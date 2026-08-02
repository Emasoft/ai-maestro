---
name: element-management-service
description: "where do plugin and agent-property mutations go through / why can't I write enabledPlugins directly / which pipeline handles ChangeTitle ChangePlugin ChangeTeam ChangeClient / PATCH /api/agents/id router dispatch / centralized gateway for element mutations"
ocd: 2026-08-02
lmd: 2026-08-02
metadata:
  node_type: memory
  type: reference
  tier: component
---

# element-management-service

`services/element-management-service.ts` is the single gateway every plugin/element/
agent-property mutation must go through — no other code may directly write to
`enabledPlugins`, call the `claude plugin` CLI, or delete element files.

All plugin/element/agent-property mutations go through
`services/element-management-service.ts`. This is the centralized gateway — no other code may
directly write to `enabledPlugins`, call `claude plugin` CLI, or delete element files.

**Key functions:**
- `ChangeTitle(agentId, newTitle)` — 23-gate pipeline for governance title lifecycle
- `ChangePlugin(agentId, desired)` — 13-gate pipeline for plugin install/uninstall/enable/disable
- `ChangeSkill`, `ChangeAgentDef`, `ChangeCommand`, `ChangeRule`, `ChangeOutputStyle`,
  `ChangeMCP`, `ChangeLSP`, `ChangeHook` — Element-specific pipelines
- `ChangeTeam(agentId, desired)` — Team membership with auto-title transitions
- `ChangeClient(agentId, newClient)` — Client change with full plugin re-emission (see the
  `cross-client-conversion` page for the R18 pipeline)
- `ChangeName`, `ChangeFolder`, `ChangeAvatar`, `ChangeCLIArgs` — Agent property pipelines

The PATCH `/api/agents/{id}` route is a router that dispatches to the appropriate Change*
function based on which fields are in the body.

## See also

## Notes and lessons learned
