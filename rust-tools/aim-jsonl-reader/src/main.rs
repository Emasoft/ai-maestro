// aim-jsonl-reader — NDJSON server over stdin/stdout for Claude Code
// JSONL session files.
//
// Protocol (one JSON object per line):
//
//   Request:  {"cmd":"open","path":"<abs-path>"}
//   Response: {"ok":true,"sessionId":"sid-...","lineCount":N,"indexed":bool}
//
//   Request:  {"cmd":"close","sessionId":"sid-..."}
//   Response: {"ok":true}
//
//   Request:  {"cmd":"read_range","sessionId":"sid-...","fromLine":0,"toLine":10}
//   Response: {"ok":true,"lines":[...JSON Values...]}
//
//   Request:  {"cmd":"search","sessionId":"sid-...","query":"foo",
//              "kind":"substring"|"regex","caseInsensitive":bool,"limit":N}
//   Response: {"ok":true,"matches":[{"line","byteOffset","snippet"}]}
//
//   Request:  {"cmd":"context_breakdown","sessionId":"sid-..."}
//   Response: {"ok":true,...7 bucket fields...}
//
//   Request:  {"cmd":"ping"}
//   Response: {"ok":true,"version":"0.1.0"}
//
// Error response on any failure:
//   {"ok":false,"error":"<code>","detail":"<msg>"}
//
// On panic, a panic-hook emits the same shape to stdout before the
// process aborts. No panic ever reaches stderr as a stacktrace — the
// Node wrapper parses stdout only.

mod context;
mod index;
mod metadata;
mod protocol;
mod reader;
mod search;
mod timeline;

use std::collections::HashMap;
use std::io::{self, BufRead, BufReader, Write};
use std::path::PathBuf;

use serde_json::{json, Value};

use crate::protocol::{err, errors, ok, optional_bool, optional_str, optional_u64, required_str, required_u64};
use crate::reader::SessionHandle;
use crate::search::{compile_regex, search, SearchKind, DEFAULT_LIMIT};
use crate::timeline::TimelineRegistry;

/// In-process session registry. Keyed by sessionId.
struct Sessions {
    map: HashMap<String, SessionHandle>,
    /// Phase 6 §3.6 — timeline registry. Keyed by timelineId.
    timelines: TimelineRegistry,
}

impl Sessions {
    fn new() -> Self {
        Sessions {
            map:       HashMap::new(),
            timelines: TimelineRegistry::default(),
        }
    }

    fn open(&mut self, path: PathBuf) -> Result<(String, bool, u64), Value> {
        // Validate that the path exists before trying to open. A
        // dedicated error code lets the Node wrapper return a crisp
        // 404 instead of a generic open failure.
        if !path.exists() {
            return Err(err(errors::OPEN_FAILED, format!("no such file: {}", path.display())));
        }
        match SessionHandle::open(&path) {
            Ok(h) => {
                let id = h.id.clone();
                let from_sidecar = h.from_sidecar;
                let line_count = h.line_count();
                self.map.insert(h.id.clone(), h);
                Ok((id, from_sidecar, line_count))
            }
            Err(e) => Err(err(errors::OPEN_FAILED, e.to_string())),
        }
    }

    fn close(&mut self, sid: &str) -> Result<(), Value> {
        if self.map.remove(sid).is_some() {
            Ok(())
        } else {
            Err(err(errors::SESSION_NOT_FOUND, format!("no open session: {sid}")))
        }
    }

    fn get(&self, sid: &str) -> Result<&SessionHandle, Value> {
        self.map.get(sid)
            .ok_or_else(|| err(errors::SESSION_NOT_FOUND, format!("no open session: {sid}")))
    }
}

fn install_panic_hook() {
    // Replace the default hook with one that emits a JSON error line
    // on stdout so the Node wrapper's line-parser still works.
    std::panic::set_hook(Box::new(|info| {
        let msg = info.payload().downcast_ref::<&'static str>().map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "unknown panic".to_string());
        let location = info.location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_else(|| "<unknown>".to_string());
        let payload = json!({
            "ok": false,
            "error": errors::PANIC,
            "detail": format!("{msg} at {location}"),
        });
        let line = payload.to_string();
        // Best-effort: if stdout is dead there's nothing we can do.
        let _ = writeln!(io::stdout(), "{line}");
        let _ = io::stdout().flush();
    }));
}

fn dispatch(cmd: &str, req: &Value, sessions: &mut Sessions) -> Value {
    match cmd {
        "ping" => ok(json!({ "version": env!("CARGO_PKG_VERSION") })),

        "open" => {
            let path = match required_str(req, "path") {
                Ok(p) => PathBuf::from(p),
                Err(e) => return e,
            };
            match sessions.open(path) {
                Ok((sid, from_sidecar, line_count)) => ok(json!({
                    "sessionId": sid,
                    "lineCount": line_count,
                    "indexed":   from_sidecar,
                })),
                Err(e) => e,
            }
        }

        "close" => {
            let sid = match required_str(req, "sessionId") {
                Ok(s) => s,
                Err(e) => return e,
            };
            match sessions.close(sid) {
                Ok(()) => ok(json!({})),
                Err(e) => e,
            }
        }

        "read_range" => {
            let sid = match required_str(req, "sessionId") {
                Ok(s) => s,
                Err(e) => return e,
            };
            let from = match required_u64(req, "fromLine") {
                Ok(n) => n,
                Err(e) => return e,
            };
            let to = match required_u64(req, "toLine") {
                Ok(n) => n,
                Err(e) => return e,
            };
            let handle = match sessions.get(sid) {
                Ok(h) => h,
                Err(e) => return e,
            };
            match handle.read_range(from, to) {
                Ok(lines) => ok(json!({ "lines": lines })),
                Err(e)    => err(errors::READ_FAILED, e.to_string()),
            }
        }

        "search" => {
            let sid = match required_str(req, "sessionId") {
                Ok(s) => s,
                Err(e) => return e,
            };
            let query = match required_str(req, "query") {
                Ok(q) => q,
                Err(e) => return e,
            };
            let kind_str = optional_str(req, "kind", "substring");
            let case_insensitive = optional_bool(req, "caseInsensitive", true);
            let limit = optional_u64(req, "limit", DEFAULT_LIMIT as u64) as usize;
            let handle = match sessions.get(sid) {
                Ok(h) => h,
                Err(e) => return e,
            };

            let matches = match kind_str {
                "regex" => {
                    match compile_regex(query, case_insensitive) {
                        Ok(re) => match search(handle, SearchKind::Regex { re }, limit) {
                            Ok(m)  => m,
                            Err(e) => return err(errors::SEARCH_FAILED, e.to_string()),
                        },
                        Err(e) => return err(errors::SEARCH_FAILED, e.to_string()),
                    }
                }
                _ => {
                    match search(handle, SearchKind::Substring {
                        needle:          query.as_bytes(),
                        case_insensitive,
                    }, limit) {
                        Ok(m)  => m,
                        Err(e) => return err(errors::SEARCH_FAILED, e.to_string()),
                    }
                }
            };

            ok(json!({ "matches": matches }))
        }

        "context_breakdown" => {
            let sid = match required_str(req, "sessionId") {
                Ok(s) => s,
                Err(e) => return e,
            };
            let handle = match sessions.get(sid) {
                Ok(h) => h,
                Err(e) => return e,
            };
            match context::compute(&handle.path) {
                Ok(mut val) => {
                    if let Some(obj) = val.as_object_mut() {
                        obj.insert("ok".to_string(), Value::Bool(true));
                        return val;
                    }
                    ok(val)
                }
                Err(e) => err(errors::READ_FAILED, e.to_string()),
            }
        }

        // Phase 5 §3.8 — single-pass metadata analyzer. Takes a raw path
        // (NOT a sessionId) because the sessions-browser list calls this
        // BEFORE it opens a Rust-side session handle, so it can populate
        // divider-row previews, ongoing flags, and compaction counts
        // without paying for an index build. The path is validated the
        // same way `open` validates its path.
        "analyze_file_metadata" => {
            let path_str = match required_str(req, "path") {
                Ok(p) => p,
                Err(e) => return e,
            };
            let path = PathBuf::from(path_str);
            if !path.exists() {
                return err(
                    errors::OPEN_FAILED,
                    format!("no such file: {}", path.display()),
                );
            }
            match metadata::compute(&path) {
                Ok(mut val) => {
                    if let Some(obj) = val.as_object_mut() {
                        obj.insert("ok".to_string(), Value::Bool(true));
                        return val;
                    }
                    ok(val)
                }
                Err(e) => err(errors::READ_FAILED, e.to_string()),
            }
        }

        // ---------------------------------------------------------------
        // Phase 6 §3.6 — timeline commands.
        //
        // open_timeline builds a TimelineHandle from a list of {path, laneId}
        // pairs, sorts them by first-entry timestamp, builds a stitched
        // sparse index, and registers the handle. Returns the new timelineId
        // plus the manifest.
        //
        // read_timeline_range, search_timeline, and context_at all take a
        // previously-opened timelineId.
        // ---------------------------------------------------------------
        "open_timeline" => {
            let files_val = match req.get("files") {
                Some(v) => v,
                None => return err(errors::INVALID_REQUEST, "missing 'files'"),
            };
            let files_arr = match files_val.as_array() {
                Some(a) => a,
                None => return err(errors::INVALID_REQUEST, "'files' must be an array"),
            };
            if files_arr.is_empty() {
                return err(errors::INVALID_REQUEST, "'files' must be non-empty");
            }
            let mut inputs: Vec<(PathBuf, String)> = Vec::with_capacity(files_arr.len());
            for (i, item) in files_arr.iter().enumerate() {
                let path_str = match item.get("path").and_then(Value::as_str) {
                    Some(s) => s,
                    None => {
                        return err(
                            errors::INVALID_REQUEST,
                            format!("files[{i}] missing 'path'"),
                        )
                    }
                };
                let lane_id = match item.get("laneId").and_then(Value::as_str) {
                    Some(s) => s.to_string(),
                    None => {
                        return err(
                            errors::INVALID_REQUEST,
                            format!("files[{i}] missing 'laneId'"),
                        )
                    }
                };
                inputs.push((PathBuf::from(path_str), lane_id));
            }
            match sessions.timelines.open(&inputs) {
                Ok(tl) => {
                    let manifest = tl.manifest();
                    ok(manifest)
                }
                Err(e) => err(errors::OPEN_FAILED, e.to_string()),
            }
        }

        "read_timeline_range" => {
            let tlid = match required_str(req, "timelineId") {
                Ok(s) => s,
                Err(e) => return e,
            };
            let from_global = match required_u64(req, "fromGlobal") {
                Ok(n) => n,
                Err(e) => return e,
            };
            let to_global = match required_u64(req, "toGlobal") {
                Ok(n) => n,
                Err(e) => return e,
            };
            let tl = match sessions.timelines.get(tlid) {
                Some(h) => h,
                None => {
                    return err(
                        errors::TIMELINE_NOT_FOUND,
                        format!("no open timeline: {tlid}"),
                    )
                }
            };
            match tl.read_range(from_global, to_global) {
                Ok(rows) => ok(json!({ "rows": rows })),
                Err(e) => err(errors::READ_FAILED, e.to_string()),
            }
        }

        _ => err(errors::UNKNOWN_COMMAND, format!("unknown command: {cmd}")),
    }
}

fn main() {
    install_panic_hook();

    let mut sessions = Sessions::new();
    let stdin = io::stdin();
    let mut stdin_lock = BufReader::with_capacity(1 << 16, stdin.lock());
    let stdout = io::stdout();
    let mut stdout_lock = stdout.lock();

    let mut line = String::new();
    loop {
        line.clear();
        let n = match stdin_lock.read_line(&mut line) {
            Ok(n) => n,
            Err(e) => {
                // Emit a final error + exit cleanly.
                let _ = writeln!(
                    stdout_lock,
                    "{}",
                    err(errors::INVALID_REQUEST, format!("stdin read failed: {e}"))
                );
                break;
            }
        };
        if n == 0 {
            break; // EOF
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let req: Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(e) => {
                let _ = writeln!(
                    stdout_lock,
                    "{}",
                    err(errors::INVALID_REQUEST, format!("bad json: {e}"))
                );
                let _ = stdout_lock.flush();
                continue;
            }
        };
        let cmd = req.get("cmd").and_then(Value::as_str).unwrap_or("");
        if cmd.is_empty() {
            let _ = writeln!(
                stdout_lock,
                "{}",
                err(errors::INVALID_REQUEST, "missing 'cmd'")
            );
            let _ = stdout_lock.flush();
            continue;
        }
        let resp = dispatch(cmd, &req, &mut sessions);
        let _ = writeln!(stdout_lock, "{resp}");
        let _ = stdout_lock.flush();
    }
}
