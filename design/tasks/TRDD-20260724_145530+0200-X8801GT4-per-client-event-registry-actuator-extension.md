---
trdd-id: X8801GT4
title: Per-client per-event registry and actuator extension
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
derived-kind: npt
blocked-by: [TRDD-6HEF0XLS]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-24

Goal: build a per-client, per-event registry and extend `fleet-recovery-actuator` with a
`conversation-continuity` diagnosis that classifies via the registry. Blocked on TRDD-6HEF0XLS
(the frame reader) landing first. NEXT ACTION: wait for 6HEF0XLS, then design the registry shape
and extend the actuator. Not started.

## Spec

- A registry keyed on the agent's `program` (claude/codex/kimi/opencode/…); each entry declares
  `events: [{ match(frame|hookState) → bool, response: RegistryResponse }]`.
- Extend `fleet-recovery-actuator` with a `conversation-continuity` diagnosis that classifies via
  the registry and dispatches the response through the existing curated-key injection.
- Adding a client = a registry entry, not engine code. Aligns with task #57.

## Acceptance

- [ ] Unit test — a frame → an event → a response, with fakes
- [ ] Unknown `program` → no-op

## Approval log

- 2026-07-24T14:55:30+0200 — MANDATE issued by USER (min-approval-requirement: none). Pre-approved; born approved to author+execute.
