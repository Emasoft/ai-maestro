---
name: manager-gated-team-governance
description: "why are all my teams blocked / team agents got hibernated after removing MANAGER / cannot wake a team agent even as the user / who can wake hibernate or restart a team agent / MANAGER required for teams to function"
ocd: 2026-08-02
lmd: 2026-08-02
metadata:
  node_type: memory
  type: reference
  tier: component
---

# manager-gated-team-governance

Manager-Gated Team Governance (v0.27.3+): **MANAGER is required for teams to function.**
Without a MANAGER on the host, all teams are blocked and team agents are hibernated.

## Blocking cascade (triggered when MANAGER removed or missing at startup)

1. All teams get `blocked: true` in teams.json
2. All agents belonging to those teams have their tmux sessions killed (hibernated)
3. AUTONOMOUS agents are unaffected
4. Team creation, agent add/remove on teams are rejected with HTTP 400

## Unblocking (triggered when MANAGER assigned)

1. All teams get `blocked: false`
2. Agents remain hibernated — user or MANAGER must wake them manually

## Agent lifecycle governance (wake/hibernate/restart)

| Caller | Scope | Enforced at |
|--------|-------|-------------|
| User (web UI) | Any agent | Always allowed |
| MANAGER | Any agent | `auth.agentId === managerId` |
| CHIEF-OF-STAFF | Own team agents only | `team.chiefOfStaffId === auth.agentId && team.agentIds.includes(targetId)` |
| Any other agent | Denied | HTTP 403 |

Team agents cannot be woken when no MANAGER exists (even by the user — assign MANAGER
first).

## Key files

- `lib/team-registry.ts` — `blockAllTeams()`, `unblockAllTeams()`, `isAgentInAnyTeam()`
- `services/element-management-service.ts` — ChangeTitle Gate 10 (block on manager
  removal), Gate 13 (unblock on manager assignment)
- `server.mjs` — Startup manager check
- `app/api/agents/[id]/wake/route.ts` — Auth + manager gate
- `app/api/agents/[id]/hibernate/route.ts` — Auth + manager gate
- `docs/GOVERNANCE-RULES.md` — Full governance rules (R9, R10, R11, and the full R1-R20
  set)

## See also

## Notes and lessons learned
