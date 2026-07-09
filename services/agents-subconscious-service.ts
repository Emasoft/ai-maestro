/**
 * Agents Subconscious Service
 *
 * Business logic for agent subconscious status and control.
 * Routes are thin wrappers that call these functions.
 */

import { agentRegistry } from '@/lib/agent'
import { ServiceResult } from '@/types/service'
import type { AuthContext } from '@/lib/agent-auth'
// NT-006: ServiceResult re-export removed — import directly from @/types/service

// ── Public Functions ────────────────────────────────────────────────────────

/**
 * Get the subconscious status for an agent.
 * This will initialize the agent if it doesn't exist yet.
 *
 * TRDD-70a521d9 Phase 1: memory-shaped fields (lastMemoryRun, totalMemoryRuns,
 * cumulativeMessagesIndexed, memoryStats, consolidation, etc.) were removed
 * when the subconscious stopped driving the RAG memory subsystem.
 *
 * TRDD-YEE33F3A — object-level authz (defence-in-depth). Reading this looks
 * harmless, but `agentRegistry.getAgent()` CONSTRUCTS and initializes an
 * in-memory Agent for whatever id it is handed, and calls `evictIfNeeded()`
 * first — so a caller sweeping arbitrary UUIDs evicts live agents from the
 * registry. That is the only real primitive on this route, and it was reachable
 * with no auth call at all. An agent may read its own status; the system owner
 * (dashboard) may read any. No authContext → internal caller, route guard is
 * authoritative.
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

  const agent = await agentRegistry.getAgent(agentId)
  if (!agent) {
    return { error: 'Agent not found', status: 404 }
  }

  const subconscious = agent.getSubconscious()
  const status = subconscious?.getStatus() || null

  return {
    data: {
      success: true,
      exists: true,
      initialized: true,
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
 * `agentRegistry.getAgent()` construct-and-evict documented above.
 *
 * So the answer to "which AuthAction does POST /subconscious need?" is: none.
 * The endpoint is gone. A stale client now gets 405 instead of 400; both are
 * errors, and one of them is no longer an unauthorized route.
 */
