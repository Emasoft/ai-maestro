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
