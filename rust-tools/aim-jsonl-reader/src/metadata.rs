// analyze_file_metadata — single streaming pass over a JSONL session
// file that produces the rich metadata blob the sessions-browser UI
// needs to render session-divider rows and aggregate summaries.
//
// Design invariants (Phase 5 §3.8 of the redesign plan):
//
//   - Streaming-friendly. One pass over the file, line-by-line, with a
//     bounded scratch buffer. Never materializes the whole file.
//   - Panic-safe. Malformed lines are silently skipped — the reader's
//     panic hook exists as a last-resort catch, but we do not rely on
//     it. Compare `context::compute` which uses the same pattern.
//   - Additive response shape. Every field is present on every return;
//     UI layers can treat optional fields that don't exist yet as
//     missing without branching on protocol version.
//   - Request-id dedup. Same bug fix as `context.rs` Phase 5 §1 — an
//     assistant turn retried mid-stream emits multiple entries sharing
//     one requestId; only the first counts toward the token total.
//
// Fields returned:
//
//   firstUserMessagePreview          first user text, ≤ 120 chars (skips isMeta)
//   isOngoing                        true when mtime is recent AND no shutdown marker
//   compactionCount                  number of rows with isCompactSummary: true
//   phaseTokenBreakdown              list of {phaseId, pre, peak, post}, one per phase
//                                    (a new phase opens after every compaction)
//   shutdownToolCalls                count of explicit shutdown tool calls
//   rejections                       count of tool_result rows with is_error: true
//   requestIdDedupedAssistantTokens  sum of usage.output_tokens, deduped by requestId
//   hasSubagentSpawns                true when any tool_use with name=Task OR any
//                                    entry with isSidechain: true appears
//   hasCompactSummary                true when compactionCount > 0

use std::collections::HashSet;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result};
use serde_json::{json, Value};

/// Preview truncation length (chars, not bytes — so multibyte Unicode is safe).
const PREVIEW_MAX_CHARS: usize = 120;

/// "Ongoing" window — a file whose last mtime is within this many seconds of
/// now, and has no explicit shutdown marker, counts as ongoing. 10 minutes
/// matches the plan's recommendation and the reference implementation.
const ONGOING_WINDOW_SECS: u64 = 10 * 60;

/// Tool names that we treat as session-shutdown markers when seen as a
/// `tool_use`. Kept explicit so the rule is easy to audit — not regex-based.
const SHUTDOWN_TOOL_NAMES: &[&str] = &["ExitPlanMode"];

/// Running totals for ONE phase of a session. A phase is the slice of the
/// transcript between two adjacent compaction markers (or start-of-file and
/// the first marker, or the last marker and end-of-file).
#[derive(Debug, Default)]
struct PhaseAccumulator {
    /// Running tokens-at-start (always 0 for phase 0; starts from the
    /// previous phase's `post` otherwise). We do not currently model
    /// cumulative-from-start at the phase level — Phase 6 adds that when
    /// the prefix-array is wired in. For now this is reported as 0 for
    /// the opening phase and as the last observed token total at the
    /// compaction boundary for subsequent phases.
    pre: u64,
    /// Highest message total observed during this phase.
    peak: u64,
    /// Token total at the closing compaction. `None` while the phase is
    /// open (the last phase of the file is always open).
    post: Option<u64>,
}

/// Compute metadata for the file at `path`.
pub fn compute(path: &Path) -> Result<Value> {
    let metadata =
        std::fs::metadata(path).context("stat jsonl file for metadata analyze")?;
    let mtime_secs = metadata
        .modified()
        .ok()
        .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let is_recent = now_secs.saturating_sub(mtime_secs) < ONGOING_WINDOW_SECS;

    let file = File::open(path).context("open jsonl file for metadata analyze")?;
    let mut reader = BufReader::with_capacity(1 << 20, file);

    let mut first_user_preview: Option<String> = None;
    let mut compaction_count: u64 = 0;
    let mut shutdown_tool_calls: u64 = 0;
    let mut rejections: u64 = 0;
    let mut has_subagent_spawns = false;
    let mut seen_request_ids: HashSet<String> = HashSet::new();
    let mut request_id_deduped_assistant_tokens: u64 = 0;
    let mut saw_shutdown_marker = false;

    // Phase bookkeeping. We emit at least one phase even for empty files
    // so the UI always has a deterministic shape to render.
    let mut phases: Vec<PhaseAccumulator> = vec![PhaseAccumulator::default()];
    // Current phase's running message total; resets on compaction.
    let mut current_phase_total: u64 = 0;

    let mut buf = Vec::<u8>::with_capacity(4096);
    loop {
        buf.clear();
        let n = reader
            .read_until(b'\n', &mut buf)
            .context("read_until metadata analyze")?;
        if n == 0 {
            break;
        }
        let slice = if buf.ends_with(b"\n") { &buf[..buf.len() - 1] } else { &buf[..] };
        if slice.is_empty() {
            continue;
        }

        // Invariant: never panic. Silently skip lines that don't parse.
        // This matches context.rs's strategy and the _parseError wrapper
        // pattern documented in reader.rs.
        let value: Value = match serde_json::from_slice(slice) {
            Ok(v) => v,
            Err(_) => continue,
        };

        // ── Compaction marker — close current phase, open a new one ──
        // isCompactSummary may appear as a boolean on the entry itself.
        let is_compact = value
            .get("isCompactSummary")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if is_compact {
            compaction_count += 1;
            // Close the current phase with its running total as `post`.
            if let Some(last) = phases.last_mut() {
                last.post = Some(current_phase_total);
            }
            // Open a new phase; its `pre` starts from the previous total
            // so phase-timelines can show continuity.
            let next = PhaseAccumulator {
                pre: current_phase_total,
                peak: current_phase_total,
                post: None,
            };
            phases.push(next);
            // The new phase's running total inherits from the previous — a
            // compaction does NOT zero the token budget, it just marks the
            // boundary where the context window was summarized. This
            // matches how the reference implementation treats it.
            continue;
        }

        // ── First user message preview (skip isMeta) ──
        if first_user_preview.is_none() {
            if let Some(preview) = extract_first_user_preview(&value) {
                first_user_preview = Some(truncate_chars(&preview, PREVIEW_MAX_CHARS));
            }
        }

        // ── Subagent-spawn signal ──
        if value
            .get("isSidechain")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            has_subagent_spawns = true;
        }
        let ty = value.get("type").and_then(Value::as_str);
        let name = value.get("name").and_then(Value::as_str).unwrap_or("");
        if ty == Some("tool_use") && name == "Task" {
            has_subagent_spawns = true;
        }

        // ── Shutdown tool calls ──
        if ty == Some("tool_use") && SHUTDOWN_TOOL_NAMES.contains(&name) {
            shutdown_tool_calls += 1;
            saw_shutdown_marker = true;
        }
        // Also treat Bash calls whose command contains `/exit` as shutdown.
        if ty == Some("tool_use") && name == "Bash" {
            if let Some(cmd) = value
                .get("input")
                .and_then(|i| i.get("command"))
                .and_then(Value::as_str)
            {
                if cmd.contains("/exit") {
                    shutdown_tool_calls += 1;
                    saw_shutdown_marker = true;
                }
            }
        }

        // ── Rejections (error tool_results) ──
        if ty == Some("tool_result")
            && value
                .get("is_error")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        {
            rejections += 1;
        }

        // ── Request-id-deduped assistant tokens ──
        // Same rule as context.rs §1: if the row has a requestId we've
        // already counted, skip it entirely.
        let role = value.get("role").and_then(Value::as_str);
        if role == Some("assistant") {
            let should_count = match value.get("requestId").and_then(Value::as_str) {
                Some(rid) => seen_request_ids.insert(rid.to_string()),
                None => true, // no requestId → always count
            };
            if should_count {
                if let Some(out_toks) = usage_field(&value, "output_tokens") {
                    request_id_deduped_assistant_tokens =
                        request_id_deduped_assistant_tokens.saturating_add(out_toks);
                    current_phase_total =
                        current_phase_total.saturating_add(out_toks);
                    if let Some(last) = phases.last_mut() {
                        if current_phase_total > last.peak {
                            last.peak = current_phase_total;
                        }
                    }
                }
            }
        }
    }

    // is_ongoing: mtime within window AND no shutdown marker seen.
    let is_ongoing = is_recent && !saw_shutdown_marker;
    let has_compact_summary = compaction_count > 0;

    let phase_token_breakdown: Vec<Value> = phases
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
        "firstUserMessagePreview":          first_user_preview.unwrap_or_default(),
        "isOngoing":                        is_ongoing,
        "compactionCount":                  compaction_count,
        "phaseTokenBreakdown":              phase_token_breakdown,
        "shutdownToolCalls":                shutdown_tool_calls,
        "rejections":                       rejections,
        "requestIdDedupedAssistantTokens":  request_id_deduped_assistant_tokens,
        "hasSubagentSpawns":                has_subagent_spawns,
        "hasCompactSummary":                has_compact_summary,
    }))
}

/// Pull a user preview string out of a JSONL record, returning None if the
/// record is NOT a genuine user entry (role != user, or isMeta == true).
///
/// User entries in Claude Code JSONL may carry content in one of several
/// shapes:
///   - `message.content` — string
///   - `message.content` — array of `{type:"text", text:"..."}` segments
///   - `content` — string (direct, no `message` wrapper)
///   - `content` — array of segments
fn extract_first_user_preview(v: &Value) -> Option<String> {
    if v.get("role").and_then(Value::as_str) != Some("user") {
        return None;
    }
    // isMeta entries are synthesized diagnostics, not real user messages.
    if v.get("isMeta").and_then(Value::as_bool).unwrap_or(false) {
        return None;
    }
    // Try message.content first.
    if let Some(text) = extract_content_text(v.get("message").and_then(|m| m.get("content"))) {
        if !text.is_empty() {
            return Some(text);
        }
    }
    // Fall back to top-level content.
    if let Some(text) = extract_content_text(v.get("content")) {
        if !text.is_empty() {
            return Some(text);
        }
    }
    None
}

/// Extract a plain-text string from a content field. Handles:
///   - null  → None
///   - string → returned verbatim
///   - array of {type:"text", text:"..."} → concatenated with a single space
///   - array of strings → concatenated with a single space
///   - everything else → None
fn extract_content_text(v: Option<&Value>) -> Option<String> {
    let v = v?;
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Array(arr) => {
            let mut pieces: Vec<String> = Vec::with_capacity(arr.len());
            for item in arr {
                match item {
                    Value::String(s) => pieces.push(s.clone()),
                    Value::Object(_) => {
                        if let Some(t) = item.get("text").and_then(Value::as_str) {
                            pieces.push(t.to_string());
                        }
                    }
                    _ => {}
                }
            }
            if pieces.is_empty() {
                None
            } else {
                Some(pieces.join(" "))
            }
        }
        _ => None,
    }
}

/// Truncate `s` to at most `max` Unicode characters (NOT bytes).
fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    s.chars().take(max).collect()
}

/// Same helper as `context::usage_field` — pull a u64 field from
/// `v.usage.<field>` OR from `v.message.usage.<field>`.
fn usage_field(v: &Value, field: &str) -> Option<u64> {
    v.get("usage")
        .and_then(|u| u.get(field))
        .and_then(Value::as_u64)
        .or_else(|| {
            v.get("message")
                .and_then(|m| m.get("usage"))
                .and_then(|u| u.get(field))
                .and_then(Value::as_u64)
        })
}
