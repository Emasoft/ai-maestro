---
trdd-id: JBFM8XR0
title: Absorb the fleet-plugins-update chore into the server
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

# Absorb the fleet-plugins-update chore into the server

Server-side absorbed lane for per-agent local-scope plugin updates across the registered
fleet (janitor task_fleet_plugins_update, 21600s). The server owns the registry and the
workdirs, so it is the natural owner. ALL THREE measured incident requirements apply
verbatim: atomic cache population (staging dir + rename — the 4OFMHOZ7 hook-blackout is
the acceptance scenario), quarantine outside every scanned tree, explicit cache-parent
root resolution stated in code comments (the ZM5LZ24Y month-dead lesson).

The per-chore disposition table, the three cross-cutting axes (stamp+cadence contract,
claim-only-when-live, default-OFF destructive lanes), and the three measured incident
requirements live on the parent [[KCRMSNL7]] (DESIGN RESOLVED 2026-08-19 section) — read
that FIRST; this card does not restate it.

## Acceptance

- [ ] lane implemented server-side with the 3 incident requirements demonstrably honored (cite the code sites in this card)
- [ ] completion stamp written via janitor-chore-stamp each run; cadence respects the janitor stale bound
- [ ] claim token 'fleet-plugins-update' added to ABSORBED_CHORES ONLY in the commit that makes the lane live
- [ ] one pinning test per requirement (staging/rename observed; quarantine path outside scan roots; root resolution)

## Approval log

- 2026-08-19T15:01:29+0200 — MANDATE issued as Tier-0 self-mandate (derived NPT of [[KCRMSNL7]],
  server-internal, reversible, dark-shipped where destructive). No approval request sent.
