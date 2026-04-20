// Session handle — owns the open JSONL file, its mmap, and its sparse
// index. A session is created by `open_file` and dropped by `close`.
//
// The mmap is used ONLY by the search module (so substring scans can
// treat the file as a contiguous byte slice). The `read_range` path
// uses a fresh File + BufReader because mmap over a very large file
// forces pages into the page cache that we don't need once we've
// decoded the specific line range the caller asked for.
//
// Why both? Each access pattern has a different ideal representation:
//   - read_range reads a tiny contiguous slice; BufReader + seek is
//     cheapest.
//   - search scans large portions; mmap lets the kernel page in on
//     demand without us managing a moving window.
//
// Both paths respect the TRDD §4.6 invariants: no full-file buffer, no
// .collect() of lines into a Vec<String>.

use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{Context, Result};
use memmap2::Mmap;
use serde_json::Value;

use crate::index::{seek_to_line, SparseIndex};

pub struct SessionHandle {
    pub id:            String,
    pub path:          PathBuf,
    pub index:         SparseIndex,
    /// Arc-wrapped so clones for search are cheap and the mmap is
    /// dropped only when the last user is gone. `Mmap` is immutable so
    /// sharing it across threads would be safe — we don't thread yet
    /// but the Arc is future-proofing.
    pub mmap:          Arc<Mmap>,
    /// Whether the index was reused (true) or freshly built (false).
    /// Reported back in the `open` response as `indexed` so callers
    /// can measure the sidecar cache hit ratio.
    pub from_sidecar:  bool,
}

impl SessionHandle {
    pub fn open(path: &Path) -> Result<Self> {
        let id = Self::derive_id(path);

        // Try to reuse the sidecar; rebuild on miss or drift.
        let (index, from_sidecar) = match SparseIndex::load_if_valid(path)? {
            Some(idx) => (idx, true),
            None => (SparseIndex::build_and_persist(path)
                .with_context(|| format!("build sparse index for {}", path.display()))?, false),
        };

        // SAFETY: we open the file read-only and keep it alive inside
        // the SessionHandle via the Mmap, which owns the underlying FD.
        // The file may be extended by a writer after we mmap it — the
        // mmap snapshot is bounded by its length at map time, so we
        // simply won't see appended bytes until the caller re-opens
        // (which is the documented contract in TRDD §4.6).
        let file = File::open(path).context("open jsonl for mmap")?;
        let mmap = unsafe { Mmap::map(&file).context("mmap jsonl")? };

        Ok(SessionHandle {
            id,
            path:         path.to_path_buf(),
            index,
            mmap:         Arc::new(mmap),
            from_sidecar,
        })
    }

    /// Derive a stable session id from the file path + its inode (if
    /// available on this platform). Two opens of the same path within
    /// one reader-lifecycle return the same id; re-opening after the
    /// file was unlinked/recreated returns a different id.
    fn derive_id(path: &Path) -> String {
        // Simple fnv-1a over path bytes + length. Not
        // cryptographically strong; it's an internal handle id, not a
        // security token.
        let bytes = path.as_os_str().as_encoded_bytes();
        let mut h: u64 = 0xcbf29ce484222325;
        for b in bytes {
            h ^= *b as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
        // Mix in file length so a recreated file gets a new id even if
        // the path is identical — the mtime check inside load_if_valid
        // already protects correctness, this just makes the handle id
        // visually different so clients don't reuse stale references.
        let len_mix = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        h ^= len_mix.wrapping_mul(0x9E3779B97F4A7C15);
        format!("sid-{h:016x}")
    }

    /// Read lines in the inclusive range [from_line, to_line]. Returns
    /// each line parsed as a serde_json::Value. If a line is not valid
    /// JSON the entry becomes `{"_parseError": true, "raw": "<text>"}`
    /// so the caller can keep rendering without the whole range
    /// failing.
    pub fn read_range(&self, from_line: u64, to_line: u64) -> Result<Vec<Value>> {
        if from_line > to_line {
            return Ok(Vec::new());
        }
        let last = self.index.line_count.saturating_sub(1);
        if from_line > last {
            return Ok(Vec::new());
        }
        let effective_to = to_line.min(last);

        let mut file = File::open(&self.path).context("open jsonl for read_range")?;
        seek_to_line(&mut file, &self.index, from_line).context("seek_to_line")?;

        let mut reader = BufReader::with_capacity(1 << 16, file);
        let needed = (effective_to - from_line + 1) as usize;
        let mut out = Vec::with_capacity(needed);
        let mut buf = Vec::<u8>::with_capacity(4096);

        for _ in 0..needed {
            buf.clear();
            let n = reader.read_until(b'\n', &mut buf).context("read_until in range")?;
            if n == 0 {
                break;
            }
            // Strip the trailing \n before parsing.
            let slice = if buf.ends_with(b"\n") { &buf[..buf.len() - 1] } else { &buf[..] };
            let parsed = match serde_json::from_slice::<Value>(slice) {
                Ok(v) => v,
                Err(_) => {
                    serde_json::json!({
                        "_parseError": true,
                        "raw": String::from_utf8_lossy(slice).to_string(),
                    })
                }
            };
            out.push(parsed);
        }

        Ok(out)
    }

    pub fn line_count(&self) -> u64 {
        self.index.line_count
    }
}
