// Context breakdown — walk the JSONL once and bucket token counts into
// the 7 categories documented in TRDD §4.5.
//
// Bucketing rules (from the TRDD table):
//   - type == "system-prompt"              -> systemPrompt
//   - role == "user"                       -> messages (not counted toward token cost)
//   - role == "assistant"                  -> messages (usage.output_tokens)
//                                             + cacheRead separately (usage.cache_read_input_tokens)
//   - type == "tool_use", name built-in    -> systemTools
//   - type == "tool_use", name mcp__*      -> mcpTools
//   - type == "tool_result"                -> messages
//   - type == "agent-definition"           -> customAgents
//   - type == "memory" OR source == "claude-md" -> memory
//
// When a record has no `usage` block, we approximate tokens as the
// length of its text payload divided by 4 — same heuristic Claude Code
// itself uses internally — and set `"approximate": true` at the top of
// the response so the UI can render a `~` marker.
//
// Model context limit: looked up from the `model` field of the first
// assistant record we encounter. Unknown/absent -> 200_000.

use std::collections::HashSet;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

use anyhow::{Context, Result};
use serde_json::{json, Value};

const DEFAULT_CONTEXT_LIMIT: u64 = 200_000;

const BUILTIN_TOOL_NAMES: &[&str] = &[
    "Read", "Write", "Grep", "Bash", "Glob", "Edit", "MultiEdit",
    "NotebookEdit", "WebFetch", "WebSearch", "Agent", "Task",
    "Skill", "ToolSearch", "TodoWrite",
];

#[derive(Default, Debug)]
pub struct Buckets {
    pub system_prompt:   u64,
    pub system_tools:    u64,
    pub mcp_tools:       u64,
    pub custom_agents:   u64,
    pub memory:          u64,
    pub messages:        u64,
    pub cache_read:      u64,
    pub approximate:     bool,
    pub model_id:        Option<String>,
    /// Request IDs of assistant entries we've already counted.
    /// Phase 5 §1 — the same requestId may appear on multiple rows when a
    /// turn is retried; only the first occurrence contributes to the
    /// running totals. Entries without a `requestId` continue to count
    /// individually (they bypass this set entirely).
    pub seen_request_ids: HashSet<String>,
}

pub fn compute(path: &Path) -> Result<Value> {
    let file = File::open(path).context("open jsonl for context breakdown")?;
    let mut reader = BufReader::with_capacity(1 << 20, file);

    let mut buckets = Buckets::default();
    let mut buf = Vec::<u8>::with_capacity(4096);
    loop {
        buf.clear();
        let n = reader.read_until(b'\n', &mut buf).context("read_until context")?;
        if n == 0 {
            break;
        }
        let slice = if buf.ends_with(b"\n") { &buf[..buf.len() - 1] } else { &buf[..] };
        if slice.is_empty() {
            continue;
        }
        let value: Value = match serde_json::from_slice(slice) {
            Ok(v) => v,
            Err(_) => continue, // Skip unparseable lines; don't fail the whole breakdown.
        };
        classify(&value, &mut buckets);
    }

    let limit = buckets.model_id.as_deref()
        .map(context_limit_for_model)
        .unwrap_or(DEFAULT_CONTEXT_LIMIT);

    let total =
        buckets.system_prompt
      + buckets.system_tools
      + buckets.mcp_tools
      + buckets.custom_agents
      + buckets.memory
      + buckets.messages;

    let free_space = limit.saturating_sub(total);

    Ok(json!({
        "systemPrompt":       buckets.system_prompt,
        "systemTools":        buckets.system_tools,
        "mcpTools":           buckets.mcp_tools,
        "customAgents":       buckets.custom_agents,
        "memory":             buckets.memory,
        "messages":           buckets.messages,
        "freeSpace":          free_space,
        "cacheRead":          buckets.cache_read,
        "total":              total,
        "modelContextLimit":  limit,
        "approximate":        buckets.approximate,
        "modelId":            buckets.model_id,
    }))
}

fn classify(v: &Value, b: &mut Buckets) {
    // Capture modelId opportunistically — the first non-null we see
    // wins. Claude Code sometimes records the model on the assistant
    // record and sometimes on a top-level `model` field.
    if b.model_id.is_none() {
        if let Some(m) = v.get("model").and_then(Value::as_str) {
            b.model_id = Some(m.to_string());
        } else if let Some(m) = v.get("message")
            .and_then(|m| m.get("model"))
            .and_then(Value::as_str)
        {
            b.model_id = Some(m.to_string());
        }
    }

    // Primary dispatch: check `type` first (more specific), then `role`.
    //
    // Claude Code JSONL shape (verified empirically 2026-05-06):
    //   - top-level `type` is `'user'` | `'assistant'` | `'attachment'` |
    //     `'last-prompt'` | `'custom-title'` | `'agent-name'` |
    //     `'permission-mode'` | `'file-history-snapshot'` | `'system'`.
    //     It is NEVER `'system-prompt'`, `'tool_use'`, `'tool_result'`,
    //     `'memory'`, `'agent-definition'` — those used to be matched
    //     here but never fired against real data, leaving every bucket
    //     at 0. Bug found in the screenshot 2026-05-06 21:24.
    //   - `role` is at `message.role`, NOT at the top level.
    //   - `tool_use` / `tool_result` / `thinking` / `text` blocks live
    //     inside `message.content[]` as objects with their own `type`.
    //   - `usage` is at `message.usage`.
    let ty = v.get("type").and_then(Value::as_str);
    let role = v.get("message")
        .and_then(|m| m.get("role"))
        .and_then(Value::as_str)
        .or_else(|| v.get("role").and_then(Value::as_str));
    let source = v.get("source").and_then(Value::as_str);

    // memory: explicit `source: "claude-md"` marker (legacy / non-Claude
    // formats). Real Claude Code JSONL doesn't ship CLAUDE.md as a
    // separate record — it's baked into the cached system prompt — but
    // we keep the check so converted-format JSONL still classifies.
    if ty == Some("memory") || source == Some("claude-md") {
        b.memory += estimate_tokens(v, b);
        return;
    }

    // Top-level legacy types — kept for forward-compat with future
    // Claude Code shapes and for non-Claude clients (Codex, etc.) that
    // emit `system-prompt` / `agent-definition` records directly.
    match ty {
        Some("system-prompt") => {
            b.system_prompt += estimate_tokens(v, b);
            return;
        }
        Some("agent-definition") => {
            b.custom_agents += estimate_tokens(v, b);
            return;
        }
        _ => {}
    }

    // Role-based dispatch for user/assistant — using the nested
    // `message.role` we resolved above.
    match role {
        Some("user") => {
            // For user messages, walk content[] for tool_result blocks
            // (those are tool-output replies and DO consume context).
            // User text itself is cheap; we don't bucket it but we
            // count tool_result tokens against the messages budget.
            if let Some(content) = v.get("message").and_then(|m| m.get("content")).and_then(Value::as_array) {
                for block in content {
                    if let Some(block_ty) = block.get("type").and_then(Value::as_str) {
                        if block_ty == "tool_result" {
                            // tool_result blocks may not have explicit usage;
                            // fall back to text estimation.
                            b.messages += estimate_tokens(block, b);
                        }
                    }
                }
            }
            // If the record has explicit usage.input_tokens at the top
            // level (some non-Claude formats), still log for fidelity.
            if let Some(u) = usage_field(v, "input_tokens") {
                b.messages += u;
            }
        }
        Some("assistant") => {
            // Phase 5 §1: deduplicateByRequestId — assistant turns that
            // were retried mid-stream share a requestId; keep only the
            // first occurrence in the totals.
            if let Some(rid) = v.get("requestId").and_then(Value::as_str) {
                if !b.seen_request_ids.insert(rid.to_string()) {
                    return;
                }
            }

            if let Some(u) = usage_field(v, "output_tokens") {
                b.messages += u;
            } else {
                b.messages += estimate_tokens(v, b);
            }
            if let Some(u) = usage_field(v, "cache_read_input_tokens") {
                b.cache_read += u;
            }
            // The cache_creation_input_tokens (what was sent to be
            // cached) is a strong proxy for "what's currently in the
            // model's view" — we attribute the FIRST cache-creation we
            // see to system_prompt (CLAUDE.md + tools + skills + role
            // persona, which is what Claude Code caches up-front on the
            // first turn). Subsequent cache-creations expand the cache
            // with new turn content; we attribute those to messages.
            if let Some(u) = usage_field(v, "cache_creation_input_tokens") {
                if b.system_prompt == 0 {
                    b.system_prompt += u;
                } else {
                    b.messages += u;
                }
            }

            // Walk message.content[] for tool_use / thinking blocks so
            // tool calls land in systemTools / mcpTools. Tool inputs
            // are typically tiny (a few hundred chars), so the
            // estimate_tokens fallback here is intentional — these are
            // "context cost of the tool descriptor", not output.
            if let Some(content) = v.get("message").and_then(|m| m.get("content")).and_then(Value::as_array) {
                for block in content {
                    let block_ty = block.get("type").and_then(Value::as_str);
                    match block_ty {
                        Some("tool_use") => {
                            let name = block.get("name").and_then(Value::as_str).unwrap_or("");
                            // tool_use contributes the rendered input
                            // size to system/mcp tools; it's NOT
                            // double-counted against `messages` because
                            // output_tokens above already accounts for
                            // the assistant turn's total output and we
                            // do NOT subtract here — the `freeSpace`
                            // calculation is the only consumer that
                            // cares, and a slight over-attribution to
                            // tools (vs messages) is the lesser evil.
                            let tool_cost = estimate_tokens(block, b);
                            if name.starts_with("mcp__") {
                                b.mcp_tools += tool_cost;
                            } else if BUILTIN_TOOL_NAMES.iter().any(|t| *t == name) {
                                b.system_tools += tool_cost;
                            } else {
                                b.system_tools += tool_cost;
                            }
                        }
                        Some("thinking") => {
                            // Extended thinking — already counted in
                            // output_tokens at the message level. We do
                            // NOT add it again here.
                        }
                        _ => {}
                    }
                }
            }
        }
        _ => {
            // Top-level types like 'attachment', 'last-prompt',
            // 'custom-title', 'agent-name', 'permission-mode',
            // 'file-history-snapshot' etc. — they don't directly
            // contribute to the context window. Skip.
        }
    }
}

/// Estimate tokens for a record. Preference order:
///   1. `usage.output_tokens` (for assistants)
///   2. `usage.input_tokens`
///   3. text_len / 4 across common text fields
///
/// When we fall back to the text estimator we flip `approximate = true`.
fn estimate_tokens(v: &Value, b: &mut Buckets) -> u64 {
    if let Some(u) = usage_field(v, "output_tokens") { return u; }
    if let Some(u) = usage_field(v, "input_tokens")  { return u; }

    let mut chars: u64 = 0;
    for field in ["content", "text", "input", "message", "prompt", "output"] {
        match v.get(field) {
            Some(Value::String(s)) => {
                chars = chars.saturating_add(s.len() as u64);
            }
            Some(Value::Array(a)) => {
                for item in a {
                    match item {
                        Value::String(s) => chars = chars.saturating_add(s.len() as u64),
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
                // `input`/`output` on tool_use/tool_result records is
                // typically a JSON object. If it has a `text` child use
                // it (that's the author-visible content); otherwise
                // fall back to the serialized JSON length so the token
                // budget isn't silently zero.
                if let Some(inner) = v.get(field).and_then(|o| o.get("text")).and_then(Value::as_str) {
                    chars = chars.saturating_add(inner.len() as u64);
                } else if let Some(obj) = v.get(field) {
                    chars = chars.saturating_add(obj.to_string().len() as u64);
                }
            }
            _ => {}
        }
    }
    b.approximate = true;
    // Claude's rough 4-chars-per-token heuristic.
    chars / 4
}

fn usage_field(v: &Value, field: &str) -> Option<u64> {
    v.get("usage").and_then(|u| u.get(field)).and_then(Value::as_u64)
        .or_else(|| v.get("message").and_then(|m| m.get("usage"))
                     .and_then(|u| u.get(field)).and_then(Value::as_u64))
}

/// Context-window table. TRDD §4.5 hard-codes the lookup.
///
/// Only the explicit 1M-context model variants advertise their window via
/// the `[1m]` marker in the model id (e.g. `claude-opus-4-8[1m]`). Every
/// other model — opus/sonnet/haiku-4 without the marker, or anything
/// unknown — resolves to the default 200K window. The previous
/// `starts_with("claude-opus-4")` rule over-reported ALL Opus-4 ids as 1M.
// MUST match lib/context-limits.ts contextLimitForModel — TRDD-1657a5f4 Phase 1.
pub fn context_limit_for_model(model_id: &str) -> u64 {
    let m = model_id.to_ascii_lowercase();
    if m.contains("[1m]") { return 1_000_000; }
    DEFAULT_CONTEXT_LIMIT
}

#[cfg(test)]
mod tests {
    use super::*;

    // Canonical rule (mirrors lib/context-limits.ts): only ids carrying the
    // `[1m]` marker get the 1M window; every other Opus/Sonnet/Haiku-4 id —
    // and anything unknown — collapses to the 200K default.
    #[test]
    fn context_limit_marker_only_grants_one_million() {
        assert_eq!(context_limit_for_model("claude-opus-4-8"), 200_000);
        assert_eq!(context_limit_for_model("claude-opus-4-8[1m]"), 1_000_000);
        assert_eq!(context_limit_for_model("claude-sonnet-4-6"), 200_000);
        assert_eq!(context_limit_for_model("claude-haiku-4-5"), 200_000);
        assert_eq!(context_limit_for_model("some-unknown-model"), 200_000);
    }
}
