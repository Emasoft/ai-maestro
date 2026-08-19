---
trdd-id: CYUCN7Y0
title: Fleet-wide TRDD query verb and batch approve-refuse surface
column: completed
created: 2026-08-19T14:01:56+0200
updated: 2026-08-19T14:21:22+0200
implementation-commits: [647a4ec7]
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

- [x] `search --all-agents` spec'd first (usage header, regenerated spec), then
      implemented as a client-side fan-out over GET /api/trdd — one row per registered
      agent {agent, agentId, result|error}, per-agent failure recorded in-row, never
      aborting the sweep. LIVE TEST 14:15: 11 agents, 0 errors, /bin/bash 3.2, exit 0.
      Server-side aggregation stays the recorded upgrade path.
- [x] batch approve/refuse: WONTFIX by AMAMA's own measurement (2026-08-19 14:20 reply:
      1-5 ids per screening session, worst <10, 50+ never occurred in the corpus). The
      client-side per-id loop recipe is written into the aimaestro-trdd.sh header (flows
      into the generated scripts spec); revisit trigger recorded there: a real session
      measuring >20 ids. AMAMA notified and ack'd part (a) adoption.

## Approval log

- 2026-08-19T14:01:56+0200 — MANDATE under the USER's 2026-08-19 orchestration directive.
  Queued at todo; spec-first at design.
- 2026-08-19T14:21:22+0200 — COMPLETED by hub (standing USER Phase-2 delegation,
  BRRJK57P). Part (a) shipped 647a4ec7, live-tested (11 rows, 0 errors, bash 3.2).
  Part (b) WONTFIX on AMAMA's measured screening volume; recipe in the CLI header.
