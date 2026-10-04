---
name: element-management-service
description: "where do plugin and agent-property mutations go through / why can't I write enabledPlugins directly / which pipeline handles ChangeTitle ChangePlugin ChangeTeam ChangeClient / PATCH /api/agents/id router dispatch / centralized gateway for element mutations"
ocd: 2026-08-02
lmd: 2026-10-02
metadata:
  node_type: memory
  type: reference
  tier: component
  topic: plugins-and-marketplaces
publish-globally: false
---

# element-management-service

^7925BGAT [desc: "element-management-service.ts is the single gateway for every plugin/element/agent-property mutation; no other code may write enabledPlugins, call the claude plugin CLI, or delete element files.", keywords: where_do_plugin_mutations_go element_management_service_gateway write_enabledPlugins_directly claude_plugin_CLI_call_forbidden delete_element_files_forbidden centralized_gateway_element_mutations single_gateway_services_element_management_service_ts plugin_agent_property_mutations no_direct_enabledPlugins_write mutation_pipeline_entry_point services_layer_rule, ocd: 2026-08-02, lmd: 2026-10-02]
`services/element-management-service.ts` is the single gateway every plugin/element/
agent-property mutation must go through — no other code may directly write to
`enabledPlugins`, call the `claude plugin` CLI, or delete element files.

All plugin/element/agent-property mutations go through
`services/element-management-service.ts`. This is the centralized gateway — no other code may
directly write to `enabledPlugins`, call `claude plugin` CLI, or delete element files.

^2B5TPK65 [desc: "The Change* pipelines in element-management-service: ChangeTitle (23 gates), ChangePlugin (13 gates), element-specific Change*, ChangeTeam, ChangeClient and agent-property pipelines.", keywords: ChangeTitle_23_gate_pipeline ChangePlugin_13_gate_pipeline ChangeSkill_ChangeAgentDef_ChangeCommand ChangeRule_ChangeOutputStyle ChangeMCP_ChangeLSP_ChangeHook ChangeTeam_auto_title_transitions ChangeClient_plugin_re_emission ChangeName_ChangeFolder_ChangeAvatar_ChangeCLIArgs which_pipeline_handles_ChangeTitle governance_title_lifecycle_pipeline cross_client_conversion_R18, ocd: 2026-08-02, lmd: 2026-10-02]
**Key functions:**
- `ChangeTitle(agentId, newTitle)` — 23-gate pipeline for governance title lifecycle
- `ChangePlugin(agentId, desired)` — 13-gate pipeline for plugin install/uninstall/enable/disable
- `ChangeSkill`, `ChangeAgentDef`, `ChangeCommand`, `ChangeRule`, `ChangeOutputStyle`,
  `ChangeMCP`, `ChangeLSP`, `ChangeHook` — Element-specific pipelines
- `ChangeTeam(agentId, desired)` — Team membership with auto-title transitions
- `ChangeClient(agentId, newClient)` — Client change with full plugin re-emission (see the
  `cross-client-conversion` page for the R18 pipeline)
- `ChangeName`, `ChangeFolder`, `ChangeAvatar`, `ChangeCLIArgs` — Agent property pipelines

^VH8KD774 [desc: "PATCH /api/agents/{id} is a router: it dispatches to the matching Change* function according to which fields appear in the request body.", keywords: PATCH_api_agents_id_router router_dispatch_Change_functions which_fields_in_body dispatch_by_body_fields agent_property_PATCH_route PATCH_agents_id_dispatch ChangeTitle_ChangePlugin_ChangeTeam_ChangeClient route_to_pipeline element_management_gateway_route PATCH_body_field_routing router_not_handler, ocd: 2026-08-02, lmd: 2026-10-02]
The PATCH `/api/agents/{id}` route is a router that dispatches to the appropriate Change*
function based on which fields are in the body.

## See also

## Notes and lessons learned
