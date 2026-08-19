---
trdd-id: 9FW92242
title: Absorb the fleet-stop chore into the server
column: human_review
created: 2026-08-19T15:01:29+0200
updated: 2026-08-20T01:27:37+0200
current-owner: hub-session-brrjk57p-phase2
created-by: hub-session-brrjk57p-phase2
assignee: hub-session-brrjk57p-phase2
task-type: feature
scope: project
min-approval-requirement: none
mandate: true
mandated-by: self
derived: true
derived-kind: npt
parent-trdd: KCRMSNL7
npt: []
eht: []
blocked-by: []
implementation-commits: [0faddaa1]
project-id: ai-maestro
labels: [family-a, janitor-absorption, npt]
release-via: none
---

# Absorb the fleet-stop chore into the server

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-08-20 01:27

- **Lane LANDED + LIVE, dark-shipped (0faddaa1).** `lib/fleet-stop.ts` + scheduler in
  `server.mjs`; verified by effect after `pm2 restart`: startup line 01:27:01
  `fleet-stop scheduler started (60s, detect-only: AIM_FLEET_STOP not set)`; claim correctly
  absent from `absorbed_chores` (claim follows arming, CONDITIONAL_CHORES shape). Unblocked
  from 99LV0U4I: its population half (gatherJanitorSessions) is exactly this lane's tmux
  population — the "actuation lane" its watchdog names now exists.
- **PAUSE IS GONE:** the body below says "kill-switch/pause flag" — SUPERSEDED. The janitor
  removed pause (owner directive 2026-07-31, global_state.py::fleet_stop_flag_state); this
  port carries disarm-only, pinned (`stopCommandFor('pause') === null`).
- **Channels:** registered agents → command queue (`enqueueCommand` commandKey
  `janitor-disarm` when:'idle'; stamp on ACCEPT, 409 retries unstamped); non-agent janitor
  sessions → soft tmux literal send-keys (no ESC — the frozen ladder was deliberately not
  ported at 99LV0U4I, so no ESC into an undiagnosed session). Dedupe keys: `agent:<id>:<flag>`
  / `pid:<n>:<flag>` in OUR state root (never the janitor's dir), forgotten on flag clear.
- **Neuters (blob-verified):** dedupe → 2 red; flag-clear-forgets → 2 red; detect-only gate →
  1 red; refused-enqueue-stamped → 2 red; pane-less-planned → 1 red (F2); HID gate → 1 red.
  14/14 restored; tsc 0; lint 0; siblings 53/53.
- **Review catch worth keeping:** first draft cast `AgentSummary` for `workingDirectory`
  (which it does not carry) — the registry-root filter would have been INERT and every
  registered agent double-targeted via tmux. Roots now resolve the watchdog's way.
- **NEXT ACTION (USER, optional):** arm with `AIM_FLEET_STOP=1` in ecosystem.config.js +
  `pm2 restart ecosystem.config.js --update-env`. Until armed: detect-only (plans logged when
  the kill-switch is set); the janitor daemon keeps the chore.

Server-side equivalent of janitor task_fleet_stop (60s): when the machine-wide
kill-switch/pause flag is set, deliver the STOP command to every janitor-armed session —
registered agents via the authenticated command queue, non-agent sessions via the
validated tmux channel. Carries the janitor's three gates verbatim: default-OFF flag;
never this process / non-claude pids / sessions whose transcript is ADVANCING; dedupe per
(pid, flag) with stamps forgotten when the flag clears.

The per-chore disposition table, the three cross-cutting axes (stamp+cadence contract,
claim-only-when-live, default-OFF destructive lanes), and the three measured incident
requirements live on the parent [[KCRMSNL7]] (DESIGN RESOLVED 2026-08-19 section) — read
that FIRST; this card does not restate it.

## Acceptance

- [x] lane implemented over both populations with the 3 gates; default-OFF
- [x] dedupe-per-(pid,flag) pinned (re-set flag re-injects; held flag injects once)
- [x] stamp + cadence contract honored; claim token added only when live

## Approval log

- 2026-08-19T15:01:29+0200 — MANDATE issued as Tier-0 self-mandate (derived NPT of [[KCRMSNL7]],
  server-internal, reversible, dark-shipped where destructive). No approval request sent.
