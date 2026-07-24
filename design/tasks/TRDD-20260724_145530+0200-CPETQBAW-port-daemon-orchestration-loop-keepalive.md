---
trdd-id: CPETQBAW
title: Port the daemon orchestration loop and keepalive
column: dev
scope: project
created: 2026-07-24T14:55:30+0200
updated: 2026-07-24T14:55:30+0200
current-owner: ai-maestro
created-by: ai-maestro
task-type: refactor
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

Goal: port `daemon.py`/`daemon_keepalive_entry.py` scheduling + the keepalive/liveness/throttle/
watchdog/path modules into a server continuity module driven at boot. NEXT ACTION: port the
janitor daemon's scheduling loop into a `lib/` continuity module following the pattern of
`startOauthRotatorTick`/`startServerLiveness`. Not started.

## Spec

- Port `daemon.py`/`daemon_keepalive_entry.py` scheduling + `lib/{keepalive_boot,
  keepalive_stage,session_liveness,daemon_throttle,daemon_watchdog,daemon_path}.py` into a server
  continuity module driven at boot (pattern of `startOauthRotatorTick`/`startServerLiveness`), so
  the server's tick performs the interval-gated chores with the daemon's throttle/backoff/
  bulk-lane semantics.
- `server-liveness.json` keeps writing every 30 s unconditionally from boot.

## Acceptance

- [ ] The continuity loop schedules every absorbed chore with the daemon's interval/backoff
- [ ] A restart shows the loop up and the janitor daemon staying exited

## Approval log

- 2026-07-24T14:55:30+0200 — MANDATE issued by USER (min-approval-requirement: none). Pre-approved; born approved to author+execute.
