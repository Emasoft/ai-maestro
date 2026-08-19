---
trdd-id: CYUCN7Y0
title: Fleet-wide TRDD query verb and batch approve-refuse surface
column: todo
created: 2026-08-19T14:01:56+0200
updated: 2026-08-19T14:01:56+0200
implementation-commits: []
current-owner: hub-session-brrjk57p-phase2
created-by: hub-session-brrjk57p-phase2
assignee: hub-session-brrjk57p-phase2
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: user
priority: 2
project-id: ai-maestro
labels: [scripts-spec-needs, decoupling-layer, amama, kanban]
external-refs: [AMAMA reply 2026-08-19 (BRRJK57P ledger)]
---

# Fleet-wide TRDD query verb and batch approve-refuse surface

## Problem (spec-first — requested by AMAMA, 2026-08-19)

(a) `aimaestro-trdd.sh search` takes one `--agent`; the MANAGER's board-reporting and
D4-watchdog sweeps need ONE call aggregating open work across ALL registered agent
workdirs (`search --all-agents`, or a portfolio board verb). (b) The
amama-proposal-approvals batch semantics (`approved: 4,6,22` / `refused:` complement)
have no script surface — only per-id approve/refuse.

## Disposition to decide at design

(a) is a genuine server-side aggregation (registry knows the workdirs) — implement.
(b) may be WONTFIX: composable client-side over per-id verbs with one sudo round-trip
per id; implement only if the auth round-trips are the measured pain. AMAMA offered the
WONTFIX explicitly — decide on measurement, not sympathy.

## Acceptance

- [ ] `search --all-agents` spec'd first, then implemented; returns per-agent-workdir
      aggregated rows with the same columns as single-agent search
- [ ] batch approve/refuse: explicit decision recorded (implemented OR WONTFIX with the
      client-side recipe written into the spec), AMAMA notified either way

## Approval log

- 2026-08-19T14:01:56+0200 — MANDATE under the USER's 2026-08-19 orchestration directive.
  Queued at todo; spec-first at design.
