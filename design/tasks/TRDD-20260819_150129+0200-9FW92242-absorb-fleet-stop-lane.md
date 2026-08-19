---
trdd-id: 9FW92242
title: Absorb the fleet-stop chore into the server
column: blocked
pre-block-column: planned
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
blocked-by: [TRDD-99LV0U4I]
implementation-commits: []
project-id: ai-maestro
labels: [family-a, janitor-absorption, npt]
release-via: none
---

# Absorb the fleet-stop chore into the server

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

- [ ] lane implemented over both populations with the 3 gates; default-OFF
- [ ] dedupe-per-(pid,flag) pinned (re-set flag re-injects; held flag injects once)
- [ ] stamp + cadence contract honored; claim token added only when live

## Approval log

- 2026-08-19T15:01:29+0200 — MANDATE issued as Tier-0 self-mandate (derived NPT of [[KCRMSNL7]],
  server-internal, reversible, dark-shipped where destructive). No approval request sent.
