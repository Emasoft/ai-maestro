---
name: manager-gated-team-governance
description: "why are all my teams blocked / team agents got hibernated after removing MANAGER / cannot wake a team agent even as the user / who can wake hibernate or restart a team agent / MANAGER required for teams to function"
ocd: 2026-08-02
lmd: 2026-10-02
metadata:
  node_type: memory
  type: reference
  tier: component
  topic: teams-and-governance
publish-globally: false
---

# manager-gated-team-governance

^UUMJ031G [desc: "Manager-Gated Team Governance (v0.27.3+): a MANAGER must exist on the host for teams to function; without one all teams are blocked and team agents hibernated.", keywords: why_are_all_my_teams_blocked MANAGER_required_for_teams manager_gated_team_governance v0_27_3 team_agents_hibernated_without_MANAGER teams_blocked_no_MANAGER cannot_wake_team_agent_without_MANAGER host_needs_a_MANAGER removing_MANAGER_blocks_teams assign_MANAGER_first MANAGER_removed_or_missing_at_startup, ocd: 2026-08-02, lmd: 2026-10-02]
Manager-Gated Team Governance (v0.27.3+): **MANAGER is required for teams to function.**
Without a MANAGER on the host, all teams are blocked and team agents are hibernated.

## Blocking cascade (triggered when MANAGER removed or missing at startup)

^Y71Q40FD [desc: "When MANAGER is removed or missing at startup: every team gets blocked:true, team agents' tmux sessions are killed, AUTONOMOUS agents are unaffected, team create/add/remove return HTTP 400.", keywords: blocking_cascade teams_blocked_true_in_teams_json team_agents_tmux_sessions_killed hibernated_after_removing_MANAGER AUTONOMOUS_agents_unaffected team_creation_rejected_HTTP_400 agent_add_remove_on_team_rejected MANAGER_removed_trigger startup_manager_check blockAllTeams team_agents_got_hibernated, ocd: 2026-08-02, lmd: 2026-10-02]
1. All teams get `blocked: true` in teams.json
2. All agents belonging to those teams have their tmux sessions killed (hibernated)
3. AUTONOMOUS agents are unaffected
4. Team creation, agent add/remove on teams are rejected with HTTP 400

## Unblocking (triggered when MANAGER assigned)

^SHENK8ER [desc: "Assigning a MANAGER sets every team to blocked:false but agents stay hibernated until the user or MANAGER wakes them manually.", keywords: unblocking_teams MANAGER_assigned_unblocks teams_blocked_false agents_remain_hibernated wake_manually_after_unblock user_or_MANAGER_must_wake unblockAllTeams ChangeTitle_Gate_13 team_agents_still_hibernated_after_assign_MANAGER wake_hibernated_team_agents after_MANAGER_assignment, ocd: 2026-08-02, lmd: 2026-10-02]
1. All teams get `blocked: false`
2. Agents remain hibernated — user or MANAGER must wake them manually

## Agent lifecycle governance (wake/hibernate/restart)

^GANCDSVF [desc: "Who may wake/hibernate/restart agents: user any; MANAGER any; CHIEF-OF-STAFF own team agents only; any other agent denied 403; team agents cannot be woken when no MANAGER exists.", keywords: who_can_wake_hibernate_restart_a_team_agent agent_lifecycle_governance wake_hibernate_restart_authorization CHIEF_OF_STAFF_own_team_only auth_agentId_equals_managerId other_agents_HTTP_403 cannot_wake_team_agent_even_as_the_user assign_MANAGER_first wake_route_manager_gate hibernate_route_manager_gate team_chiefOfStaffId_check, ocd: 2026-08-02, lmd: 2026-10-02]
| Caller | Scope | Enforced at |
|--------|-------|-------------|
| User (web UI) | Any agent | Always allowed |
| MANAGER | Any agent | `auth.agentId === managerId` |
| CHIEF-OF-STAFF | Own team agents only | `team.chiefOfStaffId === auth.agentId && team.agentIds.includes(targetId)` |
| Any other agent | Denied | HTTP 403 |

Team agents cannot be woken when no MANAGER exists (even by the user — assign MANAGER
first).

## Key files

^BJLWGVL2 [desc: "Where manager-gating lives: team-registry blockAllTeams/unblockAllTeams, ChangeTitle Gates 10 and 13, server.mjs startup check, wake/hibernate routes, GOVERNANCE-RULES R9-R11.", keywords: manager_gate_key_files lib_team_registry_ts blockAllTeams_unblockAllTeams isAgentInAnyTeam ChangeTitle_Gate_10_block_on_manager_removal ChangeTitle_Gate_13_unblock_on_manager_assignment server_mjs_startup_manager_check api_agents_id_wake_route api_agents_id_hibernate_route GOVERNANCE_RULES_R9_R10_R11 where_is_manager_gating_implemented, ocd: 2026-08-02, lmd: 2026-10-02]
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
