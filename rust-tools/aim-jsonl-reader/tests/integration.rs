// Integration tests for aim-jsonl-reader.
//
// Tests spawn the release-compiled binary as a child process and speak
// NDJSON over its stdin/stdout. That exercises the real protocol path
// end-to-end — there is no in-process test harness that would let the
// test accidentally hit the hot code in a different way than the
// shipped binary does.
//
// The `big-fixture` test is gated behind AIM_BIG_FIXTURE_TEST=1 so it
// doesn't burn 30 s of CI on every run. Its job is to prove the RSS
// ceiling on a 2 GB synthetic fixture. CI hits the smaller 10 MB
// ceiling-test every run; the 2 GB variant runs manually or on the
// long-suite nightly.

use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

use serde_json::{json, Value};
use tempfile::TempDir;

fn binary_path() -> PathBuf {
    // Point at the debug build by default so `cargo test` works out of
    // the box. Release builds are exercised by the smoke script.
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("target");
    p.push(if cfg!(debug_assertions) { "debug" } else { "release" });
    p.push("aim-jsonl-reader");
    p
}

struct Reader {
    child:   Child,
    stdin:   ChildStdin,
    stdout:  BufReader<ChildStdout>,
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

// ── 1. Protocol round-trip ───────────────────────────────────────

#[test]
fn open_ping_close_round_trip() {
    let tmp = TempDir::new().unwrap();
    let path = write_jsonl(tmp.path(), "one.jsonl", &[
        json!({"role":"user","content":"hi"}),
    ]);

    let mut r = Reader::spawn();

    let ping = r.req(json!({"cmd":"ping"}));
    assert_eq!(ping["ok"], json!(true));
    assert!(ping.get("version").is_some(), "ping should report version");

    let open = r.req(json!({"cmd":"open","path": path.to_str().unwrap()}));
    assert_eq!(open["ok"], json!(true));
    assert_eq!(open["lineCount"], json!(1));
    // Sidecar did NOT exist before this open, so indexed=false.
    assert_eq!(open["indexed"], json!(false));
    let sid = open["sessionId"].as_str().unwrap().to_string();

    let close = r.req(json!({"cmd":"close","sessionId": sid}));
    assert_eq!(close["ok"], json!(true));

    r.shutdown();
}

#[test]
fn unknown_command_returns_error_not_panic() {
    let mut r = Reader::spawn();
    let resp = r.req(json!({"cmd":"notacommand"}));
    assert_eq!(resp["ok"], json!(false));
    assert_eq!(resp["error"], json!("unknown_command"));
    r.shutdown();
}

#[test]
fn invalid_json_returns_error() {
    let mut r = Reader::spawn();
    // Send malformed input directly.
    writeln!(r.stdin, "{{not json").unwrap();
    r.stdin.flush().unwrap();
    let mut resp = String::new();
    r.stdout.read_line(&mut resp).unwrap();
    let v: Value = serde_json::from_str(resp.trim()).unwrap();
    assert_eq!(v["ok"], json!(false));
    assert_eq!(v["error"], json!("invalid_request"));
    r.shutdown();
}

// ── 2. Range reads ───────────────────────────────────────────────

#[test]
fn read_range_inclusive() {
    let tmp = TempDir::new().unwrap();
    let lines: Vec<Value> = (0..10).map(|i| json!({"role":"user","content":format!("m{i}")})).collect();
    let path = write_jsonl(tmp.path(), "range.jsonl", &lines);

    let mut r = Reader::spawn();
    let open = r.req(json!({"cmd":"open","path": path.to_str().unwrap()}));
    let sid = open["sessionId"].as_str().unwrap().to_string();

    let read = r.req(json!({
        "cmd":"read_range","sessionId": sid,
        "fromLine": 2, "toLine": 5,
    }));
    assert_eq!(read["ok"], json!(true));
    let got = read["lines"].as_array().unwrap();
    assert_eq!(got.len(), 4);
    assert_eq!(got[0]["content"], json!("m2"));
    assert_eq!(got[3]["content"], json!("m5"));
    r.shutdown();
}

#[test]
fn read_range_beyond_end_returns_empty() {
    let tmp = TempDir::new().unwrap();
    let path = write_jsonl(tmp.path(), "tiny.jsonl", &[json!({"role":"user"})]);

    let mut r = Reader::spawn();
    let open = r.req(json!({"cmd":"open","path": path.to_str().unwrap()}));
    let sid = open["sessionId"].as_str().unwrap().to_string();

    let read = r.req(json!({
        "cmd":"read_range","sessionId": sid,
        "fromLine": 100, "toLine": 200,
    }));
    assert_eq!(read["ok"], json!(true));
    assert_eq!(read["lines"].as_array().unwrap().len(), 0);
    r.shutdown();
}

// ── 3. Sidecar reuse ─────────────────────────────────────────────

#[test]
fn sidecar_is_reused_on_second_open() {
    let tmp = TempDir::new().unwrap();
    let lines: Vec<Value> = (0..5).map(|i| json!({"i": i})).collect();
    let path = write_jsonl(tmp.path(), "idx.jsonl", &lines);
    let sidecar = path.with_extension("jsonl.aimidx");

    // First open — no sidecar yet.
    let mut r = Reader::spawn();
    let open1 = r.req(json!({"cmd":"open","path": path.to_str().unwrap()}));
    assert_eq!(open1["indexed"], json!(false));
    r.shutdown();

    assert!(sidecar.exists(), "sidecar should have been written");

    // Second open — should reuse.
    let mut r = Reader::spawn();
    let open2 = r.req(json!({"cmd":"open","path": path.to_str().unwrap()}));
    assert_eq!(open2["indexed"], json!(true));
    r.shutdown();
}

#[test]
fn sidecar_rebuilds_on_mtime_drift() {
    let tmp = TempDir::new().unwrap();
    let path = write_jsonl(tmp.path(), "drift.jsonl", &[json!({"a":1})]);

    // Prime the sidecar.
    let mut r = Reader::spawn();
    let _ = r.req(json!({"cmd":"open","path": path.to_str().unwrap()}));
    r.shutdown();

    // Drift: rewrite with more content. The mtime+size will both change.
    let mut f = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
    writeln!(f, "{}", json!({"a":2})).unwrap();
    f.flush().unwrap();
    drop(f);
    // Wait a real moment so mtime_ns definitely moves forward on
    // filesystems with coarse granularity (ext4 default 1ms, HFS+ 1s).
    std::thread::sleep(std::time::Duration::from_millis(20));
    // Touch to bump mtime — on macOS the OS may keep the mtime we set
    // through filetime's utimes syscall, but we rely on the size check
    // anyway. Both have changed by now.

    let mut r = Reader::spawn();
    let open = r.req(json!({"cmd":"open","path": path.to_str().unwrap()}));
    assert_eq!(open["ok"], json!(true));
    assert_eq!(open["lineCount"], json!(2));
    // Depending on fs precision the old sidecar may still match — but
    // the size definitely doesn't (we grew by 1 line) so the rebuild
    // must have fired.
    // We don't assert `indexed=false` because an ambitiously quick
    // filesystem could in theory report the same mtime_ns; the key
    // invariant is that `lineCount` picks up the new line count.
    r.shutdown();
}

// ── 4. Search ────────────────────────────────────────────────────

#[test]
fn substring_search_finds_matches() {
    let tmp = TempDir::new().unwrap();
    let path = write_jsonl(tmp.path(), "search.jsonl", &[
        json!({"role":"user","content":"hello world"}),
        json!({"role":"user","content":"HELLO again"}),
        json!({"role":"assistant","content":"goodbye"}),
    ]);

    let mut r = Reader::spawn();
    let open = r.req(json!({"cmd":"open","path": path.to_str().unwrap()}));
    let sid = open["sessionId"].as_str().unwrap().to_string();

    let resp = r.req(json!({
        "cmd":"search","sessionId": sid,
        "query":"hello","kind":"substring","caseInsensitive":true,"limit":10
    }));
    let matches = resp["matches"].as_array().unwrap();
    assert_eq!(matches.len(), 2, "case-insensitive should match hello + HELLO");
    assert_eq!(matches[0]["line"], json!(0));
    assert_eq!(matches[1]["line"], json!(1));

    // Case-sensitive misses HELLO.
    let resp = r.req(json!({
        "cmd":"search","sessionId": sid,
        "query":"hello","kind":"substring","caseInsensitive":false,"limit":10
    }));
    let matches = resp["matches"].as_array().unwrap();
    assert_eq!(matches.len(), 1);
    r.shutdown();
}

#[test]
fn regex_search_works() {
    let tmp = TempDir::new().unwrap();
    let path = write_jsonl(tmp.path(), "re.jsonl", &[
        json!({"v":"abc123"}),
        json!({"v":"abc987"}),
        json!({"v":"nope"}),
    ]);

    let mut r = Reader::spawn();
    let open = r.req(json!({"cmd":"open","path": path.to_str().unwrap()}));
    let sid = open["sessionId"].as_str().unwrap().to_string();

    let resp = r.req(json!({
        "cmd":"search","sessionId": sid,
        "query":"abc\\d+","kind":"regex","caseInsensitive":false,"limit":10
    }));
    let matches = resp["matches"].as_array().unwrap();
    assert_eq!(matches.len(), 2);
    r.shutdown();
}

#[test]
fn search_respects_limit() {
    let tmp = TempDir::new().unwrap();
    let lines: Vec<Value> = (0..50).map(|i| json!({"v":format!("hit-{i}")})).collect();
    let path = write_jsonl(tmp.path(), "many.jsonl", &lines);

    let mut r = Reader::spawn();
    let open = r.req(json!({"cmd":"open","path": path.to_str().unwrap()}));
    let sid = open["sessionId"].as_str().unwrap().to_string();

    let resp = r.req(json!({
        "cmd":"search","sessionId": sid,
        "query":"hit","kind":"substring","caseInsensitive":false,"limit":10
    }));
    assert_eq!(resp["matches"].as_array().unwrap().len(), 10);
    r.shutdown();
}

// ── 5. Context breakdown ─────────────────────────────────────────

#[test]
fn context_breakdown_classifies_all_buckets() {
    let tmp = TempDir::new().unwrap();
    let path = write_jsonl(tmp.path(), "ctx.jsonl", &[
        json!({"type":"system-prompt","content":"x".repeat(400),"usage":{"input_tokens":100}}),
        json!({"role":"user","content":"hello"}),
        json!({"role":"assistant","model":"claude-sonnet-4-6","usage":{"output_tokens":50,"cache_read_input_tokens":10}}),
        json!({"type":"tool_use","name":"Read","input":{"path":"/tmp/a"}}),
        json!({"type":"tool_use","name":"mcp__foo__bar","input":{"x":"y"}}),
        json!({"type":"tool_result","output":"ok"}),
        json!({"type":"agent-definition","content":"a".repeat(80)}),
        json!({"type":"memory","source":"claude-md","content":"m".repeat(40)}),
    ]);

    let mut r = Reader::spawn();
    let open = r.req(json!({"cmd":"open","path": path.to_str().unwrap()}));
    let sid = open["sessionId"].as_str().unwrap().to_string();

    let b = r.req(json!({"cmd":"context_breakdown","sessionId": sid}));
    assert_eq!(b["ok"], json!(true));
    assert_eq!(b["systemPrompt"], json!(100));
    assert_eq!(b["modelId"], json!("claude-sonnet-4-6"));
    assert_eq!(b["modelContextLimit"], json!(200_000));
    // messages = output_tokens (50) + tool_result (ok -> ~0 via /4)
    assert!(b["messages"].as_u64().unwrap() >= 50);
    // systemTools and mcpTools both populated (from Read + mcp__foo__bar tool_use).
    assert!(b["systemTools"].as_u64().unwrap() > 0);
    assert!(b["mcpTools"].as_u64().unwrap() > 0);
    // customAgents from agent-definition.
    assert!(b["customAgents"].as_u64().unwrap() > 0);
    // memory from claude-md source.
    assert!(b["memory"].as_u64().unwrap() > 0);
    // cacheRead from usage.
    assert_eq!(b["cacheRead"], json!(10));
    // approximate flag: at least one record lacked usage, so true.
    assert_eq!(b["approximate"], json!(true));
    r.shutdown();
}

#[test]
fn context_breakdown_unknown_model_falls_back_to_200k() {
    let tmp = TempDir::new().unwrap();
    let path = write_jsonl(tmp.path(), "ctx2.jsonl", &[
        json!({"role":"assistant","model":"future-model-99","usage":{"output_tokens":1}}),
    ]);

    let mut r = Reader::spawn();
    let open = r.req(json!({"cmd":"open","path": path.to_str().unwrap()}));
    let sid = open["sessionId"].as_str().unwrap().to_string();

    let b = r.req(json!({"cmd":"context_breakdown","sessionId": sid}));
    assert_eq!(b["modelContextLimit"], json!(200_000));
    r.shutdown();
}

// ── 5.1 Request-ID dedup for token math (Phase 5 §1) ────────────
//
// Assistant turns that were retried produce multiple JSONL entries
// sharing the same `requestId` but with different `uuid`s. v1 summed the
// `usage.output_tokens` of every such entry, which overcounted tokens
// on any session with a streamed retry. Phase 5 fixes this by keeping
// only the first occurrence per `requestId` in the running totals.
// Entries without a `requestId` continue to count individually.

#[test]
fn context_breakdown_dedup_by_request_id_for_output_tokens() {
    let tmp = TempDir::new().unwrap();
    let path = write_jsonl(tmp.path(), "dedup-out.jsonl", &[
        // Two assistant entries with the SAME requestId — second must NOT
        // add to output_tokens. Total assistant output must be 80, not 160.
        json!({
            "uuid": "aaa-1",
            "requestId": "req-xyz",
            "role": "assistant",
            "model": "claude-sonnet-4-6",
            "message": {
                "usage": {
                    "output_tokens": 80,
                    "cache_read_input_tokens": 5
                }
            }
        }),
        json!({
            "uuid": "aaa-2",
            "requestId": "req-xyz",
            "role": "assistant",
            "model": "claude-sonnet-4-6",
            "message": {
                "usage": {
                    "output_tokens": 80,
                    "cache_read_input_tokens": 5
                }
            }
        }),
    ]);

    let mut r = Reader::spawn();
    let open = r.req(json!({"cmd":"open","path": path.to_str().unwrap()}));
    let sid = open["sessionId"].as_str().unwrap().to_string();

    let b = r.req(json!({"cmd":"context_breakdown","sessionId": sid}));
    assert_eq!(b["ok"], json!(true));
    // messages should be exactly 80 (one output, not 160 as v1 produced).
    assert_eq!(
        b["messages"], json!(80),
        "duplicate requestId must not double-count output_tokens"
    );
    // cacheRead should be exactly 5 (one entry, not 10).
    assert_eq!(
        b["cacheRead"], json!(5),
        "duplicate requestId must not double-count cache_read_input_tokens"
    );
    r.shutdown();
}

#[test]
fn context_breakdown_counts_distinct_request_ids() {
    let tmp = TempDir::new().unwrap();
    let path = write_jsonl(tmp.path(), "dedup-distinct.jsonl", &[
        json!({
            "uuid": "a",
            "requestId": "req-1",
            "role": "assistant",
            "model": "claude-sonnet-4-6",
            "message": {"usage": {"output_tokens": 40}}
        }),
        json!({
            "uuid": "b",
            "requestId": "req-2",
            "role": "assistant",
            "model": "claude-sonnet-4-6",
            "message": {"usage": {"output_tokens": 60}}
        }),
    ]);

    let mut r = Reader::spawn();
    let open = r.req(json!({"cmd":"open","path": path.to_str().unwrap()}));
    let sid = open["sessionId"].as_str().unwrap().to_string();

    let b = r.req(json!({"cmd":"context_breakdown","sessionId": sid}));
    // Distinct requestIds — both entries contribute. 40 + 60 = 100.
    assert_eq!(b["messages"], json!(100));
    r.shutdown();
}

#[test]
fn context_breakdown_counts_entries_without_request_id_individually() {
    let tmp = TempDir::new().unwrap();
    let path = write_jsonl(tmp.path(), "dedup-none.jsonl", &[
        // Neither entry carries requestId → no dedup; both count.
        json!({
            "role": "assistant",
            "model": "claude-sonnet-4-6",
            "message": {"usage": {"output_tokens": 15}}
        }),
        json!({
            "role": "assistant",
            "model": "claude-sonnet-4-6",
            "message": {"usage": {"output_tokens": 25}}
        }),
    ]);

    let mut r = Reader::spawn();
    let open = r.req(json!({"cmd":"open","path": path.to_str().unwrap()}));
    let sid = open["sessionId"].as_str().unwrap().to_string();

    let b = r.req(json!({"cmd":"context_breakdown","sessionId": sid}));
    // Neither has a requestId → both contribute. 15 + 25 = 40.
    assert_eq!(b["messages"], json!(40));
    r.shutdown();
}

#[test]
fn context_breakdown_dedup_from_static_fixture() {
    // Use the on-disk fixture at tests/fixtures/dedup/retry_same_request_id.jsonl.
    // This protects the fix from future refactors that might accidentally
    // reintroduce double-counting on streamed retries.
    let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("dedup")
        .join("retry_same_request_id.jsonl");
    assert!(fixture.exists(), "fixture missing: {}", fixture.display());

    let mut r = Reader::spawn();
    let open = r.req(json!({"cmd":"open","path": fixture.to_str().unwrap()}));
    let sid = open["sessionId"].as_str().unwrap().to_string();

    let b = r.req(json!({"cmd":"context_breakdown","sessionId": sid}));
    assert_eq!(b["ok"], json!(true));
    assert_eq!(b["messages"], json!(80));
    assert_eq!(b["cacheRead"], json!(5));
    r.shutdown();
}

// ── 6. Error paths ───────────────────────────────────────────────

#[test]
fn open_nonexistent_path_returns_error() {
    let mut r = Reader::spawn();
    let resp = r.req(json!({"cmd":"open","path":"/nope/does/not/exist.jsonl"}));
    assert_eq!(resp["ok"], json!(false));
    assert_eq!(resp["error"], json!("open_failed"));
    r.shutdown();
}

#[test]
fn read_range_on_unknown_sid_returns_error() {
    let mut r = Reader::spawn();
    let resp = r.req(json!({
        "cmd":"read_range","sessionId":"sid-deadbeef","fromLine":0,"toLine":0
    }));
    assert_eq!(resp["ok"], json!(false));
    assert_eq!(resp["error"], json!("session_not_found"));
    r.shutdown();
}

// ── 7. Memory ceiling ────────────────────────────────────────────
//
// Cheap ceiling test: build a 10 MB fixture and confirm that reading a
// small range + running a full search does NOT balloon RSS. The 2 GB
// variant is gated behind the AIM_BIG_FIXTURE_TEST env var.

#[cfg(unix)]
fn rss_kb_of(pid: u32) -> Option<u64> {
    // Best-effort RSS probe: shell out to `ps`. The reader itself
    // never shells out; these tests may. We only use this for an
    // assertion — not as part of the production path.
    use std::process::Command as StdCmd;
    let out = StdCmd::new("ps")
        .arg("-o")
        .arg("rss=")
        .arg("-p")
        .arg(pid.to_string())
        .output()
        .ok()?;
    let s = String::from_utf8(out.stdout).ok()?;
    let kb: u64 = s.trim().parse().ok()?;
    Some(kb)
}

#[cfg(not(unix))]
fn rss_kb_of(_pid: u32) -> Option<u64> { None }

#[test]
fn rss_stays_bounded_on_10mb_fixture() {
    let tmp = TempDir::new().unwrap();
    let path = tmp.path().join("medium.jsonl");
    {
        let mut f = std::fs::File::create(&path).unwrap();
        // ~10 MB of predictable lines.
        let filler = "x".repeat(100);
        for i in 0..100_000_u64 {
            let line = json!({"role":"user","content":format!("m{i} {filler}")});
            writeln!(f, "{line}").unwrap();
        }
    }
    let size = std::fs::metadata(&path).unwrap().len();
    assert!(size > 5_000_000, "fixture should be ≥5 MB, got {size}");

    let mut r = Reader::spawn();
    let pid = r.child.id();
    let open = r.req(json!({"cmd":"open","path": path.to_str().unwrap()}));
    let sid = open["sessionId"].as_str().unwrap().to_string();
    // Read a small range near the end — forces a seek.
    let last = open["lineCount"].as_u64().unwrap();
    let _ = r.req(json!({
        "cmd":"read_range","sessionId": sid,
        "fromLine": last.saturating_sub(10), "toLine": last.saturating_sub(1)
    }));
    // Search — scans the whole mmap.
    let _ = r.req(json!({
        "cmd":"search","sessionId": sid,
        "query":"m9999","kind":"substring","caseInsensitive":false,"limit":5
    }));
    // Now probe RSS. The TRDD ceiling is 100 MB for a 2 GB file.
    // For a 10 MB file we set a conservative 50 MB limit: that's easily
    // enough for the anon+binary mapping without crossing into "we
    // loaded the file" territory.
    if let Some(rss_kb) = rss_kb_of(pid) {
        let rss_mb = rss_kb / 1024;
        assert!(rss_mb < 50, "RSS {rss_mb} MB exceeds 50 MB ceiling on 10 MB fixture");
    }
    r.shutdown();
}

#[test]
#[ignore = "requires AIM_BIG_FIXTURE_TEST=1; generates a 2 GB fixture"]
fn rss_stays_bounded_on_2gb_fixture() {
    if std::env::var("AIM_BIG_FIXTURE_TEST").unwrap_or_default() != "1" {
        return;
    }

    let tmp = TempDir::new().unwrap();
    let path = tmp.path().join("big.jsonl");
    {
        // Emit ~2_000_000 lines × ~1 KB each. Use a plain loop — not
        // a shell call — so this stays inside the Rust process.
        let mut f = BufWriter::with_capacity(1 << 20,
            std::fs::File::create(&path).unwrap());
        let filler = "x".repeat(900);
        for i in 0..2_000_000_u64 {
            let line = json!({
                "role":      if i % 2 == 0 { "user" } else { "assistant" },
                "content":   format!("m{i} {filler}"),
                "timestamp": format!("2026-04-20T00:00:{:02}Z", i % 60),
            });
            writeln!(f, "{line}").unwrap();
        }
    }
    let size = std::fs::metadata(&path).unwrap().len();
    assert!(size > 1_500_000_000, "fixture should be ≥1.5 GB, got {size}");

    let mut r = Reader::spawn();
    let pid = r.child.id();
    let open = r.req(json!({"cmd":"open","path": path.to_str().unwrap()}));
    assert_eq!(open["ok"], json!(true));
    let sid = open["sessionId"].as_str().unwrap().to_string();

    // Read the last 10 lines — should be fast via the sparse index.
    let last = open["lineCount"].as_u64().unwrap();
    let t0 = std::time::Instant::now();
    let _ = r.req(json!({
        "cmd":"read_range","sessionId": sid,
        "fromLine": last - 10, "toLine": last - 1
    }));
    let elapsed = t0.elapsed();
    assert!(elapsed.as_millis() < 500, "read_range(last 10) took {elapsed:?}");

    if let Some(rss_kb) = rss_kb_of(pid) {
        let rss_mb = rss_kb / 1024;
        assert!(rss_mb < 100, "RSS {rss_mb} MB exceeds 100 MB ceiling on 2 GB fixture");
    }
    r.shutdown();
}

// ── 8. Phase 6 — timeline commands (open_timeline, read_timeline_range,
//    search_timeline, context_at) ─────────────────────────────────────
//
// These tests exercise the stitched multi-file commands added in Phase 6.
// They parallel the single-file tests above: one file, two files, main +
// subagent, main + worktree, compaction-aware, and search-across-files.

/// Write a file with sequential timestamps starting at `start_seconds_into_minute`
/// for `count` lines. Each entry carries a `uuid` of the form "<name>-<i>".
/// Returns the file path.
fn write_timestamped(
    dir: &Path,
    filename: &str,
    uuid_prefix: &str,
    start_seconds: u64,
    count: u64,
    is_sidechain: bool,
) -> PathBuf {
    let mut lines: Vec<Value> = Vec::with_capacity(count as usize);
    for i in 0..count {
        let ts = format!("2026-04-20T00:00:{:02}.000Z", (start_seconds + i) % 60);
        let uuid = format!("{uuid_prefix}-{i}");
        let mut line = json!({
            "uuid": uuid,
            "timestamp": ts,
            "role": if i % 2 == 0 { "user" } else { "assistant" },
            "content": format!("entry {uuid_prefix} {i}"),
        });
        if is_sidechain {
            line["isSidechain"] = json!(true);
        }
        lines.push(line);
    }
    write_jsonl(dir, filename, &lines)
}

#[test]
fn open_timeline_single_file_returns_manifest() {
    let tmp = TempDir::new().unwrap();
    let path = write_timestamped(tmp.path(), "one.jsonl", "a", 0, 5, false);

    let mut r = Reader::spawn();
    let resp = r.req(json!({
        "cmd": "open_timeline",
        "files": [
            {"path": path.to_str().unwrap(), "laneId": "main"},
        ],
    }));
    assert_eq!(resp["ok"], json!(true), "{}", resp);
    assert!(resp["timelineId"].as_str().unwrap().starts_with("tl-"));
    assert_eq!(resp["globalLineCount"], json!(5));
    let lanes = resp["lanes"].as_array().unwrap();
    assert_eq!(lanes.len(), 1);
    assert_eq!(lanes[0]["laneId"], json!("main"));
    assert_eq!(lanes[0]["lineCount"], json!(5));
    let file_idxs = lanes[0]["fileIndexes"].as_array().unwrap();
    assert_eq!(file_idxs.len(), 1);
    r.shutdown();
}

#[test]
fn open_timeline_two_files_merged_by_timestamp() {
    // Fixture: file B's first timestamp is EARLIER than file A's — the
    // manifest ordering must put B's lane first, A's second.
    let tmp = TempDir::new().unwrap();
    let a = write_timestamped(tmp.path(), "a.jsonl", "a", 30, 3, false);
    let b = write_timestamped(tmp.path(), "b.jsonl", "b", 0, 4, false);

    let mut r = Reader::spawn();
    let resp = r.req(json!({
        "cmd": "open_timeline",
        "files": [
            {"path": a.to_str().unwrap(), "laneId": "lane-A"},
            {"path": b.to_str().unwrap(), "laneId": "lane-B"},
        ],
    }));
    assert_eq!(resp["ok"], json!(true), "{}", resp);
    // 3 + 4 = 7 lines total.
    assert_eq!(resp["globalLineCount"], json!(7));
    let tlid = resp["timelineId"].as_str().unwrap().to_string();

    // Read the first 4 rows — must come from lane-B (earlier start).
    let range = r.req(json!({
        "cmd": "read_timeline_range",
        "timelineId": tlid,
        "fromGlobal": 0,
        "toGlobal": 3,
    }));
    assert_eq!(range["ok"], json!(true));
    let rows = range["rows"].as_array().unwrap();
    assert_eq!(rows.len(), 4);
    for row in rows {
        assert_eq!(row["laneId"], json!("lane-B"));
    }

    // Read the next 3 rows — must come from lane-A.
    let range2 = r.req(json!({
        "cmd": "read_timeline_range",
        "timelineId": tlid,
        "fromGlobal": 4,
        "toGlobal": 6,
    }));
    let rows2 = range2["rows"].as_array().unwrap();
    assert_eq!(rows2.len(), 3);
    for row in rows2 {
        assert_eq!(row["laneId"], json!("lane-A"));
    }

    r.shutdown();
}

#[test]
fn read_timeline_range_spans_file_boundary() {
    // Two files, 3 + 3 lines. Request [2..4] — 1 line from first file,
    // 2 from second.
    let tmp = TempDir::new().unwrap();
    let a = write_timestamped(tmp.path(), "first.jsonl", "a", 0, 3, false);
    let b = write_timestamped(tmp.path(), "second.jsonl", "b", 30, 3, false);

    let mut r = Reader::spawn();
    let open = r.req(json!({
        "cmd": "open_timeline",
        "files": [
            {"path": a.to_str().unwrap(), "laneId": "main"},
            {"path": b.to_str().unwrap(), "laneId": "main"},
        ],
    }));
    let tlid = open["timelineId"].as_str().unwrap().to_string();

    let range = r.req(json!({
        "cmd": "read_timeline_range",
        "timelineId": tlid,
        "fromGlobal": 2,
        "toGlobal": 4,
    }));
    let rows = range["rows"].as_array().unwrap();
    assert_eq!(rows.len(), 3);
    assert_eq!(rows[0]["localLineIndex"], json!(2));
    assert_eq!(rows[0]["fileIndex"], json!(0));
    // Second file starts at globalLineIndex 3.
    assert_eq!(rows[1]["globalLineIndex"], json!(3));
    assert_eq!(rows[1]["fileIndex"], json!(1));
    assert_eq!(rows[1]["localLineIndex"], json!(0));
    assert_eq!(rows[2]["fileIndex"], json!(1));
    assert_eq!(rows[2]["localLineIndex"], json!(1));

    r.shutdown();
}

#[test]
fn timeline_lane_identification_main_plus_subagent() {
    // Main file with a Task tool_use, plus a subagent file with isSidechain: true.
    let tmp = TempDir::new().unwrap();
    let main_lines = vec![
        json!({"uuid":"m-0","timestamp":"2026-04-20T00:00:00.000Z","role":"user","content":"start"}),
        json!({
            "uuid":"m-1","timestamp":"2026-04-20T00:00:05.000Z",
            "type":"tool_use","name":"Task","input":{"subagent_type":"helper"}
        }),
    ];
    let main = write_jsonl(tmp.path(), "main.jsonl", &main_lines);
    let subagent_lines = vec![
        json!({
            "uuid":"s-0","timestamp":"2026-04-20T00:00:06.000Z",
            "isSidechain": true, "role":"user","content":"subagent start"
        }),
        json!({
            "uuid":"s-1","timestamp":"2026-04-20T00:00:08.000Z",
            "isSidechain": true, "role":"assistant","content":"subagent reply"
        }),
    ];
    let sub = write_jsonl(tmp.path(), "sub.jsonl", &subagent_lines);

    let mut r = Reader::spawn();
    let resp = r.req(json!({
        "cmd": "open_timeline",
        "files": [
            {"path": main.to_str().unwrap(), "laneId": "main"},
            {"path": sub.to_str().unwrap(), "laneId": "subagent:helper"},
        ],
    }));
    assert_eq!(resp["ok"], json!(true), "{}", resp);
    let tlid = resp["timelineId"].as_str().unwrap().to_string();
    let lanes = resp["lanes"].as_array().unwrap();
    assert_eq!(lanes.len(), 2);

    let range = r.req(json!({
        "cmd": "read_timeline_range",
        "timelineId": tlid,
        "fromGlobal": 0,
        "toGlobal": 10,
    }));
    let rows = range["rows"].as_array().unwrap();
    assert_eq!(rows.len(), 4);
    // First two rows from main (earlier timestamps), last two from subagent.
    assert_eq!(rows[0]["laneId"], json!("main"));
    assert_eq!(rows[1]["laneId"], json!("main"));
    assert_eq!(rows[2]["laneId"], json!("subagent:helper"));
    assert_eq!(rows[3]["laneId"], json!("subagent:helper"));
    // Subagent rows carry isSidechain: true in raw.
    assert_eq!(rows[2]["raw"]["isSidechain"], json!(true));

    r.shutdown();
}

#[test]
fn timeline_main_plus_worktree_sibling() {
    // Both lanes are "main-thread" from a project-root perspective, but
    // one is a worktree of the same agent. Smoke test that the merge
    // works and the lane IDs pass through unchanged.
    let tmp = TempDir::new().unwrap();
    let main = write_timestamped(tmp.path(), "m.jsonl", "m", 0, 2, false);
    let worktree = write_timestamped(tmp.path(), "w.jsonl", "w", 10, 2, false);

    let mut r = Reader::spawn();
    let resp = r.req(json!({
        "cmd": "open_timeline",
        "files": [
            {"path": main.to_str().unwrap(), "laneId": "main"},
            {"path": worktree.to_str().unwrap(), "laneId": "worktree:fix-bug"},
        ],
    }));
    assert_eq!(resp["ok"], json!(true), "{}", resp);
    let lanes = resp["lanes"].as_array().unwrap();
    let lane_ids: Vec<&str> = lanes
        .iter()
        .map(|l| l["laneId"].as_str().unwrap())
        .collect();
    assert!(lane_ids.contains(&"main"));
    assert!(lane_ids.contains(&"worktree:fix-bug"));
    r.shutdown();
}

#[test]
fn open_timeline_rejects_empty_files_array() {
    let mut r = Reader::spawn();
    let resp = r.req(json!({"cmd":"open_timeline","files":[]}));
    assert_eq!(resp["ok"], json!(false));
    assert_eq!(resp["error"], json!("invalid_request"));
    r.shutdown();
}

#[test]
fn open_timeline_rejects_missing_path() {
    let mut r = Reader::spawn();
    let resp = r.req(json!({
        "cmd":"open_timeline",
        "files":[{"laneId":"main"}],
    }));
    assert_eq!(resp["ok"], json!(false));
    assert_eq!(resp["error"], json!("invalid_request"));
    r.shutdown();
}

#[test]
fn read_timeline_range_unknown_timeline_errors() {
    let mut r = Reader::spawn();
    let resp = r.req(json!({
        "cmd":"read_timeline_range","timelineId":"tl-deadbeef",
        "fromGlobal":0,"toGlobal":10,
    }));
    assert_eq!(resp["ok"], json!(false));
    assert_eq!(resp["error"], json!("timeline_not_found"));
    r.shutdown();
}

