---
trdd-id: 593e0d15-94d2-416a-a0c6-5963609f436e
title: Wire MANAGER-only RBAC into POST /api/teams/create-with-project
status: completed
column: completed
approval-tier: 2
created: 2026-06-16T23:38:54+0200
updated: 2026-06-19T04:34:45+0200
current-owner: null
task-type: security
priority: 1
severity: HIGH
relevant-rules: []
external-refs: ["reports/script-audit/AUDIT-REPORT-20260616_233416+0200.md"]
---

# TRDD-593e0d15 — Wire MANAGER-only RBAC into `POST /api/teams/create-with-project`

**Source:** script↔API security audit, finding L2-H1 (`server-authz-sweep` AUTHZ-01).
**Tier 2 (MANAGER):** team-creation governance.

## Problem (WHY)

Team creation is a MANAGER-only governance act (R9/R10/R12). The canonical `POST /api/teams` enforces this by passing `requestingAgentId: auth.agentId` into `createNewTeam`, where the gate `if (params.requestingAgentId) { if (managerId !== requestingAgentId) return 403 }` (`services/teams-service.ts:226-232`) blocks a non-MANAGER agent even WITH the governance password.

But the sibling `POST /api/teams/create-with-project` does `enforceAuth` + `verifyPassword(body.password)` only, then calls `createNewTeam({name,description,chiefOfStaffId,orchestratorId})` (`app/api/teams/create-with-project/route.ts:25-60`) — it **never sets `requestingAgentId` and never builds/passes an `authContext`**. When `requestingAgentId` is falsy the MANAGER gate is SKIPPED. So a non-MANAGER agent that holds the governance password creates a team via this route (reachable by raw `curl`), bypassing the RBAC its sibling enforces.

## Proposed change

```
app/api/teams/create-with-project/route.ts:
  const auth = authenticateFromRequest(request)
  // (fail-closed on auth.error)
  createNewTeam({
    name, description, chiefOfStaffId, orchestratorId,
    requestingAgentId: auth.agentId,            // <-- the missing line
    authContext: buildAuthContext(auth),         // <-- and this
  })
```

The existing `teams-service.ts:227-231` manager gate then fires for agent callers; system-owner (no agentId, valid `aim_session` cookie) keeps working because `requestingAgentId` is falsy for them by design.

## Acceptance criteria

- A non-MANAGER agent calling `POST /api/teams/create-with-project` with a valid `AID_AUTH` + correct governance password → 403 (same as `POST /api/teams`).
- The MANAGER agent (or system-owner) calling it → success.
- The created team is identical in shape to one made via `POST /api/teams`.
- Test: non-manager-403-parity-with-/api/teams, manager-OK, system-owner-OK.

## Risk / blast radius

Low. The only behavior change is that a non-MANAGER+password caller is now correctly rejected — which is the intended governance rule. Verify no internal automation relied on the (buggy) password-only path.

## Realignment + status (2026-06-18, GOVERNANCE-RULES v4.0.1)

Governed by **R29** (MANAGER team authority), **R28** (AID → title), **R38.1** (only MAESTRO-user/MANAGER create teams). **IMPLEMENTED (complete)** in commit `e238d4ec`: `create-with-project` switched `enforceAuth` → `requireAuth` and now forwards `requestingAgentId` + `authContext` to `createNewTeam` (the exact two missing lines this proposal specified). The MANAGER-RBAC gate now fires — a non-MANAGER agent is rejected; the system-owner / password path passes as `isSystemOwner`. tsc clean; 1527 unit tests pass.

## Approval log
