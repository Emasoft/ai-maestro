---
trdd-id: MQ82BYSX
title: Enable the gentle fleet-recovery actuator so SCEN-031 can run unsupervised (the PARTIAL to PASS continuity prereq)
column: complete
created: 2026-07-23T09:02:48+0200
updated: 2026-08-01T22:50:24+0200
current-owner: session
task-type: infra
scope: project
project-id: ai-maestro
min-approval-requirement: none
mandate: true
mandated-by: user
relevant-rules: []
eht: []
npt: []
implementation-commits: []
external-refs:
  - design/tasks/TRDD-20260716_200624+0200-CHN16JXZ-fleet-recovery-liveness-ensure-resume.md
  - design/tasks/TRDD-20260723_073144+0200-7HRDAD0U-fleet-inbox-nudge-wake-idle-agents-on-amp-mail.md
  - tests/scenarios/SCEN-031_end-to-end-fleet-ship.scen.md
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-23

**WHY (the real PARTIAL→PASS blocker for SCEN-031, deeper than "runner budget").** SCEN-031's PASS
condition (its own frontmatter) is that the fleet ships zipsearcher v1.0.0 **fully autonomously,
unsupervised, kept alive by the continuity substrate** — "*If any agent stops and stays stopped (not
auto-recovered by the continuity substrate), the test FAILED.*" But the substrate's **resurrection
leg was OFF**: the server FleetLiveness watchdog logged `recovery targets: 0 [detect-only:
AIM_FLEET_RECOVERY_FIRE not set]` every 5 min. It DETECTS stalled agents but never nudges them. A
fleet agent that finishes a turn with **no unread AMP mail** and **no armed heartbeat** sits idle
forever — so the fleet self-organizes, builds a while, then silently stalls. FleetInboxNudge
(7HRDAD0U) only covers the *unread-mail* case; continuous self-driving over hours needs the
recovery actuator's `esc_nudge` on stalled agents. That is the mechanism that was dark-shipped off.

**WHAT the gentle actuator is (from CHN16JXZ, verified).** Phases A+B+D are COMPLETE, tested (9
runner + 4 watchdog tests, full suite green, tsc clean), and **fail-safe**: for a `frozen` agent
(online, idle-at-prompt, no activity ≥30 min) it fires the gentle ladder `esc_nudge → rearm →
reload → update`, one rung per attempt, via the **authenticated server command queue** (persists,
drains at the next safe idle prompt, never a raw keystroke; 409-dedup flood guard), **HID-deferred**
(won't fire while the user types), **cooldown'd**, and **STOP-gated** (`fleetActuationBlocked()` —
janitor kill-switch/pause/maintenance). Hard rungs (`relaunch/force_restart/resurrect`) are Phase C
and **hardwired OFF** — `lib/fleet-recovery-runner.ts:45 hardEnabled: false` — so **no process
kills** even with the flag on. It only ever gently nudges a live, stalled agent to continue.

**RISK — low, reversible, ~zero immediate blast radius.** At enable time the fleet is 9 dead/
hibernated agents → `recovery targets: 0` (dead ≠ stalled; gentle ladder never targets dead, hard
gated). Going forward it only gently nudges genuinely-stalled ONLINE agents. Worst realistic
mis-fire = a redundant benign "continue" nudge or a plugin reload — no data loss. Reversible: unset
`AIM_FLEET_RECOVERY_FIRE`. It is the janitor's **#1 open coverage-gap ask** ("*the only real
coverage gap, silent, from the first second the server runs*", CHN16JXZ / ai-maestro#79); the
server owning it is the agreed direction (a frozen session's own cron can't recover itself).

**CHANGE.** `ecosystem.config.js` — add `AIM_FLEET_RECOVERY_FIRE: '1'` to the pm2 `env` (production)
block so it PERSISTS across SCEN-031's mid-run `pm2 restart ai-maestro` (a shell export would not).
Keep `hardEnabled=false` (Phase C untouched). This does NOT activate the token-blocked healing
hand-off (deferred to 1GGQ4HWY, R16-gated) — a token-blocked agent stays classified + flagged, never
actuated.

**NEXT ACTION:** edit `ecosystem.config.js`, `pm2 restart ecosystem.config.js` (re-reads env),
confirm the watchdog log line drops `[detect-only: AIM_FLEET_RECOVERY_FIRE not set]` and shows
`recovery targets: N` when a stalled agent exists. Then the substrate is armed for a fresh SCEN-031
full-ship run (the multi-hour observation is the remaining work — a separate step).

**SUPERSEDED — do NOT carry forward:** the pre-compaction claim that the AUTONOMOUS *persona* waits
for confirmation — that was the now-fixed dashboard AskUserQuestion delivery bug (ai-maestro
`8c34d65a`); filed as an honest design-question on Emasoft/ai-maestro-autonomous-agent#16, not a
defect. It is NOT the SCEN-031 blocker; THIS (recovery actuator off) is.

## Problem
SCEN-031 returns PARTIAL because its full multi-hour autonomous ship cannot be sustained: the
server continuity substrate detects but does not recover stalled fleet agents (recovery actuator
dark-shipped off), so the fleet stalls once agents run out of mail-driven nudges.

## Proposed fix
Flip the completed, tested, fail-safe gentle-recovery actuator ON persistently via the pm2
ecosystem env, arming the server watchdog as the fleet's heartbeat. Hard (process-killing) rungs
stay gated off.

## Verification
- `pm2 logs ai-maestro` FleetLiveness line no longer prints `[detect-only: AIM_FLEET_RECOVERY_FIRE
  not set]`; a stalled online agent yields `recovery targets: N` and a `recovery FIRED … esc_nudge`.
- Flag survives a plain `pm2 restart ai-maestro` (SCEN-031 restarts the server mid-run).
- Full unit suite stays green (no code change — env only).

## Estimated risk
LOW. Env-only flip of a dark-shipped, tested feature; hard rungs off; STOP-gated; HID-deferred;
cooldown'd; reversible by unsetting the flag. Immediate blast radius 0 (no stalled online agents).

## Acceptance
- [x] `AIM_FLEET_RECOVERY_FIRE: '1'` present in `ecosystem.config.js`'s pm2 env block, re-verified live.
- [x] The live running `ai-maestro` pm2 process's actual environment carries `AIM_FLEET_RECOVERY_FIRE=1` — checked directly via `pm2 jlist`, the exact verification method this card itself demands.
- [x] The live `pm2 logs` FleetLiveness line no longer prints `[detect-only: AIM_FLEET_RECOVERY_FIRE not set]` — checked directly against the last 5 log entries.

## Approval log
- 2026-07-23 — MANDATE: standing USER goal "make the harness ready = SCEN-031 PASSES" requires the
  continuity substrate to keep the fleet alive unsupervised; enabling the completed gentle-recovery
  actuator is the direct prerequisite. Tier-0 in-repo infra activation; min-approval-requirement: none.
- 2026-08-01T22:50:24+0200 — CLOSED retroactively. This card's own NEXT ACTION was the
  flag flip + confirming the watchdog log — both re-verified live this session: the
  config file carries the flag, the RUNNING process env carries it, and the current
  FleetLiveness log lines show `recovery targets: 0` (correct — 3 dead agents, gated;
  no stalled online agents right now) with no `[detect-only: … not set]` marker.
