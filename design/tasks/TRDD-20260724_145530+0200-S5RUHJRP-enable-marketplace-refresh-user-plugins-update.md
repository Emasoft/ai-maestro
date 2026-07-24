---
trdd-id: S5RUHJRP
title: Enable marketplace-refresh and user-plugins-update under the shared locks
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

Goal: enable `marketplace-refresh` + `user-plugins-update` under the shared locks — the
auto-update-service exists but is `enabled:false` by default. NEXT ACTION: wire the server to run
both on schedule, contending on the shared marketplace-op.lock. Not started.

**GROUNDING 2026-07-24 (from D5/A77JBHC9):** the `flock(2)` contention on `marketplace-op.lock` is
THIS TRDD's responsibility (D5 confirmed `janitor-control.ts` is read-only by construction and cannot
host a lock contender). It is currently **BLOCKED on the janitor**: the control dir
`~/.claude/janitor-control/` today holds ONLY `oauth-rotator-tick.lock` — the janitor has NOT yet
moved `marketplace-op.lock` there. Coordinate via D7 (2X4AYX9T) before building the contention; until
the lock exists, contend on it defensively (create-if-absent under the same path the janitor will use)
OR gate the chore on the lock's presence. Do NOT invent a divergent lock path.

**STATUS 2026-07-24:** the D7 ASK is POSTED on janitor#100 (comment-5071270871) — requested the exact
`marketplace-op.lock` filename/path. WAITING on the janitor's reply before building, per "verify
before acting" (building against an unconfirmed lock path risks rework). This TRDD also gates **D6
(CPETQBAW)** — its 2 chores (`marketplace-refresh` + `user-plugins-update`) are the last 2 of D6's
"every absorbed chore". NOTE: the auto-update master toggle is default-OFF (a human opt-in, per
D3/YLCTM8EU); this TRDD ships the MECHANISM, arming stays the human's — do NOT auto-enable plugin
updates by default.

## Spec

- The `auto-update-service` exists but `enabled:false` by default; wire the server to run both
  `marketplace-refresh` and `user-plugins-update` on schedule, contending on
  `~/.claude/janitor-control/marketplace-op.lock` + writing `*.last-run.ts` so N processes run
  each at most once/period.

## Acceptance

- [ ] Both `marketplace-refresh` and `user-plugins-update` run on schedule
- [ ] A concurrent-run test proves the shared lock prevents double exec

## Approval log

- 2026-07-24T14:55:30+0200 — MANDATE issued by USER (min-approval-requirement: none). Pre-approved; born approved to author+execute.
