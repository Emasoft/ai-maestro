---
trdd-id: XTDMQO68
title: Team chair and orchestrator slots are a trust anchor — validate every writer and make refusals surface
column: todo
status: tasked
created: 2026-10-05T03:07:39+0200
updated: 2026-10-05T03:07:39+0200
current-owner: main-agent@ai-maestro
created-by: main-agent@ai-maestro
task-type: security
min-approval-requirement: none
scope: project
project-id: ai-maestro
assignee: main-agent@ai-maestro
mandate: true
mandated-by: none
approved: true
approval-judge: main-agent@ai-maestro
approval-datetime: 2026-10-05T03:07:39+0200
---

# Team chair and orchestrator slots are a trust anchor — validate every writer and make refusals surface

## Problem

Split out of TRDD-A50RC5G8 (2026-10-05), which outgrew one task. `team.chiefOfStaffId` and `team.orchestratorId` now decide every CHIEF-OF-STAFF and ORCHESTRATOR grant in lib/authorization.ts, so who can write them, and with what, is a security boundary of its own.

Landed already (see A50RC5G8): a NEW chair must be a live agent and not the MANAGER in createTeam/updateTeam (96245c34c); cross-host assign-cos repeats both checks inline (5ce4c6a5a).

Open, each to be re-verified by reading before changing:

- Cross-host refusals report success. Per worker read: the request is marked `executed` in lib/governance-request-registry.ts (~208) when the second MANAGER approves, BEFORE execution; a refusal in services/cross-host-governance-service.ts only returns from the lock callback, and the caller answers 200 "Successfully executed" with nothing written. Five refusals in assign-cos alone now have this shape.
- `orchestratorId` has no writer validation equivalent to the chair's (live agent; in the team). The validator's own comment says eligibility lives at the dedicated route.
- The MANAGER-as-chair check is skipped when a caller omits `managerId` (both parameters are optional). Read by the orchestrator: the DeleteTeam G03 undo calls updateTeam with no managerId.
- Chairs seated before the validation are grandfathered silently (the check runs only when the chair changes). Read-only script on 2026-10-05: 2 of 3 live teams name a chair id with no live agent — report to the user, do not modify.
- Rollbacks that re-seat a chair through updateTeam now fail with 404 if the agent is not live at that moment. Read by the orchestrator: DeleteAgent G04 undo restores a teams snapshot with saveTeams and is NOT affected. DeleteTeam G03 undo IS a candidate; whether the agent is restored before it runs was not traced.
- The other four cross-host request types (add-to-team, remove-from-team, remove-cos, transfer-agent) write with saveTeams and skip the single-team and chair-removal rules (per worker table).

## Proposed fix

Make a cross-host refusal surface (a failed status with a reason) instead of returning silently; validate the orchestrator slot at the shared choke point; pass the manager id from every caller or resolve it inside; add a detector for invalid seated chairs rather than re-validating on every update.

## Acceptance

- [ ] Cross-host: a refused execution is recorded and returned as failed with its reason; test per refusal
- [ ] orchestratorId: a new value must be a live agent listed in the team; cross-host covered
- [ ] No caller of createTeam/updateTeam skips the MANAGER check by omitting managerId
- [ ] Detector (lint or heartbeat finding) for a team whose chair or orchestrator is not a live agent
- [ ] DeleteTeam G03 undo traced: can the 404 fire inside a rollback? fixed or proven unreachable
- [ ] The four other cross-host request types obey R4.1 / R4.7

## Approval log

## Approval log

- 2026-10-05T03:07:39+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
