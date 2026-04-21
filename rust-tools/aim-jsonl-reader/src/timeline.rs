// Timeline handle — Phase 6 backend that stitches multiple JSONL files
// into ONE continuous, per-agent transcript.
//
// Design:
//   - A TimelineHandle owns a Vec<Arc<SessionHandle>> (one per file).
//   - Files are sorted globally by their first-entry timestamp ASC.
//   - A stitched "global-line index" is built: a sparse mapping
//     (globalLineIndex → (fileIndex, localLineIndex)) at stride 1000.
//   - read_timeline_range, search_timeline, and context_at all delegate
//     down to the per-file primitives after doing an O(log N) lookup
//     in the sparse array.
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

use crate::context::{context_limit_for_model, Buckets};
use crate::reader::SessionHandle;
use crate::search::{snippet_of, SearchKind};

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

    /// Run a search across every file in the timeline, then sort by
    /// global line ASC. Unlike the per-file search, there is no match
    /// limit — the Rust side streams all matches. Callers that only
    /// want the first N should post-truncate.
    pub fn search(&self, kind: &SearchKind) -> Result<Vec<Value>> {
        let mut out: Vec<Value> = Vec::new();
        // Running global offset is implicit in the stitch.
        for (fidx, f) in self.files.iter().enumerate() {
            let global_offset = file_global_offset(&self.files, fidx);
            let data: &[u8] = &f.handle.mmap[..];
            let mut line_no: u64 = 0;
            let mut line_start: usize = 0;

            while line_start < data.len() {
                let line_end = memchr_newline(data, line_start).unwrap_or(data.len());
                let line = &data[line_start..line_end];

                if let Some(match_offset) = match_line(line, kind) {
                    let byte_offset = (line_start + match_offset) as u64;
                    let global = global_offset + line_no;
                    out.push(json!({
                        "globalLineIndex": global,
                        "laneId":          f.lane_id,
                        "sessionId":       f.handle.id,
                        "fileIndex":       fidx,
                        "localLineIndex":  line_no,
                        "byteOffset":      byte_offset,
                        "snippet":         snippet_of(line, match_offset),
                    }));
                }

                line_start = if line_end < data.len() { line_end + 1 } else { line_end + 1 };
                line_no += 1;
            }
        }

        // Sort globally by global_line. Per-file scan is already in local
        // order; sorting after we merge gives the merged timeline view.
        out.sort_by_key(|v| v.get("globalLineIndex").and_then(Value::as_u64).unwrap_or(0));
        Ok(out)
    }

    /// context_at — accumulate categorical buckets up to an anchor, plus
    /// a phase history split on isCompactSummary.
    ///
    /// Anchor resolution: the caller provides EITHER an anchor uuid OR a
    /// global line index. If a uuid is provided, we walk until we find
    /// the matching entry; otherwise we walk to `globalLineIndex` inclusive.
    ///
    /// Returns:
    ///   cumulative       — categorical buckets for [0..=anchor]
    ///   exactAtCursor    — same as cumulative (simplest correct version
    ///                       per the task spec; §5 of plan notes the
    ///                       more nuanced semantics are deferred)
    ///   phaseHistory     — vector of {phaseId, pre, peak, post} entries
    ///                       split on isCompactSummary: true markers.
    pub fn context_at(&self, target: ContextAtTarget) -> Result<Value> {
        // Walk files in order; within each file walk lines in order.
        // Stop after we pass the anchor.
        let mut cumulative = Buckets::default();
        // Phase bookkeeping: at least one phase exists.
        let mut phases: Vec<PhaseAcc> = vec![PhaseAcc::default()];
        let mut running_phase_total: u64 = 0;
        let mut running_global: u64 = 0;
        let mut anchor_global: Option<u64> = None;

        'outer: for file in self.files.iter() {
            let path = &file.handle.path;
            let f = File::open(path).context("open jsonl for context_at")?;
            let mut reader = BufReader::with_capacity(1 << 20, f);
            let mut buf = Vec::<u8>::with_capacity(4096);

            loop {
                buf.clear();
                let n = reader.read_until(b'\n', &mut buf).context("read_until context_at")?;
                if n == 0 {
                    break;
                }
                let slice = if buf.ends_with(b"\n") { &buf[..buf.len() - 1] } else { &buf[..] };
                if slice.is_empty() {
                    continue;
                }
                let value: Value = match serde_json::from_slice(slice) {
                    Ok(v) => v,
                    Err(_) => {
                        running_global += 1;
                        continue;
                    }
                };

                // Before we touch this line, check: did we already reach
                // the anchor on the PREVIOUS line? If so, we include it
                // and stop after.
                let uuid_here = value.get("uuid").and_then(Value::as_str);
                let is_target_uuid = match &target {
                    ContextAtTarget::Uuid(u) => uuid_here == Some(u.as_str()),
                    ContextAtTarget::GlobalLine(_) => false,
                };
                let is_target_global = match &target {
                    ContextAtTarget::GlobalLine(g) => *g == running_global,
                    ContextAtTarget::Uuid(_) => false,
                };

                // Classify — this mutates cumulative AND running_phase_total.
                let is_compact = value
                    .get("isCompactSummary")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                if is_compact {
                    // Close the current phase, open a new one.
                    let pre_for_next = running_phase_total;
                    if let Some(last) = phases.last_mut() {
                        last.post = Some(running_phase_total);
                    }
                    phases.push(PhaseAcc {
                        pre:  pre_for_next,
                        peak: pre_for_next,
                        post: None,
                    });
                } else {
                    classify_for_cumulative(&value, &mut cumulative, &mut running_phase_total);
                    if let Some(last) = phases.last_mut() {
                        if running_phase_total > last.peak {
                            last.peak = running_phase_total;
                        }
                    }
                }

                if is_target_uuid || is_target_global {
                    // Record the global index of the anchor line and stop
                    // the outer walk — we already classified it above, so
                    // the anchor is included in the cumulative buckets.
                    anchor_global = Some(running_global);
                    break 'outer;
                }

                running_global += 1;
            }
        }

        let limit = cumulative
            .model_id
            .as_deref()
            .map(context_limit_for_model)
            .unwrap_or(200_000);
        let total = cumulative.system_prompt
            + cumulative.system_tools
            + cumulative.mcp_tools
            + cumulative.custom_agents
            + cumulative.memory
            + cumulative.messages;
        let free_space = limit.saturating_sub(total);

        let buckets_json = json!({
            "systemPrompt":       cumulative.system_prompt,
            "systemTools":        cumulative.system_tools,
            "mcpTools":           cumulative.mcp_tools,
            "customAgents":       cumulative.custom_agents,
            "memory":             cumulative.memory,
            "messages":           cumulative.messages,
            "cacheRead":          cumulative.cache_read,
            "total":              total,
            "freeSpace":          free_space,
            "modelContextLimit":  limit,
            "approximate":        cumulative.approximate,
            "modelId":            cumulative.model_id,
        });

        let phase_history: Vec<Value> = phases
            .iter()
            .enumerate()
            .map(|(idx, p)| {
                json!({
                    "phaseId": idx as u64,
                    "pre":     p.pre,
                    "peak":    p.peak,
                    "post":    p.post,
                })
            })
            .collect();

        Ok(json!({
            "anchorGlobalLine":  anchor_global,
            "cumulative":        buckets_json,
            "exactAtCursor":     buckets_json,
            "phaseHistory":      phase_history,
        }))
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

pub enum ContextAtTarget {
    Uuid(String),
    GlobalLine(u64),
}

#[derive(Default, Debug)]
struct PhaseAcc {
    pre:  u64,
    peak: u64,
    post: Option<u64>,
}

/// Classify a line for the cumulative buckets.
///
/// This mirrors `context::classify` but also advances `running_phase_total`
/// for the phase-history feature. Unlike the single-file breakdown, we
/// do NOT use a shared Buckets.seen_request_ids field — each cumulative
/// accumulator has its own set. Callers must pass a fresh Buckets when
/// starting a new cumulative walk.
fn classify_for_cumulative(
    v: &Value,
    b: &mut Buckets,
    running_phase_total: &mut u64,
) {
    // Model id captured once.
    if b.model_id.is_none() {
        if let Some(m) = v.get("model").and_then(Value::as_str) {
            b.model_id = Some(m.to_string());
        } else if let Some(m) = v
            .get("message")
            .and_then(|m| m.get("model"))
            .and_then(Value::as_str)
        {
            b.model_id = Some(m.to_string());
        }
    }

    let ty = v.get("type").and_then(Value::as_str);
    let role = v.get("role").and_then(Value::as_str);
    let source = v.get("source").and_then(Value::as_str);

    // Memory.
    if ty == Some("memory") || source == Some("claude-md") {
        let t = estimate_tokens_for(v, b);
        b.memory = b.memory.saturating_add(t);
        return;
    }
    match ty {
        Some("system-prompt") => {
            let t = estimate_tokens_for(v, b);
            b.system_prompt = b.system_prompt.saturating_add(t);
            return;
        }
        Some("agent-definition") => {
            let t = estimate_tokens_for(v, b);
            b.custom_agents = b.custom_agents.saturating_add(t);
            return;
        }
        Some("tool_use") => {
            let name = v.get("name").and_then(Value::as_str).unwrap_or("");
            let t = estimate_tokens_for(v, b);
            if name.starts_with("mcp__") {
                b.mcp_tools = b.mcp_tools.saturating_add(t);
            } else {
                b.system_tools = b.system_tools.saturating_add(t);
            }
            return;
        }
        Some("tool_result") => {
            let t = estimate_tokens_for(v, b);
            b.messages = b.messages.saturating_add(t);
            *running_phase_total = running_phase_total.saturating_add(t);
            return;
        }
        _ => {}
    }

    match role {
        Some("user") => {
            if let Some(u) = usage_field_local(v, "input_tokens") {
                b.messages = b.messages.saturating_add(u);
                *running_phase_total = running_phase_total.saturating_add(u);
            }
        }
        Some("assistant") => {
            if let Some(rid) = v.get("requestId").and_then(Value::as_str) {
                if !b.seen_request_ids.insert(rid.to_string()) {
                    return;
                }
            }
            let toks = if let Some(u) = usage_field_local(v, "output_tokens") {
                u
            } else {
                let t = estimate_tokens_for(v, b);
                t
            };
            b.messages = b.messages.saturating_add(toks);
            *running_phase_total = running_phase_total.saturating_add(toks);
            if let Some(u) = usage_field_local(v, "cache_read_input_tokens") {
                b.cache_read = b.cache_read.saturating_add(u);
            }
        }
        _ => {}
    }
}

fn usage_field_local(v: &Value, field: &str) -> Option<u64> {
    v.get("usage").and_then(|u| u.get(field)).and_then(Value::as_u64)
        .or_else(|| {
            v.get("message")
                .and_then(|m| m.get("usage"))
                .and_then(|u| u.get(field))
                .and_then(Value::as_u64)
        })
}

/// Estimate tokens — same heuristic as context::estimate_tokens.
fn estimate_tokens_for(v: &Value, b: &mut Buckets) -> u64 {
    if let Some(u) = usage_field_local(v, "output_tokens") {
        return u;
    }
    if let Some(u) = usage_field_local(v, "input_tokens") {
        return u;
    }
    let mut chars: u64 = 0;
    for field in ["content", "text", "input", "message", "prompt", "output"] {
        match v.get(field) {
            Some(Value::String(s)) => {
                chars = chars.saturating_add(s.len() as u64);
            }
            Some(Value::Array(a)) => {
                for item in a {
                    match item {
                        Value::String(s) => {
                            chars = chars.saturating_add(s.len() as u64);
                        }
                        Value::Object(_) => {
                            if let Some(t) = item.get("text").and_then(Value::as_str) {
                                chars = chars.saturating_add(t.len() as u64);
                            } else {
                                chars = chars.saturating_add(item.to_string().len() as u64);
                            }
                        }
                        _ => {}
                    }
                }
            }
            Some(Value::Object(_)) => {
                if let Some(inner) =
                    v.get(field).and_then(|o| o.get("text")).and_then(Value::as_str)
                {
                    chars = chars.saturating_add(inner.len() as u64);
                } else if let Some(obj) = v.get(field) {
                    chars = chars.saturating_add(obj.to_string().len() as u64);
                }
            }
            _ => {}
        }
    }
    b.approximate = true;
    chars / 4
}

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

fn file_global_offset(files: &[TimelineFile], target_idx: usize) -> u64 {
    let mut offset: u64 = 0;
    for (i, f) in files.iter().enumerate() {
        if i == target_idx {
            return offset;
        }
        offset = offset.saturating_add(f.line_count);
    }
    offset
}

fn memchr_newline(data: &[u8], from: usize) -> Option<usize> {
    let slice = &data[from..];
    for (i, b) in slice.iter().enumerate() {
        if *b == b'\n' {
            return Some(from + i);
        }
    }
    None
}

fn match_line(line: &[u8], kind: &SearchKind) -> Option<usize> {
    match kind {
        SearchKind::Substring { needle, case_insensitive } => {
            if *case_insensitive {
                substring_find_ci(line, needle)
            } else {
                substring_find(line, needle)
            }
        }
        SearchKind::Regex { re } => re.find(line).map(|m| m.start()),
    }
}

fn substring_find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || needle.len() > haystack.len() {
        return if needle.is_empty() { Some(0) } else { None };
    }
    let n = needle.len();
    for i in 0..=haystack.len() - n {
        if &haystack[i..i + n] == needle {
            return Some(i);
        }
    }
    None
}

fn substring_find_ci(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || needle.len() > haystack.len() {
        return if needle.is_empty() { Some(0) } else { None };
    }
    let n = needle.len();
    let mut lc_needle = Vec::with_capacity(n);
    for &b in needle {
        lc_needle.push(ascii_to_lower(b));
    }
    for i in 0..=haystack.len() - n {
        let mut matches = true;
        for j in 0..n {
            if ascii_to_lower(haystack[i + j]) != lc_needle[j] {
                matches = false;
                break;
            }
        }
        if matches {
            return Some(i);
        }
    }
    None
}

#[inline]
fn ascii_to_lower(b: u8) -> u8 {
    if (b'A'..=b'Z').contains(&b) {
        b + 32
    } else {
        b
    }
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

// Main uses `crate::search::compile_regex` directly when dispatching
// search_timeline; no alias needed here. The timeline module exposes
// the execution primitives (TimelineHandle::search) but delegates regex
// compilation to its established home in `search.rs`.
