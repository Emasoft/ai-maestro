// NDJSON protocol — one JSON object per line, on stdin and stdout.
//
// We deliberately avoid `serde_derive` + the `serde` derive crate so the
// release binary stays small and compile time stays low. Requests are
// parsed as `serde_json::Value` and dispatched by the `cmd` field; each
// handler pulls the fields it needs and validates them explicitly.
//
// This also keeps the protocol easy to extend without recompiling
// consumers — new fields are ignored by old readers, which is the
// forward-compat story we want for a long-lived Node wrapper.

use serde_json::{json, Value};

/// Canonical error codes the server (Node) side may match on. Keep this
/// list stable across minor versions; new codes are additive.
pub mod errors {
    pub const UNKNOWN_COMMAND:    &str = "unknown_command";
    pub const INVALID_REQUEST:    &str = "invalid_request";
    pub const SESSION_NOT_FOUND:  &str = "session_not_found";
    pub const OPEN_FAILED:        &str = "open_failed";
    pub const READ_FAILED:        &str = "read_failed";
    pub const SEARCH_FAILED:      &str = "search_failed";
    pub const PANIC:              &str = "panic";
    /// Timeline id was not registered (never opened, or was closed).
    pub const TIMELINE_NOT_FOUND: &str = "timeline_not_found";
}

/// Response helpers. All responses are a single JSON line. No trailing
/// whitespace beyond a single newline (handled by the writer layer).
pub fn ok(body: Value) -> Value {
    let mut obj = json!({ "ok": true });
    if let (Some(base), Some(extra)) = (obj.as_object_mut(), body.as_object()) {
        for (k, v) in extra {
            base.insert(k.clone(), v.clone());
        }
    }
    obj
}

pub fn err(code: &str, detail: impl Into<String>) -> Value {
    json!({
        "ok": false,
        "error": code,
        "detail": detail.into(),
    })
}

/// Small helper to extract a required string field. Returns a protocol
/// error response on failure instead of panicking — the caller just
/// forwards it to stdout.
pub fn required_str<'a>(req: &'a Value, field: &str) -> Result<&'a str, Value> {
    req.get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| err(errors::INVALID_REQUEST, format!("missing '{field}'")))
}

pub fn required_u64(req: &Value, field: &str) -> Result<u64, Value> {
    req.get(field)
        .and_then(Value::as_u64)
        .ok_or_else(|| err(errors::INVALID_REQUEST, format!("missing '{field}'")))
}

/// Optional u64 with a default when the field is absent.
pub fn optional_u64(req: &Value, field: &str, default: u64) -> u64 {
    req.get(field).and_then(Value::as_u64).unwrap_or(default)
}

pub fn optional_bool(req: &Value, field: &str, default: bool) -> bool {
    req.get(field).and_then(Value::as_bool).unwrap_or(default)
}

pub fn optional_str<'a>(req: &'a Value, field: &str, default: &'a str) -> &'a str {
    req.get(field).and_then(Value::as_str).unwrap_or(default)
}
