---
trdd-id: 6HEF0XLS
title: xterm-headless per-agent rendered-frame reader
column: dev
scope: project
created: 2026-07-24T14:55:30+0200
updated: 2026-07-24T14:55:30+0200
current-owner: ai-maestro
created-by: ai-maestro
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
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-24

Goal: add a server module that feeds each server-owned agent's PTY into a headless
`@xterm/headless` Terminal and exposes `readRenderedFrame(agentId)`. NEXT ACTION: add the
`@xterm/headless` dependency and the reader module. Not started.

## Spec

- Add `@xterm/headless`; a server module feeding each server-owned agent's PTY into a headless
  `Terminal`, exposing `readRenderedFrame(agentId)` that reads the **alternate-screen** buffer
  (`buffer.active`, `.type==='alternate'`, join `getLine(viewportY+y).translateToString(true)`);
  event-driven via `onWriteParsed`/`onRender`.
- Do NOT byte-grep the raw PTY (redraw noise); do NOT use the browser Terminal (closed for an
  unattended agent).
- Fail-open (unreadable grid → not detected).

## Acceptance

- [ ] A unit test feeds a captured retry-wedge frame → the reader returns text incl.
      `attempt N/300`
- [ ] A raw-escape-noise stream does not match

## Approval log

- 2026-07-24T14:55:30+0200 — MANDATE issued by USER (min-approval-requirement: none). Pre-approved; born approved to author+execute.
