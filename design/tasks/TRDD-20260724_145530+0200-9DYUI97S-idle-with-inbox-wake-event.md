---
trdd-id: 9DYUI97S
title: Idle-with-inbox wake event
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
relevant-rules: [ai-maestro-51]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-24

Goal: implement the idle-with-inbox wake event — an online+idle agent with a pending AMP inbox
gets a turn-trigger curated key injected.

**UNBLOCKED 2026-07-24** — both blockers are `complete`: the frame reader (TRDD-6HEF0XLS) and the
registry + continuity actuator (TRDD-X8801GT4, `a3a22376`).

NEXT ACTION: the hook half is already available — `ContinuityObservation.notification` carries
`notificationType === 'idle_prompt'`. The INBOX half is not: E2 kept the observation minimal
(program, frame, bufferType, notification) rather than speculatively adding fields, so this TRDD
adds `inboxPending?: number` to `ContinuityObservation` and populates it at the poll site. The
response is `{kind:'command', commandKey}` naming a curated turn-trigger key — the registry's
`continuityCommandKeys()` test then pins it to the allowlist automatically.

## Spec

- Detect online+idle (`readHookNotification` `idle_prompt`) + a pending AMP inbox → inject a
  turn-trigger curated key so the agent drains its inbox.
- Ties to ai-maestro#51 / 4ALV5ISB worker side.
- Gated on the same cooldown/STOP/HID.

## Acceptance

- [ ] An idle agent with a queued AMP message takes a turn and processes it

## Approval log

- 2026-07-24T14:55:30+0200 — MANDATE issued by USER (min-approval-requirement: none). Pre-approved; born approved to author+execute.
