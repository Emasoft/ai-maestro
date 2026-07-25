---
trdd-id: 9DYUI97S
title: Idle-with-inbox wake event
column: superseded
superseded-by: [7HRDAD0U]
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

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-25

**SUPERSEDED by TRDD-7HRDAD0U. Do NOT implement this — building it would make the fleet WORSE.**

The spec below was authored as Flock-E's E5 without noticing that the identical mechanism had
already landed two days earlier as `lib/fleet-inbox-nudge.ts` (TRDD-7HRDAD0U, `column: testing`),
wired into the fleet-liveness watchdog as a **default-ON** leg. It matches this spec point for
point: online + idle (`readHookNotification`) + unread AMP → inject a turn-trigger, gated on the
same cooldown / machine-STOP.

Implementing E5 anyway would put a SECOND nudger on the same agents. Both would carry a
"once per window" cooldown and both would fire inside the same window, so the cooldown that reads
as a safety property in each module would be defeated by their combination — a double-nudge no
single file's tests could catch.

**Why it happened, and the guard:** the flock was authored top-down from the plan's event list
rather than from the code, so a mechanism that already existed was re-specified as a new one.
Author a derived TRDD only after grepping for what already implements it.

`ai-maestro#51`'s worker half is likewise done (AUTONOMOUS role-plugin `#17`, committed and
awaiting a USER-gated publish), so the turn-trigger this TRDD was to provide is not the blocker its
author assumed.

## Spec (SUPERSEDED — retained as the record of what was specified)

- Detect online+idle (`readHookNotification` `idle_prompt`) + a pending AMP inbox → inject a
  turn-trigger curated key so the agent drains its inbox.
- Ties to ai-maestro#51 / 4ALV5ISB worker side.
- Gated on the same cooldown/STOP/HID.

## Acceptance

- [ ] An idle agent with a queued AMP message takes a turn and processes it

## Approval log

- 2026-07-24T14:55:30+0200 — MANDATE issued by USER (min-approval-requirement: none). Pre-approved; born approved to author+execute.
- 2026-07-25T22:05:28+0200 — SUPERSEDED by TRDD-7HRDAD0U. The identical mechanism (lib/fleet-inbox-nudge.ts) shipped 2 days earlier and is default-ON in the watchdog; implementing this would have put a SECOND nudger on the same agents, defeating both cooldowns.
