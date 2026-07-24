---
trdd-id: SX593MDG
title: Finish and live-validate CHN16JXZ freeze recovery
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

Goal: finish and live-validate CHN16JXZ's freeze recovery (`session-liveness`/`fleet-stop`) —
DETECTION is live, GENTLE actuation is built dark behind `AIM_FLEET_RECOVERY_FIRE`. NEXT ACTION:
validate live on a restarted server carrying the build, then add the dead-class boot-debounce.
Not started.

## Spec

- DETECTION is live; GENTLE actuation is built dark behind `AIM_FLEET_RECOVERY_FIRE` (ladder
  `esc_nudge→rearm→reload→update`, authenticated `enqueueCommand`, STOP gate + HID + cooldown).
- Validate live on a restarted server carrying the build.
- Add the **dead-class boot-debounce** (do not fire HARD rungs on a live frozen agent, only a
  genuinely `dead` process past a boot window).
- HARD rungs (`relaunch/force_restart/resurrect`) stay behind an owner-gated flag.

## Acceptance

- [ ] Armed on a test agent — a `stalled` agent gets the gentle ladder
- [ ] A `dead` agent is detected only past the boot-debounce
- [ ] A machine-wide STOP or HID-presence suppresses injection

## Approval log

- 2026-07-24T14:55:30+0200 — MANDATE issued by USER (min-approval-requirement: none). Pre-approved; born approved to author+execute.
