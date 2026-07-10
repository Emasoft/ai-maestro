/**
 * Agents Subconscious Service
 *
 * Business logic for agent subconscious status and control.
 * Routes are thin wrappers that call these functions.
 */

import { agentRegistry } from '@/lib/agent'
import { getAgent as getAgentRecord } from '@/lib/agent-registry'
import { ServiceResult } from '@/types/service'
import type { AuthContext } from '@/lib/agent-auth'
// NT-006: ServiceResult re-export removed — import directly from @/types/service

// ── Public Functions ────────────────────────────────────────────────────────

/**
 * Get the subconscious status for an agent. Reads; never loads.
 *
 * TRDD-70a521d9 Phase 1: memory-shaped fields (lastMemoryRun, totalMemoryRuns,
 * cumulativeMessagesIndexed, memoryStats, consolidation, etc.) were removed
 * when the subconscious stopped driving the RAG memory subsystem.
 *
 * TRDD-YEE33F3A — object-level authz (defence-in-depth). An agent may read its
 * own status; the system owner (dashboard) may read any. No authContext →
 * internal caller, route guard is authoritative.
 *
 * The two lookups are deliberately different registries, because the two
 * questions are different:
 *
 *   - "does this agent exist?"  → the FILE registry, the source of truth. An
 *     agent exists whether or not it is loaded in memory.
 *   - "is it loaded right now?" → `getExistingAgent`, a Map.get + LRU touch.
 *
 * It must NOT be `agentRegistry.getAgent()`. That constructs an Agent for any
 * id, runs `initialize()` (cerebellum → subconscious `start()` → a config-change
 * timer, a hostHints subscription, and an `mkdir` + `status.json` write under
 * `~/.aimaestro/agents/<id>/`), and calls `evictIfNeeded()` first — shutting
 * down the least-recently-used real agent to make room. The dashboard indicator
 * polls this route every 30s, so the endpoint that REPORTS whether a subconscious
 * is running was the thing STARTING it, and evicting a live agent per request
 * once the registry hit its cap of 10. `exists`/`initialized` were hardcoded
 * `true` for the same reason: after the construct they could not be anything else.
 */
export async function getSubconsciousStatus(
  agentId: string,
  authContext?: AuthContext,
): Promise<ServiceResult<Record<string, unknown>>> {
  if (authContext && !authContext.isSystemOwner) {
    if (!authContext.agentId || authContext.agentId !== agentId) {
      return { error: 'Forbidden — you may only read your own subconscious status', status: 403 }
    }
  }

  if (!getAgentRecord(agentId)) {
    return { error: 'Agent not found', status: 404 }
  }

  const agent = agentRegistry.getExistingAgent(agentId)
  const status = agent?.getSubconscious()?.getStatus() || null

  return {
    data: {
      success: true,
      exists: true,
      initialized: agent !== undefined,
      isRunning: status?.isRunning || false,
      isWarmingUp: false,
      status: status ? {
        startedAt: status.startedAt,
        messageCheckInterval: status.messageCheckInterval,
        lastMessageRun: status.lastMessageRun,
        lastMessageResult: status.lastMessageResult,
        totalMessageRuns: status.totalMessageRuns,
        // TRDD-7123d51a — surface the config-change tracker so callers
        // (Diagnostics panel, /api/agents/[id]/subconscious) can render
        // per-agent drift without loading the agent into memory.
        configTracker: status.configTracker ?? null,
      } : null,
    },
    status: 200
  }
}

/*
 * `triggerSubconsciousAction` was DELETED (TRDD-YEE33F3A).
 *
 * TRDD-70a521d9 Phase 1 removed the `consolidate` action along with the RAG
 * memory subsystem, leaving a function that returned `Unknown action` — status
 * 400 — for EVERY possible input. It was kept "only so clients that shipped
 * with the old action names get a structured 400 instead of a 404". That is
 * backward-compatibility scaffolding for callers that cannot succeed, and this
 * project keeps exactly one version of the code.
 *
 * It had zero callers, yet it sat on the dangerous-primitive debt ledger as an
 * unauthorized route that "drives another agent's background process" — a
 * description taken from its NAME. Its only real side effect was the
 * `agentRegistry.getAgent()` construct-and-evict, which this service no longer
 * performs on any path (see `getSubconsciousStatus`).
 *
 * So the answer to "which AuthAction does POST /subconscious need?" is: none.
 * The endpoint is gone. A stale client now gets 405 instead of 400; both are
 * errors, and one of them is no longer an unauthorized route.
 */
