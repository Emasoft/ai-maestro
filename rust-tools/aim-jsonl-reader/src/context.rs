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
    let ty = v.get("type").and_then(Value::as_str);
    let role = v.get("role").and_then(Value::as_str);
    let source = v.get("source").and_then(Value::as_str);

    // memory: either explicit type or source marker
    if ty == Some("memory") || source == Some("claude-md") {
        b.memory += estimate_tokens(v, b);
        return;
    }

    match ty {
        Some("system-prompt") => {
            b.system_prompt += estimate_tokens(v, b);
            return;
        }
        Some("agent-definition") => {
            b.custom_agents += estimate_tokens(v, b);
            return;
        }
        Some("tool_use") => {
            let name = v.get("name").and_then(Value::as_str).unwrap_or("");
            if name.starts_with("mcp__") {
                b.mcp_tools += estimate_tokens(v, b);
            } else if BUILTIN_TOOL_NAMES.iter().any(|t| *t == name) {
                b.system_tools += estimate_tokens(v, b);
            } else {
                // Unknown tool — lump under systemTools so the budget
                // isn't silently lost.
                b.system_tools += estimate_tokens(v, b);
            }
            return;
        }
        Some("tool_result") => {
            b.messages += estimate_tokens(v, b);
            return;
        }
        _ => {}
    }

    // Role-based dispatch for user/assistant.
    match role {
        Some("user") => {
            // User text is cheap — don't add to the token budget.
            // If the record has explicit usage.input_tokens we still
            // log it against messages for fidelity.
            if let Some(u) = usage_field(v, "input_tokens") {
                b.messages += u;
            }
        }
        Some("assistant") => {
            if let Some(u) = usage_field(v, "output_tokens") {
                b.messages += u;
            } else {
                b.messages += estimate_tokens(v, b);
            }
            if let Some(u) = usage_field(v, "cache_read_input_tokens") {
                b.cache_read += u;
            }
        }
        _ => {
            // Unknown record type — skip silently. The panic handler
            // catches any real crash; we don't want to abort a huge
            // breakdown over one weird line.
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
pub fn context_limit_for_model(model_id: &str) -> u64 {
    let m = model_id.to_ascii_lowercase();
    if m.starts_with("claude-opus-4")   { return 1_000_000; }
    if m.starts_with("claude-sonnet-4") { return 200_000; }
    if m.starts_with("claude-haiku-4")  { return 200_000; }
    DEFAULT_CONTEXT_LIMIT
}
