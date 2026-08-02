---
trdd-id: 7HRDAD0U
title: Fleet inbox-nudge — wake an idle agent that never fires idle_prompt so it drains its AMP inbox
column: testing
created: 2026-07-23T07:31:44+0200
updated: 2026-08-02T16:17:36+0200
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

**✅ CONFIRMED LIVE (SCEN-031 re-run, 08:30:54) — THE WORKER-WAKE BLOCKER IS FIXED.** With the fixes live, the
MANAGER self-organized the fleet (created `zipsearcher-dev` AUTONOMOUS + `zipsearcher-maintainer` MAINTAINER, made
`Emasoft/zipsearcher`, delegated via AMP) AND both workers WOKE and worked — vs the prior run where both sat at 0
tokens, deaf. Evidence: `zipsearcher-maintainer` reached 📊 270k tokens (actively building); the server logged
`[FleetInboxNudge] nudged zipsearcher-{dev,maintainer}: 1 unread → injected inbox-check` at 08:30:54. BOTH fixes
proved to cover complementary timing cases: **DEFECT 1** (YPIRL5RA addNewline→Enter) makes the `.cjs` SessionStart
3s inbox-check actually SUBMIT (woke the maintainer to 270k before any nudge — the at-creation case); **this
inbox-nudge** catches the LATER case (a follow-up message to an already-idle worker → nudged awake at 08:30:54).
The prior "workers deaf at 0 tokens" failure is RESOLVED. (Separate: `zipsearcher-dev` woke then hit an
AskUserQuestion selector — the known P1 TRDD-1B7FC42W, unrelated to worker-wake; the runner's to handle.) Full
SCEN-031 PASS/FAIL verdict still pending the runner's completion.

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

## Acceptance

Transcribed 2026-08-02 from this card's own `## VERIFY` line, re-run live. **Read the STATE in
order:** the `✅ CONFIRMED LIVE` block is LATER than the `NEXT = live proof` paragraph below it and
supersedes it — the proof was obtained. A reader who stops at "NEXT" concludes the opposite.

- [x] unit: **nudge-idle-with-mail** — injects the inbox-check turn AND sets the cooldown
- [x] unit: **skip-0-unread** — no inject
- [x] unit: **skip-cooldown** — an agent nudged inside the window is not re-nudged
- [x] unit: **skip-actuation-blocked** — machine-wide STOP (janitor kill-switch / pause)
      short-circuits and injects nothing
- [x] unit: **skip-permission-prompt** — an agent blocked on the USER is never nudged
- [x] unit: **skip-not-idle-no-cooldown** — a 409 (pane busy) does NOT set the cooldown, so it
      retries next tick. This is the load-bearing one: it pins that a busy pane is a SKIP, not a
      consumed attempt, which is what makes "never inject mid-turn" survivable
- [x] unit: **countUnread-error-continues** — one agent's failure never ends the pass
- [x] the nudge TEXT is pinned too (single line, singular vs plural, names the agent-messaging
      skill) — 8 tests total, re-run green 2026-08-02
- [x] `tsc` / test / build green (`2f5af2e9`)
- [x] wired into `runFleetLivenessTick` in its OWN try, so a nudge failure never discards the
      liveness snapshot (`lib/fleet-liveness-watchdog.ts:204`), default-ON via
      `AIM_FLEET_INBOX_NUDGE !== '0'` (`:102`)
- [x] **default-ON is live** — verified on the running process: `AIM_FLEET_INBOX_NUDGE` is not set,
      which is exactly the ON case. Checked because a default that only holds in source is not a
      default (cf. [[78J4I4QS]]'s 20-day-stale env var)
- [x] **SCEN-031 re-run shows the workers waking on their mandate** — the card's own live proof,
      obtained 2026-07-23 08:30:54: the server logged
      `[FleetInboxNudge] nudged zipsearcher-{dev,maintainer}: 1 unread → injected inbox-check`, and
      `zipsearcher-maintainer` reached 270k tokens actively building, against a prior run where both
      workers sat at **0 tokens, deaf**. The two fixes proved COMPLEMENTARY, not redundant:
      [[YPIRL5RA]] (DEFECT 1) makes the SessionStart check actually submit — the at-creation case;
      this nudge catches the LATER case, a follow-up message to an already-idle worker
- [ ] the SCEN-031 PASS/FAIL verdict itself — *"still pending the runner's completion"*. The
      worker-wake blocker this card exists for is RESOLVED and evidenced above; what is outstanding
      is the scenario's overall verdict, which is the runner's to give, not this card's

## Approval log
- 2026-07-23 — MANDATE: USER chose "In-repo: server watchdog" for the worker-wake fix (AskUserQuestion). Tier-0
  in-repo feature build under the standing harness-ready goal; min-approval-requirement: none.
