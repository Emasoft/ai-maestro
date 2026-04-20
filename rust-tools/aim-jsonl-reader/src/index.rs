// Sparse line-index sidecar (the `.aimidx` file).
//
// Design:
//   - One entry every N lines (SPARSE_STRIDE = 1000). Each entry maps
//     line_number -> byte_offset of the start of that line.
//   - Binary layout: 16 bytes per entry, two little-endian u64s.
//   - ASCII header: "AIMIDX01\n<mtime-ns>\n<file-size>\n<line-count>\n"
//     Including line_count in the header lets the caller know the total
//     without re-scanning the whole file.
//   - The sidecar lives next to the JSONL at "<jsonl-path>.aimidx".
//
// Invariants:
//   - We never write into the JSONL file itself. Sidecar writes go
//     through a temp file + atomic rename so a partially-written index
//     never appears on disk.
//   - We never `.collect()` lines. Indexing is a streaming scan via
//     BufReader::read_line with offset tracking.

use std::fs::{self, File, OpenOptions};
use std::io::{self, BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use anyhow::{Context, Result};

pub const SPARSE_STRIDE: u64 = 1000;
pub const INDEX_VERSION: &str = "AIMIDX01";
pub const SIDECAR_SUFFIX: &str = ".aimidx";

/// One sparse-index entry: line_number + byte_offset.
/// `line_number` is 0-based. `byte_offset` is the start-of-line offset
/// within the JSONL file. Both stored as little-endian u64s on disk.
#[derive(Debug, Clone, Copy)]
pub struct IndexEntry {
    pub line:        u64,
    pub byte_offset: u64,
}

#[derive(Debug)]
pub struct SparseIndex {
    pub jsonl_path:  PathBuf,
    pub file_size:   u64,
    pub mtime_ns:    u128,
    pub line_count:  u64,
    pub entries:     Vec<IndexEntry>,
}

impl SparseIndex {
    /// Sidecar path for a given JSONL path. `/foo/bar.jsonl` ->
    /// `/foo/bar.jsonl.aimidx`.
    pub fn sidecar_path(jsonl_path: &Path) -> PathBuf {
        let mut s = jsonl_path.as_os_str().to_owned();
        s.push(SIDECAR_SUFFIX);
        PathBuf::from(s)
    }

    /// Load an existing index and validate it against the JSONL's
    /// current mtime+size. Returns Ok(Some(idx)) if valid, Ok(None) if
    /// stale or missing, Err only on real I/O failures (not stale).
    pub fn load_if_valid(jsonl_path: &Path) -> Result<Option<Self>> {
        let sidecar = Self::sidecar_path(jsonl_path);
        if !sidecar.exists() {
            return Ok(None);
        }

        let jsonl_meta = match fs::metadata(jsonl_path) {
            Ok(m) => m,
            Err(e) => return Err(e).context("stat jsonl for index validation"),
        };
        let jsonl_size = jsonl_meta.len();
        let jsonl_mtime_ns = mtime_ns(&jsonl_meta.modified().unwrap_or(SystemTime::UNIX_EPOCH));

        let mut f = BufReader::new(File::open(&sidecar).context("open sidecar")?);

        // Read header: version line, mtime line, size line, line-count line.
        let mut version = String::new();
        f.read_line(&mut version).context("read sidecar version")?;
        if version.trim_end() != INDEX_VERSION {
            // Unknown version — treat as stale; we'll rebuild.
            return Ok(None);
        }

        let mut mtime_line = String::new();
        f.read_line(&mut mtime_line).context("read sidecar mtime")?;
        let mut size_line = String::new();
        f.read_line(&mut size_line).context("read sidecar size")?;
        let mut count_line = String::new();
        f.read_line(&mut count_line).context("read sidecar line-count")?;

        let sidecar_mtime_ns: u128 = match mtime_line.trim_end().parse() {
            Ok(v) => v,
            Err(_) => return Ok(None),
        };
        let sidecar_size: u64 = match size_line.trim_end().parse() {
            Ok(v) => v,
            Err(_) => return Ok(None),
        };
        let sidecar_line_count: u64 = match count_line.trim_end().parse() {
            Ok(v) => v,
            Err(_) => return Ok(None),
        };

        if sidecar_size != jsonl_size || sidecar_mtime_ns != jsonl_mtime_ns {
            // JSONL changed since the index was written. Drop.
            return Ok(None);
        }

        // Read the binary body. Each entry is 16 bytes.
        let mut body = Vec::new();
        f.read_to_end(&mut body).context("read sidecar body")?;
        if body.len() % 16 != 0 {
            // Corrupted — treat as stale.
            return Ok(None);
        }

        let mut entries = Vec::with_capacity(body.len() / 16);
        for chunk in body.chunks_exact(16) {
            let line = u64::from_le_bytes(chunk[0..8].try_into().unwrap());
            let byte_offset = u64::from_le_bytes(chunk[8..16].try_into().unwrap());
            entries.push(IndexEntry { line, byte_offset });
        }

        Ok(Some(SparseIndex {
            jsonl_path:  jsonl_path.to_path_buf(),
            file_size:   jsonl_size,
            mtime_ns:    jsonl_mtime_ns,
            line_count:  sidecar_line_count,
            entries,
        }))
    }

    /// Build a new sparse index by streaming the JSONL. Writes the
    /// sidecar atomically (temp file + rename). Returns the built index.
    pub fn build_and_persist(jsonl_path: &Path) -> Result<Self> {
        let jsonl_meta = fs::metadata(jsonl_path).context("stat jsonl for index build")?;
        let file_size = jsonl_meta.len();
        let mtime_ns = mtime_ns(&jsonl_meta.modified().unwrap_or(SystemTime::UNIX_EPOCH));

        // Always include an entry for line 0 at offset 0 so read_range
        // of the first 1000 lines can start without a backwards scan.
        let mut entries: Vec<IndexEntry> = Vec::new();
        entries.push(IndexEntry { line: 0, byte_offset: 0 });

        let mut line_count: u64 = 0;

        // Streaming scan: read one line at a time, tracking offsets.
        // We don't buffer lines. Memory usage is O(entries) which is
        // line_count / 1000 — a 2 GB file with 1M lines needs ~16 KB.
        let mut reader = BufReader::with_capacity(1 << 20, File::open(jsonl_path)
            .context("open jsonl for index build")?);
        let mut offset: u64 = 0;
        let mut buf = Vec::<u8>::with_capacity(4096);
        loop {
            buf.clear();
            let n = reader.read_until(b'\n', &mut buf).context("read_until")?;
            if n == 0 {
                break;
            }
            line_count += 1;
            offset += n as u64;
            // Emit an entry for every SPARSE_STRIDE-th boundary. The
            // entry's `line` is the line number of the NEXT line, so
            // its byte_offset is exactly the current `offset` cursor.
            if line_count % SPARSE_STRIDE == 0 {
                entries.push(IndexEntry { line: line_count, byte_offset: offset });
            }
        }

        // Note: `offset` should equal `file_size` once EOF is hit — if
        // it doesn't, the file was truncated between stat and scan.
        // We proceed anyway; a subsequent open will catch the drift via
        // the mtime/size check.

        let idx = SparseIndex {
            jsonl_path: jsonl_path.to_path_buf(),
            file_size,
            mtime_ns,
            line_count,
            entries,
        };

        idx.persist()?;
        Ok(idx)
    }

    fn persist(&self) -> Result<()> {
        let sidecar = Self::sidecar_path(&self.jsonl_path);
        // Write to <sidecar>.tmp-<pid> and rename. Atomic on POSIX.
        let pid = std::process::id();
        let tmp = sidecar.with_extension(format!("aimidx.tmp-{pid}"));

        {
            let mut f = OpenOptions::new()
                .create(true).truncate(true).write(true)
                .open(&tmp).context("create sidecar tmp")?;
            writeln!(f, "{INDEX_VERSION}").context("write version")?;
            writeln!(f, "{}", self.mtime_ns).context("write mtime")?;
            writeln!(f, "{}", self.file_size).context("write size")?;
            writeln!(f, "{}", self.line_count).context("write line-count")?;
            for e in &self.entries {
                f.write_all(&e.line.to_le_bytes()).context("write entry line")?;
                f.write_all(&e.byte_offset.to_le_bytes()).context("write entry offset")?;
            }
            f.sync_all().ok();
        }
        fs::rename(&tmp, &sidecar).context("rename sidecar into place")?;
        Ok(())
    }

    /// Locate the largest index entry whose line <= target_line. Used
    /// to seek to the closest checkpoint before a random-access read.
    /// Binary search on self.entries, which is sorted by construction.
    pub fn floor_entry(&self, target_line: u64) -> IndexEntry {
        if self.entries.is_empty() {
            return IndexEntry { line: 0, byte_offset: 0 };
        }
        let mut lo = 0usize;
        let mut hi = self.entries.len() - 1;
        while lo < hi {
            let mid = (lo + hi + 1) / 2;
            if self.entries[mid].line <= target_line {
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }
        self.entries[lo]
    }
}

/// Convert a SystemTime into ns-since-epoch as u128. Falls back to 0 on
/// pre-epoch times (shouldn't happen for real files).
fn mtime_ns(t: &SystemTime) -> u128 {
    t.duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}

/// Seek a File to the start of the Nth line. Uses the floor entry as a
/// checkpoint, then scans forward one line at a time. Memory usage is
/// O(1) regardless of file size.
pub fn seek_to_line(file: &mut File, idx: &SparseIndex, target_line: u64) -> io::Result<()> {
    let entry = idx.floor_entry(target_line);
    file.seek(SeekFrom::Start(entry.byte_offset))?;
    if entry.line == target_line {
        return Ok(());
    }
    let mut reader = BufReader::with_capacity(1 << 16, file.try_clone()?);
    let mut current = entry.line;
    let mut consumed: u64 = 0;
    let mut buf = Vec::<u8>::with_capacity(4096);
    while current < target_line {
        buf.clear();
        let n = reader.read_until(b'\n', &mut buf)?;
        if n == 0 {
            break;
        }
        consumed += n as u64;
        current += 1;
    }
    // The BufReader we wrapped may have read-ahead past what we needed.
    // Re-seek the underlying file to exactly where we want.
    file.seek(SeekFrom::Start(entry.byte_offset + consumed))?;
    Ok(())
}
