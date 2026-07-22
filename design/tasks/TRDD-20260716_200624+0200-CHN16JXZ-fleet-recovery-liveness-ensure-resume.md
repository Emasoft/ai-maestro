---
trdd-id: CHN16JXZ
title: Fleet recovery — server-internal liveness detection + ensure-resume actuation across the fleet
column: dev
pre-block-column: null
created: 2026-07-16T20:06:24+0200
updated: 2026-07-22T14:56:09+0200
current-owner: ai-maestro
task-type: feature
scope: project
min-approval-requirement: none
mandate: true
mandated-by: ai-maestro
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-07-16T20:06:24+0200
relevant-rules: [16, 23, 42]
labels: [family-a, continuity, fleet-recovery, liveness, ensure-resume, npt]
external-refs: [Emasoft/ai-maestro-janitor#100, Emasoft/ai-maestro#60, Emasoft/ai-maestro#51]
parent-trdd: KCRMSNL7
derived: true
derived-kind: npt
npt: []
eht: []
blocked-by: []
implementation-commits: [c930a1cc, a7c04017, 70688c00, 3b68005c, 17206049, 0a90648b, a717fc3b]
release-via: none
---

# Fleet recovery — server-internal liveness detection + ensure-resume actuation across the fleet

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-22

**▶ 2026-07-22 — `blocked` → `dev`. Phase A (DETECTION) landed; unblocked, correctly.**

Verified against the janitor's own v0.60.1 daemon + ai-maestro#79: this is the ONE Family-A
chore that *structurally* transfers to the server (a frozen session's own cron is what has
stopped, so only an external watcher can recover it), and it is the janitor's #1 open ask —
*"the only real coverage gap, silent, from the first second the server runs."* The
capabilities-vs-binary handshake break (janitor ignores our `capabilities:[]` and yields on mere
liveness, TRDD-LU0C5KAR) makes this urgent. Coordination posted:
ai-maestro#79#issuecomment-5045588088 (per-chore YES/NO — janitor keeps its stopgap until each
server half lands).

**Unblocked:** [[DXJZM3BW]]'s `ensure-resume`/`status` verbs are DONE (in testing), so that
dep is satisfied. [[1GGQ4HWY]] is NOT a hard blocker for the core: a token-blocked agent is
*classified* `token_blocked` with `recoveryRecommended:false` and simply flagged — never
actuated — until the OAuth cascade is R16-live. So the token-cascade hand-off is a deferred,
gated SUB-feature, not a block on fleet recovery. `blocked-by: []`.

**Phase plan (safest-first, like 1GGQ4HWY):**
- **A ✅ DONE (`c930a1cc`, `a7c04017`)** — DETECTION, read-only, zero actuation:
  - `lib/janitor-control.ts` — read-only reader of the janitor fleet-control plane
    (`~/.claude/janitor-control/`, shared `$JANITOR_CONTROL_DIR`); `fleetActuationBlocked()`
    gate (kill-switch/pause/maintenance). NEVER writes. 9 tests.
  - `lib/fleet-liveness.ts` — pure `classifyLiveness` (active/idle_waiting/permission_waiting/
    stalled/token_blocked/offline) + `scanFleetLiveness` (injectable deps). Conservative:
    `stalled` = idle-at-prompt with no activity ≥30 min (never ordinary idle); STOP-gate empties
    `recoveryTargets`. 15 tests. + `readHookNotification` companion on `lib/session-safe-state.ts`.
- **B (1/2) ✅ DONE (`3b68005c`)** — the PURE recovery-ladder decision logic:
  `lib/fleet-recovery.ts` — `RECOVERY_LADDER` (janitor-parity 7 rungs) + `recoveryRungFor(diagnosis,
  attempt, hardEnabled)` (entry-rung by diagnosis, 1-rung/attempt escalation clamped to last, HARD
  rungs gated → null when disabled). 8 tests. No actuation yet.
- **B (2/2) ✅ DONE (`17206049`)** — the gated ACTUATION DECISION layer: `lib/fleet-recovery-actuator.ts`.
  Stateless 7-gate fail-safe dispatch for ONE stalled agent — `not_a_target → fire_flag_off →
  actuation_blocked → hard_gated|hard_not_wired → hid_present → cooldown → FIRE`. `inject` (the #60
  side-effect), `hidPresent`, `actuationBlocked`, clock ALL INJECTED (real wiring = D-full); per-agent
  attempt/cooldown PASSED IN (stateless). Hard rungs REFUSED (Phase C owns process-kill). Only
  `stalled`→`frozen`; reload rungs are a genuine plain→forced escalation. **default-OFF fire flag** is
  the master gate (checked before any I/O). 12 tests; tsc clean.
- **C 🔲 HARD rungs** `relaunch → force_restart → resurrect` behind a **default-OFF** flag +
  per-instance cooldown + crash-loop-page-once (mirrors janitor `FLEET_HARD_RESTART_ENABLED`).
- **D-lite ✅ DONE (`70688c00`)** — READ-ONLY WATCHDOG wiring: `lib/fleet-liveness-watchdog.ts`
  (`defaultFleetScanDeps` wires registry + `getAgentSessionStatus` + `readHookNotification`;
  `runFleetLivenessTick` scans + LOGS stalled/token-blocked, never throws; `startFleetLivenessWatchdog`
  setInterval/unref/env-interval/0-disables). Started at boot in `server.mjs` after server-liveness.
  Detection RUNS now (the guardian's eyes) — no actuation. 6 tests.
- **D-full ✅ DONE (`0a90648b` keys, `a717fc3b` wiring)** — the watchdog now FIRES the gentle actuator on
  `recoveryTargets`, behind the default-OFF `AIM_FLEET_RECOVERY_FIRE`. `lib/fleet-recovery-runner.ts`:
  threads per-agent state across ticks (prune-on-recover, advance-on-fire), wires the REAL deps —
  `inject`=`enqueueCommand` on the server-owned queue (the authenticated #60 path: persists, drains at
  the next safe idle prompt, never a raw keystroke; 409-dedup is a 2nd flood-guard), `hidPresent`=user-
  presence (defer while the user types), `hardEnabled`=false. 9 runner + 4 watchdog tests. Full suite
  3224/0, tsc + next lint clean. Still `listAgents()`==server registry today; add the `server_owned`
  filter when cross-host/#N sessions enter scope so we never touch the janitor's.
- **Deferred:** token-blocked healing hand-off to [[1GGQ4HWY]]'s cascade, live only after R16.

**Recovery-ladder parity spec** (mirror the janitor's `RECOVERY_LADDER`, from the audit report
`reports/janitor-daemon-audit/20260722_140531+0200-family-a-coverage.md` §2.4):
`esc_nudge → rearm → reload → update → relaunch → force_restart → resurrect`; entry map
`cron_dead→rearm / version_mismatch→reload / dead→relaunch / frozen→full-ladder`; HARD rungs
gated + cooldown + crash-loop-page-once + HID-presence defer; never touch `server_owned`(theirs
is us now)/`unarmed`.

**GENTLE RECOVERY (A + B + D) IS COMPLETE and dark-shipped** (default-OFF `AIM_FLEET_RECOVERY_FIRE`):
detection runs live at boot; the gentle ladder (`esc_nudge → rearm → reload → update`) actuates via the
authenticated queue when armed. Phase C is the only remaining rung set and is OPTIONAL for the core
coverage gap — gentle recovery handles a frozen agent; hard is only for a truly-dead process.

**NEXT ACTION:** Phase C — the HARD rungs (`relaunch → force_restart → resurrect`), behind their OWN
default-off flag (mirror the janitor's `FLEET_HARD_RESTART_ENABLED`). These are NOT slash-injections: they
kill + relaunch the stuck pid. `actuateRecovery` already REFUSES them (returns `hard_not_wired` when
`hardEnabled`, `hard_gated` when not), so Phase C adds a SEPARATE hard-actuator the runner calls when the
gentle ladder is exhausted AND the hard flag is on — with per-instance cooldown + crash-loop-page-once +
the same HID-presence + `fleetActuationBlocked()` gates. Reuse the stop/restart substrate
(`app/api/sessions/[id]/restart`, `kill`). Read `lib/fleet-recovery.ts` (`HARD_RUNGS`) +
`lib/fleet-recovery-runner.ts` first.

## Problem / Goal

An agent can go idle mid-task (rate-limit turn-death, a stalled tool, a dropped notification) and
never resume on its own. The server must DETECT that and actuate a resume — for the WHOLE fleet,
because cross-agent liveness is inherently the server's responsibility (an agent cannot and must
not drive another, R42). This is the actuation half of `ensure-resume`.

## Scope (server-internal — reuses existing actuation, adds no cross-agent script)

- **Liveness detection:** a server-internal scan over the registered fleet using the existing
  5-state safe-state model (`lib/session-safe-state.ts`) + hook activity stream to classify each
  agent (active / idle-waiting / stalled / token-blocked).
- **Actuation:** for a stalled agent at a safe idle prompt, resume it by reusing
  `aimaestro-session.sh slash|queue` (the server owns the queue; a hibernated agent is enqueued,
  not blocked on). NO new cross-agent verb — [[DXJZM3BW]]'s `ensure-resume <self>` is the ONLY
  new surface, and it is self-scoped; the fleet-wide actuation is server-internal.
- **Token-blocked agents** are handed to [[1GGQ4HWY]]'s cascade first (resume is pointless until
  the credential heals), then resumed.

## Open issues this NPT must honor

- **ai-maestro#60** — authenticated daemon→agent command injection for freeze-recovery (signed):
  the actuation path must be the authenticated injection, not an unauth keystroke.
- **ai-maestro#51** — active idle-agent wake mechanism: this NPT is where that wake lands.

## Reuse (do not reinvent)

- Actuation substrate = the existing stop/restart safe-state poll + `session.sh queue/slash`.
- Liveness = the existing hook activity stream + `lib/session-safe-state.ts`; do NOT add a
  second polling channel (WebSocket-only per the project's no-polling rule where it applies).

## Verification

- A deliberately-stalled test agent at a safe idle prompt is detected and resumed via the
  authenticated path (#60); a token-blocked agent is healed by [[1GGQ4HWY]] first, then resumed.
- No cross-agent script surface added (only [[DXJZM3BW]]'s self-scoped `ensure-resume`).
- `tsc` clean; liveness/actuation unit tests green.

## Approval log

- 2026-07-16T20:06:24+0200 — Tier-0 self-mandate (derived NPT of [[KCRMSNL7]], server-internal
  in-scope dev; reuses existing actuation). Authored directly as `planned`.
