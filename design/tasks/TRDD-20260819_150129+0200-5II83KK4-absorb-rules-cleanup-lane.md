---
trdd-id: 5II83KK4
title: Absorb the rules-cleanup chore into the server
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

# Absorb the rules-cleanup chore into the server

Server-side sweep of janitor task_rules_cleanup (3600s): remove the janitor's
provenance-MARKED rules from ~/.claude/rules/ ONLY when the janitor is CONFIRMED fully
uninstalled (referenced in no settings.json scope AND its data dir gone). Never touches
an unmarked (user-authored) rule. Strictly improves on the daemon: the orphaned-cache
daemon survives uninstall <=7 days, the server indefinitely.

The per-chore disposition table, the three cross-cutting axes (stamp+cadence contract,
claim-only-when-live, default-OFF destructive lanes), and the three measured incident
requirements live on the parent [[KCRMSNL7]] (DESIGN RESOLVED 2026-08-19 section) — read
that FIRST; this card does not restate it.

## Acceptance

- [ ] marker-gated sweep implemented; the confirmed-uninstalled predicate matches the janitor's own (cite both)
- [ ] stamp + cadence contract honored; claim token added only when live
- [ ] test: an unmarked rule NEVER removed (neuter the marker gate -> exactly that test reds); nothing removed while the janitor is installed

## Approval log

- 2026-08-19T15:01:29+0200 — MANDATE issued as Tier-0 self-mandate (derived NPT of [[KCRMSNL7]],
  server-internal, reversible, dark-shipped where destructive). No approval request sent.
