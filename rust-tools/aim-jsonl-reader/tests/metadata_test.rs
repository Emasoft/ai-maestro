// Integration tests for the `analyze_file_metadata` command.
//
// The command is streaming-friendly (single pass, no full-file
// materialization) and never panics on malformed lines. Its job is to
// produce a rich metadata blob for each JSONL session file the sessions
// browser displays — including preview text, ongoing flag, compaction
// count, request-id-deduped assistant tokens, and subagent-spawn /
// compact-summary detection flags.
//
// Protocol (matches the pattern used by context_breakdown):
//
//   Request:  {"cmd":"analyze_file_metadata","path":"<abs>"}
//   Response: {
//     "ok": true,
//     "firstUserMessagePreview": "hello world",
//     "isOngoing": true,
//     "compactionCount": 0,
//     "phaseTokenBreakdown": [ {"phaseId":0,"pre":N,"peak":N,"post":null|N} ],
//     "shutdownToolCalls": 0,
//     "rejections": 0,
//     "requestIdDedupedAssistantTokens": 80,
//     "hasSubagentSpawns": false,
//     "hasCompactSummary": false
//   }

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

use serde_json::{json, Value};
use tempfile::TempDir;

fn binary_path() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("target");
    p.push(if cfg!(debug_assertions) { "debug" } else { "release" });
    p.push("aim-jsonl-reader");
    p
}

struct Reader {
    child:  Child,
    stdin:  ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl Reader {
    fn spawn() -> Self {
        let mut child = Command::new(binary_path())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .expect("spawn aim-jsonl-reader");
        let stdin = child.stdin.take().expect("child stdin");
        let stdout = BufReader::new(child.stdout.take().expect("child stdout"));
        Reader { child, stdin, stdout }
    }

    fn req(&mut self, req: Value) -> Value {
        let line = req.to_string();
        writeln!(self.stdin, "{line}").expect("write req");
        self.stdin.flush().expect("flush");
        let mut resp = String::new();
        self.stdout.read_line(&mut resp).expect("read resp");
        serde_json::from_str::<Value>(resp.trim()).expect("parse resp")
    }

    fn shutdown(mut self) {
        drop(self.stdin);
        let _ = self.child.wait();
    }
}

fn write_jsonl(dir: &Path, name: &str, lines: &[Value]) -> PathBuf {
    let path = dir.join(name);
    let mut f = std::fs::File::create(&path).unwrap();
    for line in lines {
        writeln!(f, "{}", line).unwrap();
    }
    path
}

fn write_raw_lines(dir: &Path, name: &str, raw_lines: &[&str]) -> PathBuf {
    let path = dir.join(name);
    let mut f = std::fs::File::create(&path).unwrap();
    for line in raw_lines {
        writeln!(f, "{}", line).unwrap();
    }
    path
}

// ── Plain: minimal session, first user message preview ──────────

#[test]
fn analyze_plain_returns_first_user_preview_and_core_fields() {
    let tmp = TempDir::new().unwrap();
    // Ongoing flag is driven by mtime being recent (< 10 min) AND no
    // explicit shutdown marker. A freshly-written temp file satisfies both.
    let path = write_jsonl(tmp.path(), "plain.jsonl", &[
        json!({
            "uuid": "u1",
            "role": "user",
            "message": {"content": "Hello, please help with the thing"}
        }),
        json!({
            "uuid": "u2",
            "requestId": "req-1",
            "role": "assistant",
            "model": "claude-sonnet-4-6",
            "message": {"usage": {"output_tokens": 50}}
        }),
    ]);

    let mut r = Reader::spawn();
    let resp = r.req(json!({
        "cmd": "analyze_file_metadata",
        "path": path.to_str().unwrap(),
    }));

    assert_eq!(resp["ok"], json!(true), "response: {}", resp);
    assert_eq!(
        resp["firstUserMessagePreview"],
        json!("Hello, please help with the thing")
    );
    assert_eq!(resp["compactionCount"], json!(0));
    assert_eq!(resp["hasCompactSummary"], json!(false));
    assert_eq!(resp["hasSubagentSpawns"], json!(false));
    assert_eq!(resp["requestIdDedupedAssistantTokens"], json!(50));
    // Freshly-written file → ongoing.
    assert_eq!(resp["isOngoing"], json!(true));
    // One phase (no compactions yet).
    let phases = resp["phaseTokenBreakdown"].as_array().unwrap();
    assert_eq!(phases.len(), 1, "expected 1 phase, got {:?}", phases);
    assert_eq!(phases[0]["phaseId"], json!(0));
    assert_eq!(phases[0]["post"], json!(null));

    r.shutdown();
}

// ── One compaction: compactionCount + hasCompactSummary + phase split ──

#[test]
fn analyze_one_compaction_splits_phases_and_counts() {
    let tmp = TempDir::new().unwrap();
    let path = write_jsonl(tmp.path(), "compact.jsonl", &[
        json!({"uuid":"u1","role":"user","message":{"content":"First user msg"}}),
        json!({
            "uuid":"u2","requestId":"r1","role":"assistant","model":"claude-sonnet-4-6",
            "message":{"usage":{"output_tokens":30}}
        }),
        // The compaction marker.
        json!({
            "uuid":"u3",
            "isCompactSummary": true,
            "role":"user",
            "message":{"content":"Previous conversation summary..."}
        }),
        json!({
            "uuid":"u4","requestId":"r2","role":"assistant","model":"claude-sonnet-4-6",
            "message":{"usage":{"output_tokens":70}}
        }),
    ]);

    let mut r = Reader::spawn();
    let resp = r.req(json!({
        "cmd": "analyze_file_metadata",
        "path": path.to_str().unwrap(),
    }));

    assert_eq!(resp["ok"], json!(true), "response: {}", resp);
    assert_eq!(resp["compactionCount"], json!(1));
    assert_eq!(resp["hasCompactSummary"], json!(true));
    // Distinct requestIds → both count. 30 + 70 = 100.
    assert_eq!(resp["requestIdDedupedAssistantTokens"], json!(100));
    // Phase history: 1 compaction splits the timeline into 2 phases.
    let phases = resp["phaseTokenBreakdown"].as_array().unwrap();
    assert_eq!(phases.len(), 2, "expected 2 phases, got {:?}", phases);
    assert_eq!(phases[0]["phaseId"], json!(0));
    assert_eq!(phases[1]["phaseId"], json!(1));
    // First phase is closed (has post-compaction total).
    assert!(phases[0]["post"].is_number(), "phase 0 should be closed");
    // Second phase is still open (null post).
    assert_eq!(phases[1]["post"], json!(null));

    r.shutdown();
}

// ── Subagent spawn detection ─────────────────────────────────────

#[test]
fn analyze_subagent_spawn_sets_flag() {
    let tmp = TempDir::new().unwrap();
    let path = write_jsonl(tmp.path(), "subagent.jsonl", &[
        json!({"uuid":"u1","role":"user","message":{"content":"do parallel work"}}),
        // tool_use with name=Task → subagent spawn signal.
        json!({
            "uuid":"u2",
            "type":"tool_use",
            "name":"Task",
            "input":{"subagent_type":"general-purpose","prompt":"hi"}
        }),
    ]);

    let mut r = Reader::spawn();
    let resp = r.req(json!({
        "cmd": "analyze_file_metadata",
        "path": path.to_str().unwrap(),
    }));

    assert_eq!(resp["ok"], json!(true), "response: {}", resp);
    assert_eq!(resp["hasSubagentSpawns"], json!(true));

    r.shutdown();
}

#[test]
fn analyze_sidechain_entry_also_counts_as_subagent() {
    let tmp = TempDir::new().unwrap();
    let path = write_jsonl(tmp.path(), "sidechain.jsonl", &[
        json!({"uuid":"u1","role":"user","message":{"content":"sub work"}}),
        // isSidechain: true → subagent entry.
        json!({
            "uuid":"u2",
            "isSidechain": true,
            "role":"assistant",
            "message":{"content":[{"type":"text","text":"sub-reply"}]}
        }),
    ]);

    let mut r = Reader::spawn();
    let resp = r.req(json!({
        "cmd": "analyze_file_metadata",
        "path": path.to_str().unwrap(),
    }));

    assert_eq!(resp["ok"], json!(true));
    assert_eq!(resp["hasSubagentSpawns"], json!(true));
    r.shutdown();
}

// ── Error tool_results count under rejections ────────────────────

#[test]
fn analyze_error_tool_results_count_as_rejections() {
    let tmp = TempDir::new().unwrap();
    let path = write_jsonl(tmp.path(), "errors.jsonl", &[
        json!({"uuid":"u1","role":"user","message":{"content":"try it"}}),
        // tool_use with a result that has is_error: true.
        json!({
            "uuid":"u2",
            "type":"tool_use",
            "name":"Bash",
            "input":{"command":"fail"}
        }),
        json!({
            "uuid":"u3",
            "type":"tool_result",
            "is_error": true,
            "content": "ERROR: permission denied"
        }),
        json!({
            "uuid":"u4",
            "type":"tool_result",
            "is_error": false,
            "content": "ok"
        }),
    ]);

    let mut r = Reader::spawn();
    let resp = r.req(json!({
        "cmd": "analyze_file_metadata",
        "path": path.to_str().unwrap(),
    }));

    assert_eq!(resp["ok"], json!(true));
    assert_eq!(resp["rejections"], json!(1), "one error tool_result");
    r.shutdown();
}

// ── Shutdown tool calls counted ──────────────────────────────────

#[test]
fn analyze_counts_shutdown_tool_calls() {
    let tmp = TempDir::new().unwrap();
    let path = write_jsonl(tmp.path(), "shutdown.jsonl", &[
        json!({"uuid":"u1","role":"user","message":{"content":"bye"}}),
        // The reference implementation treats tool calls whose name
        // suggests session shutdown (SlashCommand with `/exit`, or an
        // explicit shutdown name) as shutdown markers. Our heuristic:
        // any tool_use whose name is "ExitPlanMode" OR Bash with a
        // command containing /exit.
        json!({
            "uuid":"u2",
            "type":"tool_use",
            "name":"ExitPlanMode",
            "input":{}
        }),
    ]);

    let mut r = Reader::spawn();
    let resp = r.req(json!({
        "cmd": "analyze_file_metadata",
        "path": path.to_str().unwrap(),
    }));

    assert_eq!(resp["ok"], json!(true));
    assert!(resp["shutdownToolCalls"].as_u64().unwrap() >= 1);
    r.shutdown();
}

// ── RequestId dedup on duplicates ────────────────────────────────

#[test]
fn analyze_dedup_duplicate_request_ids() {
    let tmp = TempDir::new().unwrap();
    let path = write_jsonl(tmp.path(), "dupes.jsonl", &[
        json!({"uuid":"u1","role":"user","message":{"content":"hi"}}),
        json!({
            "uuid":"u2","requestId":"req-shared","role":"assistant",
            "model":"claude-sonnet-4-6","message":{"usage":{"output_tokens":40}}
        }),
        // Same requestId → must not double-count.
        json!({
            "uuid":"u3","requestId":"req-shared","role":"assistant",
            "model":"claude-sonnet-4-6","message":{"usage":{"output_tokens":40}}
        }),
    ]);

    let mut r = Reader::spawn();
    let resp = r.req(json!({
        "cmd": "analyze_file_metadata",
        "path": path.to_str().unwrap(),
    }));

    assert_eq!(resp["ok"], json!(true));
    // Must be 40, not 80.
    assert_eq!(resp["requestIdDedupedAssistantTokens"], json!(40));
    r.shutdown();
}

// ── Preview truncation at 120 characters ─────────────────────────

#[test]
fn analyze_first_user_preview_truncates_at_120_chars() {
    let tmp = TempDir::new().unwrap();
    let long = "x".repeat(500);
    let path = write_jsonl(tmp.path(), "long.jsonl", &[
        json!({"uuid":"u1","role":"user","message":{"content": long.clone()}}),
    ]);

    let mut r = Reader::spawn();
    let resp = r.req(json!({
        "cmd": "analyze_file_metadata",
        "path": path.to_str().unwrap(),
    }));

    assert_eq!(resp["ok"], json!(true));
    let preview = resp["firstUserMessagePreview"].as_str().unwrap();
    assert!(
        preview.chars().count() <= 120,
        "preview too long: {} chars",
        preview.chars().count()
    );
    r.shutdown();
}

// ── First user preview ignores meta / system entries ────────────

#[test]
fn analyze_preview_skips_meta_user_entries() {
    let tmp = TempDir::new().unwrap();
    let path = write_jsonl(tmp.path(), "meta.jsonl", &[
        // isMeta true → not a real first user message; skip.
        json!({
            "uuid":"u1",
            "role":"user",
            "isMeta": true,
            "message":{"content":"META: do not show this"}
        }),
        // The real one.
        json!({
            "uuid":"u2",
            "role":"user",
            "message":{"content":"Real first user question"}
        }),
    ]);

    let mut r = Reader::spawn();
    let resp = r.req(json!({
        "cmd": "analyze_file_metadata",
        "path": path.to_str().unwrap(),
    }));

    assert_eq!(resp["ok"], json!(true));
    assert_eq!(
        resp["firstUserMessagePreview"],
        json!("Real first user question"),
        "preview must skip meta entries"
    );
    r.shutdown();
}

// ── Malformed lines do NOT panic; they're skipped silently ──────

#[test]
fn analyze_malformed_lines_do_not_panic() {
    let tmp = TempDir::new().unwrap();
    let path = write_raw_lines(
        tmp.path(),
        "bad.jsonl",
        &[
            r#"{"uuid":"u1","role":"user","message":{"content":"hi"}}"#,
            r#"{BROKEN — not a valid json line at all"#,
            r#"{"uuid":"u2","requestId":"r1","role":"assistant","model":"claude-sonnet-4-6","message":{"usage":{"output_tokens":5}}}"#,
        ],
    );

    let mut r = Reader::spawn();
    let resp = r.req(json!({
        "cmd": "analyze_file_metadata",
        "path": path.to_str().unwrap(),
    }));

    assert_eq!(resp["ok"], json!(true), "malformed line must not break analyze");
    assert_eq!(resp["firstUserMessagePreview"], json!("hi"));
    assert_eq!(resp["requestIdDedupedAssistantTokens"], json!(5));
    r.shutdown();
}

// ── Error paths ─────────────────────────────────────────────────

#[test]
fn analyze_missing_path_is_invalid_request() {
    let mut r = Reader::spawn();
    let resp = r.req(json!({"cmd":"analyze_file_metadata"}));
    assert_eq!(resp["ok"], json!(false));
    assert_eq!(resp["error"], json!("invalid_request"));
    r.shutdown();
}

#[test]
fn analyze_nonexistent_path_returns_open_failed() {
    let mut r = Reader::spawn();
    let resp = r.req(json!({
        "cmd":"analyze_file_metadata",
        "path":"/nope/does/not/exist.jsonl",
    }));
    assert_eq!(resp["ok"], json!(false));
    assert_eq!(resp["error"], json!("open_failed"));
    r.shutdown();
}

// ── Empty file: well-formed response with defaults ──────────────

#[test]
fn analyze_empty_file_returns_defaults() {
    let tmp = TempDir::new().unwrap();
    let path = tmp.path().join("empty.jsonl");
    std::fs::File::create(&path).unwrap();

    let mut r = Reader::spawn();
    let resp = r.req(json!({
        "cmd":"analyze_file_metadata",
        "path": path.to_str().unwrap(),
    }));

    assert_eq!(resp["ok"], json!(true));
    assert_eq!(resp["firstUserMessagePreview"], json!(""));
    assert_eq!(resp["compactionCount"], json!(0));
    assert_eq!(resp["hasCompactSummary"], json!(false));
    assert_eq!(resp["hasSubagentSpawns"], json!(false));
    assert_eq!(resp["requestIdDedupedAssistantTokens"], json!(0));
    assert_eq!(resp["rejections"], json!(0));
    assert_eq!(resp["shutdownToolCalls"], json!(0));
    // phaseTokenBreakdown: one open phase with zeroed counters.
    let phases = resp["phaseTokenBreakdown"].as_array().unwrap();
    assert_eq!(phases.len(), 1);
    assert_eq!(phases[0]["phaseId"], json!(0));
    assert_eq!(phases[0]["pre"], json!(0));
    assert_eq!(phases[0]["peak"], json!(0));
    assert_eq!(phases[0]["post"], json!(null));
    r.shutdown();
}
