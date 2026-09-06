---
trdd-id: C3CHP8L2
title: createNewTeam has no team-level compensation - a failure after saveTeams leaves the team and its COS behind under a 500
column: todo
created: 2026-09-06T03:38:49+0200
updated: 2026-09-06T03:38:49+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
task-type: bugfix
min-approval-requirement: none
assignee: ai-maestro-hub-session
mandate: true
mandated-by: none
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-09-06T03:38:49+0200
---

# createNewTeam has no team-level compensation - a failure after saveTeams leaves the team and its COS behind under a 500

## Problem

`services/teams-service.ts:275` `export async function createNewTeam(` has no team-level
compensation. Its outer `} catch (error) {` at l.583 runs the R31 freeze compensation (clears
`frozen`, wakes the recorded ids), maps `TeamValidationException` to its status code, logs
`Failed to create team`, and returns `{ error, status: 500 }` — it removes NOTHING the pipeline
created: no team-record deletion, no COS-agent deletion, no directory removal (lines 583-632 read
whole). Between l.275 and l.583 the only rollback bookkeeping is `cosWorkDir` / `cosWorkDirCreated`
(an inner scope around the COS agent creation), so a failure AFTER `saveTeams`/`createTeam` and the
COS creation leaves the team record and its COS agent persisted while the caller receives a 500 —
a husk. The gap PRE-EXISTS TRDD-0KMDJVON's freeze gate (commit b9b47954 and the createNewTeam
wiring); the fail-fast freeze makes it easier to reach (a throwing freeze now ends in that catch),
but any post-save throw did the same before.

## Evidence

- `services/teams-service.ts:275` `export async function createNewTeam(`; its outer `} catch (error) {` at l.583 runs the R31 freeze compensation (clears `frozen`, wakes the recorded ids), maps `TeamValidationException` to its status code, logs `Failed to create team`, and returns `{ error, status: 500 }` — it removes NOTHING the pipeline created: no team-record deletion, no COS-agent deletion, no directory removal (lines 583-632 read whole).
- Between l.275 and l.583 the only rollback bookkeeping is `cosWorkDir` / `cosWorkDirCreated` (an inner scope around the COS agent creation), so a failure AFTER `saveTeams`/`createTeam` and the COS creation leaves the team record and its COS agent persisted while the caller receives a 500 — a husk (the R50/R51 aio-pipeline rules: "the last write in a pipeline still needs a compensation"; "a preserved parent row with its children stripped is a husk").
- The gap PRE-EXISTS TRDD-0KMDJVON's freeze gate (commit b9b47954 and the createNewTeam wiring); the fail-fast freeze makes it easier to reach (a throwing freeze now ends in that catch), but any post-save throw did the same before.
- Evidence file (gitignored): `reports/colony/evidence/` job outputs of 2026-09-06 03:30-03:32; ledger `reports/colony/DELEGATION.md` bullets "HUSK GAP MEASURED".

## Proposed fix

Register a compensation right after the team record is persisted (delete the team record) and
after the COS agent is created (delete the COS agent + its workdir via the existing DeleteAgent
pipeline or its primitives), executed in reverse order in the outer catch after the freeze undo.
The existing `cosWorkDir` bookkeeping is already a partial precedent for this shape.

## Acceptance

- [ ] a test proves a throw after saveTeams leaves NO team record and NO COS agent behind (fixture: make a later gate throw)
- [ ] a test proves the compensations run in reverse order and the original error is what the caller receives

## Approval log

- 2026-09-06T03:38:49+0200 — MANDATE issued by ai-maestro-hub-session (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
