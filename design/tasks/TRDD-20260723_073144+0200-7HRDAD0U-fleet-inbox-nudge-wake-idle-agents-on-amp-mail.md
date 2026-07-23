---
trdd-id: 7HRDAD0U
title: Fleet inbox-nudge — wake an idle agent that never fires idle_prompt so it drains its AMP inbox
column: testing
created: 2026-07-23T07:31:44+0200
updated: 2026-07-23T07:37:00+0200
current-owner: session
task-type: feature
scope: project
project-id: ai-maestro
min-approval-requirement: none
mandate: true
mandated-by: user
relevant-rules: []
eht: []
npt: []
implementation-commits: [2f5af2e9]
external-refs:
  - design/proposals/TRDD-20260723_063443+0200-4ALV5ISB-idle-agent-never-wakes-on-amp-mandate.md
  - design/tasks/TRDD-20260723_070143+0200-YPIRL5RA-wake-idle-agent-on-amp-notify-defect1-2.md
  - design/tasks/TRDD-20260716_200624+0200-CHN16JXZ-fleet-recovery-liveness-ensure-resume.md
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-23

**WHY (proven, not speculative):** the ACTUAL SCEN-031 run's hook-debug.log shows both zipsearcher workers received
ONLY `SessionStart`+`SessionEnd` over 25 min — ZERO `idle_prompt`. A freshly-launched, never-PROMPTED Claude agent
sits at its first prompt and never fires `idle_prompt`, so the plugin's inbox-notify chain (idle_prompt|
agent_needs_input|SessionStart-only) never runs after the SessionStart 3s check (which races AHEAD of the mandate).
AMP local delivery is pure-filesystem (writes straight into the recipient's `~/.agent-messaging` inbox; the server
is never called), so an idle recipient is deaf to a mandate that arrives after startup. `YPIRL5RA` (DEFECT 1+2) is
the NECESSARY companion (it makes the notification submit WHEN it fires) but insufficient alone. **USER chose the
server-watchdog approach (2026-07-23) over launch-arm and cross-repo janitor auto-arm.**

**DESIGN — a new inbox-nudge leg riding the shipped CHN16JXZ fleet-liveness watchdog.**
`lib/fleet-inbox-nudge.ts`:
- `runInboxNudgeTick(deps, store, now)` — for each agent: `countUnread`; if >0 AND not blocked-on-user
  (`permission_prompt`/`elicitation_dialog`) AND not in cooldown → `inject` a one-line inbox-check nudge. The inject
  is `sendAgentSessionCommand(agentId, {command, requireIdle:true, addNewline:true}, systemAuth)` — `requireIdle`
  409s if the pane is busy (skip, retry next tick), so it NEVER injects mid-turn; a submitted turn (200) sets the
  cooldown. This does NOT use the command-queue (which drains on `idle_prompt`, the very signal these workers never
  fire) — it is a directly-gated inject, which is the whole point. Machine-wide STOP (`fleetActuationBlocked()` —
  janitor kill-switch/pause) short-circuits: inject nothing.
- `defaultInboxNudgeDeps()` — wires `listAgents(false)` + `listInboxMessages(id,{status:'unread'})` +
  `sendAgentSessionCommand`(system auth `fleet-inbox-nudge`) + `readHookNotification` + `fleetActuationBlocked`.
- Everything injectable → unit-tested with fakes, no live fleet.

**Wiring:** `runFleetLivenessTick` (in `lib/fleet-liveness-watchdog.ts`) calls `runInboxNudgeTick` each tick, in its
OWN try (a nudge failure never discards the liveness snapshot), behind `AIM_FLEET_INBOX_NUDGE !== '0'` (**default
ON** — it is the core AMP-delivery function, low-risk: gated + benign prompt + cooldown; env off-switch for safety).
Rides the watchdog's interval (5 min default), so a mandate is delivered within one tick. Module-level
`inboxNudgeStore` + `resetInboxNudgeStore()` for tests (mirrors `recoveryStore`).

**▶ CODE LANDED (`2f5af2e9`). Gates GREEN:** tsc 0 · vitest 227 files / 3254 passed (8 new) · build clean.
`lib/fleet-inbox-nudge.ts` + tests + wired into `runFleetLivenessTick`, default-ON. **NEXT = live proof:** the
`Emasoft/zipsearcher` residue is CLEARED (USER granted delete_repo 2026-07-23; deleted + verified 404), so re-run
SCEN-031 (server must be RESTARTED first so the new watchdog leg is live — `pm2 restart ai-maestro`) and confirm
the workers consume tokens on their mandate within one watchdog tick (5 min) WITHOUT runner intervention. NOTE:
the watchdog runs at 5-min default interval; a mandate is delivered within one tick.

**VERIFY:** unit tests (nudge-idle-with-mail / skip-0-unread / skip-cooldown / skip-actuation-blocked /
skip-permission-prompt / skip-not-idle-no-cooldown / countUnread-error-continues); tsc/test/build green; SCEN-031
re-run shows workers waking on their mandate.

## Problem
An idle worker that never fires `idle_prompt` never checks its filesystem AMP inbox → the fleet organizes then
stalls at the first delegation handoff. See WHY above (empirically proven from the real run's hook-debug.log).

## Proposed fix
The server-watchdog inbox-nudge above: periodically inject a gated inbox-check turn into any online agent with
unread AMP mail, breaking the "arming needs a turn, the wake IS the turn" deadlock server-side, without depending on
the idle_prompt hook or the janitor cron.

## Verification
Unit tests on the pure tick + a SCEN-031 re-run (repo now cleared).

## Estimated risk
LOW–MED. New fleet-wide behavior that injects turns — mitigated: `requireIdle` gate (never mid-turn),
permission-prompt skip, cooldown, `fleetActuationBlocked` STOP-gate, default-ON but env-disable, and the injected
content is a benign inbox-check prompt. Rides the existing watchdog (no new timer). Overlaps the janitor heartbeat's
wake role but is server-owned and independent of the janitor cron.

## Approval log
- 2026-07-23 — MANDATE: USER chose "In-repo: server watchdog" for the worker-wake fix (AskUserQuestion). Tier-0
  in-repo feature build under the standing harness-ready goal; min-approval-requirement: none.
