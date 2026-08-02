---
trdd-id: D8OYFG35
title: Statusline ingest — take the 5h/7d windows from Claude Code's own feed at zero API cost
column: human_review
created: 2026-08-01T19:14:59+0200
updated: 2026-08-02T06:21:18+0200
current-owner: ai-maestro-dev
assignee: ai-maestro-dev
created-by: ai-maestro-dev
task-type: feature
project-id: ai-maestro
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro-dev
approval-datetime: 2026-08-01T19:14:59+0200
severity: high
effort: medium
release-via: none
npt: []
eht: []
blocked-by: []
implementation-commits: [675f5a9f]
---

# Statusline ingest — take the 5h/7d windows from Claude Code's own feed at zero API cost

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-08-02

**STEPS 1-6 ARE BUILT, TESTED AND COMMITTED. STEP 7 IS THE USER'S AND IS THE ONLY THING LEFT.**

Nothing is live yet: the pipeline exists end to end and NOTHING CALLS IT until the USER adds one
line to `~/.claude/settings.json` (below). That file was deliberately not touched.

**NEXT ACTION — the USER pastes this, replacing the `statusLine.command` value.** The current value
is `agentlenspro statusline --inner '<python> ~/.claude/statusline.py'`; the wrapper takes the whole
existing command as its arguments, so nothing about the bar changes:

```json
"statusLine": {
  "type": "command",
  "command": "~/.local/bin/aimaestro-statusline-capture.sh agentlenspro statusline --inner '/Users/<you>/Code/llm-externalizer/llm-externalizer-plugin/.venv/bin/python3 /Users/<you>/.claude/statusline.py'",
  "refreshInterval": 3
}
```

`~/.local/bin/aimaestro-statusline-capture.sh` appears after the next `./install-messaging.sh`
(the `scripts/*.sh` glob picks both new scripts up; no installer edit was needed). Until then the
in-repo path `scripts/aimaestro-statusline-capture.sh` works identically.

**Also needs a `yarn build` + restart before the routes answer** — `app/` is bundled into `.next`,
so the running server still 404s `/api/statusline/*` until it is rebuilt.

**DEVIATION FROM THE PLAN, deliberate:** the wrapper lives at
`scripts/aimaestro-statusline-capture.sh` → `~/.local/bin/`, NOT at `~/.claude/statusline-capture.sh`
as step 1 said. It is repo-canonical, git-tracked, installed by the existing glob, and it keeps the
whole feature inside one repo — and `~/.claude/` is the USER's directory, which this work was not
to write into.

**SUPERSEDED — do NOT carry forward:** nothing. The plan held; only the wrapper's path moved.

---

## ⏵ Original STATE — 2026-08-01

USER directive: *"lets use the internal statusline api then. its 300ms, but its already cached and
all. You only need to create an hook script that capture all values. It must be in addition of the
existing statusline, but it must not output anything in the context. instead it must send the data
to ai-maestro server so it will serve the data via api/scripts to all agents."*

**NEXT ACTION:** build the wrapper (§Proposed fix step 1) — it is the piece nothing else depends
on. **Do NOT edit `~/.claude/settings.json` without asking**; that flip is the last step and it is
the USER's file.

**⚠ THE ONE FACT THAT CHANGES THE PLAN:** the statusline payload carries `five_hour` and
`seven_day` **and NOT the model-scoped windows**. Fable 5's separate weekly limit — the thing the
USER called "very useful" — is NOT in this feed. So this does not replace TRDD-WFIMES6U's cache;
it demotes it to a slow path.

## Problem

Verified against the shipped doc (`downloads_dev/statusline.md`, lines 192-193 and the schema at
267-276): Claude Code pipes its statusline command a JSON payload that **already contains the
rate-limit windows**.

```json
"rate_limits": {
  "five_hour": { "used_percentage": 23.5, "resets_at": 1738425600 },
  "seven_day": { "used_percentage": 41.2, "resets_at": 1738857600 }
}
```

**This costs ZERO API calls.** Claude Code has already paid for the number; the statusline is
handed it locally ("The status line runs locally and does not consume API tokens", line 165). It
refreshes on every assistant message, on `/compact`, on permission/vim changes, and on the
`refreshInterval` timer, debounced at **300 ms** (line 151).

So the entire rate-limit problem of TRDD-WFIMES6U evaporates for the two main windows. We are
currently making up to 420 calls/hour to `/api/oauth/usage` for numbers that arrive free on stdin.

**What the feed does NOT carry** (`grep -ic "weekly_scoped|limits\[\]|model-scoped|seven_day_opus"`
→ **0**): the model-scoped weekly windows, `severity`, `is_active`, `extra_usage`, `spend`. Those
remain endpoint-only.

Beyond the windows, the same payload carries per-session facts ai-maestro has no other cheap source
for: `session_id`, `model.id`, `agent.name`, `context_window.*` (used %, size, current usage),
`cost.*`, `effort.level`, `fast_mode`, `version`, `transcript_path`, `workspace.*`, `pr.*`.

## Root cause

Nothing consumes the statusline payload. The number arrives on stdin every few seconds, free, and
is thrown away.

**AgentlensPro is explicitly out of scope (USER, 2026-08-01: *"agentlens also has hooks that
monitor everything, ignore them"*).** An earlier draft of this card proposed feeding
`lib/agentlens-status.ts`'s shape; that is dropped. This pipeline defines its OWN payload type and
does not read, write, or depend on any agentlens contract — coupling our fleet-wide telemetry to a
third-party plugin's interface would make its hooks a dependency of ours.

## Proposed fix

1. **A pass-through wrapper, not a replacement.** Claude Code supports exactly ONE `statusLine`
   command, so "in addition" means wrapping:
   `~/.claude/statusline-capture.sh` reads stdin ONCE, hands the identical bytes to the existing
   `statusline.py`, and **passes its stdout and exit code through unchanged**. The user's status
   bar must look and behave exactly as it does today.
   - **Nothing extra on stdout, ever.** Stray output corrupts the status bar. (It never reaches
     the model context either way — statusline stdout renders in the bar, not the transcript.)
   - **The capture MUST be detached and non-blocking.** The doc is explicit: *"If a new update
     triggers while your script is still running, Claude Code cancels the in-flight script"*
     (line 151). A synchronous POST would stall or cancel the bar. Fire-and-forget, stdout/stderr
     to `/dev/null`, never `wait`.
   - **Fail-soft absolutely.** ai-maestro down, unreachable, or slow ⇒ the status bar still
     renders. The capture may never be able to break the user's terminal.
2. **Ingest through the script layer, not a raw curl.** Per the decoupling invariant, the writer
   is `scripts/aimaestro-statusline.sh` (canonical home = this repo, installed to `~/.local/bin/`
   by `install-messaging.sh`'s glob), which owns the only knowledge of the endpoint.
3. **`POST /api/statusline/ingest`** — accepts one payload, keyed by `session_id`. Localhost-only
   per the peer rule (`lib/peer-address.mjs` / `isConsolePeer`); this is a local observation, not
   a remote command.
4. **Store it where the fleet already looks.** Follow the `chat-state` precedent (hook → file →
   server → WS): `~/.aimaestro/statusline-state/<session_id>.json`, written through
   `lib/json-io.ts` (the gate — never a fourth writer).
5. **Serve it back**: `GET /api/statusline/:sessionId` + a fleet-wide roll-up, and an
   `aimaestro-statusline.sh get` verb so agents read it without touching the API.
6. **Define our OWN payload type** (`types/statusline.ts`), carrying a `source` field so a
   consumer can tell a statusline-fed window from an endpoint-fed one. No agentlens dependency.

**⚠ `resets_at` IS UNIX EPOCH SECONDS HERE** (`1738425600`), while `/api/oauth/usage` returns
**ISO 8601** (`2026-08-05T16:00:00.517432+00:00`). Two formats for one concept, and
`statusline.py:410` records that Claude Code itself *changed* this field from ISO to epoch in
v2.1.138. Normalize at the boundary to epoch ms, once, or the shared cache will silently hold two
incompatible time formats.

**Consequence for TRDD-WFIMES6U:** it is not superseded, it is demoted. The fast-moving 5h/7d
numbers come free from this feed; the endpoint is needed only for the model-scoped windows,
`severity`, and `is_active` — so its TTL can go LONG (600 s+) with no loss of resolution. The
candidate-429-is-not-exhaustion fix in that card remains necessary regardless.

## Verification

- Wrapper: given a recorded payload on stdin, its stdout is **byte-identical** to running
  `statusline.py` with the same stdin, and its exit code matches. **Neuter:** make the capture
  write one byte to stdout ⇒ that test must redden.
- Wrapper does not block: with the ingest target pointed at a black hole that never answers, the
  wrapper still returns in well under the 300 ms debounce. Assert elapsed time.
- Wrapper fails soft: with ai-maestro stopped, stdout is still correct and the exit code is still
  0.
- Ingest: a POSTed payload appears at `GET /api/statusline/:sessionId` with `resets_at` normalized
  to epoch **ms**; a payload carrying ISO instead of epoch normalizes to the same instant (pins
  the v2.1.138 format change both ways).
- Route is localhost-only: a non-console peer is refused.
- Whole suite green, `tsc` 0 lines.

## Estimated risk

MEDIUM, concentrated in one place: the wrapper sits in the USER's live status bar, so a bug there
is visible on every keystroke. Mitigated by pass-through-and-exit semantics, a detached capture,
and the byte-identical test. The settings.json flip is the only irreversible-feeling step and is
gated on the USER.

## Acceptance

- [x] wrapper passes the inner command's stdout/exit code through byte-identically
      — `statusline-capture-wrapper.test.ts`, Buffer equality against an un-wrapped run, over three
      inputs (trailing newline / none / multibyte + ANSI). Exit codes 0, 3 and 127 all relayed.
- [x] capture is detached; wrapper returns well inside 300 ms even when the target hangs
      — measured 47 ms mean over 10 runs against an ingest that blocks 5 s (floor: ~41 ms of pure
      `bash` startup). Neuter: drop the `&` → the test reads 5429 ms and reddens.
- [x] wrapper is fail-soft with the server down — CLI absent / erroring / hanging / chattering, and
      an unwritable temp dir: the bar renders in every case and the exit code stays the inner's.
- [x] `scripts/aimaestro-statusline.sh` is the only thing that knows the endpoint
      — the wrapper names no URL; it forks the CLI. Pinned by `statusline-cli.test.ts` against a
      real ephemeral-port server, including the true end-to-end wrapper → CLI → HTTP.
- [x] `POST /api/statusline/ingest` + `GET /api/statusline/:sessionId`, localhost-only
      — plus `GET /api/statusline` (fleet roll-up). Ingest is `isConsolePeer`-gated; a forged
      `x-forwarded-for` does not move it. The READS are authenticated but NOT console-gated, so
      remote work from a phone still sees the fleet.
- [x] state written through `lib/json-io.ts`, under `~/.aimaestro/statusline-state/`
      — `updateJson` + `{createIfMissing:true}`, mutating in place. All 7 top-level keys written
      every time, so the key-loss tripwire can never fire on a session that sheds a field.
- [x] `resets_at` normalized to epoch ms at the boundary, both input formats pinned by test
      — epoch seconds AND ISO 8601 asserted to land on the SAME instant, at the normaliser and
      again through the route.
- [x] our own payload type (`types/statusline.ts`), with `source` on each WINDOW as well as the
      record; ZERO agentlens coupling — nothing imports or names any agentlens symbol.
- [ ] `~/.claude/settings.json` flipped **only after the USER agrees** — NOT DONE, by design. The
      exact line is in the STATE block above. This is the only step left.

## Approval log

- 2026-08-01T19:14:59+0200 — MANDATE (self) at `min-approval-requirement: none`: in-scope feature
  in ai-maestro, filed directly from a USER directive. The one step that touches a file outside
  this repo (`~/.claude/settings.json`) is explicitly gated on the USER above.
