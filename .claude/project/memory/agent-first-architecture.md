---
name: agent-first-architecture
description: "why is data.governanceTitle always undefined / agent API response nesting bug / do agents need a tmux session / where does ai-maestro store agent workingDirectory / difference between lib/agent-registry.ts and lib/agent.ts / does the subconscious need remote API calls / why is checkMessages disabled by default"
ocd: 2026-08-02
lmd: 2026-09-29
metadata:
  node_type: memory
  type: reference
  tier: component
  topic: agents
publish-globally: false
---

# agent-first-architecture

## Agent-First Architecture (CRITICAL)

^TSZT5G0A [desc: "Agents are the core entity in ai-maestro; sessions are optional properties — an agent can exist with zero tmux sessions, and the entity tree hangs every property off the agent record.", keywords: agent_first_architecture agents_are_the_core_entity sessions_are_optional_properties can_an_agent_exist_without_a_session agent_entity_tree_model what_is_the_core_entity sessions_optional_not_required, ocd: 2026-08-02, lmd: 2026-09-29]
**AGENTS ARE THE CORE ENTITY.** Sessions are optional properties of agents.

```
Agent (core entity)
├── id (UUID)
├── name (agent identity, used as session name)
├── label (optional display override)
├── workingDirectory (stored property, NOT derived from tmux)
├── sessions[] (array of AgentSession, typically 0 or 1)
│   ├── index (0 for primary session)
│   ├── status ('online' | 'offline')
│   └── workingDirectory (optional override)
└── preferences.defaultWorkingDirectory
```

^DLSHXR42 [desc: "Four agent-first principles: agents can exist without sessions; workingDirectory is stored on the agent; never query tmux to derive properties; sessions are linked to existing agents, not derived.", keywords: agent_first_key_principles never_query_tmux_for_agent_data workingDirectory_stored_not_derived sessions_linked_to_existing_agents agent_registry_source_of_truth derive_agent_properties_from_tmux sessions_discovered_and_linked, ocd: 2026-08-02, lmd: 2026-09-29]
**Key principles:**
1. **Agents can exist without sessions** - An agent for querying repos/documents doesn't need a tmux session
2. **workingDirectory is STORED on the agent** - Set when agent is created or session is linked
3. **NEVER query tmux to derive agent properties** - All agent data comes from the registry
4. **Sessions are discovered and LINKED to existing agents** - Not the other way around

^QHB6Y3P4 [desc: "Two agent systems: lib/agent-registry.ts is the file-based registry (registry.json) holding full metadata; lib/agent.ts is the in-memory runtime class. Use the registry for metadata.", keywords: two_agent_systems lib_agent_registry_ts_vs_lib_agent_ts which_file_holds_agent_metadata agent_registry_json_location in_memory_agent_class_runtime getAgent_getAgentBySession how_to_read_agent_workingDirectory_in_code, ocd: 2026-08-02, lmd: 2026-09-29]
**Two agent systems:**
- **`lib/agent-registry.ts`** - File-based registry (`~/.aimaestro/agents/registry.json`) with full agent metadata
- **`lib/agent.ts`** - In-memory Agent class for runtime (database, subconscious)

When you need agent metadata (workingDirectory, etc.), use the file-based registry:
```typescript
import { getAgent, getAgentBySession } from '@/lib/agent-registry'
const agent = getAgent(agentId) || getAgentBySession(sessionName)
const workingDir = agent?.workingDirectory || agent?.sessions?.[0]?.workingDirectory
```

^S0Y805QC [desc: "DO-NOT list for agent data: never query tmux for working directories, never derive properties from tmux session state, never assume an agent has a session, never build runtime lookups for stored data.", keywords: agent_data_do_not_list query_tmux_for_working_directory_derive_agent_properties_from_session_state assume_agent_always_has_session runtime_lookup_for_stored_data anti_pattern_agent_properties, ocd: 2026-08-02, lmd: 2026-09-29]
**DO NOT:**
- Query tmux to get working directories
- Derive agent properties from tmux session state
- Assume an agent always has a session
- Create runtime lookups for data that should be stored

^DTLVX9ZT [desc: "The subconscious runs LOCAL to the agent's machine - direct access to conversation files, CozoDB, and the filesystem; no remote API calls, so index-delta reads .jsonl straight from disk.", keywords: subconscious_runs_local_same_machine_as_agent no_remote_api_calls_needed index_delta_reads_jsonl_directly subconscious_coardb_local_access where_does_subconscious_run conversation_files_local, ocd: 2026-08-02, lmd: 2026-09-29]
**Subconscious runs LOCAL to the agent:**

The subconscious process runs on the **same machine where the agent lives**. This means it has direct access to:
- Local conversation files (`~/.claude/projects/`)
- The agent's CozoDB database (`~/.aimaestro/agents/<id>/`)
- The local file system (workingDirectory, repos, etc.)

The subconscious does NOT need remote API calls to access agent data - everything is local. This is why `index-delta` can read `.jsonl` files directly from disk.

^NMDXS703 [desc: "Subconscious timers post-TRDD-70a521d9: RAG memory maintenance removed once Claude Code shipped built-in memory; only checkMessages() remains, DISABLED by default (push notifications replace polling).", keywords: subconscious_timers_checkMessages_disabled_by_default RAG_memory_maintenance_removed maintainMemory_triggerConsolidation_removed TRDD_70a521d9 messagePollingEnabled re_enable_message_polling push_notifications_replace_polling, ocd: 2026-08-02, lmd: 2026-09-29]
**Subconscious timers (v0.29+ / post-RAG removal per TRDD-70a521d9):**
- `checkMessages()` - **DISABLED by default** (push notifications replace polling)

The RAG-based memory maintenance (`maintainMemory()` + nightly `triggerConsolidation()`) was removed in Phase 1 of TRDD-70a521d9 once Claude Code shipped first-class built-in memory. Only message polling remains, and it stays off by default. To re-enable polling (not recommended), set `messagePollingEnabled: true` in the subconscious config.

## Agent API Response Nesting — ALWAYS use `.agent.field`

^69H0B4UV [desc: "GET /api/agents/{id} nests all data under .agent - reading data.governanceTitle directly is ALWAYS undefined; always read data.agent?.field (title changes once looked failed while server saved them).", keywords: agent_api_response_nesting data_governanceTitle_always_undefined GET_api_agents_id_returns_agent_object title_change_fails_silently read_data_agent_field data_agent_workingDirectory agent_api_nested_payload, ocd: 2026-08-02, lmd: 2026-09-29]
**CRITICAL:** `GET /api/agents/{id}` returns `{ agent: { id, name, role, governanceTitle, ... } }` — the data is nested under `.agent`. NEVER read fields directly from the response object.

```typescript
// ✅ CORRECT
const data = await res.json()
const title = data.agent?.governanceTitle
const workDir = data.agent?.workingDirectory

// ❌ WRONG — silently returns undefined, causes fallback to defaults
const title = data?.governanceTitle  // ALWAYS undefined!
```

This caused a critical bug where `governanceTitle` was always null, making title changes appear to fail silently (the server saved the title correctly, but the UI never read it back).

## See also

## Notes and lessons learned

[^1]: [id:ATOM-AFA1-TR01, status:active, keywords:"governanceTitle_always_undefined agent_api_response_nesting_bug title_change_fails_silently", ocd:2026-08-02, lmd:2026-08-02]
    DO NOT read fields directly off a `GET /api/agents/{id}` response object, BECAUSE the payload
    nests all agent data under `.agent` and a top-level read silently returns `undefined`. DO
    read via `data.agent?.field` — this exact bug once made `governanceTitle` look permanently
    null while the server had saved it correctly.
