---
trdd-id: 1LX5LMBD
title: Decide whether Create Team is a strict sudo route and align SCEN-001 S017
column: proposal
created: 2026-07-07T03:45:00+0200
updated: 2026-07-07T03:45:00+0200
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
