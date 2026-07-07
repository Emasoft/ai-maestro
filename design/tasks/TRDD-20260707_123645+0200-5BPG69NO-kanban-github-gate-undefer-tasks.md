---
trdd-id: 5BPG69NO
title: Clarify kanban local-task vs GitHub-linked task model and un-defer SCEN-002 S038/S039
column: planned
created: 2026-07-07T12:36:45+0200
updated: 2026-07-07T13:24:46+0200
current-owner: scenario-runner
approval-tier: 2
priority: 2
severity: LOW
effort: M
labels: [scenario-improvement, scen-002, batch-backlog-20260707]
task-type: docs
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_002_2026-06-23T10-24-11Z.md", "reports_dev/scenarios-runner/SCEN-002_2026-06-23T10-24-11Z.report.md"]
---

# TRDD-5BPG69NO — Clarify kanban local-task vs GitHub-linked task model and un-defer SCEN-002 S038/S039

## Problem
SCEN-002 S038 found that clicking "Add task" on the team kanban board opens
an inline new-task form with NO "Team has no GitHub project linked" error —
the gate the scenario cites (2026-04 authoring) as the reason S038/S039 are
DEFERRED. The scenario did not submit a task (no fixture, avoids
cleanup-requiring state), so it's unconfirmed whether task creation is
actually GitHub-gated at submit-time or whether the local-task model has
been restored end-to-end.

## Root cause
Verified at HEAD (2026-07-07): there are TWO separate task/kanban surfaces:
- `app/api/teams/[id]/kanban/items/route.ts` — `POST` handler explicitly
  gates on `team.githubProject` (line 74: `if (!team.githubProject) { ... }`)
  before calling `createIssue`/`linkIssueToProject` from `lib/github-cli`.
  This route is GitHub-only; a team without a linked GitHub project cannot
  use it.
- `app/api/teams/[id]/tasks/route.ts` — a separate `POST` handler
  ("Create a new task", line 90) with no `githubProject` check visible at
  the route's auth/validation entry (needs full-body confirmation, not
  fully read in this light spot-check).

This confirms the report's hypothesis #2 is plausible: a local-task model
exists via `/api/teams/[id]/tasks`, distinct from the GitHub-linked
`/api/teams/[id]/kanban/items` route. Which route the "Add task" inline form
in the UI actually calls has NOT been confirmed by this proposal — that is
the first concrete investigation step below.

## Proposed fix
1. Read the kanban board's "Add task" form submit handler (likely in
   `components/team-meeting/TaskKanbanBoard.tsx` / `TaskCreateForm.tsx`) to
   determine which of the two routes it POSTs to.
2. If it posts to `/api/teams/[id]/tasks` (local model): rewrite SCEN-002
   S038/S039 from DEFERRED to live steps — create a task in Backburner (or
   whatever the first TRDD-v2 column is), drag it to another column via
   native HTML5 drag-and-drop (matching the existing `KanbanCard`/
   `KanbanColumn` pattern documented in CLAUDE.md §"Team Meeting
   Architecture"), verify the status change via the API, then delete the
   task and add its cleanup to the scenario's cleanup phase. Update the
   scenario's Phase 8 AUTHORING note to reflect the corrected model.
3. If it posts to `/api/teams/[id]/kanban/items` (GitHub-gated): the
   inline form opening with no upfront error is itself a UX defect — it
   should either show the "Team has no GitHub project linked" gate BEFORE
   the form opens (disable/hide "Add task" with an explanatory tooltip), or
   inline-error immediately after Enter/Submit rather than opening an
   interactive form the submission will always reject. Keep S038/S039
   DEFERRED but fix the inline-form premise so a future run can un-defer it
   without hitting the same ambiguity.

## Verification
1. Static confirmation: grep the "Add task" submit handler's fetch target
   and cross-check against the two routes above.
2. If local-task path confirmed: re-run SCEN-002 with the rewritten
   S038/S039 — the kanban CRUD path (create → drag → verify → delete) is
   exercised end-to-end with 0 GitHub fixture dependency.
3. If GitHub-gated path confirmed: re-run S038 — the gate is now shown
   BEFORE the form opens (or immediately on submit attempt), and the
   scenario's DEFERRED note explains why cleanly instead of citing removed
   behavior.

## Estimated risk
LOW. This is primarily an investigation + scenario-authoring correction;
any UI change (showing the gate earlier) is additive and does not alter the
underlying GitHub-linkage requirement for that specific route.

## Approval log

- 2026-07-07T13:24:46+0200 — APPROVED by USER-delegated batch screening (tier 2). Investigation-first; outcome picks branch 2 or 3 of its own Proposed fix.
