/**
 * Subconscious Status Types
 *
 * The subconscious system runs background processes for each agent:
 * - Message checking (legacy polling — disabled by default, replaced by push notifications)
 * - Activity state tracking
 * - status.json lifecycle write-out for the dashboard
 *
 * Memory-specific fields were removed in TRDD-70a521d9 Phase 1.
 */

/**
 * Result from a message check run
 */
export interface MessageCheckResult {
  success: boolean
  unreadCount?: number
  error?: string
}

/**
 * Status details for a running subconscious process
 */
export interface SubconsciousProcessStatus {
  startedAt: number | null
  messageCheckInterval: number
  lastMessageRun: number | null
  lastMessageResult: MessageCheckResult | null
  totalMessageRuns: number
}

/**
 * Per-agent subconscious status
 * Returned by GET /api/agents/[id]/subconscious
 */
export interface AgentSubconsciousStatus {
  success: boolean
  exists: boolean
  initialized: boolean
  isRunning: boolean
  isWarmingUp: boolean
  status: SubconsciousProcessStatus | null
}

/**
 * Summary of an agent's subconscious for global aggregation
 */
export interface AgentSubconsciousSummary {
  agentId: string
  isRunning: boolean
  initialized: boolean
  isWarmingUp: boolean
  status: Omit<SubconsciousProcessStatus, 'startedAt' | 'messageCheckInterval'> | null
}

/**
 * Global aggregated subconscious status
 * Returned by GET /api/subconscious
 */
export interface GlobalSubconsciousStatus {
  success: boolean
  discoveredAgents: number
  activeAgents: number
  runningSubconscious: number
  isWarmingUp: boolean
  totalMessageRuns: number
  lastMessageRun: number | null
  lastMessageResult: MessageCheckResult | null
  agents: Array<{
    agentId: string
    status: {
      isRunning: boolean
      lastMessageRun: number | null
      lastMessageResult: MessageCheckResult | null
      totalMessageRuns: number
    } | null
  }>
}
