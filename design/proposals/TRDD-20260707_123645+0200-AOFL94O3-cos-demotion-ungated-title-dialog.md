---
trdd-id: AOFL94O3
title: COS-demotion ungated in Title Assignment Dialog and ChangeTitle Gate 8
column: proposal
created: 2026-07-07T12:36:45+0200
updated: 2026-07-07T12:36:45+0200
current-owner: scenario-runner
approval-tier: 2
priority: 1
severity: HIGH
effort: M
labels: [scenario-improvement, scen-002, batch-backlog-20260707]
task-type: bugfix
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_002_2026-06-23T10-24-11Z.md", "reports_dev/scenarios-runner/SCEN-002_2026-06-23T10-24-11Z.report.md"]
---

# TRDD-AOFL94O3 — COS-demotion ungated in Title Assignment Dialog and ChangeTitle Gate 8

## Problem
SCEN-002 S031 found that opening the Title Assignment Dialog on a team's
CHIEF-OF-STAFF shows MEMBER / ORCHESTRATOR / ARCHITECT / INTEGRATOR all
ENABLED (`disabled=false`, `cursor:pointer`). Only AUTONOMOUS is disabled
(standalone-only rule). Per governance R4.7, the COS cannot be removed while
the team exists — this is enforced for the *agentIds-removal* path (Edit Team
modal keeps the COS pre-selected) but NOT for the *title-change* path. A user
(or an API caller) can pick another team title for the current COS and vacate
`team.chiefOfStaffId`, leaving the team without a Chief-of-Staff.

## Root cause
Verified at HEAD (2026-07-07) by reading
`components/governance/TitleAssignmentDialog.impl.tsx` lines 289-323
(`titleDisabledReason` computation). The per-title disable logic only checks
singleton occupancy by OTHERS:
```
} else if (opt.title === 'manager' && managerHeldByOther) { ... }
} else if (opt.title === 'chief-of-staff' && governance.memberTeam?.chiefOfStaffId && governance.memberTeam.chiefOfStaffId !== agentId) { ... }
} else if (opt.title === 'orchestrator' && governance.memberTeam?.orchestratorId && governance.memberTeam.orchestratorId !== agentId) { ... }
```
There is no branch of the form "if `agent.id === team.chiefOfStaffId`, disable
every OTHER team title" — so when the dialog is opened FOR the COS agent
itself, none of the three `!== agentId` conditions fire and every team title
renders enabled.

Server-side belt-and-braces was ALSO verified missing: in
`services/element-management-service.ts`, Gate 8 ("Singleton check —
COS/ORCHESTRATOR per team", around line 2182) only rejects assigning a
singleton title that is ALREADY held by someone else (`newTitle ===
'chief-of-staff' && memberTeamG8.chiefOfStaffId && memberTeamG8.chiefOfStaffId
!== agentId`). It does NOT reject changing the CURRENT COS's title away from
`chief-of-staff` to MEMBER/ORCHESTRATOR/ARCHITECT/INTEGRATOR, which would
vacate `team.chiefOfStaffId` with no replacement. This makes it a real R4.7
governance-invariant hole, not merely a UX defect — the dialog gap and the
server gap are both confirmed present.

## Proposed fix
1. **Client (`components/governance/TitleAssignmentDialog.impl.tsx`,** the
   `titleDisabledReason` loop, ~line 289-323): add a guard before the
   existing per-title branches — when `governance.memberTeam?.chiefOfStaffId
   === agentId`, disable every `teamTitles` entry except `'chief-of-staff'`
   itself with the reason text: `"The team's Chief-of-Staff cannot be
   demoted while the team exists. Delete the team or transfer COS first."`
   Reuse the existing disabled-card styling (opacity/cursor-not-allowed
   already applied via `isDisabled` at line ~776).
2. **Server (`services/element-management-service.ts`, Gate 8, ~line 2182-2199):**
   add a check: when the agent currently holds `chief-of-staff` on
   `memberTeamG8` (`memberTeamG8.chiefOfStaffId === agentId`) and `newTitle`
   is any other team title, reject with an error such as `"Cannot change
   title away from Chief-of-Staff while holding it — the team would be left
   without a COS. Transfer Chief-of-Staff to another agent first."` This
   closes the API-bypass path (direct PATCH, MANAGER flow, COS reassign)
   the same way Gate 8's existing singleton checks close the UI-bypass path
   (per the Gate's own SCEN-001 BUG-001 precedent comment).
3. Update SCEN-002 S031 to assert the new disabled state + reason text
   instead of the current "all enabled" observation.

## Verification
1. Reproduce S031: create a team, open the Title Assignment Dialog on its
   COS agent — the 4 other team titles must render disabled with the new
   reason text; only `chief-of-staff` (current) and AUTONOMOUS-disabled
   stay as today.
2. Server: call `ChangeTitle(cosAgentId, 'member')` (or any other team
   title) directly while the agent is `team.chiefOfStaffId` — must return
   an error, not succeed.
3. Confirm `ChangeTitle(cosAgentId, 'member')` still succeeds AFTER the COS
   is reassigned to a different agent (no regression on legitimate
   transfer-then-demote flows).
4. Re-run SCEN-002 S031 with the rewritten assertion — expect PASS.

## Estimated risk
LOW-MEDIUM. Both changes are additive guards (deny paths), so they cannot
newly permit anything; the risk is over-restricting a legitimate flow (e.g.
a COS-transfer pipeline that changes the OLD COS's title before writing the
NEW COS into `team.chiefOfStaffId`). Any existing COS-transfer code path
that mutates `chiefOfStaffId` and the old COS's title in two separate calls
must be checked for correct ordering (reassign COS first, demote old COS
second) or the new Gate 8 check will start rejecting it. No external
dependencies.

## Approval log
