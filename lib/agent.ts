/**
 * Agent - The core abstraction for autonomous agents
 *
 * An Agent is a cognitive entity that:
 * - Maintains its own database (legacy CozoDB — being retired with TRDD-70a521d9)
 * - Has a subconscious that tracks activity state and writes a status file
 * - Operates independently without central coordination
 *
 * Philosophy:
 * - Subconscious runs in the background, mirroring lifecycle + activity without
 *   conscious effort. It no longer drives the RAG memory subsystem.
 * - Each agent is truly autonomous and self-sufficient.
 */

import { hostHints } from './host-hints'
import { getAgent as getAgentFromRegistry } from './agent-registry'
import { getSelfHost } from './hosts-config'
import { computeSessionName } from '@/types/agent'
import { Cerebellum } from './cerebellum/cerebellum'
import { SubconsciousSubsystem } from './cerebellum/subconscious-subsystem'
import { VoiceSubsystem } from './cerebellum/voice-subsystem'

import * as fs from 'fs'
import * as path from 'path'
import { statePath } from '@/lib/ecosystem-constants'

// Get this host's API base URL from configuration
// NEVER returns localhost - getSelfHost() already handles IP detection
function getSelfApiBase(): string {
  const selfHost = getSelfHost()
  // selfHost.url should always be a real IP from hosts-config
  // If somehow undefined, use hostname (never localhost)
  if (selfHost?.url) {
    return selfHost.url
  }
  // Absolute fallback - use hostname, never localhost
  const hostname = require('os').hostname().toLowerCase()
  return `http://${hostname}:23000`
}

interface AgentConfig {
  agentId: string
  workingDirectory?: string
}

interface SubconsciousConfig {
  messageCheckInterval?: number // How often to check for messages (default: 5 minutes) - DEPRECATED
  messagePollingEnabled?: boolean // Enable message polling (default: false - use push notifications instead)
}

// Type for host hints (optional optimization from AI Maestro host)
export type HostHintType = 'run_now' | 'skip' | 'idle_transition'

export interface HostHint {
  type: HostHintType
  agentId: string
  timestamp: number
}

/**
 * Agent Subconscious
 *
 * Runs in the background for each agent, tracking activity state,
 * writing a status file the dashboard can read without loading the agent
 * into memory, and (optionally, deprecated) polling for new messages.
 *
 * TRDD-70a521d9 Phase 1 detached the RAG memory callbacks — no more
 * maintainMemory, scheduleConsolidation, runConsolidation. The timer
 * infrastructure remains for message polling + lifecycle.
 */
interface SubconsciousStatus {
  isRunning: boolean
  startedAt: number | null
  messageCheckInterval: number
  messagePollingEnabled: boolean  // false = using push notifications (default)
  activityState: 'active' | 'idle' | 'disconnected'
  staggerOffset: number
  lastMessageRun: number | null
  lastMessageResult: {
    success: boolean
    unreadCount?: number
    error?: string
  } | null
  totalMessageRuns: number
}

// Static counter for staggering initial runs across all agents
let subconsciousInstanceCount = 0

class AgentSubconscious {
  private agentId: string
  private agent: Agent
  private messageTimer: NodeJS.Timeout | null = null
  private isRunning = false
  private messageCheckInterval: number
  private staggerOffset: number

  // Activity state (purely informational after Phase 1 — no interval impact)
  private activityState: 'active' | 'idle' | 'disconnected' = 'disconnected'

  // Status tracking
  private startedAt: number | null = null
  private lastMessageRun: number | null = null
  private lastMessageResult: SubconsciousStatus['lastMessageResult'] = null
  private totalMessageRuns = 0

  // Message polling (deprecated - use push notifications instead)
  private messagePollingEnabled: boolean

  constructor(agentId: string, agent: Agent, config: SubconsciousConfig = {}) {
    this.agentId = agentId
    this.agent = agent
    this.messageCheckInterval = config.messageCheckInterval || 5 * 60 * 1000  // 5 minutes (deprecated)
    // Message polling is DISABLED by default - use push notifications instead (RFC: Message Delivery Notifications)
    // Explicitly requires config.messagePollingEnabled === true to enable; any other value (undefined, false) keeps it disabled.
    this.messagePollingEnabled = config.messagePollingEnabled === true
    // Bump the static counter (kept for logging symmetry with older logs)
    subconsciousInstanceCount++
    // Calculate stagger offset based on agentId hash (consistent across restarts)
    this.staggerOffset = this.calculateStaggerOffset()
  }

  /**
   * Calculate stagger offset based on agentId hash
   * This ensures consistent spreading of agents across time
   */
  private calculateStaggerOffset(): number {
    // Hash the agentId to get a consistent number
    const hash = this.agentId.split('').reduce(
      (acc, char) => char.charCodeAt(0) + ((acc << 5) - acc), 0
    )
    // Spread across 5 minutes (300 seconds) to avoid clustering
    const maxOffset = 5 * 60 * 1000 // 5 minutes
    return Math.abs(hash) % maxOffset
  }

  /**
   * Start the subconscious processes
   */
  start() {
    if (this.isRunning) {
      console.log(`[Agent ${this.agentId.substring(0, 8)}] Subconscious already running`)
      return
    }

    console.log(`[Agent ${this.agentId.substring(0, 8)}] 🧠 Starting subconscious...`)
    console.log(`[Agent ${this.agentId.substring(0, 8)}]   - Stagger offset: ${Math.round(this.staggerOffset / 1000)}s`)
    console.log(`[Agent ${this.agentId.substring(0, 8)}]   - Message polling: ${this.messagePollingEnabled ? 'enabled (legacy)' : 'disabled (using push notifications)'}`)

    // Message polling is DEPRECATED - push notifications handle this at delivery time
    // Only enable polling if explicitly configured (for backwards compatibility)
    if (this.messagePollingEnabled) {
      console.log(`[Agent ${this.agentId.substring(0, 8)}]   - Message interval: ${this.messageCheckInterval / 60000} min`)

      // Run first message check immediately (lightweight, no stagger needed)
      this.checkMessages().catch(err => {
        console.error(`[Agent ${this.agentId.substring(0, 8)}] Initial message check failed:`, err)
      })

      // Start periodic message checking
      this.messageTimer = setInterval(() => {
        this.checkMessages().catch(err => {
          console.error(`[Agent ${this.agentId.substring(0, 8)}] Message check failed:`, err)
        })
      }, this.messageCheckInterval)
    }

    this.isRunning = true
    this.startedAt = Date.now()

    // Subscribe to host hints (optional optimization)
    // If host hints aren't available, agent continues running with its own timers
    try {
      hostHints.subscribe(this.agentId, (hint) => this.handleHostHint(hint))
      console.log(`[Agent ${this.agentId.substring(0, 8)}] ✓ Subscribed to host hints`)
    } catch (e) {
      // Host hints not available - agent runs independently (this is fine)
      console.log(`[Agent ${this.agentId.substring(0, 8)}] Host hints not available - running autonomously`)
    }

    console.log(`[Agent ${this.agentId.substring(0, 8)}] ✓ Subconscious running`)

    // Write initial status file
    this.writeStatusFile()
  }

  /**
   * Stop the subconscious
   */
  stop() {
    if (this.messageTimer) {
      clearInterval(this.messageTimer)
      this.messageTimer = null
    }

    // Unsubscribe from host hints
    try {
      hostHints.unsubscribe(this.agentId)
    } catch {
      // Host hints not available - that's fine
    }

    this.isRunning = false
    console.log(`[Agent ${this.agentId.substring(0, 8)}] Subconscious stopped`)

    // Write final status file (marks as not running)
    this.writeStatusFile()
  }

  /**
   * Check for incoming messages from other agents
   * Agent-first: Always query by agent ID, not session name
   */
  private async checkMessages() {
    this.totalMessageRuns++
    this.lastMessageRun = Date.now()

    try {
      // Query messages directly by agent ID (agent-first architecture)
      const messagesResponse = await fetch(
        `${getSelfApiBase()}/api/messages?agent=${encodeURIComponent(this.agentId)}&box=inbox&status=unread`
      )

      if (messagesResponse.ok) {
        const messagesData = await messagesResponse.json()
        const unreadCount = messagesData.messages?.length || 0

        this.lastMessageResult = { success: true, unreadCount }

        if (unreadCount > 0) {
          console.log(`[Agent ${this.agentId.substring(0, 8)}] 📨 ${unreadCount} unread message(s)`)

          // Try to trigger message check in the agent's terminal if idle
          // Pass message summaries so we can craft a helpful prompt
          await this.triggerMessageCheck(messagesData.messages || [])
        }
      } else {
        this.lastMessageResult = { success: false, error: `HTTP ${messagesResponse.status}` }
      }
    } catch (error) {
      this.lastMessageResult = { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
      console.error(`[Agent ${this.agentId.substring(0, 8)}] Message check error:`, error)
    }

    // Update status file after message check
    this.writeStatusFile()
  }

  /**
   * Find the tmux session name associated with this agent
   * Agent-first: Use the registry agent.name + sessions array to compute session name
   */
  private async findSessionName(): Promise<string | null> {
    try {
      // Agent-first: Get agent from registry
      const registryAgent = getAgentFromRegistry(this.agentId)
      if (!registryAgent) {
        return null
      }

      // Get the agent name (primary identity)
      const agentName = registryAgent.name || (registryAgent as any).alias
      if (!agentName) {
        return null
      }

      // Get list of active tmux sessions
      const sessionsResponse = await fetch(`${getSelfApiBase()}/api/sessions`)
      if (!sessionsResponse.ok) return null

      const data = await sessionsResponse.json()
      const activeSessions = data.sessions || []

      // Check registry sessions to find an active one
      const registrySessions = registryAgent.sessions || []

      for (const regSession of registrySessions) {
        // Compute what the tmux session name should be
        const expectedSessionName = computeSessionName(agentName, regSession.index)

        // Check if this session is active in tmux
        const isActive = activeSessions.some((s: { id?: string; name?: string }) =>
          s.id === expectedSessionName || s.name === expectedSessionName
        )

        if (isActive) {
          return expectedSessionName
        }
      }

      // If no registry sessions, try the base agent name directly
      // This handles agents that may have been created without explicit sessions
      const directMatch = activeSessions.find((s: { id?: string; name?: string }) =>
        s.id === agentName || s.name === agentName
      )

      if (directMatch) {
        return directMatch.id || directMatch.name
      }

      return null
    } catch {
      return null
    }
  }

  /**
   * Trigger message notification in Claude Code's prompt
   * Sends a natural language prompt that Claude will understand and act on
   */
  private async triggerMessageCheck(messages: Array<{
    from?: string
    fromAlias?: string
    fromHost?: string
    subject?: string
    priority?: string
  }>) {
    try {
      // Find the session name for this agent
      const sessionName = await this.findSessionName()
      if (!sessionName) {
        console.log(`[Agent ${this.agentId.substring(0, 8)}] No active session found for message notification`)
        return
      }

      // Helper to format sender info (prefer alias, include host)
      const formatSender = (msg: { from?: string; fromAlias?: string; fromHost?: string }) => {
        const name = msg.fromAlias || msg.from?.substring(0, 8) || 'unknown'
        const host = msg.fromHost ? ` (${msg.fromHost})` : ''
        return `${name}${host}`
      }

      // Craft a natural language prompt for Claude Code
      const unreadCount = messages.length
      let prompt: string

      if (unreadCount === 1) {
        const msg = messages[0]
        const fromInfo = ` from ${formatSender(msg)}`
        const subjectInfo = msg.subject ? ` about "${msg.subject}"` : ''
        const urgentFlag = msg.priority === 'urgent' ? ' [URGENT]' : ''
        prompt = `${urgentFlag}You have a new message${fromInfo}${subjectInfo}. Please check your inbox.`
      } else {
        // Multiple messages - summarize with sender names and hosts
        const urgentCount = messages.filter(m => m.priority === 'urgent').length
        const senderInfos = messages.map(m => formatSender(m))
        const uniqueSenders = [...new Set(senderInfos)].slice(0, 3)
        const sendersInfo = uniqueSenders.length > 0
          ? ` from ${uniqueSenders.join(', ')}${uniqueSenders.length < messages.length ? ' and others' : ''}`
          : ''
        const urgentFlag = urgentCount > 0 ? ` [${urgentCount} URGENT]` : ''
        prompt = `${urgentFlag}You have ${unreadCount} new messages${sendersInfo}. Please check your inbox.`
      }

      // Send the natural language prompt to Claude Code
      const commandResponse = await fetch(
        `${getSelfApiBase()}/api/sessions/${encodeURIComponent(sessionName)}/command`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            command: prompt.trim(),
            requireIdle: true,
            addNewline: true  // Press Enter to submit the prompt to Claude
          })
        }
      )

      if (commandResponse.ok) {
        const result = await commandResponse.json()
        if (result.success) {
          console.log(`[Agent ${this.agentId.substring(0, 8)}] ✓ Sent message notification to Claude (${unreadCount} unread)`)
        }
      } else {
        const result = await commandResponse.json()
        if (result.idle === false) {
          console.log(`[Agent ${this.agentId.substring(0, 8)}] Session busy, skipping message notification`)
        }
      }
    } catch (error) {
      // Silently fail - this is a convenience feature
      console.log(`[Agent ${this.agentId.substring(0, 8)}] Could not send message notification:`, error instanceof Error ? error.message : 'Unknown error')
    }
  }

  /**
   * Set activity state. Called by the host when session activity changes.
   * After TRDD-70a521d9 Phase 1 this only tracks the state value for
   * reporting; it no longer drives any memory-maintenance interval.
   */
  setActivityState(state: 'active' | 'idle' | 'disconnected') {
    const prevState = this.activityState
    if (prevState !== state) {
      console.log(`[Agent ${this.agentId.substring(0, 8)}] Activity: ${prevState} -> ${state}`)
    }
    this.activityState = state
  }

  /**
   * Get current activity state
   */
  getActivityState(): 'active' | 'idle' | 'disconnected' {
    return this.activityState
  }

  /**
   * Handle host hints (optional optimization)
   * Agent works fine without these - they're just optimization hints
   */
  handleHostHint(hint: HostHint) {
    if (hint.agentId !== this.agentId) return

    switch (hint.type) {
      case 'idle_transition':
        // Session just went idle
        console.log(`[Agent ${this.agentId.substring(0, 8)}] Host hint: idle_transition`)
        this.setActivityState('idle')
        // Propagate idle to cerebellum so voice subsystem can trigger
        this.agent.getCerebellum()?.setActivityState('idle')
        break

      case 'run_now':
      case 'skip':
        // Memory maintenance used to react to these hints. After TRDD-70a521d9
        // Phase 1 they are ignored — kept in the switch so the enum is
        // exhaustive and future non-memory subsystems can opt in.
        break
    }
  }

  /**
   * Get subconscious status
   */
  getStatus(): SubconsciousStatus {
    return {
      isRunning: this.isRunning,
      startedAt: this.startedAt,
      messageCheckInterval: this.messageCheckInterval,
      messagePollingEnabled: this.messagePollingEnabled,
      activityState: this.activityState,
      staggerOffset: this.staggerOffset,
      lastMessageRun: this.lastMessageRun,
      lastMessageResult: this.lastMessageResult,
      totalMessageRuns: this.totalMessageRuns,
    }
  }

  /**
   * Write subconscious status to a file for dashboard to read
   * This decouples the dashboard from loading agents into memory
   */
  private writeStatusFile(): void {
    try {
      const statusDir = statePath('agents', this.agentId)
      const statusPath = path.join(statusDir, 'status.json')

      // Ensure directory exists
      if (!fs.existsSync(statusDir)) {
        fs.mkdirSync(statusDir, { recursive: true })
      }

      const status = {
        agentId: this.agentId,
        lastUpdated: Date.now(),
        isRunning: this.isRunning,
        activityState: this.activityState,
        startedAt: this.startedAt,
        messageCheckInterval: this.messageCheckInterval,
        lastMessageRun: this.lastMessageRun,
        lastMessageResult: this.lastMessageResult,
        totalMessageRuns: this.totalMessageRuns,
      }

      fs.writeFileSync(statusPath, JSON.stringify(status, null, 2))
    } catch (error) {
      // Silently fail - status file is convenience, not critical
      console.error(`[Agent ${this.agentId.substring(0, 8)}] Failed to write status file:`, error)
    }
  }
}

// Export the status type
export type { SubconsciousStatus }

/**
 * Agent - The core abstraction for autonomous agents
 */
export class Agent {
  private agentId: string
  private config: AgentConfig
  private subconscious: AgentSubconscious | null = null
  private cerebellum: Cerebellum | null = null
  private initialized = false

  constructor(config: AgentConfig) {
    this.agentId = config.agentId
    this.config = config
  }

  /**
   * Initialize the agent (database + cerebellum with subsystems)
   */
  async initialize(subconsciousConfig?: SubconsciousConfig): Promise<void> {
    if (this.initialized) {
      console.log(`[Agent ${this.agentId.substring(0, 8)}] Already initialized`)
      return
    }

    console.log(`[Agent ${this.agentId.substring(0, 8)}] Initializing...`)

    // Create cerebellum (orchestrates subsystems)
    this.cerebellum = new Cerebellum(this.agentId)

    // Register memory subsystem (wraps existing AgentSubconscious unchanged)
    const agent = this
    const subconsciousSubsystem = new SubconsciousSubsystem(
      () => new AgentSubconscious(this.agentId, agent, subconsciousConfig)
    )
    this.cerebellum.registerSubsystem(subconsciousSubsystem)

    // Register voice subsystem (LLM-powered speech summarization)
    this.cerebellum.registerSubsystem(new VoiceSubsystem())

    // Start all subsystems
    this.cerebellum.start()

    // Backward compat: expose subconscious from subconscious subsystem
    this.subconscious = subconsciousSubsystem.getSubconscious()

    this.initialized = true
    console.log(`[Agent ${this.agentId.substring(0, 8)}] ✓ Initialized`)
  }

  /**
   * Shutdown the agent (stop cerebellum + subsystems, close database)
   */
  async shutdown(): Promise<void> {
    console.log(`[Agent ${this.agentId.substring(0, 8)}] Shutting down...`)

    // Stop cerebellum (stops all subsystems including memory/voice)
    if (this.cerebellum) {
      this.cerebellum.stop()
      this.cerebellum = null
    }
    this.subconscious = null

    this.initialized = false
    console.log(`[Agent ${this.agentId.substring(0, 8)}] ✓ Shutdown complete`)
  }

  /**
   * Get the agent's subconscious (backward compat)
   */
  getSubconscious(): AgentSubconscious | null {
    return this.subconscious
  }

  /**
   * Get the agent's cerebellum (subsystem coordinator)
   */
  getCerebellum(): Cerebellum | null {
    return this.cerebellum
  }

  /**
   * Get agent ID
   */
  getAgentId(): string {
    return this.agentId
  }

  /**
   * Get agent status
   */
  getStatus() {
    return {
      agentId: this.agentId,
      initialized: this.initialized,
      subconscious: this.subconscious?.getStatus() || null,
      cerebellum: this.cerebellum?.getStatus() || null,
    }
  }

  /**
   * Get agent config
   */
  getConfig(): AgentConfig {
    return this.config
  }
}

/**
 * Agent Registry - Manages agent lifecycle with LRU eviction
 *
 * This singleton keeps track of active agents with a maximum limit.
 * When the limit is reached, least recently used agents are evicted
 * (properly shutdown including CozoDB) to prevent memory bloat.
 *
 * Default: max 10 agents in memory at once
 */
class AgentRegistry {
  private agents = new Map<string, Agent>()
  // Tracks agents currently being initialized to prevent duplicate concurrent initialization
  private initializingAgents = new Map<string, Promise<Agent>>()
  private accessOrder: string[] = []  // Most recently accessed at the end
  private maxAgents: number

  constructor(maxAgents = 10) {
    this.maxAgents = maxAgents
    console.log(`[AgentRegistry] Initialized with max ${maxAgents} agents (LRU eviction enabled)`)
  }

  /**
   * Update access order (move to end = most recently used)
   */
  private touch(agentId: string): void {
    const index = this.accessOrder.indexOf(agentId)
    if (index !== -1) {
      this.accessOrder.splice(index, 1)
    }
    this.accessOrder.push(agentId)
  }

  /**
   * Evict least recently used agent if at capacity
   */
  private async evictIfNeeded(): Promise<void> {
    // Track how many candidates we've skipped due to initialization — if we cycle
    // through the entire accessOrder without finding an evictable agent, stop.
    let skippedInitializing = 0
    while (this.agents.size >= this.maxAgents && this.accessOrder.length > 0) {
      const lruAgentId = this.accessOrder.shift()!
      // Do not evict an agent that is currently being initialized — it hasn't been
      // added to this.agents yet, so evicting would leave us over capacity anyway.
      if (this.initializingAgents.has(lruAgentId)) {
        // Put it back so the next iteration can try a different candidate.
        this.accessOrder.push(lruAgentId)
        skippedInitializing++
        // If every entry is initializing we cannot evict; break to avoid an infinite loop.
        if (skippedInitializing >= this.accessOrder.length) {
          break
        }
        continue
      }
      skippedInitializing = 0
      const agent = this.agents.get(lruAgentId)
      if (agent) {
        console.log(`[AgentRegistry] Evicting LRU agent ${lruAgentId.substring(0, 8)} (${this.agents.size}/${this.maxAgents})`)
        try {
          await agent.shutdown()
        } catch (err) {
          console.error(`[AgentRegistry] Error shutting down evicted agent:`, err)
        }
        this.agents.delete(lruAgentId)
      }
    }
  }

  /**
   * Get or create an agent
   */
  async getAgent(agentId: string, config?: AgentConfig, subconsciousConfig?: SubconsciousConfig): Promise<Agent> {
    const existing = this.agents.get(agentId)
    if (existing) {
      // Update access order (touch = mark as recently used)
      this.touch(agentId)
      return existing
    }

    // If initialization is already in progress for this agentId, wait for it instead
    // of creating a second Agent instance — this prevents the race condition where
    // concurrent callers each run agent.initialize() for the same logical agent.
    const inFlight = this.initializingAgents.get(agentId)
    if (inFlight) {
      return inFlight
    }

    // Evict LRU agent if at capacity before creating new one
    await this.evictIfNeeded()

    // Create new agent and register the initialization promise immediately so that
    // any concurrent callers arriving while we await initialize() get the same promise.
    console.log(`[AgentRegistry] Loading agent ${agentId.substring(0, 8)} (${this.agents.size + 1}/${this.maxAgents})`)
    const agent = new Agent({
      agentId,
      workingDirectory: config?.workingDirectory
    })

    // Pass subconsciousConfig so callers can control memory/consolidation intervals
    const initPromise: Promise<Agent> = agent.initialize(subconsciousConfig).then(() => {
      this.agents.set(agentId, agent)
      this.touch(agentId)
      this.initializingAgents.delete(agentId)
      return agent
    }).catch(err => {
      // Clean up so a subsequent call can retry cleanly
      this.initializingAgents.delete(agentId)
      throw err
    })

    this.initializingAgents.set(agentId, initPromise)
    return initPromise
  }

  /**
   * Get an existing agent (without creating)
   * Also updates access order
   */
  getExistingAgent(agentId: string): Agent | undefined {
    const agent = this.agents.get(agentId)
    if (agent) {
      this.touch(agentId)
    }
    return agent
  }

  /**
   * Shutdown an agent
   */
  async shutdownAgent(agentId: string): Promise<void> {
    // Cancel any in-flight initialization (callers awaiting it will get the rejection)
    this.initializingAgents.delete(agentId)
    const agent = this.agents.get(agentId)
    if (agent) {
      await agent.shutdown()
      this.agents.delete(agentId)
      const index = this.accessOrder.indexOf(agentId)
      if (index !== -1) {
        this.accessOrder.splice(index, 1)
      }
    }
  }

  /**
   * Shutdown all agents
   */
  async shutdownAll(): Promise<void> {
    console.log('[AgentRegistry] Shutting down all agents...')
    // Cancel all pending initializations before shutting down initialized agents
    this.initializingAgents.clear()
    const shutdownPromises = Array.from(this.agents.values()).map(agent => agent.shutdown())
    await Promise.all(shutdownPromises)
    this.agents.clear()
    this.accessOrder = []
    console.log('[AgentRegistry] ✓ All agents shutdown')
  }

  /**
   * Get all active agents (currently in memory)
   */
  getAllAgents(): Agent[] {
    return Array.from(this.agents.values())
  }

  /**
   * Get registry status
   */
  getStatus() {
    return {
      activeAgents: this.agents.size,
      maxAgents: this.maxAgents,
      agents: Array.from(this.agents.values()).map(agent => agent.getStatus())
    }
  }

  /**
   * Get global subconscious status (summary across all agents)
   */
  getGlobalSubconsciousStatus() {
    const agents = Array.from(this.agents.values())
    const subconsciousStatuses = agents
      .map(agent => ({
        agentId: agent.getAgentId(),
        status: agent.getSubconscious()?.getStatus() || null
      }))
      .filter(s => s.status !== null)

    const runningCount = subconsciousStatuses.filter(s => s.status?.isRunning).length
    const totalMessageRuns = subconsciousStatuses.reduce((sum, s) => sum + (s.status?.totalMessageRuns || 0), 0)

    // Find the most recent message run across all agents
    let lastMessageRun: number | null = null
    let lastMessageResult: SubconsciousStatus['lastMessageResult'] = null

    for (const s of subconsciousStatuses) {
      // Use !== null instead of truthiness so a zero timestamp (edge case) is not skipped
      if (s.status?.lastMessageRun !== null && s.status?.lastMessageRun !== undefined && (lastMessageRun === null || s.status.lastMessageRun > lastMessageRun)) {
        lastMessageRun = s.status.lastMessageRun
        lastMessageResult = s.status.lastMessageResult
      }
    }

    return {
      activeAgents: this.agents.size,
      runningSubconscious: runningCount,
      totalMessageRuns,
      lastMessageRun,
      lastMessageResult,
      agents: subconsciousStatuses
    }
  }
}

// Singleton instance using globalThis to ensure it's shared across Next.js API routes
// This is necessary because Next.js may create separate module contexts
declare global {
  // eslint-disable-next-line no-var
  var _agentRegistry: AgentRegistry | undefined
}

if (!globalThis._agentRegistry) {
  globalThis._agentRegistry = new AgentRegistry()
}

export const agentRegistry = globalThis._agentRegistry
