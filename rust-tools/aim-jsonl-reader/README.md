# aim-jsonl-reader

Streaming reader for Claude Code JSONL session files. Speaks NDJSON
over stdin/stdout. Designed to be driven by the AI Maestro Node server
(Phase 2) or directly from a shell for debugging.

TRDD reference: `design/tasks/TRDD-d46b42e9-52fa-4f04-9be5-2fb4131fcdd1-jsonl-session-browser.md` §4.

## Why Rust

Claude Code JSONL files regularly reach 1–2 GB for long-lived agents.
Reading them inside the Node server would churn V8's heap and
introduce GC pauses into the live WebSocket terminal stream. This
binary keeps the expensive work out-of-process:

- `mmap` the file, never load it into a `Vec`.
- Build a sparse `(line_number, byte_offset)` index every 1000 lines
  on first open, persist it as `<path>.aimidx`, reuse forever.
- Answer range reads by seeking to the nearest index checkpoint and
  scanning forward — O(1000 lines) worst case regardless of file size.

## Protocol

One JSON object per line on stdin and stdout.

| Command | Required fields | Optional | Response (success) |
|---|---|---|---|
| `open` | `path` | — | `{sessionId, lineCount, indexed}` |
| `close` | `sessionId` | — | `{}` |
| `read_range` | `sessionId`, `fromLine`, `toLine` | — | `{lines:[…JSON values…]}` |
| `search` | `sessionId`, `query` | `kind` (`substring`\|`regex`), `caseInsensitive` (bool), `limit` (int) | `{matches:[{line, byteOffset, snippet}]}` |
| `context_breakdown` | `sessionId` | — | `{systemPrompt, systemTools, mcpTools, customAgents, memory, messages, freeSpace, cacheRead, total, modelContextLimit, approximate, modelId}` |
| `ping` | — | — | `{version}` |

All responses carry `ok: true`; errors carry `ok: false, error: "<code>", detail: "<msg>"`.

Error codes:

- `invalid_request` — malformed JSON, missing required field
- `unknown_command` — first-level dispatch miss
- `open_failed` — path doesn't exist or can't be mmap'd
- `read_failed` — seek/read error inside an opened session
- `search_failed` — regex compile error or scan I/O error
- `session_not_found` — `sessionId` not in the reader's open-set
- `panic` — last-resort handler for anything that reaches `panic!`

## Sparse `.aimidx` sidecar

Written next to the JSONL (`<jsonl-path>.aimidx`). ASCII header + binary body:

```
AIMIDX01\n
<mtime-ns of jsonl, decimal>\n
<file-size of jsonl, decimal>\n
<line-count of jsonl, decimal>\n
<binary: (u64 line_le, u64 byte_offset_le) × N entries>
```

The reader validates the header's `mtime_ns` and `file_size` against
the JSONL's current metadata. Drift → rebuild, overwriting the old
sidecar atomically (temp file + rename).

## Building

### Via the yarn-build hook (normal path)

From the project root:

```bash
scripts/build-jsonl-reader.sh
```

This detects the host platform, adds the target via rustup if missing,
builds `--release`, and copies the binary to `scripts/aim-jsonl-reader`.

### Via cargo directly (for development)

```bash
cd rust-tools/aim-jsonl-reader
cargo build --release
./target/release/aim-jsonl-reader
```

## Running tests

```bash
cd rust-tools/aim-jsonl-reader
cargo test
```

The 2 GB fixture test is gated behind `AIM_BIG_FIXTURE_TEST=1`:

```bash
AIM_BIG_FIXTURE_TEST=1 cargo test -- --ignored rss_stays_bounded_on_2gb_fixture
```

## Crate dependencies

TRDD §4.6 pins the runtime deps list (plus the `dev-dependencies`
which don't affect the shipped binary):

- `anyhow` — error wrapping with context for internal paths.
- `memmap2` — file-backed memory mapping for the mmap search path.
- `regex` — Rust's standard regex engine (bytes-mode).
- `serde_json` — JSON parse + serialize.

No network crate, no subprocess crate, no async runtime. The binary
is single-threaded by design — one stdin command processed at a time.

## Safety notes

- **`unsafe` is used once**: the `Mmap::map` call. `memmap2` documents
  this as a sound-on-immutable-file operation and we never mutate the
  mapped region. If a writer truncates the file between our stat and
  our map, we'll see a shortened snapshot but won't crash.
- **Panic hook**: installed in `main` to redirect panics into a JSON
  error on stdout, so the Node wrapper's line-parser never sees a
  stderr stacktrace.

## Non-goals (explicitly deferred to later phases)

- No search across multiple sessions (search is scoped to one open
  session).
- No live-tailing of a session in progress — callers re-`open` to
  rebuild the index when they need fresh lines.
- No non-Claude transcript formats (Codex, Gemini, OpenCode, Kiro) —
  those live in future adapters keyed on the client's format.
