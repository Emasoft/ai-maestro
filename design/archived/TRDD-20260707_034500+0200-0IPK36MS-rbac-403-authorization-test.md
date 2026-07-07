---
trdd-id: 0IPK36MS
title: Add the missing RBAC-403 authorization unit test that SCEN-001 defers to
column: complete
created: 2026-07-07T03:45:00+0200
updated: 2026-07-07T15:48:02+0200
current-owner: scenario-runner
approval-tier: 2
priority: 1
severity: MEDIUM
effort: S
labels: [scenario-improvement, scen-001, batch-backlog-20260707]
task-type: feature
parent-trdd: null
npt: []
eht: []
relevant-rules: []
implementation-commits: [c9b77089]
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_001_2026-06-23T08-44-04Z.md"]
---

# TRDD-0IPK36MS — Add the missing RBAC-403 authorization unit test

## Problem
SCEN-001 S014/S032 deliberately do NOT exercise the post-authentication RBAC denial
path live (the UI always sends correct auth) and instead cite
`tests/authorization.test.ts` as the covering test. That file does not exist (verified
2026-07-07: no `*authorization*` test anywhere under tests/). The 403 path — a MEMBER
with a VALID Bearer token attempting to change another agent's title — is therefore
unverified everywhere.

## Root cause
Test file never authored (or moved and lost); the scenario reference is aspirational.

## Proposed fix
Author `tests/authorization.test.ts` (vitest, real AID Bearer tokens, no mocks of the
auth layer itself): MEMBER → 403 PATCHing another agent's `governanceTitle`; COS → 200
for own-team member, 403 out-of-team; MANAGER → 200 any agent; plus the 401 cases
(no Bearer with `X-Agent-Id`; mismatched `X-Agent-Id`) asserted against
`lib/agent-auth.ts` behavior. Assert the target agent is UNCHANGED after each denial
(the real security property).

## Verification
`npx vitest run tests/authorization.test.ts` green; grep confirms SCEN-001 S014/S032's
cited path now exists.

## Estimated risk
LOW — additive test. Dependencies: none.

## Approval log

- 2026-07-07T13:24:46+0200 — APPROVED by USER-delegated batch screening (tier 2).
- 2026-07-07T15:11:42+0200 — IMPLEMENTED (wave W4): tests/authorization.test.ts tests the real lib/authorization.ts::authorize() RBAC matrix with real AID Bearer tokens (real fs-store fixtures, no auth-layer mocks). Discovered and fixed a real testability bug: lib/authorization.ts's lookupGovernanceTitle/lookupTeamIdForAgent used lazy require('./...') calls that never resolve under Vitest (production bundlers handle them fine, but the COS-own-team authorize() path had ZERO real test coverage in this codebase before this TRDD) — converted to static imports, zero behavior change, 486 pre-existing tests re-verified green.
- 2026-07-07T15:48:02+0200 — COMPLETED (implementation-commits recorded); archived per the TRDD lifecycle.
