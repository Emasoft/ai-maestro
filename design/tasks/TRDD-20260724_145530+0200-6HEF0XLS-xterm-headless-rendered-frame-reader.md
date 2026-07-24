---
trdd-id: 6HEF0XLS
title: xterm-headless per-agent rendered-frame reader
column: complete
scope: project
created: 2026-07-24T14:55:30+0200
updated: 2026-07-24T17:12:00+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-24T14:55:30+0200
parent-trdd: 5CIL7A07
derived: true
derived-kind: npt
implementation-commits: [7a48cab9]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-24

**COMPLETE 2026-07-24 (commit `7a48cab9`).** `lib/agent-frame-reader.ts` — feeds each server-owned
agent's PTY into a headless `@xterm/headless@6.0.0` Terminal (added as a dep, lockstep with the
installed `@xterm/xterm@6.0.0`) and exposes `readRenderedFrame(agentId)` (active-buffer cells,
`translateToString(true)`, trailing blank rows dropped), `feedFrame` (async, resolves on parse),
`activeBufferType`, `attachPty` (duck-typed `onData`→feed, no node-pty import), `resize`, `dispose`,
`reset`. FAIL-OPEN: unreadable grid → '' ("not detected"), never a false wedge. Reads only.

8 tests: a captured retry-wedge frame renders to text containing `attempt 12/300` (regex
`/attempt\s+\d+\s*\/\s*\d+/i` matches); raw cursor-move/redraw escape-noise does NOT match (proving
it RENDERS, not byte-greps); fail-open on unknown agent; dispose; attachPty wiring. tsc 0, lint clean.

**NEXT (Flock E):** this reader is the foundation E2 (per-client event registry) + E3 (retry-wedge
event, the #90 contract) + E4 (AskUserQuestion event) build on. Those are the `blocked` E-children,
now unblocked on the detection side (E1 done; D1 trustworthy for ESC-before-rotation).

## Spec

- Add `@xterm/headless`; a server module feeding each server-owned agent's PTY into a headless
  `Terminal`, exposing `readRenderedFrame(agentId)` that reads the **alternate-screen** buffer
  (`buffer.active`, `.type==='alternate'`, join `getLine(viewportY+y).translateToString(true)`);
  event-driven via `onWriteParsed`/`onRender`.
- Do NOT byte-grep the raw PTY (redraw noise); do NOT use the browser Terminal (closed for an
  unattended agent).
- Fail-open (unreadable grid → not detected).

## Acceptance

- [x] A unit test feeds a captured retry-wedge frame → the reader returns text incl.
      `attempt N/300` — `agent-frame-reader.test.ts` (renders `attempt 12/300`, buffer='alternate')
- [x] A raw-escape-noise stream does not match — cursor-move/redraw noise renders to a clean screen
      with no `attempt N/300` (proves it RENDERS the grid, not byte-greps the stream)

## Approval log

- 2026-07-24T14:55:30+0200 — MANDATE issued by USER (min-approval-requirement: none). Pre-approved; born approved to author+execute.
- 2026-07-24T17:12:00+0200 — COMPLETED by ai-maestro (self-mandate). Frame reader + @xterm/headless dep landed (7a48cab9); both acceptance boxes met by 8 tests. dev → complete.
