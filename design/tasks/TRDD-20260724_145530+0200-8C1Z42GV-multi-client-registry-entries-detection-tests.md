---
trdd-id: 8C1Z42GV
title: Multi-client registry entries and detection tests
column: blocked
pre-block-column: dev
scope: project
created: 2026-07-24T14:55:30+0200
updated: 2026-07-24T15:07:44+0200
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
derived-kind: eht
blocked-by: [TRDD-X8801GT4]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-24

Goal: add per-client event signatures for at least Codex + one of Kimi/OpenCode, with a detection
unit test per client. Blocked on TRDD-X8801GT4 (the registry) landing first. NEXT ACTION: wait for
X8801GT4, then add the per-client signatures and tests. Not started.

## Spec

- Per-client event signatures for at least Codex + one of Kimi/OpenCode (their wedge/menu/idle
  surfaces); a detection unit test per client. Aligns with task #57 (multi-client runtime-env
  enforcer).

## Acceptance

- [ ] Per-client detection unit tests pass for Claude + ≥1 non-Claude client

## Approval log

- 2026-07-24T14:55:30+0200 — MANDATE issued by USER (min-approval-requirement: none). Pre-approved; born approved to author+execute.
