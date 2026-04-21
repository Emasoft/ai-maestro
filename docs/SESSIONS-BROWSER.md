# JSONL Session Browser

The Sessions tab in the Agent Profile panel lets you open, scroll, and
search any Claude Code conversation an agent has ever had — directly in the
browser, with per-message token accounting and a live context-window
breakdown. Sessions files routinely grow into the hundreds of megabytes and
occasionally past a gigabyte, so the browser is backed by a streaming Rust
reader (`aim-jsonl-reader`) that keeps memory bounded regardless of file
size.

This document covers where the data lives on disk, how to open the tab,
what each UI element means, how to search, the current known limitations,
and where the feature deliberately stops (the "non-goals" section, per
[TRDD-d46b42e9](../design/tasks/TRDD-d46b42e9-52fa-4f04-9be5-2fb4131fcdd1-jsonl-session-browser.md) §2).

---

## 1. Overview

Every conversation with Claude Code is persisted as line-delimited JSON at
`~/.claude/projects/<slug>/<uuid>.jsonl`. Each line is one record — a user
message, an assistant message, a tool invocation, a tool result, a system
prompt load, a memory update, and so on. For an AI Maestro agent that has
been running for days or weeks, this file is the complete ground truth of
what that agent said, did, and received.

The Sessions tab exposes this ground truth through four composable surfaces:

- **Session list** — every `.jsonl` belonging to the selected agent, sorted
  by last-modified time descending, with size and message count.
- **Chat transcript** — the currently-open session rendered as a scrollable
  chat with role-colored bubbles, collapsible tool-use rows, and per-message
  token badges.
- **Context breakdown panel** — the classic `/context` view as 7 horizontal
  bars: system prompt, system tools, MCP tools, custom agents, memory,
  messages, free space.
- **Search bar** — incremental substring or regex search within the open
  session, with match count and prev/next navigation.

All four share a single streaming backend. The UI never downloads the whole
JSONL to the browser — it asks for line ranges on demand.

---

## 2. Where sessions live on disk

Claude Code stores conversations under:

```
~/.claude/projects/<slugged-project-dir>/<session-uuid>.jsonl
```

The "slugged project dir" is the agent's working directory with `/`
replaced by `-` (the leading dash is preserved). For an agent whose
`workingDirectory` is `/Users/alice/agents/peter-bot`, its sessions land in:

```
~/.claude/projects/-Users-alice-agents-peter-bot/
```

Alongside each `.jsonl`, the Rust reader writes a sparse index sidecar:

```
<session-uuid>.jsonl.aimidx
```

The `.aimidx` file is a small (single-digit MB at most, usually a few
hundred KB) binary index with a header (`AIMIDX01\n<mtime-ns>\n<file-size>\n`)
followed by one byte-offset record per 1000 lines. The reader uses it to
jump to arbitrary line numbers in O(log n) time rather than re-scanning the
whole file. The sidecar is rebuilt automatically if the JSONL's mtime or
size changed since the last index.

You can safely delete every `.aimidx` file — the reader regenerates them on
next open:

```bash
find ~/.claude/projects -name '*.aimidx' -delete
```

---

## 3. Opening the tab

1. Log into the dashboard at `http://localhost:23000`.
2. Click an agent in the sidebar.
3. Click its avatar (or the Profile button) to expose the Agent Profile
   panel.
4. In the Profile tab bar, click **Sessions**.

The tab label carries a badge showing how many sessions the agent has on
disk. If the badge shows zero — or the panel shows `No sessions yet. This
agent hasn't started a Claude conversation.` — the agent has not yet
written any JSONL because it has never been launched through Claude Code
inside its workdir, or its `.jsonl` files have been deleted by the user.

The URL reflects the selected session as a query parameter, e.g.
`?tab=sessions&sid=<uuid>`. Browser back / forward navigates between
previously-opened sessions within the same agent profile.

---

## 4. Reading the transcript

Each message is a bubble. Role colors:

- **User** — cool color, left-aligned.
- **Assistant** — warm color, left-aligned.
- **Tool use** — collapsible block showing the tool name, arguments
  summary, and (on expand) the full JSON payload.
- **Tool result** — follows the parent tool-use block, collapsible.
- **System events** (system-prompt load, memory update, agent definition
  load) — neutral color, rendered compact.

Every assistant bubble carries a token badge in small-caps at the top-right:

```
in: 1234 · out: 567 · cache: 89
```

- `in` = `usage.input_tokens` (what the model received as input on this turn)
- `out` = `usage.output_tokens` (what it generated)
- `cache` = `usage.cache_read_input_tokens` (what it read from the prompt
  cache)

A sticky header at the top of the transcript shows the running totals for
the entire session:

```
in: 42.1K · out: 9.7K · cache: 18.3K · total: 70.1K
```

If a message lacks a `usage` field the reader estimates tokens from the
character length divided by 4, and marks the field with a `~` prefix (e.g.
`~out: 450`) so you know it is approximate. This typically happens for
legacy sessions written before Claude Code added fine-grained usage
reporting.

Messages with extremely large text payloads (>1 MB of a single
assistant response, for example) are rendered inside a collapsed
"Show 1.2 MB of text" toggle, expanded on demand. This keeps the
virtualized list snappy even on pathological sessions.

---

## 5. Context breakdown

The right-hand panel mirrors what Claude Code's `/context` command shows
during a live session, but computed over the *whole* JSONL rather than the
current turn only. Seven categories:

| Category | What counts toward it |
|---|---|
| `systemPrompt` | Every `system-prompt` record's `usage.input_tokens` (fallback to `text_len / 4`). |
| `systemTools` | Built-in tool invocations: `Read`, `Write`, `Grep`, `Bash`, `Glob`, `Edit`, `NotebookEdit`, `WebFetch`, `WebSearch`, `Agent`. |
| `mcpTools` | Any tool whose name starts with `mcp__`. |
| `customAgents` | Loads of `<agent>.md` files (the `.agent.toml` persona and its associated main-agent markdown). |
| `memory` | `CLAUDE.md` loads and explicit memory-update events. |
| `messages` | User messages, assistant messages, and tool-result bodies — the main conversation volume. |
| `freeSpace` | `modelContextLimit − total`. Negative (clipped to zero) if the model's context would have been exceeded. |

The model context limit is looked up from the session's `modelId`:
Opus 4 → 1 000 000, Sonnet 4 → 200 000, Haiku 4 → 200 000, unknown → 200 000
(default). Each bar shows absolute tokens, a percentage of the session
total, and a percentage of the model's context limit.

---

## 6. Search

The search bar at the top of the transcript accepts either a substring or
a regex. It debounces 250 ms after the last keystroke, then fires the
server-side search endpoint against the Rust reader.

- **Substring mode (default)** — case-insensitive literal match.
- **Regex mode** — uses Rust's `regex` crate. Invalid regexes show an error
  below the bar; the transcript is unchanged until the regex compiles.

Results:

- A `M / N` counter shows the position of the current match and the total
  number of matches (capped at 10 000 server-side to prevent pathological
  "match every character" queries from sending megabytes over the wire).
- **Prev** / **Next** buttons scroll the transcript to the previous / next
  match. Matches wrap around.
- Match spans are highlighted inline in the message body, not the whole
  bubble.

Clearing the bar (Backspace to empty, or the X button) drops every match
immediately.

---

## 7. Performance

The chat transcript uses virtualization (`@tanstack/react-virtual`) — only
the visible rows are actually mounted in the DOM. A 10 000-message session
scrolls end-to-end in under two seconds on a mid-range laptop with no
blank frames.

The Node layer never holds the full JSONL. Every request goes to the
long-lived Rust child process over stdio; that process uses `memmap2` to
map the file, reads line ranges directly from the mapping, and never
collects lines into an in-memory `Vec`. RSS stays under 100 MB even when
querying a 2 GB session (enforced by integration test
`rss_stays_bounded_on_2gb_fixture` in `rust-tools/aim-jsonl-reader/tests/integration.rs`,
gated behind `AIM_BIG_FIXTURE_TEST=1`).

Open sessions that have not been touched for 30 minutes are closed
automatically by the Node wrapper's idle GC. The next request re-opens
them transparently — the `.aimidx` sidecar makes the second open
essentially instant (<50 ms on a 2 GB file).

---

## 8. Known limitations and non-goals

The following are **intentionally not supported** in the Sessions tab. Each
is documented here so users don't file bugs asking "why can't I do X?".

- **No cross-session analytics.** You can only look at one session at a
  time. There is no "compare two sessions" view and no aggregate token
  graphs over time.
- **No search across sessions.** Search is scoped to the single session
  currently open. Full-text search across every `.jsonl` an agent has ever
  had is a much larger problem and is not addressed here.
- **No edit / replay.** The browser is read-only. There is no affordance
  to inject a fake user message, rewrite assistant output, or replay the
  conversation from turn *N*.
- **No export to Markdown / PDF.** Copy-paste from the transcript is the
  supported way to extract content. If you need a file-based export, write
  a small script against the JSONL directly.
- **No LLM-powered summarization.** There is no "summarize this session"
  button. Session summarization belongs in the cerebellum subsystem, not
  in the viewer.
- **No live-tailing.** The tab is snapshot-based. If an agent is actively
  writing to its session while you have it open, you need to re-open the
  session (or switch away and back) to see the new lines. The existing
  terminal WebSocket is the "live" channel; the Sessions tab complements
  it, it does not replace it.
- **Claude Code only.** Codex, Gemini, OpenCode, and Kiro each have their
  own transcript formats. Adapters for those clients are a future scope.

If you need any of the above, see the TRDD's §2 "Non-goals" for the
rationale and the decision log.

---

## 9. Troubleshooting

**"I don't see any sessions for my agent."**
The agent has never been launched through Claude Code inside its
workdir, or its JSONL files have been deleted. Launch the agent
(Sidebar → click agent → approve the terminal launch prompt) and exchange
at least one message, then reload the Sessions tab.

**"Sessions tab shows an error 'reader binary missing'."**
The Rust binary was not built. Run `yarn build` — the `build:jsonl-reader`
script invokes `cargo build --release -p aim-jsonl-reader` and copies the
result to `scripts/aim-jsonl-reader`. Verify with
`test -x scripts/aim-jsonl-reader`.

**"Search returns nothing even for a word I can see in the transcript."**
Check the mode toggle — regex mode treats your input as a regex, so
typing `hello (world)` in regex mode matches "hello world" but typing
`(world` (unbalanced paren) is a compile error. Switch to substring mode
if you meant literal.

**"Context-breakdown percentages don't match `/context` exactly."**
The Sessions tab computes over the whole file; `/context` computes over
the current in-memory turn. Expect differences in the `messages` and
`freeSpace` buckets especially.

**".aimidx files are cluttering my `~/.claude/projects/` dir."**
You can delete them at any time with
`find ~/.claude/projects -name '*.aimidx' -delete`; they are rebuilt
automatically on next open.

---

## 10. Feedback and bug reports

File issues at [Emasoft/ai-maestro](https://github.com/Emasoft/ai-maestro/issues)
with the label `sessions-browser`. Please include the session's size
(`ls -lh`) and the approximate number of messages (`wc -l`) so the
maintainer can reproduce at scale. If the bug involves the Rust reader
specifically, enable `AIM_JSONL_READER_LOG=trace` before launching the
server and attach the trace — it captures every NDJSON request and
response between Node and Rust.
