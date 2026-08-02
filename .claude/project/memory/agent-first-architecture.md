---
name: agent-first-architecture
description: "why is data.governanceTitle always undefined / agent API response nesting bug / do agents need a tmux session / where does ai-maestro store agent workingDirectory / difference between lib/agent-registry.ts and lib/agent.ts / does the subconscious need remote API calls / why is checkMessages disabled by default"
ocd: 2026-08-02
lmd: 2026-08-02
metadata:
  node_type: memory
  type: reference
  tier: component
---

# agent-first-architecture

## Agent-First Architecture (CRITICAL)

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

**Key principles:**
1. **Agents can exist without sessions** - An agent for querying repos/documents doesn't need a tmux session
2. **workingDirectory is STORED on the agent** - Set when agent is created or session is linked
3. **NEVER query tmux to derive agent properties** - All agent data comes from the registry
4. **Sessions are discovered and LINKED to existing agents** - Not the other way around

**Two agent systems:**
- **`lib/agent-registry.ts`** - File-based registry (`~/.aimaestro/agents/registry.json`) with full agent metadata
- **`lib/agent.ts`** - In-memory Agent class for runtime (database, subconscious)

When you need agent metadata (workingDirectory, etc.), use the file-based registry:
```typescript
import { getAgent, getAgentBySession } from '@/lib/agent-registry'
const agent = getAgent(agentId) || getAgentBySession(sessionName)
const workingDir = agent?.workingDirectory || agent?.sessions?.[0]?.workingDirectory
```

**DO NOT:**
- Query tmux to get working directories
- Derive agent properties from tmux session state
- Assume an agent always has a session
- Create runtime lookups for data that should be stored

**Subconscious runs LOCAL to the agent:**

The subconscious process runs on the **same machine where the agent lives**. This means it has direct access to:
- Local conversation files (`~/.claude/projects/`)
- The agent's CozoDB database (`~/.aimaestro/agents/<id>/`)
- The local file system (workingDirectory, repos, etc.)

The subconscious does NOT need remote API calls to access agent data - everything is local. This is why `index-delta` can read `.jsonl` files directly from disk.

**Subconscious timers (v0.29+ / post-RAG removal per TRDD-70a521d9):**
- `checkMessages()` - **DISABLED by default** (push notifications replace polling)

The RAG-based memory maintenance (`maintainMemory()` + nightly `triggerConsolidation()`) was removed in Phase 1 of TRDD-70a521d9 once Claude Code shipped first-class built-in memory. Only message polling remains, and it stays off by default. To re-enable polling (not recommended), set `messagePollingEnabled: true` in the subconscious config.

## Agent API Response Nesting — ALWAYS use `.agent.field`

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
