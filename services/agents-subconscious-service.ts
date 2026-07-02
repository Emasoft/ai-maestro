/**
 * Agents Subconscious Service
 *
 * Business logic for agent subconscious status and control.
 * Routes are thin wrappers that call these functions.
 */

import { agentRegistry } from '@/lib/agent'
import { ServiceResult } from '@/types/service'
// NT-006: ServiceResult re-export removed — import directly from @/types/service

// ── Public Functions ────────────────────────────────────────────────────────

/**
 * Get the subconscious status for an agent.
 * This will initialize the agent if it doesn't exist yet.
 *
 * TRDD-70a521d9 Phase 1: memory-shaped fields (lastMemoryRun, totalMemoryRuns,
 * cumulativeMessagesIndexed, memoryStats, consolidation, etc.) were removed
 * when the subconscious stopped driving the RAG memory subsystem.
 */
export async function getSubconsciousStatus(agentId: string): Promise<ServiceResult<Record<string, unknown>>> {
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

/**
 * Trigger subconscious actions.
 *
 * TRDD-70a521d9 Phase 1: the `consolidate` action was removed with the
 * RAG memory subsystem. Remaining actions are no-ops that exist only so
 * clients that shipped with the old action names get a structured 400
 * instead of a 404 on the whole route.
 */
export async function triggerSubconsciousAction(
  agentId: string,
  action: string
): Promise<ServiceResult<Record<string, unknown>>> {
  // SF-028: Check agent exists before accessing subconscious
  const agent = await agentRegistry.getAgent(agentId)
  if (!agent) {
    return { error: 'Agent not found', status: 404 }
  }
  const subconscious = agent.getSubconscious()

  if (!subconscious) {
    return { error: 'Subconscious not initialized', status: 400 }
  }

  return { error: `Unknown action: ${action}`, status: 400 }
}
