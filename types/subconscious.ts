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
 * Config-change tracker status (TRDD-7123d51a).
 *
 * Reported from the subconscious on every heartbeat so the Diagnostics
 * panel + GET /api/agents/[id]/subconscious can surface the drift count
 * and the subpaths that last changed. `driftCountSinceStart` resets on
 * each AgentSubconscious.start() — it counts ledger-emitted drifts, not
 * scan attempts.
 */
export interface ConfigTrackerStatus {
  intervalMs: number
  lastScanAt: number | null
  driftCountSinceStart: number
  lastDriftAt: number | null
  /**
   * Short sub-tree names that drifted on the most recent tick (e.g.
   * `['skills', 'settings']`). Capped at 32 entries so the status file
   * can't balloon on a pathological agent.
   */
  lastDriftPaths: string[]
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
  /** TRDD-7123d51a — populated when the config-change tracker is active. */
  configTracker?: ConfigTrackerStatus
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
