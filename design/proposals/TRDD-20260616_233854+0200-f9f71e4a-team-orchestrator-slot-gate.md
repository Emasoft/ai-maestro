---
trdd-id: f9f71e4a-1f4d-4f41-a97d-c79215dbac8e
title: Gate the team orchestratorId slot — sudo plus eligibility plus titling on PUT
status: proposal
column: proposal
approval-tier: 2
created: 2026-06-16T23:38:54+0200
updated: 2026-06-16T23:38:54+0200
current-owner: null
task-type: security
priority: 0
severity: HIGH
relevant-rules: []
external-refs: ["reports/script-audit/AUDIT-REPORT-20260616_233416+0200.md"]
---

# TRDD-f9f71e4a — Gate the team `orchestratorId` slot (sudo + eligibility + titling) on PUT

**Source:** script↔API security audit, finding L2-H2 (`aimaestro-teams` TEAMS-03).
**Tier 2 (MANAGER):** team governance + sudo-gate change.

## Problem (WHY)

`PUT /api/teams/[id]` sets the team `orchestratorId` slot through three compounding gaps, letting a team MEMBER self-elevate to ORCHESTRATOR-equivalent ACL (including kanban-write) or graft an arbitrary agent into the team authority graph — with NO sudo, NO eligibility check, NO governance title:

1. **Sudo bypass.** `PUT_/api/teams/[id]` is classified `strict` (`security-registry.json:33`) but the handler runs `requireSudoToken` ONLY inside `if (safeBody.agentIds !== undefined)` (`app/api/teams/[id]/route.ts:114-117`). A PUT with `orchestratorId` but no `agentIds` skips sudo entirely (sudo is in-handler, never in middleware — `lib/sudo-guard.ts:12-14`).
2. **No validation + no titling.** `updateTeamById` keeps `orchestratorId` in `updateFields` (`services/teams-service.ts:463`); `validateTeamMutation` only sees `{name,type,chiefOfStaffId,agentIds}` (`lib/team-registry.ts:340-341`) then raw-spreads `orchestratorId` onto the team (`:348-354`); the update path never calls `ChangeTitle`. Contrast the CREATE path, which validates eligibility and titles the orchestrator (`teams-service.ts:235-251,360-365`), and `chiefOfStaffId`, which is STRIPPED on update.
3. **The slot is authority.** `isOrchestrator(agentId,teamId) = team.orchestratorId === agentId` (`lib/governance.ts:230-236`) → `lib/team-acl.ts:87` ACL allow; the kanban-write gate grants write to `isOrchestrator` only, member is read-only (`app/api/teams/[id]/kanban/items/route.ts:78-85`); and `lookupTeamIdForAgent` (`lib/authorization.ts:218-224`), `resolveTeamId` (`lib/agent-auth.ts:388-394`), and AID-token issuance (`app/api/v1/auth/token/route.ts:148-157`) all resolve an agent into the team when it occupies the slot — even if NOT in `agentIds`.

**Exploit:** `aimaestro-teams.sh update <ownTeamId> --orchestrator <self>` (or any `curl`) with no password/sudo → member gains kanban-write; `--orchestrator <foreignAgent>` grafts an arbitrary agent into the team's authority graph and changes its resolved teamId/token scope. `checkTeamAccess` gates the PUT to members+, so a non-member can't reach it — but a member can.

## Proposed change

```
1. app/api/teams/[id]/route.ts (PUT): fire requireSudoToken when ANY privileged slot is
   present — agentIds OR orchestratorId OR chiefOfStaffId — or unconditionally for the
   strict-classified route. (Simplest: move requireSudoToken before the field branch.)
2. services/teams-service.ts::updateTeamById: do NOT pass orchestratorId straight through.
   Either:
   (a) validate eligibility (existing agent; in this team's agentIds) AND route it through
       the same ChangeTitle('orchestrator') pipeline the create path uses; or
   (b) strip orchestratorId from the PUT body like chiefOfStaffId already is, and require a
       dedicated /api/teams/[id]/orchestrator endpoint that does (a).
3. lib/team-registry.ts::validateTeamMutation: include orchestratorId in the validated set so
   it can never be raw-spread unvalidated.
```

Option (b) is preferred for symmetry with `chiefOfStaffId`.

## Acceptance criteria

- A team MEMBER doing `PUT /api/teams/<ownTeam>` with `{orchestratorId:<self>}` and no sudo token → 403 sudo_required (or 404 on the stripped path).
- With a valid sudo token, the same PUT still requires `orchestratorId` to be an eligible in-team agent and applies the orchestrator title via the pipeline.
- `--orchestrator <foreignAgent>` (not in `agentIds`) is rejected as ineligible.
- Existing create-path orchestrator assignment is unchanged.
- Tests: member-self-403-without-sudo, ineligible-foreign-rejected, valid-with-sudo-titles-correctly, kanban-write-not-granted-without-the-pipeline.

## Risk / blast radius

Medium. Any existing tooling/UI that sets `orchestratorId` via the bare PUT must now supply sudo and/or use the dedicated endpoint — audit callers of the PUT before shipping.

## Realignment + status (2026-06-18, GOVERNANCE-RULES v4.0.1)

Governed by **R26/R29/R30** (the orchestrator slot is team-STRUCTURE/authority) and **R32** (agents never use sudo). **PARTIALLY IMPLEMENTED** in commit `e238d4ec`:
- ✅ Gap 1 (sudo bypass) — `teams/[id]` PUT now fires `requireSudoToken` when `agentIds` **OR** `orchestratorId` is present (proposed change #1), closing the no-sudo `orchestratorId`-only path.
- ⏳ **Remaining (follow-up):** Gaps 2 & 3 — `updateTeamById` still passes `orchestratorId` straight through with **no eligibility validation and no `ChangeTitle` pipeline**, and `validateTeamMutation` still omits it. Preferred fix (option b): strip `orchestratorId` from the PUT like `chiefOfStaffId`, add a dedicated `/api/teams/[id]/orchestrator` endpoint that validates in-team eligibility + applies the orchestrator title.
- **R32 note:** the sudo gate above is the USER/UI factor; the agent path should authorize by AID+title (R28) — part of the `bb344037` sudo-subsystem refactor.

tsc clean; 1527 unit tests pass.

## Approval log
