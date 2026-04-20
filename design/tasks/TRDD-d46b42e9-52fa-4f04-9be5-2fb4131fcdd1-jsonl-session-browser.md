# TRDD-d46b42e9 — JSONL Session Browser (Rust streaming reader + chat transcript UI)

**TRDD ID:** `d46b42e9-52fa-4f04-9be5-2fb4131fcdd1`
**Filename:** `design/tasks/TRDD-d46b42e9-52fa-4f04-9be5-2fb4131fcdd1-jsonl-session-browser.md`
**Tracked in:** this repo (design/tasks/ is git-tracked)
**Feature branch:** `feature/jsonl-session-browser` (already cut from `feature/team-governance` HEAD `9dcb520b`)
**Status:** Not started — specs only. Parallel-worker-agent will implement phase-by-phase.
**Orchestration:** Parallel-worker-agent lands each phase on the feature branch; parallel-tester-agent smoke-tests after each phase merges. The 25-scenario batch runs concurrently on `feature/team-governance` — no merge conflicts because file scopes do not overlap.

---

## 0. One-line summary

Render a Claude Code session's `.jsonl` file (up to ~2 GB) as a scrollable chat transcript with per-message token counts and a right-hand context-window breakdown, backed by a Rust streaming reader so the Node server never holds the full file in memory.

---

## 1. Context and motivation

Claude Code persists every conversation at `~/.claude/projects/<slugged-project-dir>/<session-uuid>.jsonl`. Each line is a JSON record — a user message, assistant message, tool use, tool result, system event, etc. For active long-running agents (like the ones AI Maestro orchestrates) these files routinely exceed 200 MB and have been observed at 1.5 GB+ after weeks of multi-turn work.

The user wants AI Maestro to expose these sessions inside the Agent Profile UI so that, for any agent running inside the dashboard, they can:

1. **List the agent's sessions** — every `.jsonl` file belonging to that agent's project dir, sorted newest first, with size + message count + last-modified date.
2. **Open one session as a full chat transcript** — every message rendered in its natural form (user text, assistant text, tool calls collapsed to summary, tool results collapsible), with clear visual separation and role labels.
3. **See per-message token counts** — input / output / cache-read / cache-creation tokens shown alongside each assistant message, plus a running total at the top.
4. **Break down the context window** — a right-side panel that categorizes the current context into 7 buckets (system prompt, system tools, MCP tools, custom agents, memory, messages, free space) mirroring what Claude Code's `/context` command shows.
5. **Search within the session** — type a keyword or regex, see every match in context, jump between them.
6. **Navigate by index or time** — "go to message 5000" or "go to 2026-04-18 14:00" without loading the file into memory.

The reference implementation the user pointed at is `matt1398/claude-devtools` — specifically its JSONL browser. The bit that implementation does not solve well is the **streaming problem**: it reads the whole file into memory, so a 2 GB session kills the Node process. AI Maestro must do better.

### Why this matters for AI Maestro

- Agents in AI Maestro run 24/7 under tmux. Their JSONL files grow far faster than a typical user's Claude Code session.
- The Subconscious Self-Change Tracker (TRDD-7123d51a, already landed) uses the same JSONL files to detect drift; the reader-crate from Phase 1 is reusable infra for that subsystem later.
- The per-op signed ledger (TRDD-eac02238, already landed) writes to its own store, but correlating ledger entries with the JSONL turn that caused them is a future win that depends on index-by-timestamp from Phase 1.
- Debugging live agents (Rule 13 overnight batches, SCEN runs) is currently blocked on `less` / `jq` — a proper UI browser is the unlock.

---

## 2. Non-goals

The following are NOT part of this TRDD. If a phase spec starts drifting toward them, `DEFER` and open a new TRDD.

- **Edit / replay sessions.** Read-only. No "inject a fake user message" or "replay from turn X" affordance.
- **Cross-session analytics.** No "compare two sessions" view, no aggregate token graphs over time. One session at a time.
- **Export to other formats.** No markdown export, no PDF export. Copy-paste from the browser is sufficient.
- **LLM-powered summarization.** No "summarize this session" button. That belongs in the cerebellum layer, not the viewer.
- **Search across sessions.** Search is WITHIN one open session. Fulltext-over-all-sessions is a separate (bigger) problem.
- **Live-tailing of a session in progress.** The viewer is snapshot-based. The "Live" stream is already served by the existing terminal WebSocket; this is a complement, not a replacement.
- **Non-Claude clients.** Codex / Gemini / OpenCode / Kiro have different transcript formats. Phase 1–4 are Claude-only. A future TRDD adds adapters.

---

## 3. Architecture overview

Three tiers. Each tier maps cleanly to one or two implementation phases.

```
┌────────────────────────────────────────────────────────────────────┐
│  Browser (React) — Phase 3                                         │
│  ┌───────────────────────┐  ┌────────────────────────────────────┐ │
│  │ Session list panel    │  │ Chat transcript (virtualized)      │ │
│  │  • one row per .jsonl │  │  • role-colored bubbles            │ │
│  │  • size / msgs / date │  │  • token badge per assistant msg   │ │
│  └───────────────────────┘  │  • tool-call collapsible rows      │ │
│                             └────────────────────────────────────┘ │
│                             ┌────────────────────────────────────┐ │
│                             │ Context breakdown panel (right)    │ │
│                             │  • 7 categories with bars + % used │ │
│                             │  • total context tokens            │ │
│                             └────────────────────────────────────┘ │
│                             ┌────────────────────────────────────┐ │
│                             │ Search bar (top)                   │ │
│                             └────────────────────────────────────┘ │
└────────────────────────────┬───────────────────────────────────────┘
                             │   HTTP JSON (paged)
┌────────────────────────────▼───────────────────────────────────────┐
│  Next.js API routes — Phase 2                                      │
│  • GET  /api/sessions-browser/agents/:id/sessions                  │
│  • POST /api/sessions-browser/sessions/:sid/range                  │
│  • POST /api/sessions-browser/sessions/:sid/search                 │
│  • GET  /api/sessions-browser/sessions/:sid/context-breakdown      │
└────────────────────────────┬───────────────────────────────────────┘
                             │   Node ↔ Rust stdio (NDJSON frames)
┌────────────────────────────▼───────────────────────────────────────┐
│  Rust binary  aim-jsonl-reader  — Phase 1                          │
│  • streaming line reader (memory-bounded)                          │
│  • sparse index (byte-offset per line, built on first open)        │
│  • byte-range read + line-index read                               │
│  • case-insensitive substring + regex search                       │
│  • token sum + context-breakdown extraction                        │
└────────────────────────────┬───────────────────────────────────────┘
                             │   mmap-backed read of jsonl + sidecar .idx
                         filesystem
```

**Why Rust for the reader.** The alternative is a Node stream reader. Three reasons Node is wrong here:

1. **GC pressure.** A 2 GB file streamed through Node's V8 will churn the heap hard — and the AI Maestro server is a long-lived process that must not GC-pause during live terminal WebSocket traffic.
2. **mmap is first-class in Rust.** The sparse index + byte-range read is 20 lines of `memmap2` + `std::io::BufReader`. In Node it's a third-party addon or a read-stream loop that loses the mmap benefit.
3. **Cold-path latency.** The Rust binary returns an indexed offset range in <10 ms for arbitrary line numbers inside a 2 GB file; a Node equivalent that re-scans from the top is O(bytes). With the sparse index (every N lines) persisted as a sidecar `.idx` file, the second open is instant.

**How Node talks to Rust.** The Rust binary exposes an NDJSON protocol over stdio — one JSON request per line in, one JSON response per line out. A long-lived Node-side worker keeps one Rust process alive per dashboard (with session-level handles inside). No per-request fork/exec.

**Where the binary lives.** `scripts/aim-jsonl-reader` (macOS arm64 + x86_64, Linux x86_64). The `yarn build` step copies the right binary for the current platform from `rust-tools/aim-jsonl-reader/target/release/` into `scripts/`. The binary is gitignored; CI + a release-time pre-build stage produces it. For dev, `yarn build` triggers `cargo build --release -p aim-jsonl-reader` on first run.

---

## 4. Phase 1 — Rust streaming reader (self-contained spec for parallel-worker-agent)

### 4.1 Feature description

Build a Rust CLI binary `aim-jsonl-reader` that reads Claude Code JSONL session files and answers 4 classes of query over stdio, without ever loading the full file into memory. Publishes a sparse sidecar index (one entry per 1000 lines) so the second open of a given file is O(log lines) instead of O(bytes).

### 4.2 File scope (parallel-worker-agent may ONLY write inside these paths)

```
rust-tools/aim-jsonl-reader/Cargo.toml
rust-tools/aim-jsonl-reader/src/main.rs
rust-tools/aim-jsonl-reader/src/index.rs       (sparse index + .idx sidecar)
rust-tools/aim-jsonl-reader/src/reader.rs      (mmap + byte-range + line-index)
rust-tools/aim-jsonl-reader/src/search.rs      (substring + regex)
rust-tools/aim-jsonl-reader/src/context.rs     (context-breakdown aggregator)
rust-tools/aim-jsonl-reader/src/protocol.rs    (NDJSON request/response types)
rust-tools/aim-jsonl-reader/tests/fixtures/    (small .jsonl fixtures)
rust-tools/aim-jsonl-reader/tests/integration.rs
rust-tools/aim-jsonl-reader/README.md
scripts/build-jsonl-reader.sh                  (yarn build hook)
package.json                                   (append a "build:jsonl-reader" script)
.gitignore                                     (add scripts/aim-jsonl-reader-* binaries)
```

**Explicitly OUT of scope for Phase 1:** everything under `app/`, `components/`, `lib/` (except the gitignore entry), `services/`, `hooks/`, `types/`, any existing file in `scripts/` other than the new `build-jsonl-reader.sh`. Phase 1 is a standalone Rust crate + a build hook; the Node wrapper is Phase 2.

### 4.3 Acceptance criteria

Each bullet must be objectively verifiable via `cargo test` or a shell smoke-check.

1. **`aim-jsonl-reader` binary builds on macOS (arm64 + x86_64) and Linux (x86_64).** `cargo build --release` exits 0 on all three triples. Cross-compile targets added to `Cargo.toml`; the `scripts/build-jsonl-reader.sh` script picks the right target for the current platform and copies the binary to `scripts/aim-jsonl-reader`.
2. **Stdio NDJSON protocol works round-trip.** Sending `{"cmd":"open","path":"<fixture>.jsonl"}` returns `{"ok":true,"sessionId":"<uuid>","lineCount":<N>,"indexed":true|false}` on a single line. Sending `{"cmd":"close","sessionId":"..."}` returns `{"ok":true}`. Unknown commands return `{"ok":false,"error":"unknown_command"}`.
3. **Range read is memory-bounded.** `{"cmd":"read_range","sessionId":"...","fromLine":5000,"toLine":5100}` returns exactly 101 lines (or fewer if EOF), each as a parsed JSON value in a `"lines":[...]` array, with peak-RSS of the reader process measured by `ps` staying <100 MB even for a 2 GB fixture. Enforce by including a 2 GB synthetic fixture generator in `tests/fixtures/` and running the RSS assertion in `integration.rs`.
4. **Sparse index is built once, reused forever.** First `open` on a file that has no sidecar takes O(bytes) and writes `<path>.aimidx` next to the JSONL. Second `open` reads `.aimidx`, validates its header (jsonl mtime + size), and skips the rebuild — completing in <50 ms for a 2 GB file. If mtime/size drift, the index is rebuilt automatically and the new one overwrites the old.
5. **Search returns matches with byte offsets and line numbers.** `{"cmd":"search","sessionId":"...","query":"foo","kind":"substring","caseInsensitive":true,"limit":100}` returns up to 100 matches as `[{"line":42,"byteOffset":12345,"snippet":"<line truncated to 200 chars with match highlighted>"}]`. Regex variant accepted under `"kind":"regex"` using Rust's `regex` crate.
6. **Context breakdown extracts 7 categories.** `{"cmd":"context_breakdown","sessionId":"..."}` returns `{"systemPrompt":<tokens>,"systemTools":<tokens>,"mcpTools":<tokens>,"customAgents":<tokens>,"memory":<tokens>,"messages":<tokens>,"freeSpace":<tokens>,"total":<tokens>,"modelContextLimit":<tokens>}`. Each bucket is summed from the relevant JSONL record types per the Claude Code schema (see §4.5 below).

### 4.4 Smoke test (parallel-tester-agent uses this after Phase 1 merges)

1. **Preconditions check** — `scripts/aim-jsonl-reader` exists, `chmod +x` set, `file scripts/aim-jsonl-reader | grep -q "executable"` exits 0.
2. **Create a tiny fixture** — `echo '{"role":"user","content":"hi","timestamp":"2026-04-20T00:00:00Z"}' > /tmp/aim-smoke.jsonl`.
3. **Open + line count** — `echo '{"cmd":"open","path":"/tmp/aim-smoke.jsonl"}' | scripts/aim-jsonl-reader` — expect JSON with `"lineCount":1,"ok":true`.
4. **Range read** — send `{"cmd":"read_range","sessionId":"<from step 3>","fromLine":0,"toLine":0}` — expect `lines[0].role === "user"`.
5. **Close** — send `close` command, expect `ok:true`.
6. **Sidecar exists** — `test -f /tmp/aim-smoke.jsonl.aimidx` — expect exit 0.
7. **Second open is fast** — re-run step 3 — the response's `"indexed":true` confirms reuse of sidecar.
8. **2 GB synthetic fixture** — `rust-tools/aim-jsonl-reader/tests/fixtures/generate-big.sh` produces `/tmp/aim-big.jsonl` (~2 GB) — `open` + `read_range(lineCount-10, lineCount-1)` completes in <500 ms on an Apple Silicon dev box.
9. **Search** — send `{"cmd":"search","sessionId":"...","query":"hi","kind":"substring","caseInsensitive":true,"limit":10}` against the tiny fixture — expect 1 match.
10. **RSS ceiling** — during step 8, a background `ps -o rss -p <pid>` snapshot shows peak <100 MB. Fail visibly if exceeded.

### 4.5 Claude Code JSONL schema (reference for the implementer)

Each line in `~/.claude/projects/*/*.jsonl` is one of these record types (key = `"type"` when present, otherwise the `role`):

| Type/Role | Tokens to add to... | Notes |
|---|---|---|
| `"type":"system-prompt"` | `systemPrompt` | Full prompt blob; count via `usage.input_tokens` when present, else char-length / 4 fallback. |
| `"role":"user"` | `messages.user` | Text + images. Ignore tokens (user messages are cheap). |
| `"role":"assistant"` | `messages.assistant` | `usage.output_tokens` added to `messages`; `usage.cache_read_input_tokens` goes to a separate `cacheRead` stat. |
| `"type":"tool_use"` | `systemTools` for built-ins (Read/Write/Grep/Bash/Glob/Edit/NotebookEdit/WebFetch/WebSearch/Agent) vs `mcpTools` when name begins with `mcp__` | Count arg JSON chars. |
| `"type":"tool_result"` | `messages` | The tool's result is part of the assistant-visible message history. |
| `"type":"agent-definition"` or `<agent>.md` read | `customAgents` | The expanded definition's tokens. |
| `"type":"memory"` or `"source":"claude-md"` | `memory` | CLAUDE.md load events. |

**Model context limit** is model-dependent; hard-code a lookup table keyed on `modelId` in the JSONL: `claude-opus-4-*` → 1_000_000, `claude-sonnet-4-*` → 200_000, `claude-haiku-4-*` → 200_000, unknown → 200_000 default. `freeSpace = modelContextLimit - total`.

For records missing `usage`, fall back to `text_len / 4` as a rough token estimate and mark the field `"approximate":true` in the response so the UI can render a `~` marker.

### 4.6 Invariants (hard rules the implementer MUST preserve)

- **Never `.collect()` lines into a `Vec<String>`.** Use `BufReader::read_line` + offset tracking. A violation is a review-blocker.
- **Never lock the file for writing.** This binary is read-only. Opening a file that's being appended to by Claude Code must succeed; the reader simply sees lines up to the mtime snapshot taken at open time and re-indexes on next open if mtime drifted.
- **Never shell out.** No `std::process::Command` in the reader. Pure std + `serde_json` + `memmap2` + `regex` + `anyhow`. If the implementer feels they need another crate, add it to Cargo.toml with justification in the commit message.
- **Errors return JSON, never panic.** Any internal `Result::Err` becomes `{"ok":false,"error":"<code>","detail":"<msg>"}` on stdout. `panic::set_hook` installs a JSON-writing panic handler as a safety net.
- **The `.aimidx` sidecar format is versioned.** Header is `AIMIDX01\n<mtime-ns>\n<file-size>\n`. Bumping the version requires a new reader version too.

---

## 5. Phase 2 — Node wrapper + API routes (self-contained spec)

### 5.1 Feature description

Wrap the Rust binary with a long-lived Node child-process manager at `lib/jsonl-reader.ts` and expose 4 HTTP routes under `/api/sessions-browser/*` that proxy commands to it. One reader process per dashboard, lazily spawned on first request. Session handles live in-memory and idle-GC after 30 min of inactivity.

### 5.2 File scope

```
lib/jsonl-reader.ts                                        (NEW)
lib/jsonl-reader-protocol.ts                               (NEW - types shared with UI)
services/sessions-browser-service.ts                       (NEW - resolves agent → project dir → .jsonl files)
app/api/sessions-browser/agents/[id]/sessions/route.ts     (NEW)
app/api/sessions-browser/sessions/[sid]/range/route.ts     (NEW)
app/api/sessions-browser/sessions/[sid]/search/route.ts    (NEW)
app/api/sessions-browser/sessions/[sid]/context-breakdown/route.ts  (NEW)
types/sessions-browser.ts                                  (NEW)
tests/unit/jsonl-reader.test.ts                            (NEW)
tests/unit/sessions-browser-service.test.ts                (NEW)
services/headless-router.ts                                (APPEND routes only; no refactor)
```

**Explicitly OUT of scope for Phase 2:** every file under `components/`, `hooks/`, `app/` except the 4 new route files. No UI. No shared-state changes to existing services. Phase 2 is pure API + wrapper.

### 5.3 Acceptance criteria

1. **Reader process manager is a singleton + self-healing.** `getJsonlReader()` returns the same `JsonlReader` instance across requests. If the child process dies, the next call respawns it transparently. Verified by a unit test that calls `reader.open()`, `kill -9`'s the child, then calls `reader.open()` again and asserts success.
2. **Idle session GC works.** Sessions opened but not touched for 30 min are closed via `{"cmd":"close"}`. Asserted by a fake-timer test that advances 31 min and then checks `reader.openSessions.size === 0`.
3. **All 4 routes return shape-validated JSON.** Each route has a Zod schema for its response, and the route uses `schema.parse()` before returning. Unit tests verify the schema matches the Rust binary's actual output (using captured fixtures in `tests/unit/fixtures/`).
4. **Agent → sessions resolution is correct.** `GET /api/sessions-browser/agents/:id/sessions` reads the agent's `workingDirectory` from the registry, slugs it to match Claude's `~/.claude/projects/<slug>/` convention (replace `/` with `-`, strip leading `-`), lists `.jsonl` files in that dir, and returns them sorted by mtime DESC with `{path, size, messageCount (lazy — null until opened), lastModified, displayName}`. `messageCount` is populated lazily on first `open` and cached.
5. **Auth integration.** All 4 routes require user auth (the existing `aim_session` cookie). If absent → 401. If present → proceed. Agent-level RBAC (user can only browse sessions of agents they own) is deferred to Phase 4 — Phase 2 just checks "is authenticated".

### 5.4 Smoke test

1. **Preconditions** — `scripts/aim-jsonl-reader` exists and is executable (Phase 1 output); dashboard running with at least one agent that has ≥1 session on disk.
2. **GET sessions list** — `curl -H "Cookie: aim_session=<token>" http://localhost:23000/api/sessions-browser/agents/<aid>/sessions` → 200 with a JSON array of ≥1 entry.
3. **Open + range read via route** — pick the largest session, issue `POST /api/sessions-browser/sessions/<sid>/range` body `{"fromLine":0,"toLine":10}` → 200 with an 11-element `lines` array.
4. **Search** — `POST /api/sessions-browser/sessions/<sid>/search` body `{"query":"tool_use","kind":"substring","limit":50}` → 200 with up to 50 matches.
5. **Context breakdown** — `GET /api/sessions-browser/sessions/<sid>/context-breakdown` → 200 with all 7 bucket fields + `total` + `modelContextLimit`.
6. **401 for unauthenticated** — same GET without cookie → 401.
7. **Child process recovery** — `pkill -9 aim-jsonl-reader`, then re-issue step 2 — still 200, transparent respawn.
8. **Idle GC** — open a session, wait (fake-time or real 31 min), check via a debug endpoint `GET /api/sessions-browser/_debug/open-sessions` → 0.
9. **Range read on 2 GB fixture** (if one exists in the agent's dir) — server memory growth over 10 sequential reads stays flat within 50 MB band.
10. **Error handling** — request a non-existent session id → 404 with `{error:"session_not_found"}`.

---

## 6. Phase 3 — React UI: Sessions tab in Agent Profile (self-contained spec)

### 6.1 Feature description

Add a new "Sessions" tab to the Agent Profile panel (next to Overview / Config / Skills / …). Clicking it reveals a three-pane layout: a session list (left, ≤200 px), a virtualized chat transcript (center), and a context-breakdown panel (right, ≤280 px). Search bar spans the top of the center pane. All data comes from Phase 2 routes; no new API calls outside those 4.

### 6.2 File scope

```
components/agent-profile/SessionsTab.tsx                   (NEW)
components/agent-profile/sessions/SessionList.tsx          (NEW)
components/agent-profile/sessions/ChatTranscript.tsx       (NEW)
components/agent-profile/sessions/MessageBubble.tsx        (NEW)
components/agent-profile/sessions/ToolUseRow.tsx           (NEW)
components/agent-profile/sessions/ContextBreakdownPanel.tsx (NEW)
components/agent-profile/sessions/SessionSearchBar.tsx     (NEW)
components/agent-profile/sessions/useJsonlSession.ts       (NEW - data hook)
components/AgentProfilePanel.tsx                           (EDIT - add "Sessions" tab entry)
styles/sessions-browser.css                                (NEW - optional, for .aim-msg-tokens etc.)
types/sessions-browser.ts                                  (EDIT - add UI-side types)
tests/unit/useJsonlSession.test.ts                         (NEW)
```

**Explicitly OUT of scope for Phase 3:** any change to `lib/`, `services/`, `app/api/`, the Rust crate, or any existing component other than `AgentProfilePanel.tsx`.

### 6.3 Acceptance criteria

1. **Sessions tab is reachable.** Clicking "Sessions" in the Agent Profile tab bar swaps the right-side content to the new tab. The tab label shows the count of sessions as a badge (`Sessions (12)`). Verified by a click-through manual test.
2. **Virtualized transcript renders 10 000 messages without jank.** Use `@tanstack/react-virtual` (already a project dep) to render only visible rows. Scrolling to the bottom of a 10 000-message session completes in <2 s with no visible blank frames. Verified by a manual test on a real 500 MB session from one of the user's active agents.
3. **Per-message token badge shown for assistant messages.** Each assistant bubble has `in: 1234 · out: 567 · cache: 89` in a small-caps monospace badge at the top-right. Aggregated in a sticky header at the top of the transcript: total `in / out / cache / total` for the whole session.
4. **Context-breakdown panel matches `/context` visually.** 7 horizontal bars (systemPrompt, systemTools, mcpTools, customAgents, memory, messages, freeSpace) with absolute token counts, percentages of total, and % of model context limit. Colors: one distinct color per bucket, free space gray. Updates live as the user scrolls (same breakdown for the whole session — this is a per-session view, not per-turn).
5. **Search is incremental.** Typing in the search bar debounces 250 ms, then fires `/search`; matches appear as highlighted spans in the transcript, with `Prev` / `Next` buttons that scroll to each match. Match count shown: `3 / 47`. If the user changes the query, the old matches are cleared first.

### 6.4 Smoke test

1. **Navigate to an existing agent's Profile → Sessions tab** — tab is visible, session count badge is non-zero.
2. **Click the newest session** — center pane loads with ≥1 message visible within 1 s.
3. **Token badge visible on assistant messages** — at least one `in: ... · out: ...` label is present.
4. **Context panel populated** — all 7 bar rows are rendered with non-zero percentages (except possibly `customAgents` if none were used).
5. **Scroll to end** — virtualization works, `Last message` visible, no memory blow-up in DevTools profiler.
6. **Search "tool_use"** — matches highlight, `Next` button scrolls to the next, match count is correct.
7. **Switch to another session** — transcript clears, loads the new one, context panel re-fetches.
8. **Responsive check (tablet viewport)** — the right-side context panel collapses into a toggleable drawer when width <1024 px (matches existing mobile-feature-parity rule).
9. **Empty-state** — an agent with zero `.jsonl` files shows an empty state: "No sessions yet. This agent hasn't started a Claude conversation."
10. **Back-forward navigation** — opening a session, clicking back in sidebar to another agent, then forward again restores the same session selection (session id stored in URL query param, e.g. `?tab=sessions&sid=<uuid>`).

---

## 7. Phase 4 — Tests, docs, scenario (self-contained spec)

### 7.1 Feature description

Lock the feature in with integration tests, a new UI scenario (SCEN-027), and user-facing docs. No production code changes outside tiny fixups that fall out of test writing.

### 7.2 File scope

```
rust-tools/aim-jsonl-reader/tests/integration.rs           (EDIT - add big-fixture RSS test if not already there)
tests/scenarios/SCEN-027_jsonl-session-browser.scen.md     (NEW)
tests/scenarios/scripts/setup-SCEN-027.sh                  (NEW)
tests/scenarios/scripts/cleanup-SCEN-027.sh                (NEW)
tests/scenarios/NEXT_SCEN_NUMBER                           (EDIT - bump 27 → 28)
tests/scenarios/fixtures/git/                              (NEW - optional, if a known-good jsonl fixture is useful)
docs/SESSIONS-BROWSER.md                                   (NEW - user-facing guide)
README.md                                                  (EDIT - add one line under "Features" linking to SESSIONS-BROWSER.md)
```

**Explicitly OUT of scope for Phase 4:** any production code change outside tiny test-scaffold fixes (which must be itemized in the commit body).

### 7.3 Acceptance criteria

1. **`cargo test -p aim-jsonl-reader` is green.** All 6 integration tests pass on macOS arm64 + Linux x86_64.
2. **`yarn test --run tests/unit/jsonl-reader.test.ts tests/unit/sessions-browser-service.test.ts tests/unit/useJsonlSession.test.ts` is green.** No new flakes; no pre-existing test affected.
3. **SCEN-027 scenario runs end-to-end.** The scenario covers: open a session, scroll, search, switch sessions, verify token counts match a known-good fixture, close cleanup.
4. **Docs cover: where sessions live on disk, how to open the tab, token semantics, search syntax, known limitations.** `docs/SESSIONS-BROWSER.md` is ≥800 words and ≤2500 words. Linked from README.
5. **No behavior regressions.** Re-run SCEN-001..023 after the merge — same pass rate as before this feature branch merged.

### 7.4 Smoke test

1. **`cargo test` green** on the dev box.
2. **`yarn test --run` on the three new unit files** — all pass.
3. **`yarn build` green.**
4. **`pm2 restart ai-maestro`** — server comes up; `/api/sessions-browser/_debug/open-sessions` returns `0`.
5. **Manual click-through of SCEN-027 steps 1–5** — each step passes.
6. **`SCENARIOS_TESTS_RULES.md` compliance check** on SCEN-027 — Rule 0 ✓, Rule 3 rewipe-list ✓, Rule 7 safe-setup delegation ✓, Rule 8 dev-browser canonical ✓.
7. **`tests/scenarios/NEXT_SCEN_NUMBER` contains `28`.**
8. **README link to `docs/SESSIONS-BROWSER.md` exists and resolves.**
9. **`docs/SESSIONS-BROWSER.md` mentions the non-goals listed in §2 of this TRDD** so users don't file bugs for "why can't I export?".
10. **Full-batch regression** — `/run-scenarios-batch 1-23 --improve` run shows same verdicts as pre-feature baseline.

---

## 8. Orchestration protocol (how this gets built in parallel with the 25-scenario run)

### 8.1 Two branches, two workstreams

- **`feature/team-governance`** (parent) — the 25-scenario long batch runs here per Rule 13. Bug fixes land in-place (Rule 4 FIX-AS-YOU-GO). No worktree, no PR.
- **`feature/jsonl-session-browser`** (sibling) — parallel-worker-agent does Phase 1, Phase 2, Phase 3, Phase 4 here, one phase at a time, in its own worktree. After each phase merges to this branch, parallel-tester-agent smoke-tests the merge.

Because the File scopes in §4.2, §5.2, §6.2, §7.2 do NOT overlap with any file the 25-scenario batch modifies (scenarios only touch files named in `rewipe-list` + bug-fixes in scenario-specified areas), the two branches can develop in full parallel without merge conflicts 99% of the time. If a conflict does surface at the moment we merge sibling into parent, the conflict is trivial — a single-file rebase by the orchestrator.

### 8.2 Spawn template (for post-compaction orchestrator)

For each phase, the orchestrator spawns `parallel-worker-agent` with exactly this prompt structure (derived from the `Inputs` section of `.claude/agents/parallel-worker-agent.md`):

```
# Feature description
<copy §N.1 from this TRDD>

# File scope
<copy §N.2 file list>

# Acceptance criteria
<copy §N.3 bullets>

# Smoke test
<copy §N.4 steps>
```

After the worker returns `[DONE]` + branch name + head SHA, the orchestrator:
1. Fetches the branch into the parent repo.
2. Merges (ff-only) into `feature/jsonl-session-browser`.
3. Pushes `feature/jsonl-session-browser` to fork.
4. Spawns `parallel-tester-agent` with the Phase N smoke test.
5. If tester returns `[PASS]`, proceed to Phase N+1.
6. If tester returns `[FAIL]`, spawn `parallel-worker-agent` again with the failure report + instruction to fix on the same branch.

### 8.3 Turn-management between the two workstreams

The orchestrator interleaves work:

- After each **scenario** completes in the 25-batch, the orchestrator (a) commits the scenario's outputs per Rule 13, (b) checks if any parallel-worker-agent output is waiting to be merged. If yes → merge + smoke-test before spawning the next scenario.
- If the parallel workstream has nothing in flight, the orchestrator spawns the next phase's worker as a background task and continues straight to the next scenario.
- If a smoke-test FAILS, the orchestrator prioritizes spawning the fix worker BEFORE continuing the scenario batch — because a broken sibling branch is a blocker for the final PR.

This interleaving keeps the dashboard / dev-browser / Chromium state stable (only one live scenario at a time) while letting the sibling feature develop in its own isolated worktrees.

### 8.4 Quality guardrails

- **No time pressure** on either agent. Per the Anthropic research cited in both agent persona files, a calm pace produces fewer bugs than a rushed pace. The orchestrator NEVER inserts "finish by X" language.
- **One phase = one worker spawn = one commit series**. Do not pipeline phases. Phase N+1 waits for Phase N's `[PASS]`.
- **DEFER is better than `[DONE]` with flaws**. Both agent prompts make this explicit.
- **If Phase N's acceptance criteria cannot be met inside the declared File scope, the worker DEFERs**. The orchestrator then updates the TRDD's File scope (explicitly, with a commit on feature/team-governance) and re-spawns. No worker is ever asked to silently exceed its scope.

---

## 9. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Rust cross-compile fails on CI | M | H (blocks install) | Phase 1 acceptance #1 makes arm64+x86_64 macOS build a hard gate; CI runs both targets. |
| 2 GB fixture generator takes too long | L | L | Generator is optional; RSS ceiling test uses a 500 MB real session if no 2 GB fixture handy. |
| `.aimidx` sidecar in `~/.claude/projects/` litters the user's dirs | L | L | Sidecars are gitignored via a global rule the installer documents in SESSIONS-BROWSER.md. Cleanup script: `find ~/.claude/projects -name '*.aimidx' -delete`. |
| Virtualized list breaks when a single message is >1 MB of text | M | M | `MessageBubble` renders oversize content inside a collapsed "Show 1.2 MB of text" toggle — only expanded on demand. |
| Context breakdown drifts from `/context` values | M | L | Phase 1 §4.5 table references Claude Code's own schema; Phase 4 includes a fixture test that compares reader output against a hand-counted truth table. |
| Feature branch rots while the 25-scenario batch runs for 12 h | L | M | Rebase sibling onto parent before spawning Phase N+1; §8.1 ensures non-overlapping scopes keep rebase trivial. |
| User opens a session while its agent is actively writing it | M | L | Reader opens read-only, mmap captures a snapshot at open time; re-open at user request shows any new lines. Warn in the UI if mtime changed since open: "Session updated — click to reload". |

---

## 10. Deliverable summary (for each phase)

| Phase | What lands on `feature/jsonl-session-browser` | Verified by |
|---|---|---|
| 1 | Rust crate + build script + `scripts/aim-jsonl-reader` binary | `cargo test` + parallel-tester smoke §4.4 |
| 2 | Node wrapper + 4 API routes + types | `yarn test` + parallel-tester smoke §5.4 |
| 3 | Sessions tab UI + 7 React components + 1 hook | parallel-tester smoke §6.4 |
| 4 | 1 new scenario + docs + README link + RSS integration test | parallel-tester smoke §7.4 + re-run of SCEN-001..023 |

When all 4 phases are PASS, the orchestrator opens a draft PR from `feature/jsonl-session-browser` → `feature/team-governance`. The user reviews and merges.

---

## 11. Provenance

- User request (2026-04-20): "I want you to write all phases specs and let the agents (worker and tester) spawned by you implement this feature... Look at the source code of this app: https://github.com/matt1398/claude-devtools."
- User request (2026-04-20): "jsonl files can be up to 2Gb in size, you have to implement an streaming reader in rust that efficiently index and render the jsonl on demand, at the exact time interval or message indexes, and to search for exact keywords."
- Context: a 67% main-context checkpoint before auto-compaction; this TRDD is the durable spec the post-compaction orchestrator reads to start Phase 1.
- Related TRDDs: none — this is a net-new feature. The Subconscious Self-Change Tracker (TRDD-7123d51a) touches the same files (`~/.claude/projects/*/*.jsonl`) read-only but the two subsystems do not share code or state.
