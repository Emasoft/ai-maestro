---
trdd-id: 67f8b9bd-0484-4a03-adde-2d5c52da67c2
title: Next.js POST tasks route drops TRDD-v2 kanban fields it validates (dual-mode drift)
column: complete
created: 2026-06-21T00:33:52+0200
updated: 2026-06-21T00:33:52+0200
current-owner: ai-maestro-session
assignee: ai-maestro-session
task-type: bugfix
release-via: none
parent-trdd: TRDD-903b7a20
relevant-rules: []
test-requirements: [unit, typecheck]
labels: [kanban, dual-mode-drift, trdd-v2, "#40"]
---

# TRDD-67f8b9bd — Next.js tasks route forwards TRDD-v2 fields

**Source:** overnight fleet-readiness verification (TRDD-903b7a20), fix-queue #9
(`trdd-verify-implemented` finding). Evidence: `reports/overnight-verify/trdd-verify-implemented.findings.json`.

## Problem
`POST /api/teams/[id]/tasks` (FULL/Next.js mode) accepts + validates the TRDD-v2
task fields via `CreateTaskSchema` (severity, effort, parentTask, npt, eht,
supersedes, relevantRules, releaseVia, + 6 more) and returns 200 — but the
`safeParams: CreateTaskParams` object it passes to `createTeamTask` spread only
the 13 base fields, **dropping every TRDD-v2 field**. A stale comment claimed
"forwarding them would break tsc against the current CreateTaskParams" — but
`CreateTaskParams` (teams-service.ts:114) ALREADY carries the 8 core fields,
`createTeamTask` ALREADY forwards them to `ghProject.createTask`, and
`trddMetadataLabels` (lib/github-project.ts:54-61) ALREADY encodes them as
issue labels. So the whole downstream chain supported them; only the route's
spread was missing. The **headless-router mirror**
(services/headless-router.ts:2099-2106) spread them correctly — pure
Next-route-vs-headless dual-mode drift. Net effect: a kanban task created in
FULL mode silently lost its classification/relationships/delivery metadata
(the kanban pillar, #40/#2), while the same request in headless kept it.

## Fix
Spread the 8 end-to-end-supported TRDD-v2 fields (severity, effort, parentTask,
npt, eht, supersedes, relevantRules, releaseVia) into the Next route's
`safeParams`, matching headless. The Zod-parsed `body.*` is already the typed
enum/array, so no `String()` cast is needed (unlike headless's untyped JSON).
Stale comment replaced with the accurate state.

## Remaining (follow-up, NOT this fix)
6 schema-validated fields are accepted (so a valid TRDD-v2 payload doesn't 400)
but NOT yet carried by `CreateTaskParams` / `createTeamTask` /
`ghProject.createTask`: reviewResult, supersededBy, implementationCommits,
lastTestResult, publishedVersion, liveSince. Forwarding them needs the full
service + GitHub-label chain extended (and is uniform across BOTH modes — not a
drift). Documented for a later pass.

## Acceptance
- POST with the 8 fields → `createTeamTask` receives them (was dropped before).
- POST without them → params omit them (no `undefined` injection).
- `tsc --noEmit` clean; `tests/unit/api-team-tasks-trddv2-fields.test.ts` 2/2 green
  (RED-verified against the unfixed route first).

## Implementation (2026-06-21)
`app/api/teams/[id]/tasks/route.ts` safeParams. TDD: `tests/unit/api-team-tasks-trddv2-fields.test.ts`.
Landed in the overnight campaign (TRDD-903b7a20). Not pushed.
