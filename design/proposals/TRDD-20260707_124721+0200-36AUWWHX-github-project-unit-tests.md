---
trdd-id: 36AUWWHX
title: Add gh-CLI-mocked unit tests for lib/github-project.ts CRUD functions
column: proposal
created: 2026-07-07T12:47:21+0200
updated: 2026-07-07T12:47:21+0200
current-owner: scenario-runner
approval-tier: 2
priority: 2
severity: MEDIUM
effort: M
labels: [scenario-improvement, scen-025, batch-backlog-20260707]
task-type: feature
parent-trdd: null
npt: []
eht: []
relevant-rules: [25]
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_025_2026-05-04T12-16-23Z.md"]
---

# TRDD-36AUWWHX — Add gh-CLI-mocked unit tests for lib/github-project.ts CRUD functions

## Problem
A UI scenario (SCEN-025) for round-trip GitHub Project sync is fragile —
it depends on GitHub API rate limits, `gh` auth scopes, fixture account
state, and network timing, and costs ~30 seconds of real network
round-trips per step. `lib/github-project.ts` (1500+ lines at HEAD,
2026-07-07) is the module doing the actual `gh` CLI shelling
(`spawnSync('gh', args, ...)` — see lines 388 and 942) via these exported
functions: `listTasks`, `getKanbanColumns`, `createTask`, `updateTask`,
`deleteTask`, `updateKanbanColumns`, `resolveTaskDeps`, `refreshCache`,
plus `trddMetadataLabels`/`splitBodyAttachments`/`buildBodyWithAttachments`/
`consumeTrddMetadataLabel`/`checkGhAuth`.

**Note on scope drift from the original report:** the original report
(2026-05-04) named functions `linkProject`, `updateStatus`, `closeIssue`
that do not exist in the current module — the module has evolved
substantially in the two months since. This proposal targets the
functions that actually exist today.

An existing test file, `tests/unit/github-project-task-model.test.ts`
(407 lines), already covers `trddMetadataLabels`, `splitBodyAttachments`,
`buildBodyWithAttachments`, `consumeTrddMetadataLabel` (label
encode/decode + attachments round-trip) — but does NOT mock the `gh`
binary or exercise `createTask`/`updateTask`/`deleteTask`/`listTasks`/
`getKanbanColumns`, i.e. the actual CRUD calls that shell out via
`spawnSync('gh', ...)`. `tests/unit/api-team-tasks-trddv2-fields.test.ts`
mocks `@/services/teams-service` (a layer above `github-project.ts`), so
it also does not exercise the `gh`-CLI-calling code paths. This gap is
real, not already covered.

## Root cause
The label/attachment helpers (pure functions, no I/O) got unit tests
because they're easy to test in isolation. The CRUD functions that
actually spawn `gh` were never given an equivalent mocked-binary test
harness, so their correctness is currently verified only by a UI
scenario that has never successfully run (SCEN-025 SETUP_FAIL).

## Proposed fix
Create `tests/unit/github-project-crud.test.ts` (or extend the existing
`github-project-task-model.test.ts` file) covering, against a stubbed
`gh` binary or a `vi.mock('child_process')` intercepting `spawnSync`:

- `createTask` calls `gh` with the expected argument array (item-add /
  issue-create shape) and returns a task object.
- `updateTask` calls `gh` with the expected argument array when changing
  a task's kanban column, and correctly maps the app's column value to
  the target GitHub Project Status-field option name. **Kanban-alignment
  note (governance-rules branch, 2026-07-07):** the column values under
  test MUST be drawn from the ratified TRDD `column:` vocabulary
  (`~/.claude/rules/trdd-design-tasks.md` v2, `docs/GOVERNANCE-RULES.md`
  R25), not an ad-hoc kanban-style list — do not hardcode legacy values
  like "in_progress"/"review" as the canonical set under test.
- `deleteTask` calls `gh` with the expected argument array.
- `listTasks` / `getKanbanColumns` parse a stubbed `gh ... --format json`
  response into the expected in-app shape.

Mock `spawnSync`/`execSync` via `vi.mock('child_process')` (Vitest is
already the project's test runner — see `tests/unit/*.test.ts`), matching
the existing test file's style rather than introducing a new stub-binary
mechanism.

The SCEN-025 UI scenario then stays focused on what only a UI scenario
can verify: "can the user paste a GitHub Project URL into the Link form
and see the linked state persist?" — the round-trip CRUD logic itself is
unit-tested and no longer depends on live GitHub API calls for routine
CI.

**File to create/edit:** `tests/unit/github-project-crud.test.ts` (new),
referencing `lib/github-project.ts`.

## Verification
`yarn test` includes the new tests, all pass, and the suite adds no
network calls (confirm via `--reporter=verbose` showing no test exceeds
~50ms, versus SCEN-025's ~30s-per-step network round-trips).

## Estimated risk
LOW — additive test file, no production code changed. Risk is scope
creep if `lib/github-project.ts`'s `gh` argument shapes are more complex
to mock than expected (1500+ lines suggests real complexity) — budget
for reading the full `createTask`/`updateTask` implementations before
writing the mocks, not just their signatures.

## Approval log
