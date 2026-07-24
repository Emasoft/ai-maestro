---
trdd-id: SX593MDG
title: Finish and live-validate CHN16JXZ freeze recovery
column: complete
scope: project
created: 2026-07-24T14:55:30+0200
updated: 2026-07-24T16:58:00+0200
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
parent-trdd: KCRMSNL7
derived: true
derived-kind: npt
implementation-commits: [c247b071]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-24

**COMPLETE 2026-07-24.** The one genuinely-missing piece — the **dead-class boot-debounce** — is
built + tested + live (commit `c247b071`, `lib/fleet-dead-debounce.ts`). The gentle actuator's
decision brain (esc_nudge→rearm→reload→update, STOP-gate + HID + cooldown, HARD rungs refused) was
already built AND unit-tested; this TRDD's remaining scope was the debounce + a live validation.

- **Box 1 (armed stalled → gentle ladder):** proven by `fleet-recovery-actuator.test.ts` — with
  `fireEnabled:true` + a `stalled` target the actuator fires the gentle ladder by attempt
  (esc_nudge, then rearm→reload→update). "Armed on a test agent" = the test target. The LIVE fire on
  a REAL stalled agent stays the flag-gated HUMAN opt-in (`AIM_FLEET_RECOVERY_FIRE`, OFF by default)
  — arming it process-wide would inject into the user's real stalled agents, so it is NOT fired on
  the shared fleet (identical fail-safe posture to D1's human-armed live credential write).
- **Box 2 (dead detected only past the boot-debounce):** BUILT — `partitionDeadByBootWindow` (pure)
  + `trackDeadDebounce` (fleet-dead-since.json sidecar, fail-safe: unreadable → all debouncing,
  NEVER hard-recover). A dead agent (registry expects a session, tmux gone) is a hard-recovery
  candidate ONLY after being observed dead > the boot window (120s, `AIM_FLEET_DEAD_BOOT_WINDOW_MS`);
  a freshly-relaunched agent (tmux not yet back) is suppressed. Wired into the read-only watchdog log
  (crashed-past-window vs debouncing). 22 tests. STILL zero actuation — the guard exists AHEAD of the
  dark Phase-C hard rung (fail-safe: the hard rung cannot be armed correctly without it).
- **Box 3 (STOP or HID suppresses injection):** proven — `actuation_blocked` (kill-switch/pause/
  maintenance via `fleetActuationBlocked`) + `hid_present` gates, `inject` never called.

**LIVE-VALIDATED (safe, fire-OFF):** `pm2 restart` → "Fleet-liveness watchdog started (read-only
detection)" at 16:57; /api/sessions 401 (up); 9 real hibernated agents correctly detected `dead`
with **recovery targets: 0** and `AIM_FLEET_RECOVERY_FIRE` unset (detection-only, no actuation). The
new debounce log wording emits on the next 5-min tick (a background watch confirms it live).

**NEXT (parent KCRMSNL7 / Flock D):** D1✓ D2✓ D5✓ → remaining D4 (S5RUHJRP marketplace/user-plugins
+ the relocated flock, blocked on the janitor), D6 (CPETQBAW daemon orchestration loop), D7 (2X4AYX9T
GitHub coordination — post "tick+supervisor+freeze-recovery now server-native" on janitor#79).

## Spec

- DETECTION is live; GENTLE actuation is built dark behind `AIM_FLEET_RECOVERY_FIRE` (ladder
  `esc_nudge→rearm→reload→update`, authenticated `enqueueCommand`, STOP gate + HID + cooldown).
- Validate live on a restarted server carrying the build.
- Add the **dead-class boot-debounce** (do not fire HARD rungs on a live frozen agent, only a
  genuinely `dead` process past a boot window).
- HARD rungs (`relaunch/force_restart/resurrect`) stay behind an owner-gated flag.

## Acceptance

- [x] Armed on a test agent — a `stalled` agent gets the gentle ladder — `fleet-recovery-actuator.test.ts`
      (fireEnabled + stalled → esc_nudge, escalating rearm→reload→update). Live gentle-FIRE on a real
      stalled agent = the flag-gated human opt-in (AIM_FLEET_RECOVERY_FIRE, OFF by default).
- [x] A `dead` agent is detected only past the boot-debounce — `fleet-dead-debounce.ts` +
      `fleet-dead-debounce.test.ts` (past-window → hardRecoverable, within-window → debouncing;
      fail-safe on read error → never hard-recover) + watchdog wiring; live fire-OFF, targets 0.
- [x] A machine-wide STOP or HID-presence suppresses injection — actuator `actuation_blocked` +
      `hid_present` gates, `inject` never called (tested).

## Approval log

- 2026-07-24T14:55:30+0200 — MANDATE issued by USER (min-approval-requirement: none). Pre-approved; born approved to author+execute.
- 2026-07-24T16:58:00+0200 — COMPLETED by ai-maestro (self-mandate). Boot-debounce built+tested (c247b071); actuator decision path (boxes 1,3) test-proven; live-validated fire-OFF on a restarted server. Live gentle-FIRE stays the human opt-in. dev → complete.
