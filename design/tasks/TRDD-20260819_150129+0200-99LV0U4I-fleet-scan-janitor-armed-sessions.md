---
trdd-id: 99LV0U4I
title: Extend the fleet liveness scan to janitor-armed non-agent sessions
column: human_review
created: 2026-08-19T15:01:29+0200
updated: 2026-08-19T19:36:39+0200
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
implementation-commits: [f060e7cb, 133f3441]
project-id: ai-maestro
labels: [family-a, janitor-absorption, npt]
release-via: none
---

# Extend the fleet liveness scan to janitor-armed non-agent sessions

THE population gap blocking full absorption of session-liveness and fleet-stop: the
janitor's fleet_scan covers EVERY claude session on the machine; the server's
scanFleetLiveness covers the REGISTRY. Extend the server scan with a second population —
janitor-armed sessions discovered from the same janitor-control state + tmux/process
substrate the daemon reads — tagged by origin so actuation policy can differ (registered
agents: authenticated queue; non-agent sessions: the validated tmux channel, or
detect-only initially). Claiming session-liveness additionally requires
AIM_FLEET_RECOVERY_FIRE armed (USER).

The per-chore disposition table, the three cross-cutting axes (stamp+cadence contract,
claim-only-when-live, default-OFF destructive lanes), and the three measured incident
requirements live on the parent [[KCRMSNL7]] (DESIGN RESOLVED 2026-08-19 section) — read
that FIRST; this card does not restate it.

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-08-19T19:36:39+0200

- **SHIPPED + LIVE (detect-only).** `lib/fleet-session-scan.ts` (f060e7cb) ports the janitor's
  discovery half; `scanFleetLiveness` carries `snapshot.sessions` (origin `janitor-session`),
  registry agents carry `origin: 'registry'`, `recoveryTargets` registry-only by construction;
  the watchdog logs stale non-agent sessions as "detect-only, no actuation lane".
- **Measured live 2026-08-19 19:23** (before the tests were written): 21 claude sessions
  unfiltered, **19** after the registry filter — every plugin-dev Claude present (janitor,
  plugin, maintainer, orchestrator, assistant-manager, architect, webdesign, programmer,
  COS, autonomous, assistant-role, integrator, CPV, PSS, llm-externalizer, AgentlensPro,
  visual-comunicator, this hub, ANIME2SVG); testbot + frank correctly dropped (positive
  control: the unfiltered run shows both with their tmux panes %361/%2). 2.0 s.
- **Verified BY EFFECT on the live server** after `pm2 restart` (liveness sha 133f34415b7f ==
  HEAD): first watchdog tick 19:36:09 logged `1 janitor-armed non-agent session(s) stale (>15min
  …; detect-only, no actuation lane): ~/Code/ANIME2SVG pid=74422` — a real 3.1-day-idle owner
  terminal, not a defect.
- **NEUTER RUNS** (scripts/dev/neuter, restore verified by blob hash; fix committed first):
  n1 drop `isRegistryRoot` skip → 1 red (registered-root filter test); n2 `isReplInvocation`
  always true → 2 red (both verb-exclusion tests); n3 watchdog logs all classes → 1 red
  (detect-only log test); n4 scan drops `sessions` key → 2 red (both threading tests).
  Incidental: the helper itself was broken under BSD mktemp (n2-n4 first read "0 red / 0
  green") — fixed 133f3441, GUARD 6.
- **NOT ported (deliberate, detect-only ceiling):** substantive-tail transcript analysis
  (`awaiting_user`, trailing enqueues), iTerm TTY resolution, `diagnose_root`'s cron/rate-limit
  ladder. The mtime age is an UPPER bound on substantive age — the safe direction for a
  detector that actuates nothing. Port them with the actuation lane, not before.
- **NEXT ACTION (USER-gated, box 4):** arm `AIM_FLEET_RECOVERY_FIRE`, then propose the
  `session-liveness` claim (add to `ABSORBED_CHORES` ONLY with the lane live). Until then this
  card sits in human_review; 9FW92242 (fleet-stop) is unblocked on the population half.

## Acceptance

- [x] scan discovers janitor-armed non-agent sessions (measured against the live machine: the plugin-dev Claudes appear) — 19/21 on 2026-08-19, see STATE
- [x] origin tag threads through snapshot -> runner so actuation policy is per-population — `origin` on both populations; runner sees registry ids only (n4 pins the threading)
- [x] detect-only first: no actuation on the new population until separately armed — watchdog log line only; n3 pins it
- [ ] claim of 'session-liveness' proposed to USER only after this lands + FIRE armed — USER-gated (AIM_FLEET_RECOVERY_FIRE not armed)

## Approval log

- 2026-08-19T15:01:29+0200 — MANDATE issued as Tier-0 self-mandate (derived NPT of [[KCRMSNL7]],
  server-internal, reversible, dark-shipped where destructive). No approval request sent.
