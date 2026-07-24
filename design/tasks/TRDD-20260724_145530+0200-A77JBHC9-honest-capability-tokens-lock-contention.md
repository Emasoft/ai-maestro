---
trdd-id: A77JBHC9
title: Honest capability tokens and control-plane lock contention
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
parent-trdd: KCRMSNL7
derived: true
derived-kind: npt
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-24

Goal: make `currentCapabilities` advertise a token only when its chore is actually live, and
extend `janitor-control.ts` to `flock(2)`-contend on the shared locks. NEXT ACTION: edit
`lib/server-liveness.ts::currentCapabilities` + `lib/janitor-control.ts`; isolate
`$JANITOR_CONTROL_DIR` in test setup FIRST. Not started.

## Spec

- `lib/server-liveness.ts::currentCapabilities` advertises `family-a`/`fleet-recovery`/
  `singleton-chores` **only when that chore is actually live** (a token without a live chore
  silences the janitor on work nobody does).
- `lib/janitor-control.ts` extends to `flock(2)`-contend on the shared locks once the janitor
  moves them to the control dir.
- Isolate `$JANITOR_CONTROL_DIR` in test setup BEFORE the first flag test (the janitor leaked a
  live `kill-switch.flag` this way).

## Acceptance

- [ ] A token appears iff its chore runs
- [ ] A test proves the flag-path isolation
- [ ] Never write a control flag automatically (esp. never enable fleet maintenance from a status
      line)

## Approval log

- 2026-07-24T14:55:30+0200 — MANDATE issued by USER (min-approval-requirement: none). Pre-approved; born approved to author+execute.
