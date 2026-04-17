/**
 * Agent Startup - Initialize all registered agents on server boot
 *
 * This module solves the chicken-and-egg problem where:
 * - The subconscious only starts when an agent is accessed
 * - But nothing accesses agents on server startup
 *
 * Solution: On server boot, discover all agent databases and initialize them
 */

import fs from 'fs'
import { agentRegistry } from './agent'
import { statePath } from '@/lib/ecosystem-constants'

const AGENTS_DIR = statePath('agents')

/**
 * Discover all agent database directories
 * Agent databases are stored as directories (not .json files) in ~/.aimaestro/agents/
 *
 * IMPORTANT — do NOT rewrite this to be registry-only. The per-agent disk dir
 * `~/.aimaestro/agents/<uuid>/` holds not just the CozoDB but also the agent's
 * Ed25519 AMP identity keys (`keys/`), the subconscious `status.json`, and
 * other identity-scoped state. The intersection of "dir exists on disk" AND
 * "agent id is in registry" is the AID integrity invariant — both must be
 * true for this agent to be considered real. Feeding registry-only IDs into
 * `initializeAllAgents()` would trigger `agentRegistry.getAgent()` which in
 * turn calls `getDatabase()` on a possibly-missing dir, creating a fresh
 * empty `agent.db` (and directory) that contains no keys — silently
 * fabricating a new identity for what was supposed to be an existing agent.
 *
 * TRDD-70a521d9 note: the RAG memory removal Phase 9 deletes only the
 * `agent.db` files inside these directories (`find -name 'agent.db' -delete`),
 * not the directories themselves. So this FS scan keeps working after memory
 * is gone; the coupling to fix is inside `agentRegistry.getAgent()` → make
 * sure subconscious startup stops calling `getDatabase()` (Phase 1 work).
 */
export function discoverAgentDatabases(): string[] {
  if (!fs.existsSync(AGENTS_DIR)) {
    console.log('[AgentStartup] No agents directory found')
    return []
  }

  try {
    const entries = fs.readdirSync(AGENTS_DIR, { withFileTypes: true })
    const allDirs = entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)

    // Cross-reference with registry: only return agent IDs that actually exist
    // in the registry. Stale directories from deleted agents should not inflate
    // the subconscious count. (ISSUE-005 fix)
    const { loadAgents } = require('@/lib/agent-registry')
    const registeredIds = new Set(loadAgents().map((a: { id: string }) => a.id))
    const agentIds = allDirs.filter(id => registeredIds.has(id))

    if (agentIds.length < allDirs.length) {
      console.log(`[AgentStartup] Filtered ${allDirs.length - agentIds.length} stale agent dirs (not in registry)`)
    }

    return agentIds
  } catch (err: unknown) {
    // Only return empty for missing directory; rethrow corruption/permission errors
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw err
  }
}

/**
 * Initialize all discovered agents
 * This starts their subconscious processes for memory maintenance
 */
export async function initializeAllAgents(): Promise<{
  initialized: string[]
  failed: Array<{ agentId: string; error: string }>
}> {
  console.log('[AgentStartup] Starting agent initialization...')

  const agentIds = discoverAgentDatabases()

  if (agentIds.length === 0) {
    console.log('[AgentStartup] No agents to initialize')
    return { initialized: [], failed: [] }
  }

  console.log(`[AgentStartup] Found ${agentIds.length} agent database(s)`)

  const initialized: string[] = []
  const failed: Array<{ agentId: string; error: string }> = []

  // Initialize agents in parallel with concurrency limit
  const CONCURRENCY = 5
  for (let i = 0; i < agentIds.length; i += CONCURRENCY) {
    const batch = agentIds.slice(i, i + CONCURRENCY)

    await Promise.all(
      batch.map(async (agentId) => {
        try {
          // getAgent will initialize if not already initialized
          await agentRegistry.getAgent(agentId)
          initialized.push(agentId)
          console.log(`[AgentStartup] Initialized: ${agentId.substring(0, 8)}...`)
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error'
          failed.push({ agentId, error: errorMsg })
          console.error(`[AgentStartup] Failed to initialize ${agentId.substring(0, 8)}...: ${errorMsg}`)
        }
      })
    )
  }

  console.log(`[AgentStartup] Complete: ${initialized.length} initialized, ${failed.length} failed`)

  return { initialized, failed }
}

/**
 * Get summary of startup status
 */
export function getStartupStatus() {
  const registryStatus = agentRegistry.getStatus()
  return {
    discoveredAgents: discoverAgentDatabases().length,
    activeAgents: registryStatus.activeAgents,
    agents: registryStatus.agents.map(a => ({
      agentId: a.agentId,
      initialized: a.initialized,
      subconscious: a.subconscious?.isRunning || false
    }))
  }
}
