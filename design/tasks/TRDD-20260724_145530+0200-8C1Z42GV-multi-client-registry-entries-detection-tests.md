---
trdd-id: 8C1Z42GV
title: Multi-client registry entries and detection tests
column: dev
scope: project
created: 2026-07-24T14:55:30+0200
updated: 2026-07-24T21:10:33+0200
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
derived-kind: eht
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-24

Goal: add per-client event signatures for at least Codex + one of Kimi/OpenCode, with a detection
unit test per client.

**UNBLOCKED 2026-07-24** — the registry landed (TRDD-X8801GT4, `a3a22376`).

NEXT ACTION: this is now PURE DATA — append a `ContinuityClientEntry` per client to
`CONTINUITY_REGISTRY` in `lib/continuity-registry.ts`; the engine needs no change (its tests
already prove that by driving it entirely with fake tables). Two things to get right: (1) capture
a REAL frame from each client before writing a matcher — a signature guessed from documentation
is exactly how one client's pattern fires on another's healthy screen; (2) `program` must match
what the agent registry actually stores for that client (normalisation handles path/case, not a
different name). Aligns with task #57.

## Spec

- Per-client event signatures for at least Codex + one of Kimi/OpenCode (their wedge/menu/idle
  surfaces); a detection unit test per client. Aligns with task #57 (multi-client runtime-env
  enforcer).

## Acceptance

- [ ] Per-client detection unit tests pass for Claude + ≥1 non-Claude client

## Approval log

- 2026-07-24T14:55:30+0200 — MANDATE issued by USER (min-approval-requirement: none). Pre-approved; born approved to author+execute.
