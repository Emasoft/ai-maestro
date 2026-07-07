---
trdd-id: 1LX5LMBD
title: Decide whether Create Team is a strict sudo route and align SCEN-001 S017
column: planned
created: 2026-07-07T03:45:00+0200
updated: 2026-07-07T15:11:42+0200
current-owner: scenario-runner
approval-tier: 2
priority: 2
severity: MEDIUM
effort: S
labels: [scenario-improvement, scen-001, batch-backlog-20260707]
task-type: security
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_001_2026-06-23T08-44-04Z.md"]
---

# TRDD-1LX5LMBD — Create Team strict-route policy decision

## Problem
SCEN-001 S017 expects a governance-password (sudo) prompt during Create Team; none
appeared in the 2026-06-23 run (team + auto-COS created without it). Verified
2026-07-07: `security-registry.json` classifies `DELETE_/api/teams/[id]` and
`PUT_/api/teams/[id]` as strict but has NO entry for `POST /api/teams` — so team
creation is currently NOT sudo-gated.

## Root cause
Policy gap: team creation is a privileged operation (it auto-creates an agent, generates
an AID keypair, and installs a role-plugin) but was never classified when sudo-mode
rolled out.

## Proposed fix
Decide the policy. Recommended: classify `POST_/api/teams` as `strict` in
`security-registry.json` and route the Create Team dialog's submit through `sudoFetch`
(one fresh token per create). Then align SCEN-001 S017 to always expect the sudo modal.
If the decision is NOT-strict instead, drop S017's password-prompt expectation.

## Verification
Create a team twice, >60s apart, no other strict op between: the sudo modal appears each
time; SCEN-001 S017 passes as re-written. Rule 12's strict-routes table updated.

## Estimated risk
LOW-MED — one registry entry + dialog fetch path; the sudo layer is proven. Dependencies:
none.

## Approval log

- 2026-07-07T13:24:46+0200 — APPROVED by USER-delegated batch screening (tier 2). Implementer follows the proposal's recommended option.
- 2026-07-07T15:11:42+0200 — IMPLEMENTED (wave W4): classified POST_/api/teams strict in security-registry.json + sudo-guard.ts STRICT_AGENT_RULES (manage-team); app/api/teams/route.ts now calls requireSudoToken, replacing the old ad-hoc in-body governancePassword check; TeamListView.tsx's create-team fetch now uses sudoFetch; SCEN-001 S017 updated to require the sudo modal. NOTE: tests/team-api.test.ts's 6 POST tests still pass because that file mocks fs and never populates security-registry.json in its fixture store, so requiresSudo() sees no file and the gate is inert there — flagged as a follow-up: that test file should be updated to exercise the strict gate for real (out of this task's write-scope).
