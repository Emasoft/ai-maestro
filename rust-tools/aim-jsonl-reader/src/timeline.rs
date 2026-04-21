// Timeline handle — Phase 6 backend that stitches multiple JSONL files
// into ONE continuous, per-agent transcript.
//
// This commit introduces the two "read-only" commands — `open_timeline`
// and `read_timeline_range` — plus the core data structures. The
// `search_timeline` and `context_at` commands land in a follow-up.
//
// Design:
//   - A TimelineHandle owns a Vec<Arc<SessionHandle>> (one per file).
//   - Files are sorted globally by their first-entry timestamp ASC.
//   - A stitched "global-line index" is built: a sparse mapping
//     (globalLineIndex → (fileIndex, localLineIndex)) at stride 1000.
//   - read_timeline_range binary-searches the sparse array to locate
//     (fileIndex, localLineIndex) pairs, then delegates to the existing
//     per-file reader.
//
// Invariants:
//   - Never materialize the whole timeline into memory. Per-file mmaps
//     are the only large allocation, and they're kernel-paged on demand.
//   - Every file is still opened via SessionHandle::open(), so the
//     existing sparse .aimidx sidecar + panic-safety apply.
//   - The lane id is supplied by the caller; it's opaque to the Rust
//     side — the service layer maps agent-id/slug/worktree to a short
//     label and passes it through.
//   - Timestamp sort is done at open time. Within a file we preserve
//     the original append order (JSONL is already time-ordered per-file
//     by Claude Code's writer).

use std::collections::HashSet;
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{Context, Result};
use serde_json::{json, Value};

use crate::reader::SessionHandle;

/// Stride between entries in the stitched sparse index.
/// Balances build cost (one write per N lines) vs lookup cost
/// (≤ STRIDE linear scan per query). 1000 matches the per-file index.
const TIMELINE_STRIDE: u64 = 1000;

/// One file in a Timeline.
pub struct TimelineFile {
    pub handle:          Arc<SessionHandle>,
    pub lane_id:         String,
    /// ISO-8601 string of the file's first entry timestamp (best-effort).
    pub first_timestamp: String,
    /// ISO-8601 string of the file's last entry timestamp (best-effort).
    pub last_timestamp:  String,
    /// Line count — copied from handle.line_count() so we don't traverse
    /// the Arc for every lookup.
    pub line_count:      u64,
}

/// One stitched sparse-index entry.
/// Maps a global line number to the file + local line number.
#[derive(Debug, Clone, Copy)]
pub struct StitchEntry {
    pub global_line: u64,
    pub file_index:  u32,
    pub local_line:  u64,
}

pub struct TimelineHandle {
    pub id:             String,
    pub files:          Vec<TimelineFile>,
    pub stitch:         Vec<StitchEntry>,
    pub total_lines:    u64,
}

impl TimelineHandle {
    /// Build a TimelineHandle from a list of (path, laneId) pairs.
    ///
    /// Opens each file (reusing its .aimidx sidecar if present), reads
    /// the first + last timestamp, sorts by first timestamp ASC, and
    /// builds the stitched sparse index.
    pub fn open(inputs: &[(PathBuf, String)]) -> Result<Self> {
        let mut files: Vec<TimelineFile> = Vec::with_capacity(inputs.len());
        for (path, lane_id) in inputs {
            if !path.exists() {
                anyhow::bail!("no such file: {}", path.display());
            }
            let handle = SessionHandle::open(path)
                .with_context(|| format!("open timeline file {}", path.display()))?;
            let line_count = handle.line_count();
            let (first_ts, last_ts) = read_first_and_last_timestamp(path, &handle)
                .unwrap_or_else(|_| (String::new(), String::new()));
            files.push(TimelineFile {
                handle:          Arc::new(handle),
                lane_id:         lane_id.clone(),
                first_timestamp: first_ts,
                last_timestamp:  last_ts,
                line_count,
            });
        }

        // Sort files by first_timestamp ASC. Files with blank timestamps
        // are pushed to the end (stable) — they still participate but
        // never appear before timestamped entries.
        files.sort_by(|a, b| {
            match (a.first_timestamp.is_empty(), b.first_timestamp.is_empty()) {
                (true, true) => std::cmp::Ordering::Equal,
                (true, false) => std::cmp::Ordering::Greater,
                (false, true) => std::cmp::Ordering::Less,
                (false, false) => a.first_timestamp.cmp(&b.first_timestamp),
            }
        });

        // Build the stitched sparse index. One entry per stride, plus one
        // at the very start of every file (so file-boundary seeks are
        // O(1) to land on the right file).
        let mut stitch: Vec<StitchEntry> = Vec::new();
        let mut running_global: u64 = 0;
        for (fidx, f) in files.iter().enumerate() {
            if f.line_count == 0 {
                // Still emit a boundary entry so binary-search can find
                // this file (its range is empty but the offset is real).
                stitch.push(StitchEntry {
                    global_line: running_global,
                    file_index:  fidx as u32,
                    local_line:  0,
                });
                continue;
            }
            // File-start entry — always present.
            stitch.push(StitchEntry {
                global_line: running_global,
                file_index:  fidx as u32,
                local_line:  0,
            });
            // Strided entries within the file.
            let mut local = TIMELINE_STRIDE;
            while local < f.line_count {
                stitch.push(StitchEntry {
                    global_line: running_global + local,
                    file_index:  fidx as u32,
                    local_line:  local,
                });
                local = local.saturating_add(TIMELINE_STRIDE);
            }
            running_global = running_global.saturating_add(f.line_count);
        }
        let total_lines = running_global;

        let id = derive_id(&files);

        Ok(TimelineHandle {
            id,
            files,
            stitch,
            total_lines,
        })
    }

    /// Binary-search the stitch for the largest entry with
    /// global_line <= target. Returns None if the stitch is empty
    /// (only true for an empty-input timeline).
    fn floor_entry(&self, target: u64) -> Option<StitchEntry> {
        if self.stitch.is_empty() {
            return None;
        }
        // Standard upper_bound - 1.
        let mut lo: usize = 0;
        let mut hi: usize = self.stitch.len();
        while lo < hi {
            let mid = (lo + hi) / 2;
            if self.stitch[mid].global_line <= target {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        if lo == 0 {
            Some(self.stitch[0])
        } else {
            Some(self.stitch[lo - 1])
        }
    }

    /// Read rows in the inclusive [from_global, to_global] range.
    /// Returns one entry per emitted row, with file attribution.
    pub fn read_range(&self, from_global: u64, to_global: u64) -> Result<Vec<Value>> {
        if from_global > to_global || self.total_lines == 0 {
            return Ok(Vec::new());
        }
        let effective_to = to_global.min(self.total_lines.saturating_sub(1));
        if from_global > effective_to {
            return Ok(Vec::new());
        }

        let mut out: Vec<Value> = Vec::new();
        let mut global = from_global;
        while global <= effective_to {
            // Locate the (fileIndex, localLine) for `global`.
            let entry = match self.floor_entry(global) {
                Some(e) => e,
                None => break,
            };
            let fidx = entry.file_index as usize;
            let file = &self.files[fidx];
            // Local offset within this file for the requested global.
            let local_start = entry.local_line + (global - entry.global_line);

            // How many lines of THIS file remain after local_start.
            let file_remaining = if file.line_count == 0 {
                0
            } else {
                file.line_count - local_start
            };
            if file_remaining == 0 {
                // Advance to the next file boundary.
                global = (entry.global_line.saturating_add(file.line_count)).max(global + 1);
                continue;
            }

            // How many lines we still want total.
            let total_remaining = effective_to - global + 1;
            let take = file_remaining.min(total_remaining);
            let local_end = local_start + take - 1;

            let lines = file
                .handle
                .read_range(local_start, local_end)
                .with_context(|| format!("timeline read_range on file {}", file.handle.path.display()))?;

            for (offset_idx, raw) in lines.into_iter().enumerate() {
                let local_line = local_start + offset_idx as u64;
                let global_line = global + offset_idx as u64;
                out.push(json!({
                    "sessionId":       file.handle.id,
                    "laneId":          file.lane_id,
                    "fileIndex":       fidx,
                    "localLineIndex":  local_line,
                    "globalLineIndex": global_line,
                    "raw":             raw,
                }));
            }

            global = global.saturating_add(take);
        }

        Ok(out)
    }

    /// Manifest description suitable for a Node-side JSON response.
    pub fn manifest(&self) -> Value {
        // Group files by lane for the response summary.
        let mut lane_order: Vec<String> = Vec::new();
        let mut lane_first_ts: std::collections::HashMap<String, String> =
            std::collections::HashMap::new();
        let mut lane_last_ts: std::collections::HashMap<String, String> =
            std::collections::HashMap::new();
        let mut lane_line_count: std::collections::HashMap<String, u64> =
            std::collections::HashMap::new();
        let mut lane_file_indexes: std::collections::HashMap<String, Vec<u64>> =
            std::collections::HashMap::new();

        for (fidx, f) in self.files.iter().enumerate() {
            if !lane_first_ts.contains_key(&f.lane_id) {
                lane_order.push(f.lane_id.clone());
                lane_first_ts.insert(f.lane_id.clone(), f.first_timestamp.clone());
            } else if let Some(prev) = lane_first_ts.get(&f.lane_id) {
                if !f.first_timestamp.is_empty()
                    && (prev.is_empty() || &f.first_timestamp < prev)
                {
                    lane_first_ts.insert(f.lane_id.clone(), f.first_timestamp.clone());
                }
            }
            match lane_last_ts.get(&f.lane_id) {
                Some(prev) if !prev.is_empty() && &f.last_timestamp <= prev => {}
                _ => {
                    lane_last_ts.insert(f.lane_id.clone(), f.last_timestamp.clone());
                }
            }
            *lane_line_count.entry(f.lane_id.clone()).or_insert(0) += f.line_count;
            lane_file_indexes
                .entry(f.lane_id.clone())
                .or_default()
                .push(fidx as u64);
        }

        let lanes: Vec<Value> = lane_order
            .iter()
            .map(|lane| {
                let default = String::new();
                let first = lane_first_ts.get(lane).unwrap_or(&default);
                let last = lane_last_ts.get(lane).unwrap_or(&default);
                let count = lane_line_count.get(lane).copied().unwrap_or(0);
                let default_vec: Vec<u64> = Vec::new();
                let files = lane_file_indexes.get(lane).unwrap_or(&default_vec);
                json!({
                    "laneId":             lane,
                    "fileIndexes":        files,
                    "firstTimestampIso":  first,
                    "lastTimestampIso":   last,
                    "lineCount":          count,
                })
            })
            .collect();

        json!({
            "timelineId":      self.id,
            "globalLineCount": self.total_lines,
            "lanes":           lanes,
        })
    }
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

/// Scan the first and last line of `path` and extract `timestamp` if
/// present. Empty strings on any failure — the caller treats blank
/// timestamps as "sort to the end".
fn read_first_and_last_timestamp(
    path: &Path,
    handle: &SessionHandle,
) -> Result<(String, String)> {
    let first_line = {
        let mut f = File::open(path).context("open for first-ts")?;
        f.seek(SeekFrom::Start(0)).ok();
        let mut r = BufReader::new(f);
        let mut buf = String::new();
        r.read_line(&mut buf).ok();
        buf.trim_end().to_string()
    };
    let first_ts = first_line
        .and_then_extract_timestamp()
        .unwrap_or_default();

    // For the last line, use the sparse index to skip to the last
    // stride, then read to EOF.
    let last_line = {
        let lc = handle.line_count();
        if lc == 0 {
            String::new()
        } else {
            let target = lc - 1;
            // Read from target to target using the existing read_range —
            // small allocation, O(1) seek.
            match handle.read_range(target, target) {
                Ok(rows) if !rows.is_empty() => rows[0].to_string(),
                _ => String::new(),
            }
        }
    };
    // last_line from read_range is the JSON repr of the parsed Value;
    // pull `timestamp` via another parse to be safe.
    let last_ts = if last_line.is_empty() {
        String::new()
    } else {
        match serde_json::from_str::<Value>(&last_line) {
            Ok(v) => v
                .get("timestamp")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            Err(_) => String::new(),
        }
    };

    Ok((first_ts, last_ts))
}

/// Small trait to extract `timestamp` from a raw JSONL line string.
trait ExtractTimestamp {
    fn and_then_extract_timestamp(self) -> Option<String>;
}

impl ExtractTimestamp for String {
    fn and_then_extract_timestamp(self) -> Option<String> {
        if self.is_empty() {
            return None;
        }
        let v: Value = serde_json::from_str(&self).ok()?;
        v.get("timestamp")
            .and_then(Value::as_str)
            .map(|s| s.to_string())
    }
}

fn derive_id(files: &[TimelineFile]) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for f in files {
        for b in f.handle.id.as_bytes() {
            h ^= *b as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
        for b in f.lane_id.as_bytes() {
            h ^= *b as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
    }
    format!("tl-{h:016x}")
}

// ---------------------------------------------------------------------
// Registry — the module-level handle map.
// ---------------------------------------------------------------------

pub struct TimelineRegistry {
    map: std::collections::HashMap<String, TimelineHandle>,
    /// Track keys that have been seen to avoid collisions when a user
    /// re-opens the same fileset repeatedly — the fnv-based id is
    /// deterministic so this set is idempotent.
    #[allow(dead_code)]
    seen: HashSet<String>,
}

impl Default for TimelineRegistry {
    fn default() -> Self {
        TimelineRegistry {
            map: std::collections::HashMap::new(),
            seen: HashSet::new(),
        }
    }
}

impl TimelineRegistry {
    pub fn open(&mut self, inputs: &[(PathBuf, String)]) -> Result<&TimelineHandle> {
        let tl = TimelineHandle::open(inputs)?;
        let id = tl.id.clone();
        self.map.insert(id.clone(), tl);
        // Safety: we just inserted, so this unwrap never triggers.
        Ok(self.map.get(&id).unwrap())
    }

    pub fn get(&self, id: &str) -> Option<&TimelineHandle> {
        self.map.get(id)
    }

    #[allow(dead_code)]
    pub fn remove(&mut self, id: &str) -> bool {
        self.map.remove(id).is_some()
    }
}
