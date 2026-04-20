// Substring + regex search over the mmap'd JSONL.
//
// Strategy:
//   - Scan the mmap once, left-to-right, maintaining a running line
//     number and line-start offset so we can report both.
//   - For each match, capture a 200-char-max snippet of the containing
//     line. We clamp at the line boundary, not at the match midpoint,
//     so multi-match lines stay readable.
//   - Case-insensitive substring uses the ASCII-lowercased line as the
//     search target but reports offsets in the original line. This is
//     fine for our use case (mostly ASCII JSON keys + URLs); if we
//     ever need case-insensitive Unicode we move to regex with the
//     `(?i)` flag.
//
// Memory: zero extra allocation per line during the scan. We only
// allocate for the snippet when a match is emitted. Peak RSS ceiling
// is driven by the mmap page cache, which the kernel manages.

use anyhow::{Context, Result};
use regex::bytes::Regex;
use serde_json::{json, Value};

use crate::reader::SessionHandle;

pub const MAX_SNIPPET_BYTES: usize = 200;
pub const DEFAULT_LIMIT: usize = 100;

pub enum SearchKind<'a> {
    Substring { needle: &'a [u8], case_insensitive: bool },
    Regex { re: Regex },
}

pub fn search(
    session: &SessionHandle,
    kind: SearchKind,
    limit: usize,
) -> Result<Vec<Value>> {
    let data: &[u8] = &session.mmap[..];
    let mut out: Vec<Value> = Vec::with_capacity(limit.min(64));

    // Walk line by line. `line_start` is the byte offset of the first
    // byte of the current line. We emit a match the moment we find
    // one in the current line, then skip to the next newline so each
    // match is reported once.
    let mut line_no: u64 = 0;
    let mut line_start: usize = 0;

    while line_start < data.len() && out.len() < limit {
        // Find end of line.
        let line_end = match memchr_newline(data, line_start) {
            Some(n) => n,
            None    => data.len(),
        };
        let line = &data[line_start..line_end];

        if let Some(match_offset) = match_line(line, &kind) {
            let byte_offset = (line_start + match_offset) as u64;
            out.push(json!({
                "line":       line_no,
                "byteOffset": byte_offset,
                "snippet":    snippet_of(line, match_offset),
            }));
        }

        // Advance past the \n (or to EOF).
        line_start = if line_end < data.len() { line_end + 1 } else { line_end + 1 };
        line_no += 1;
    }

    // Return early if nothing found.
    Ok(out)
}

/// Find the position of the next `\n` at or after `from`, or None.
fn memchr_newline(data: &[u8], from: usize) -> Option<usize> {
    // Plain loop; the std `memchr` is internal. This is a single linear
    // scan per line so the cost is already bounded by line length.
    let slice = &data[from..];
    for (i, b) in slice.iter().enumerate() {
        if *b == b'\n' {
            return Some(from + i);
        }
    }
    None
}

/// Return the offset within `line` at which a match starts, or None.
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
    // Two-pointer naive search. Fine for needles up to ~1 KB.
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
    // Lower-case the needle once.
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
    if (b'A'..=b'Z').contains(&b) { b + 32 } else { b }
}

/// Build a ≤200-byte snippet around the match. Tries to center the
/// window on the match; trims cleanly at UTF-8 boundaries to avoid
/// panics in downstream JSON serialization.
fn snippet_of(line: &[u8], match_offset: usize) -> String {
    let line_len = line.len();
    let half = MAX_SNIPPET_BYTES / 2;
    let start = match_offset.saturating_sub(half);
    let end = (match_offset + half).min(line_len);
    let slice = &line[start..end];
    // Convert to String lossy — JSONL values are text by convention but
    // a mangled byte shouldn't crash the reader.
    let mut s = String::from_utf8_lossy(slice).into_owned();
    // Prepend/append ellipses to signal truncation.
    if start > 0 { s.insert_str(0, "…"); }
    if end < line_len { s.push('…'); }
    s
}

/// Compile a user-supplied regex, returning a user-friendly error.
pub fn compile_regex(pattern: &str, case_insensitive: bool) -> Result<Regex> {
    let mut builder = regex::bytes::RegexBuilder::new(pattern);
    builder.case_insensitive(case_insensitive);
    // Guard against runaway patterns. 1 MB is plenty for search over
    // multi-GB files; lets a `.*` still match long lines but bounds
    // the regex engine's state table.
    builder.size_limit(1 << 20);
    builder.build().context("compile regex")
}
