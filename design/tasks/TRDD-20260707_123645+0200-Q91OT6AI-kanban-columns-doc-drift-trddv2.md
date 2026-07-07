---
trdd-id: Q91OT6AI
title: Kanban board columns drifted from docs — update to TRDD-v2 14-stage set
column: planned
created: 2026-07-07T12:36:45+0200
updated: 2026-07-07T13:24:46+0200
current-owner: scenario-runner
approval-tier: 2
priority: 2
severity: NIT
effort: S
labels: [scenario-improvement, scen-002, batch-backlog-20260707]
task-type: docs
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_002_2026-06-23T10-24-11Z.md", "reports_dev/scenarios-runner/SCEN-002_2026-06-23T10-24-11Z.report.md"]
---

# TRDD-Q91OT6AI — Kanban board columns drifted from docs — update to TRDD-v2 14-stage set

## Problem
SCEN-002 S037 expected the team kanban board to show 5 columns
(Backlog/To Do/In Progress/Review/Done — the model referenced by the
scenario's 2026-04 authoring and by older docs). At HEAD (verified by the
2026-06-23 run itself, ADAPTED not a hypothesis) the board actually shows
the TRDD-v2 14-stage pipeline columns
(Backburner/To Do/Design/Dispatch/Dev/Testing/AI Review/Human
Review/Complete/Publish/Published/Deploy/Live/Live-Auditing, per
`~/.claude/rules/trdd-design-tasks.md`'s Column enum). The board itself
works correctly (per-column "Add task" is functional) — this is pure
scenario/doc drift, not an app defect.

## Root cause
The kanban column model was migrated to the TRDD-v2 pipeline (see
`design/tasks/TRDD-20260621_003352+0200-67f8b9bd-kanban-trddv2-fields-next-route.md`
for the related route-level migration) after SCEN-002 was authored in
2026-04. Nobody swept the scenario file or any stale doc references to the
old 5-column model when that migration landed.

## Proposed fix
1. Update `tests/scenarios/SCEN-002_*.scen.md` step S037's expected-result
   text from the fixed 5-column list to either (a) the current TRDD-v2
   14-stage column list, or (b) a version-resilient assertion such as
   "board loads with ≥5 columns matching the project's configured kanban
   pipeline (see PRRD/TRDD-v2 column enum) + per-column 'Add task'
   control" so a future pipeline-shape change doesn't re-trip this same
   drift.
2. Grep the repo for the stale 5-column description and update any hits:
   `grep -rn "Backlog.*To Do.*In Progress.*Review.*Done" docs/ README.md
   tests/scenarios/ 2>/dev/null` (or an equivalent broader search for
   "Backlog" + "In Progress" + "Review" + "Done" co-occurring near
   "kanban").
3. Cross-reference `types/task.ts` / `lib/task-registry.ts` (per CLAUDE.md
   §"Key Files to Understand") to confirm the TRDD-v2 columns are indeed
   the single source of truth to document against, not a third
   intermediate model.

## Verification
1. Re-run SCEN-002 S037 with the updated expected column list/assertion —
   result should be PASS, not ADAPTED.
2. `grep -rn "Backlog.*In Progress.*Review.*Done"` across `docs/`,
   `README.md`, `tests/scenarios/` returns no stale hits.

## Estimated risk
LOW. Documentation/scenario-only change; no code or behavior modification.

## Approval log

- 2026-07-07T13:24:46+0200 — APPROVED by USER-delegated batch screening (tier 2).
