---
trdd-id: 99LV0U4I
title: Extend the fleet liveness scan to janitor-armed non-agent sessions
column: planned
created: 2026-08-19T15:01:29+0200
updated: 2026-08-19T15:01:29+0200
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
implementation-commits: []
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

## Acceptance

- [ ] scan discovers janitor-armed non-agent sessions (measured against the live machine: the plugin-dev Claudes appear)
- [ ] origin tag threads through snapshot -> runner so actuation policy is per-population
- [ ] detect-only first: no actuation on the new population until separately armed
- [ ] claim of 'session-liveness' proposed to USER only after this lands + FIRE armed

## Approval log

- 2026-08-19T15:01:29+0200 — MANDATE issued as Tier-0 self-mandate (derived NPT of [[KCRMSNL7]],
  server-internal, reversible, dark-shipped where destructive). No approval request sent.
