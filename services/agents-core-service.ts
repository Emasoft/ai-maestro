/**
 * Agents Core Service
 *
 * Pure business logic extracted from app/api/agents/** routes.
 * No HTTP concepts (Request, Response, NextResponse, headers) leak into this module.
 * API routes become thin wrappers that call these functions.
 *
 * Covers:
 *   GET    /api/agents                    -> listAgents / searchAgentsByQuery
 *   GET    /api/agents/[id]               -> getAgentById
 *   PATCH  /api/agents/[id]               -> updateAgentById
 *   POST   /api/agents/register           -> registerAgent
 *   GET    /api/agents/by-name/[name]     -> lookupAgentByName
 *   GET    /api/agents/unified            -> getUnifiedAgents
 *   GET    /api/agents/[id]/session       -> getAgentSessionStatus
 *   POST   /api/agents/[id]/session       -> linkAgentSession
 *   PATCH  /api/agents/[id]/session       -> sendAgentSessionCommand
 *   DELETE /api/agents/[id]/session       -> unlinkOrDeleteAgentSession
 *   POST   /api/agents/[id]/wake          -> wakeAgent
 *   POST   /api/agents/[id]/hibernate     -> hibernateAgent
 *   POST   /api/agents/startup            -> initializeStartup
 *   GET    /api/agents/startup            -> getStartupInfo
 *   POST   /api/agents/health             -> proxyHealthCheck
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { execSync } from 'child_process'
import { v4 as uuidv4 } from 'uuid'
import type { AuthContext } from '@/lib/agent-auth'
import type {
  Agent,
  AgentSession,
  AgentSessionStatus,
  AgentStats,
  CreateAgentRequest,
  UpdateAgentRequest,
} from '@/types/agent'
import {
  parseSessionName,
  parseNameForDisplay,
  computeSessionName,
} from '@/types/agent'
import {
  loadAgents,
  saveAgents,
  createAgent,
  getAgent,
  getAgentByName,
  getAgentBySession,
  updateAgent,
  deleteAgent,
  searchAgents,
  linkSession,
  unlinkSession,
} from '@/lib/agent-registry'
import { resolveAgentIdentifier } from '@/lib/messageQueue'
import { getHosts, getSelfHost, getSelfHostId, isSelf } from '@/lib/hosts-config'
import { persistSession, unpersistSession } from '@/lib/session-persistence'
import { initAgentAMPHome, getAgentAMPDir } from '@/lib/amp-inbox-writer'
import { initializeAllAgents, getStartupStatus } from '@/lib/agent-startup'
import { sessionActivity } from '@/services/shared-state'
import { getRuntime } from '@/lib/agent-runtime'
import { isManager, isChiefOfStaffAnywhere } from '@/lib/governance'
import { isValidUuid } from '@/lib/validation'
import { loadTeams } from '@/lib/team-registry'
import { statePath } from '@/lib/ecosystem-constants'
import type { Host } from '@/types/host'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

import { ServiceResult } from '@/types/service'
// NT-006: ServiceResult re-export removed — import directly from @/types/service

interface DiscoveredSession {
  name: string
  workingDirectory: string
  status: 'active' | 'idle' | 'disconnected'
  createdAt: string
  lastActivity: string
  windows: number
}

interface HostAgentResponse {
  agents: Agent[]
  stats: AgentStats
  hostInfo: {
    id: string
    name: string
    url: string
  }
}

interface UnifiedAgentResult {
  agent: Agent
  sourceHost: {
    id: string
    name: string
    url: string
  }
  qualifiedName: string // agent@host format
}

interface HostFetchResult {
  host: Host
  success: boolean
  agents: Agent[]
  stats: AgentStats | null
  error?: string
}

export interface RegisterAgentParams {
  // WorkTree format
  sessionName?: string
  workingDirectory?: string
  // Cloud agent format
  id?: string
  deployment?: {
    cloud?: {
      websocketUrl: string
    }
  }
  // NT-006: Replaced index signature with explicit field for cloud-specific extras
  cloudConfig?: Record<string, unknown>
}

export interface WakeAgentParams {
  startProgram?: boolean
  sessionIndex?: number
  program?: string
  /** Auth context from the route — when provided, Gate 0 checks authorization */
  authContext?: import('@/lib/agent-auth').AuthContext
}

export interface HibernateAgentParams {
  sessionIndex?: number
  /** Auth context from the route — when provided, Gate 0 checks authorization */
  authContext?: import('@/lib/agent-auth').AuthContext
}

export interface AgentSessionCommandParams {
  command: string
  requireIdle?: boolean
  addNewline?: boolean
}

export interface LinkSessionParams {
  sessionName: string
  workingDirectory?: string
}

export interface UnlinkSessionParams {
  kill?: boolean
  deleteAgent?: boolean
  // Which session index to target when computing the tmux session name (defaults to 0)
  sessionIndex?: number
}

export interface UnifiedAgentsParams {
  query?: string | null
  includeOffline?: boolean
  timeout?: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Idle threshold in milliseconds (30 seconds) */
const IDLE_THRESHOLD_MS = 30 * 1000

// ---------------------------------------------------------------------------
// Internal helpers (shared across multiple endpoints)
// ---------------------------------------------------------------------------

/** Check if a session is idle based on activity threshold */
function isSessionIdle(sessionName: string): boolean {
  const activity = sessionActivity.get(sessionName)
  if (!activity) return true // No activity recorded = idle
  return (Date.now() - activity) > IDLE_THRESHOLD_MS
}

/** Strips unsafe characters from CLI arguments. Allows: a-z A-Z 0-9 space - _ . = / : , ~ @ */
function sanitizeArgs(args: string): string {
  return args.replace(/[^a-zA-Z0-9\s\-_.=/:,~@]/g, '').trim()
}

/** Resolve program name to CLI command */
function resolveStartCommand(program: string): string {
  // SF-008: Removed redundant `|| program.includes('claude code')` — 'claude code' always matches 'claude' first
  if (program.includes('claude')) {
    return 'claude'
  } else if (program.includes('codex')) {
    return 'codex'
  } else if (program.includes('aider')) {
    return 'aider'
  } else if (program.includes('cursor')) {
    return 'cursor'
  } else if (program.includes('gemini')) {
    return 'gemini'
  } else if (program.includes('opencode')) {
    return 'opencode'
  } else if (program.includes('openclaw')) {
    // SF-009: Keep resolveStartCommand in sync with sessions-service program resolution
    return 'openclaw'
  }
  return 'claude' // Default
}

/**
 * Discover all tmux sessions on this host
 */
async function discoverLocalSessions(): Promise<DiscoveredSession[]> {
  try {
    const runtime = getRuntime()
    const discovered = await runtime.listSessions()

    return discovered.map(disc => {
      const activityTimestamp = sessionActivity.get(disc.name)

      let lastActivity: string
      let status: 'active' | 'idle' | 'disconnected'

      if (activityTimestamp) {
        lastActivity = new Date(activityTimestamp).toISOString()
        const secondsSinceActivity = (Date.now() - activityTimestamp) / 1000
        status = secondsSinceActivity > 3 ? 'idle' : 'active'
      } else {
        lastActivity = disc.createdAt
        status = 'disconnected'
      }

      return {
        name: disc.name,
        workingDirectory: disc.workingDirectory,
        status,
        createdAt: disc.createdAt,
        lastActivity,
        windows: disc.windows,
      }
    })
  } catch (error) {
    console.error('[Agents] Error discovering local sessions:', error)
    return []
  }
}

/**
 * Lightweight struct for tmux sessions not linked to any registered agent.
 * NOT stored in registry. NOT given a subconscious. Zero resource cost.
 * Displayed in the sidebar as "Unregistered Sessions" for user adoption.
 */
export interface UnregisteredSession {
  tmuxSessionName: string
  workingDirectory: string
  createdAt: string
  windows: number
  paneCommand?: string
  programRunning?: boolean
  /** From session history: the agent name that originally owned this session */
  originalAgentName?: string
  /** From session history: the agent label/persona name */
  originalAgentLabel?: string
  /** From session history: the agent ID (may no longer exist in registry) */
  originalAgentId?: string
  /** From session history: the AI client used */
  originalProgram?: string
  /** From session history: the CLI arguments */
  originalProgramArgs?: string
}

/** Check what process is running in the tmux pane (e.g., "claude", "zsh", "node") */
function getPaneCommand(tmuxSessionName: string): { paneCommand: string; programRunning: boolean } {
  const SHELL_COMMANDS = new Set(['zsh', 'bash', 'sh', 'fish', 'tcsh', 'csh', 'dash'])
  try {
    const cmd = execSync(
      `tmux list-panes -t "${tmuxSessionName}" -F "#{pane_current_command}" 2>/dev/null`,
      { encoding: 'utf-8', timeout: 2000 }
    ).trim()
    const paneCommand = cmd.split('\n')[0] || ''
    return { paneCommand, programRunning: !SHELL_COMMANDS.has(paneCommand) }
  } catch {
    return { paneCommand: '', programRunning: false }
  }
}

/**
 * Merge agent with runtime session status and host info
 */
function mergeAgentWithSession(
  agent: Agent,
  sessionStatus: AgentSessionStatus,
  hostId: string,
  hostName: string,
  hostUrl: string,
  isOrphan: boolean
): Agent {
  return {
    ...agent,
    hostId,
    hostName,
    hostUrl,
    session: sessionStatus,
    isOrphan
  }
}

/**
 * Set up AMP environment for an agent in a tmux session.
 * Non-fatal -- agent still works without AMP.
 */
async function setupAMPForSession(
  sessionName: string,
  agentName: string,
  agentId?: string
): Promise<string> {
  let ampDir = ''
  try {
    const runtime = getRuntime()
    await initAgentAMPHome(agentName, agentId)
    ampDir = getAgentAMPDir(agentName, agentId)
    await runtime.setEnvironment(sessionName, 'AMP_DIR', ampDir)
    await runtime.setEnvironment(sessionName, 'AIM_AGENT_NAME', agentName)
    if (agentId) {
      await runtime.setEnvironment(sessionName, 'AIM_AGENT_ID', agentId)
    }
    await runtime.unsetEnvironment(sessionName, 'CLAUDECODE')
    console.log(`[Agents] Set AMP_DIR=${ampDir} for agent ${agentName}`)
  } catch (ampError) {
    console.warn(`[Agents] Could not set up AMP for ${agentName}:`, ampError)
  }
  return ampDir
}

/**
 * Update agent session status in the registry after wake/hibernate.
 */
function updateAgentSessionInRegistry(
  agentId: string,
  sessionIndex: number,
  status: 'online' | 'offline',
  workingDirectory?: string,
  incrementLaunch: boolean = false
): void {
  const agents = loadAgents()
  const index = agents.findIndex(a => a.id === agentId)
  if (index === -1) return

  if (!agents[index].sessions) {
    agents[index].sessions = []
  }

  const sessionIdx = agents[index].sessions.findIndex(s => s.index === sessionIndex)

  if (status === 'online') {
    const sessionData: AgentSession = {
      index: sessionIndex,
      status: 'online',
      workingDirectory: workingDirectory || agents[index].workingDirectory,
      createdAt: new Date().toISOString(),
      lastActive: new Date().toISOString(),
    }
    if (sessionIdx >= 0) {
      agents[index].sessions[sessionIdx] = sessionData
    } else {
      agents[index].sessions.push(sessionData)
    }
    agents[index].status = 'active'
  } else {
    if (sessionIdx >= 0) {
      agents[index].sessions[sessionIdx].status = 'offline'
      agents[index].sessions[sessionIdx].lastActive = new Date().toISOString()
    }
    const hasOnlineSession = agents[index].sessions?.some(s => s.status === 'online') ?? false
    agents[index].status = hasOnlineSession ? 'active' : 'offline'
  }

  agents[index].lastActive = new Date().toISOString()

  if (incrementLaunch) {
    agents[index].launchCount = (agents[index].launchCount || 0) + 1
  }

  saveAgents(agents)
}

// ===========================================================================
// PUBLIC API -- called by API routes
// ===========================================================================

// ---------------------------------------------------------------------------
// GET /api/agents -- list agents with tmux discovery + search
// ---------------------------------------------------------------------------

export async function listAgents(): Promise<ServiceResult<{
  agents: Agent[]
  unregisteredSessions: UnregisteredSession[]
  stats: AgentStats
  hostInfo: { id: string; name: string; url: string; isSelf: boolean }
}>> {
  try {
    const selfHost = getSelfHost()
    const hostName = selfHost?.name || os.hostname()
    const hostId = selfHost?.id || hostName
    const hostUrl = selfHost?.url || `http://${os.hostname().toLowerCase()}:23000`

    // 1. Load all registered agents from this host's registry (exclude soft-deleted)
    const agents = loadAgents().filter(a => !a.deletedAt)

    // 2. Discover local tmux sessions
    const discoveredSessions = await discoverLocalSessions()
    console.log(`[Agents] Found ${discoveredSessions.length} local tmux session(s)`)

    // 3. Group discovered sessions by agent name (NORMALIZED TO LOWERCASE)
    const sessionsByAgentName = new Map<string, DiscoveredSession[]>()
    for (const session of discoveredSessions) {
      const { agentName } = parseSessionName(session.name)
      const normalizedName = agentName.toLowerCase()
      if (!sessionsByAgentName.has(normalizedName)) {
        sessionsByAgentName.set(normalizedName, [])
      }
      sessionsByAgentName.get(normalizedName)!.push(session)
    }

    // 4. Process agents and update their session status
    const resultAgents: Agent[] = []
    // (orphan creation removed — unregistered sessions collected in step 5 instead)
    const processedAgentNames = new Set<string>()

    for (const agent of agents) {
      // Use agent.id as last-resort fallback so agents without a name are never silently dropped
      const agentName = agent.name || agent.id
      if (!agentName) continue

      const normalizedAgentName = agentName.toLowerCase()
      processedAgentNames.add(normalizedAgentName)

      // BUG-018 fix: Also check for sessions named <uuid>@<hostId> (created by CreateAgent AIO)
      const uuidSessionKey = `${agent.id}@${hostId}`.toLowerCase()
      if (uuidSessionKey !== normalizedAgentName) {
        processedAgentNames.add(uuidSessionKey)
      }

      const agentSessions = sessionsByAgentName.get(normalizedAgentName)
        || sessionsByAgentName.get(uuidSessionKey)
        || []

      // Build updated sessions array from discovered tmux sessions
      const updatedSessions: AgentSession[] = []
      for (const session of agentSessions) {
        const { index } = parseSessionName(session.name)
        updatedSessions.push({
          index,
          status: 'online',
          workingDirectory: session.workingDirectory,
          createdAt: session.createdAt,
          lastActive: session.lastActivity,
        })
      }

      // Add offline sessions from registry that weren't discovered
      const existingSessions = agent.sessions || []
      for (const existingSession of existingSessions) {
        const alreadyUpdated = updatedSessions.some(s => s.index === existingSession.index)
        if (!alreadyUpdated) {
          updatedSessions.push({
            ...existingSession,
            status: 'offline',
          })
        }
      }

      updatedSessions.sort((a, b) => a.index - b.index)

      const hasOnlineSession = updatedSessions.some(s => s.status === 'online')

      // Create session status for API response (backward compatibility)
      const onlineSession = updatedSessions.find(s => s.status === 'online')
      const primarySession = updatedSessions.find(s => s.index === 0) || updatedSessions[0]
      const onlineDiscoveredSession = onlineSession
        ? agentSessions.find(s => parseSessionName(s.name).index === onlineSession.index)
        : undefined

      const tmuxName = onlineDiscoveredSession?.name || computeSessionName(agentName, onlineSession?.index ?? 0)
      const paneInfo = onlineSession ? getPaneCommand(tmuxName) : { paneCommand: '', programRunning: false }

      const sessionStatus: AgentSessionStatus = onlineSession
        ? {
            status: 'online',
            tmuxSessionName: tmuxName,
            workingDirectory: onlineSession.workingDirectory,
            lastActivity: onlineSession.lastActive,
            windows: onlineDiscoveredSession?.windows,
            hostId,
            hostName,
            ...paneInfo,
          }
        : {
            status: 'offline',
            workingDirectory: agent.workingDirectory || primarySession?.workingDirectory,
            windows: undefined,
            hostId,
            hostName,
          }

      const updatedAgent: Agent = {
        ...agent,
        // Preserve the canonical name/alias fields; do not promote alias to name
        name: agent.name,
        alias: agent.alias,
        sessions: updatedSessions,
        status: hasOnlineSession ? 'active' : 'offline',
        // Use the actual lastActive from the online session rather than the current timestamp
        // so the field reflects true last activity, not the polling time
        lastActive: (onlineSession?.lastActive ?? agent.lastActive) || new Date().toISOString(),
      }

      resultAgents.push(mergeAgentWithSession(updatedAgent, sessionStatus, hostId, hostName, hostUrl, false))
    }

    // 5. Collect unregistered sessions (tmux sessions with no matching agent).
    // These are NOT agents — they are displayed as "potential agents" in the UI.
    // Zero resource cost: no UUID, no registry entry, no subconscious.
    const unregisteredSessions: UnregisteredSession[] = []
    for (const [agentName, sessions] of sessionsByAgentName.entries()) {
      if (!processedAgentNames.has(agentName)) {
        const primarySession = sessions[0]
        const paneInfo = getPaneCommand(primarySession.name)
        unregisteredSessions.push({
          tmuxSessionName: primarySession.name,
          workingDirectory: primarySession.workingDirectory || '',
          createdAt: primarySession.createdAt,
          windows: primarySession.windows,
          ...paneInfo,
        })
      }
    }
    // Enrich unregistered sessions with history data (original agent name)
    if (unregisteredSessions.length > 0) {
      try {
        const { lookupSessionAgents } = await import('@/lib/session-history')
        const historyMap = lookupSessionAgents(unregisteredSessions.map(s => s.tmuxSessionName))
        for (const session of unregisteredSessions) {
          const entry = historyMap[session.tmuxSessionName]
          if (entry) {
            session.originalAgentName = entry.agentName
            session.originalAgentLabel = entry.agentLabel
            session.originalAgentId = entry.agentId
            session.originalProgram = entry.program
            session.originalProgramArgs = entry.programArgs
          }
        }
      } catch { /* history file missing or corrupt — no enrichment */ }
      console.log(`[Agents] Found ${unregisteredSessions.length} unregistered tmux session(s) (not auto-registered — awaiting user adoption)`)
    }

    // 7. Sort: online agents first, then alphabetically by name
    resultAgents.sort((a, b) => {
      if (a.session?.status === 'online' && b.session?.status !== 'online') return -1
      if (a.session?.status !== 'online' && b.session?.status === 'online') return 1
      const nameA = a.name || ''
      const nameB = b.name || ''
      return nameA.toLowerCase().localeCompare(nameB.toLowerCase())
    })

    return {
      data: {
        agents: resultAgents,
        unregisteredSessions,
        stats: {
          total: resultAgents.length,
          online: resultAgents.filter(a => a.session?.status === 'online').length,
          offline: resultAgents.filter(a => a.session?.status === 'offline').length,
          unregistered: unregisteredSessions.length,
        },
        hostInfo: {
          id: hostId,
          name: hostName,
          url: hostUrl,
          isSelf: true,
        },
      },
      status: 200,
    }
  } catch (error) {
    console.error('[Agents] Failed to fetch agents:', error)
    return { error: 'Failed to fetch agents', status: 500 }
  }
}

// ---------------------------------------------------------------------------
// GET /api/agents?q=... -- search agents
// ---------------------------------------------------------------------------

export function searchAgentsByQuery(query: string): ServiceResult<{ agents: Agent[] }> {
  const agents = searchAgents(query)
  return { data: { agents }, status: 200 }
}

// ---------------------------------------------------------------------------
// GET /api/agents/[id] -- get agent by ID
// ---------------------------------------------------------------------------

export function getAgentById(id: string): ServiceResult<{ agent: Agent }> {
  try {
    const agent = getAgent(id)
    if (!agent) {
      return { error: 'Agent not found', status: 404 }
    }
    // Strip sensitive fields from API response
    const sanitized = { ...agent }
    if (sanitized.metadata) {
      const { sessionSecretHash, ...safeMetadata } = sanitized.metadata as Record<string, unknown>
      sanitized.metadata = safeMetadata as typeof sanitized.metadata
    }
    return { data: { agent: sanitized }, status: 200 }
  } catch (error) {
    console.error('Failed to get agent:', error)
    return { error: 'Failed to get agent', status: 500 }
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/agents/[id] -- update agent
// ---------------------------------------------------------------------------

// CHANGEABLE_FIELDS — the one canonical list of PATCH body fields that are
// routed through element-management-service Change* pipelines instead of the
// generic updateAgent() path. Any field NOT in this tuple falls through as a
// simple registry write.
//
// Why a tuple and not a Set: the `satisfies readonly (keyof UpdateAgentRequest)[]`
// constraint is what makes the compile-time check work — if a developer adds
// 'workingDirector' (typo) or 'unknown-field' here, TypeScript fails the build
// at this line instead of letting the typo slip through and ship a silent
// Change*-owned field leak to the generic path.
//
// Maintainer contract when adding a new field:
//   1. Add it to UpdateAgentRequest in types/agent.ts FIRST.
//   2. Add the key here. TypeScript will not let you use a string that is
//      not a key of UpdateAgentRequest.
//   3. Add the corresponding `if (changeableFields.<k> !== ...)` dispatch
//      inside updateAgentById — the compiler cannot enforce this automatically
//      (would require procedural codegen), so the runtime "anyChangeExecuted"
//      flag is the safety net. Every existing dispatch lives in ONE function,
//      so search-replace on `// Change<X>` comments reveals every site.
//   4. If the transition is destructive, add a sudo gate in
//      app/api/agents/[id]/route.ts PATCH (see R19 sudo-mode + security-registry.json).
//
// `alias` is a legacy alias for `name` — it is stripped from cleanBody too,
// but it is NOT a CHANGEABLE_FIELD because it does not have its own Change*
// dispatch. ChangeName absorbs it via `body.name || body.alias`.
export const CHANGEABLE_FIELDS = [
  'governanceTitle',
  'name',
  'workingDirectory',
  'avatar',
  'programArgs',
  'program',
  'githubRepo',
] as const satisfies readonly (keyof UpdateAgentRequest)[]

type ChangeableField = typeof CHANGEABLE_FIELDS[number]

// Legacy field names that ALSO dispatch to a Change* pipeline (via absorb-
// in-dispatcher semantics). Kept for sudo-gate coverage so PATCH routes that
// still receive `alias` (deprecated in UpdateAgentRequest, absorbed by
// ChangeName via `body.name || body.alias`) don't bypass the security gate.
export const CHANGEABLE_FIELD_ALIASES = ['alias'] as const

/**
 * Return true when `body` carries any field that will dispatch through a
 * Change* pipeline. Used by the PATCH route to decide whether the whole
 * request requires a sudo token (PROP #1 — see route-level comment for
 * the security rationale). Callers may pass any object shape; non-UA
 * bodies return false.
 */
export function bodyHasChangeableField(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false
  const bodyKeys = Object.keys(body as Record<string, unknown>)
  if (bodyKeys.length === 0) return false
  for (const field of CHANGEABLE_FIELDS) {
    if (bodyKeys.includes(field)) return true
  }
  for (const alias of CHANGEABLE_FIELD_ALIASES) {
    if (bodyKeys.includes(alias)) return true
  }
  return false
}

export async function updateAgentById(id: string, body: UpdateAgentRequest, requestingAgentId?: string | null, authContext?: AuthContext): Promise<ServiceResult<{ agent: Agent; restartNeeded?: boolean; warnings?: string[] }>> {
  // Side-channel data collected from Change* pipelines that needs to reach
  // the PATCH response body (e.g. ChangeClient's restartNeeded flag, which
  // the UI useRestartQueue hook reads to auto-enqueue the agent for restart).
  //
  // BUG-003 fix: before this commit, ChangeClient's failures AND its
  // restartNeeded return value were both silently swallowed by a
  // try/catch { console.warn } block — the PATCH returned 200 OK even when
  // ChangeClient aborted mid-flight, causing the UI to show a green check
  // for a client change that never happened. Now ChangeClient failures are
  // promoted to returned errors, and its restartNeeded flag is propagated
  // into the PATCH response body.
  const sideChannel: { restartNeeded?: boolean; warnings?: string[] } = {}
  try {
    // Check if agent exists and is not soft-deleted
    const existing = getAgent(id, true) // include deleted to distinguish 404 vs 410
    if (!existing) {
      return { error: 'Agent not found', status: 404 }
    }
    if (existing.deletedAt) {
      return { error: 'Cannot update a deleted agent', status: 410 }
    }

    // Layer 5: When a requesting agent is identified, enforce governance roles
    // CC-GOV-005: No self-modification — consistent with RBAC rule in authorization.ts
    if (requestingAgentId) {
      const isReqManager = isManager(requestingAgentId)
      const isReqCOS = isChiefOfStaffAnywhere(requestingAgentId)

      if (!isReqManager && !isReqCOS) {
        // Check if requester is COS of a team the target agent belongs to
        const teams = loadTeams()
        const closedTeams = teams.filter(t => t.type === 'closed')
        const agentTeams = closedTeams.filter(t => t.agentIds.includes(id))
        const isOwningCOS = agentTeams.some(t => t.chiefOfStaffId === requestingAgentId)

        if (!isOwningCOS) {
          return { error: 'Only MANAGER or owning Chief-of-Staff can update this agent', status: 403 }
        }
      }
    }

    // Fields handled by Change* functions — strip from body, call Change* separately.
    // Keys are typed against ChangeableField so TypeScript refuses to compile
    // if a field is missing from CHANGEABLE_FIELDS or carries a typo.
    // Values preserve their original UpdateAgentRequest types via a mapped
    // type — downstream consumers like ChangeTitle still receive
    // `AgentRole | null | undefined` instead of `unknown`.
    // `name` also falls back to the legacy `body.alias` (deprecated) so
    // callers that still send the old field name continue to work — the
    // fallback is intentional and lives here, not in CHANGEABLE_FIELDS.
    const changeableFields: { [K in ChangeableField]: UpdateAgentRequest[K] } = {
      governanceTitle: body.governanceTitle,
      name: body.name || body.alias,
      workingDirectory: body.workingDirectory,
      avatar: body.avatar,
      programArgs: body.programArgs,
      program: body.program,
      // R19.2: githubRepo is a MAINTAINER-title attribute. Must be forwarded to
      // ChangeTitle's options (Gate 9a validates "owner/repo" format and repo
      // uniqueness). We also strip it from cleanBody below so updateAgent does
      // not leak-write it to the registry for non-maintainer transitions — the
      // ChangeTitle pipeline is the single source of truth for this field.
      githubRepo: body.githubRepo,
    }

    // Strip changeable fields from body so updateAgent only handles simple fields.
    // Driven by CHANGEABLE_FIELDS so that adding a new entry there automatically
    // strips it here — no more two-place drift.
    const cleanBody: UpdateAgentRequest = { ...body }
    for (const field of CHANGEABLE_FIELDS) {
      delete cleanBody[field]
    }
    // Legacy alias for `name` — ChangeName reads it via `body.name || body.alias`
    // above, so the generic updateAgent path must not see it.
    delete cleanBody.alias

    // Execute simple updateAgent for remaining fields (tags, label, model, etc.)
    const agent = await updateAgent(id, cleanBody)
    if (!agent) {
      return { error: 'Agent not found', status: 404 }
    }

    // Execute Change* functions for fields that need gated validation
    let anyChangeExecuted = false

    // ChangeTitle — governance title transitions
    // BUG-014 fix: detect old title from ALL sources (registry + governance.json + team COS),
    // not just the registry field. This mirrors ChangeTitle Gate 5 logic.
    let oldTitle = existing.governanceTitle || null
    if (!oldTitle) {
      try {
        const { isManager, isChiefOfStaffAnywhere } = await import('@/lib/governance')
        if (isManager(id)) oldTitle = 'manager'
        else if (isChiefOfStaffAnywhere(id)) oldTitle = 'chief-of-staff'
      } catch { /* best effort */ }
    }
    const newTitle = changeableFields.governanceTitle !== undefined
      ? (changeableFields.governanceTitle || null)
      : oldTitle
    if (oldTitle !== newTitle) {
      try {
        const { ChangeTitle } = await import('@/services/element-management-service')
        const ac = authContext || { agentId: requestingAgentId || undefined, isSystemOwner: !requestingAgentId }
        // R19.2: forward githubRepo from body.githubRepo into ChangeTitle's
        // options so Gate 9a receives it for MAINTAINER transitions. Before
        // this fix, PATCH { governanceTitle: 'maintainer', githubRepo: 'x/y' }
        // would reach ChangeTitle with no githubRepo, fail Gate 9a, and leave
        // the title unchanged — while the separate updateAgent(cleanBody)
        // call silently wrote githubRepo to the registry anyway (SCEN-020
        // BUG-001). Both paths are now covered: strip the field from
        // cleanBody (above) and pipe it through here.
        const titleOptions: { authContext: typeof ac; githubRepo?: string } = { authContext: ac }
        if (typeof changeableFields.githubRepo === 'string' && changeableFields.githubRepo.trim()) {
          titleOptions.githubRepo = changeableFields.githubRepo.trim()
        }
        const titleResult = await ChangeTitle(id, newTitle, titleOptions)
        if (!titleResult.success) console.warn('[agents] ChangeTitle failed:', titleResult.error)
        anyChangeExecuted = true
      } catch (err) {
        console.warn('[agents] Failed ChangeTitle on PATCH:', err instanceof Error ? err.message : err)
      }
    }

    // ChangeName — agent name with uniqueness + tmux rename
    if (changeableFields.name && changeableFields.name !== existing.name) {
      try {
        const { ChangeName } = await import('@/services/element-management-service')
        const ac = authContext || { agentId: requestingAgentId || undefined, isSystemOwner: !requestingAgentId }
        const nameResult = await ChangeName(id, changeableFields.name, ac)
        if (!nameResult.success) console.warn('[agents] ChangeName failed:', nameResult.error)
        anyChangeExecuted = true
      } catch (err) {
        console.warn('[agents] Failed ChangeName on PATCH:', err instanceof Error ? err.message : err)
      }
    }

    // ChangeFolder — working directory with path validation
    if (changeableFields.workingDirectory && changeableFields.workingDirectory !== existing.workingDirectory) {
      try {
        const { ChangeFolder } = await import('@/services/element-management-service')
        const ac2 = authContext || { agentId: requestingAgentId || undefined, isSystemOwner: !requestingAgentId }
        const folderResult = await ChangeFolder(id, changeableFields.workingDirectory, ac2)
        if (!folderResult.success) console.warn('[agents] ChangeFolder failed:', folderResult.error)
        anyChangeExecuted = true
      } catch (err) {
        console.warn('[agents] Failed ChangeFolder on PATCH:', err instanceof Error ? err.message : err)
      }
    }

    // ChangeAvatar — avatar path validation
    if (changeableFields.avatar && changeableFields.avatar !== existing.avatar) {
      try {
        const { ChangeAvatar } = await import('@/services/element-management-service')
        const ac3 = authContext || { agentId: requestingAgentId || undefined, isSystemOwner: !requestingAgentId }
        const avatarResult = await ChangeAvatar(id, changeableFields.avatar, ac3)
        if (!avatarResult.success) console.warn('[agents] ChangeAvatar failed:', avatarResult.error)
        anyChangeExecuted = true
      } catch (err) {
        console.warn('[agents] Failed ChangeAvatar on PATCH:', err instanceof Error ? err.message : err)
      }
    }

    // ChangeCLIArgs — CLI argument sanitization
    if (changeableFields.programArgs !== undefined && changeableFields.programArgs !== existing.programArgs) {
      try {
        const { ChangeCLIArgs } = await import('@/services/element-management-service')
        const ac4 = authContext || { agentId: requestingAgentId || undefined, isSystemOwner: !requestingAgentId }
        const argsResult = await ChangeCLIArgs(id, changeableFields.programArgs, ac4)
        if (!argsResult.success) console.warn('[agents] ChangeCLIArgs failed:', argsResult.error)
        anyChangeExecuted = true
      } catch (err) {
        console.warn('[agents] Failed ChangeCLIArgs on PATCH:', err instanceof Error ? err.message : err)
      }
    }

    // ChangeClient — AI client (program) change
    //
    // BUG-003 fix: ChangeClient failures MUST NOT be silently swallowed.
    // A client change is a destructive, non-atomic operation (R18: uninstalls
    // every plugin in the old client's format and re-emits them in the new
    // client's format). If it fails or aborts, the agent's on-disk plugin
    // state is in an indeterminate state and the UI MUST know about it.
    //
    // Status code choice:
    //   409 Conflict  — Change* pipeline aborted (clientResult.success=false).
    //                   R18 aborts are conflicts between the desired state
    //                   and the current state of the plugin ecosystem
    //                   (e.g. "cannot go X→Claude lossy", "no native source
    //                   found for target client"). They are NOT 400 bad
    //                   requests — the input is valid, the environment
    //                   refuses to fulfill it.
    //   500 Internal  — ChangeClient threw an unexpected exception (bug).
    //
    // Side-channel propagation: the restartNeeded flag from ChangeClient
    // is stored in sideChannel so the PATCH response body can forward it
    // to the client-side useRestartQueue hook.
    if (changeableFields.program && changeableFields.program !== (existing.program || 'claude')) {
      try {
        const { ChangeClient } = await import('@/services/element-management-service')
        const ac5 = authContext || { agentId: requestingAgentId || undefined, isSystemOwner: !requestingAgentId }
        const clientResult = await ChangeClient(id, changeableFields.program, ac5)
        if (!clientResult.success) {
          return { error: clientResult.error || 'Client change failed', status: 409 }
        }
        sideChannel.restartNeeded = clientResult.restartNeeded
        // ChangeResult does not yet carry a warnings array (P0.2 follow-up);
        // we emit an empty array so the response shape is stable and any
        // client that reads `warnings` never sees undefined.
        sideChannel.warnings = []
        anyChangeExecuted = true
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : 'Client change crashed',
          status: 500,
        }
      }
    }

    // Re-read agent after all Change* calls to include updated fields in response
    if (anyChangeExecuted) {
      // Broadcast agent data update to all /status WebSocket subscribers
      // so every UI component refreshes instantly (sidebar, profile, zoom, etc.)
      const changedFields = Object.entries(changeableFields)
        .filter(([, v]) => v !== undefined)
        .map(([k]) => k)
      if (changedFields.length > 0) {
        const { broadcastAgentUpdate } = await import('@/services/shared-state')
        broadcastAgentUpdate(id, changedFields)
      }

      const freshAgent = getAgent(id)
      if (freshAgent) {
        return {
          data: {
            agent: freshAgent,
            ...(sideChannel.restartNeeded !== undefined && { restartNeeded: sideChannel.restartNeeded }),
            ...(sideChannel.warnings !== undefined && { warnings: sideChannel.warnings }),
          },
          status: 200,
        }
      }
    }

    // Also broadcast for simple field updates (tags, label, etc.)
    const simpleChangedFields = Object.keys(cleanBody).filter(k => (cleanBody as Record<string, unknown>)[k] !== undefined)
    if (simpleChangedFields.length > 0 && !anyChangeExecuted) {
      const { broadcastAgentUpdate } = await import('@/services/shared-state')
      broadcastAgentUpdate(id, simpleChangedFields)
    }

    return {
      data: {
        agent,
        ...(sideChannel.restartNeeded !== undefined && { restartNeeded: sideChannel.restartNeeded }),
        ...(sideChannel.warnings !== undefined && { warnings: sideChannel.warnings }),
      },
      status: 200,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update agent'
    console.error('Failed to update agent:', error)
    return { error: message, status: 400 }
  }
}

// ---------------------------------------------------------------------------
// POST /api/agents/register -- register agent from session or cloud
// ---------------------------------------------------------------------------

export async function registerAgent(body: RegisterAgentParams): Promise<ServiceResult<{
  success: boolean
  message: string
  agentId: string
  agent: any
  registryAgent: { id: string; name: string } | null
}>> {
  try {
    let agentId: string
    let agentConfig: any
    let registryAgent: Agent | null = null

    if (body.sessionName && !body.id) {
      // WorkTree format - create agent from session name
      const { sessionName, workingDirectory } = body

      if (!sessionName) {
        return { error: 'Missing required field: sessionName', status: 400 }
      }

      // Check if agent already exists in registry by session name
      const existingAgent = getAgentBySession(sessionName)
      if (existingAgent) {
        await linkSession(existingAgent.id, sessionName, workingDirectory || process.cwd())
        registryAgent = existingAgent
        // Use the existing registry agent's UUID as the canonical ID
        agentId = existingAgent.id
      } else {
        const parts = sessionName.split('-')
        const shortName = parts[parts.length - 1] || sessionName
        const tags = parts.slice(0, -1).map((t: string) => t.toLowerCase())

        try {
          registryAgent = await createAgent({
            name: sessionName,
            label: shortName !== sessionName ? shortName : undefined,
            program: 'claude-code',
            model: 'sonnet',
            taskDescription: `Agent for ${sessionName}`,
            tags,
            owner: os.userInfo().username,
            createSession: true,
            workingDirectory: workingDirectory || process.cwd()
          })
          // createAgent always generates a UUID; use it as the canonical ID
          agentId = registryAgent.id
        } catch (createError) {
          console.warn(`[Register] Could not create registry entry for ${sessionName}:`, createError)
          // Fall back to a fresh UUID so agentConfig.id is always a valid UUID
          agentId = uuidv4()
        }
      }

      agentConfig = {
        id: agentId,
        sessionName,
        workingDirectory: workingDirectory || process.cwd(),
        createdAt: Date.now(),
      }
    } else {
      // Full agent config format (cloud agents)
      if (!body.id || !body.deployment?.cloud?.websocketUrl) {
        return { error: 'Missing required fields: id and websocketUrl', status: 400 }
      }

      agentId = body.id
      agentConfig = body
    }

    // MF-002 + SF-005: Validate agentId format — reject empty strings and non-UUID values
    if (body.id !== undefined && (!body.id || !isValidUuid(agentId))) {
      return { error: 'Invalid agent ID format', status: 400 }
    }

    // Ensure agents directory exists
    const agentsDir = statePath('agents')
    if (!fs.existsSync(agentsDir)) {
      fs.mkdirSync(agentsDir, { recursive: true })
    }

    // MF-002: Use path.basename to prevent directory traversal in file path construction
    const agentFilePath = path.join(agentsDir, `${path.basename(agentId)}.json`)
    fs.writeFileSync(agentFilePath, JSON.stringify(agentConfig, null, 2), 'utf8')

    return {
      data: {
        success: true,
        message: `Agent ${agentId} registered successfully`,
        agentId,
        agent: agentConfig,
        registryAgent: registryAgent ? { id: registryAgent.id, name: registryAgent.name || '' } : null,
      },
      status: 200,
    }
  } catch (error) {
    console.error('Failed to register agent:', error)
    return {
      error: `Failed to register agent: ${error instanceof Error ? error.message : 'Unknown error'}`,
      status: 500,
    }
  }
}

// ---------------------------------------------------------------------------
// GET /api/agents/by-name/[name] -- agent lookup by name (rich resolution)
// ---------------------------------------------------------------------------

export function lookupAgentByName(name: string): ServiceResult<{
  exists: boolean
  agent?: {
    id: string
    name: string
    hostId: string
    ampRegistered?: boolean
  }
}> {
  try {
    const decodedName = decodeURIComponent(name)
    const selfHostId = getSelfHostId()

    const resolved = resolveAgentIdentifier(decodedName)

    if (!resolved?.agentId) {
      return { data: { exists: false }, status: 200 }
    }

    const agent = getAgent(resolved.agentId)
    if (!agent) {
      return { data: { exists: false }, status: 200 }
    }

    return {
      data: {
        exists: true,
        agent: {
          id: agent.id,
          name: agent.name || '',
          hostId: agent.hostId || selfHostId,
          ampRegistered: agent.ampRegistered,
        },
      },
      status: 200,
    }
  } catch (error) {
    console.error('[Agent Lookup] Error:', error)
    return { data: { exists: false }, status: 500 }
  }
}

// ---------------------------------------------------------------------------
// GET /api/agents/unified -- unified agents across all hosts
// ---------------------------------------------------------------------------

export async function getUnifiedAgents(params: UnifiedAgentsParams): Promise<ServiceResult<{
  agents: UnifiedAgentResult[]
  stats: AgentStats
  hosts: Array<{
    host: { id: string; name: string; url: string; isSelf: boolean }
    success: boolean
    agentCount: number
    error?: string
  }>
  selfHost: { id: string; name: string; url: string }
  totalHosts: number
  successfulHosts: number
}>> {
  const { query, includeOffline = true, timeout = 3000 } = params
  const hosts = getHosts()
  const selfHost = getSelfHost()

  // Fetch agents from all hosts in parallel
  const fetchPromises: Promise<HostFetchResult>[] = hosts.map(async (host) => {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      let url = `${host.url}/api/agents`
      if (query) {
        url += `?q=${encodeURIComponent(query)}`
      }

      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        return {
          host,
          success: false,
          agents: [],
          stats: null,
          error: `HTTP ${response.status}: ${response.statusText}`,
        }
      }

      const data: HostAgentResponse = await response.json()
      return {
        host,
        success: true,
        agents: data.agents || [],
        stats: data.stats || null,
      }
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.name === 'AbortError' ? 'Request timeout' : error.message
        : 'Unknown error'
      return {
        host,
        success: false,
        agents: [],
        stats: null,
        error: errorMessage,
      }
    }
  })

  const results = await Promise.all(fetchPromises)

  // Aggregate agents with host context
  const unifiedAgents: UnifiedAgentResult[] = []
  const aggregatedStats: AgentStats = {
    total: 0,
    online: 0,
    offline: 0,
    unregistered: 0,
  }

  const hostResults: Array<{
    host: { id: string; name: string; url: string; isSelf: boolean }
    success: boolean
    agentCount: number
    error?: string
  }> = []

  for (const result of results) {
    hostResults.push({
      host: {
        id: result.host.id,
        name: result.host.name || result.host.id,
        url: result.host.url,
        isSelf: isSelf(result.host.id),
      },
      success: result.success,
      agentCount: result.agents.length,
      error: result.error,
    })

    if (!result.success && !includeOffline) {
      continue
    }

    for (const agent of result.agents) {
      const agentName = agent.name || agent.id
      const qualifiedName = `${agentName}@${result.host.id}`

      unifiedAgents.push({
        agent: {
          ...agent,
          hostId: result.host.id,
          hostName: result.host.name || result.host.id,
          hostUrl: result.host.url,
        },
        sourceHost: {
          id: result.host.id,
          name: result.host.name || result.host.id,
          url: result.host.url,
        },
        qualifiedName,
      })
    }

    if (result.stats) {
      aggregatedStats.total += result.stats.total
      aggregatedStats.online += result.stats.online
      aggregatedStats.offline += result.stats.offline
      aggregatedStats.unregistered += result.stats.unregistered || 0
    }
  }

  // Sort agents: online first, then by name
  unifiedAgents.sort((a, b) => {
    const aOnline = a.agent.status === 'active' ? 1 : 0
    const bOnline = b.agent.status === 'active' ? 1 : 0
    if (aOnline !== bOnline) return bOnline - aOnline
    return a.qualifiedName.localeCompare(b.qualifiedName)
  })

  return {
    data: {
      agents: unifiedAgents,
      stats: aggregatedStats,
      hosts: hostResults,
      selfHost: {
        // selfHost can be null; fall back to hostname-derived values (same pattern as listAgents)
        id: selfHost?.id || os.hostname(),
        name: selfHost?.name || os.hostname(),
        url: selfHost?.url || `http://${os.hostname().toLowerCase()}:23000`,
      },
      totalHosts: hosts.length,
      successfulHosts: results.filter(r => r.success).length,
    },
    status: 200,
  }
}

// ---------------------------------------------------------------------------
// GET /api/agents/[id]/session -- get session status
// ---------------------------------------------------------------------------

export async function getAgentSessionStatus(agentId: string): Promise<ServiceResult<{
  success: boolean
  agentId: string
  sessionName?: string
  hasSession: boolean
  exists: boolean
  idle: boolean
  lastActivity?: number | null
  timeSinceActivity?: number | null
  idleThreshold: number
}>> {
  try {
    const agent = getAgent(agentId)
    if (!agent) {
      return { error: 'Agent not found', status: 404 }
    }

    const agentNameForSession = agent.name
    if (!agentNameForSession) {
      return {
        data: {
          success: true,
          agentId,
          hasSession: false,
          exists: false,
          idle: false,
          idleThreshold: IDLE_THRESHOLD_MS,
        },
        status: 200,
      }
    }

    // Use the primary session (index 0) if it exists; derive the real tmux session name
    // via computeSessionName so it matches the name actually created by wakeAgent/createAgent
    const primarySession = agent.sessions?.find(s => s.index === 0)
    const sessionName = primarySession
      ? computeSessionName(agentNameForSession, primarySession.index)
      : computeSessionName(agentNameForSession, 0)

    const runtime = getRuntime()
    const exists = await runtime.sessionExists(sessionName)
    const lastActivity = sessionActivity.get(sessionName) || null
    const timeSinceActivity = lastActivity ? Date.now() - lastActivity : null
    const idle = isSessionIdle(sessionName)

    return {
      data: {
        success: true,
        agentId,
        sessionName,
        hasSession: true,
        exists,
        idle,
        lastActivity,
        timeSinceActivity,
        idleThreshold: IDLE_THRESHOLD_MS,
      },
      status: 200,
    }
  } catch (error) {
    console.error('[Agent Session] Error:', error)
    return {
      error: error instanceof Error ? error.message : 'Unknown error',
      status: 500,
    }
  }
}

// ---------------------------------------------------------------------------
// POST /api/agents/[id]/session -- link session to agent
// ---------------------------------------------------------------------------

export async function linkAgentSession(agentId: string, params: LinkSessionParams): Promise<ServiceResult<{ success: boolean }>> {
  try {
    const { sessionName, workingDirectory } = params

    if (!sessionName) {
      return { error: 'sessionName is required', status: 400 }
    }

    const success = await linkSession(agentId, sessionName, workingDirectory || process.cwd())
    if (!success) {
      return { error: 'Agent not found', status: 404 }
    }

    // Record initial activity timestamp so idle/status checks are accurate immediately after linking
    sessionActivity.set(sessionName, Date.now())

    return { data: { success: true }, status: 200 }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to link session'
    console.error('Failed to link session:', error)
    return { error: message, status: 400 }
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/agents/[id]/session -- send command to agent's session
// ---------------------------------------------------------------------------

export async function sendAgentSessionCommand(
  agentId: string,
  params: AgentSessionCommandParams
): Promise<ServiceResult<{
  success: boolean
  agentId?: string
  sessionName?: string
  commandSent?: string
  method?: string
  wasIdle?: boolean
  idle?: boolean
  timeSinceActivity?: number
  idleThreshold?: number
}>> {
  try {
    const { command, requireIdle = true, addNewline = true } = params

    if (!command || typeof command !== 'string') {
      return { error: 'Command is required', status: 400 }
    }

    const agent = getAgent(agentId)
    if (!agent) {
      return { error: 'Agent not found', status: 404 }
    }

    const agentNameForSession = agent.name
    if (!agentNameForSession) {
      return { error: 'Agent has no name configured', status: 400 }
    }

    // Use the primary session (index 0); derive the real tmux session name via
    // computeSessionName so it matches the name used by wakeAgent/createAgent
    const primarySession = agent.sessions?.find(s => s.index === 0)
    const sessionName = primarySession
      ? computeSessionName(agentNameForSession, primarySession.index)
      : computeSessionName(agentNameForSession, 0)

    const runtime = getRuntime()
    const exists = await runtime.sessionExists(sessionName)
    if (!exists) {
      return { error: 'Tmux session not found', status: 404 }
    }

    if (requireIdle && !isSessionIdle(sessionName)) {
      // MF-001: Return ONLY error without data field to avoid ambiguous response
      return {
        error: 'Session is not idle',
        status: 409,
      }
    }

    await runtime.cancelCopyMode(sessionName)
    await runtime.sendKeys(sessionName, command, { literal: true, enter: addNewline })

    // Update activity timestamp
    sessionActivity.set(sessionName, Date.now())

    return {
      data: {
        success: true,
        agentId,
        sessionName,
        commandSent: command,
        method: 'tmux-send-keys',
        wasIdle: true,
      },
      status: 200,
    }
  } catch (error) {
    console.error('[Agent Session Command] Error:', error)
    return {
      error: error instanceof Error ? error.message : 'Unknown error',
      status: 500,
    }
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/agents/[id]/session -- unlink or delete agent session
// ---------------------------------------------------------------------------

export async function unlinkOrDeleteAgentSession(
  agentId: string,
  params: UnlinkSessionParams
): Promise<ServiceResult<{
  success: boolean
  agentId: string
  deleted?: boolean
  sessionUnlinked?: boolean
  sessionKilled?: boolean
}>> {
  try {
    const { kill: killSession = false, deleteAgent: shouldDeleteAgent = false, sessionIndex = 0 } = params

    const agent = getAgent(agentId)
    if (!agent) {
      return { error: 'Agent not found', status: 404 }
    }

    const agentName = agent.name
    if (!agentName) {
      return { error: 'Agent has no name configured', status: 400 }
    }

    const runtime = getRuntime()
    // Use computeSessionName to derive the correct tmux session name (same as wakeAgent/hibernateAgent)
    const sessionName = computeSessionName(agentName, sessionIndex)

    if (shouldDeleteAgent) {
      // Kill tmux session if requested and exists
      if (killSession) {
        const exists = await runtime.sessionExists(sessionName)
        if (exists) {
          await runtime.killSession(sessionName)
          await unpersistSession(sessionName)
        }
      }

      // Hard delete with backup
      const success = await deleteAgent(agentId, true)
      if (!success) {
        return { error: 'Failed to delete agent', status: 500 }
      }

      return {
        data: {
          success: true,
          agentId,
          deleted: true,
          sessionKilled: killSession && !!sessionName,
        },
        status: 200,
      }
    }

    // Just unlink the session
    if (killSession) {
      const exists = await runtime.sessionExists(sessionName)
      if (exists) {
        await runtime.killSession(sessionName)
        await unpersistSession(sessionName)
      }
    }

    const success = await unlinkSession(agentId)
    if (!success) {
      return { error: 'Agent not found', status: 404 }
    }

    return {
      data: {
        success: true,
        agentId,
        sessionUnlinked: true,
        sessionKilled: killSession && !!sessionName,
      },
      status: 200,
    }
  } catch (error) {
    console.error('Failed to unlink/delete session:', error)
    return { error: 'Failed to unlink session', status: 500 }
  }
}

// ---------------------------------------------------------------------------
// R17-TRUST: Auto-accept Claude Code's directory trust prompt.
// Extracted from wakeAgent so it can also be called from createSession (BUG-003).
//
// This prompt is the ONLY thing that executes BEFORE plugins load and hooks start.
// Without accepting it, the agent is a zombie — invisible to AI Maestro.
// The function is non-blocking and never throws — it logs warnings on failure.
// ---------------------------------------------------------------------------

export async function handleTrustAutoAccept(sessionName: string, agentName: string): Promise<void> {
  const runtime = getRuntime()
  // Wait for Claude to start and render the trust prompt
  await new Promise(resolve => setTimeout(resolve, 2500))
  const maxAttempts = 8
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const { execSync: execSyncCapture } = await import('child_process')
      const pane = execSyncCapture(
        `tmux capture-pane -t "${sessionName}" -p -S -25`,
        { encoding: 'utf-8', timeout: 3000 }
      )
      // Fuzzy trust prompt detection (P004): match multiple patterns
      // in case Claude changes the wording in future versions.
      const paneLower = pane.toLowerCase()
      const hasTrustWord = paneLower.includes('trust')
      const hasFolderWord = paneLower.includes('folder') || paneLower.includes('directory') || paneLower.includes('workspace')
      const hasSelector = pane.includes('❯') || pane.includes('>')
      const hasExactMatch = pane.includes('Yes, I trust this folder') || pane.includes('trust this folder')
      if (hasExactMatch || (hasTrustWord && hasFolderWord && hasSelector)) {
        await runtime.sendKeys(sessionName, '', { enter: true })
        const matchType = hasExactMatch ? 'exact' : 'fuzzy'
        console.log(`[R17-TRUST] Auto-accepted directory trust prompt for "${agentName}" (${matchType} match)`)
        if (!hasExactMatch) {
          console.warn(`[R17-TRUST] Fuzzy match used — Claude may have changed trust prompt wording. Check pane content.`)
        }
        return
      }
      // If Claude's main prompt is visible, trust was not asked (dir already trusted)
      if (pane.includes('╭─')) {
        return
      }
    } catch { /* pane capture failed — session still starting */ }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
}

// ---------------------------------------------------------------------------
// POST /api/agents/[id]/wake -- wake a hibernated agent
// ---------------------------------------------------------------------------

export async function wakeAgent(agentId: string, params: WakeAgentParams): Promise<ServiceResult<{
  success: boolean
  agentId: string
  name: string
  sessionName: string
  sessionIndex: number
  workingDirectory?: string
  woken: boolean
  alreadyRunning?: boolean
  programStarted?: boolean
  message: string
}>> {
  try {
    const { startProgram = true, sessionIndex = 0, program: programOverride, authContext } = params

    // ── Gate 0: Authorization ───────────────────────────────────
    // When authContext is provided (route call), check caller permissions.
    // Gate 0: Authorization — when authContext provided, check RBAC
    if (authContext && !authContext.isSystemOwner) {
      const { authorize } = await import('@/lib/authorization')
      const authResult: import('@/lib/agent-auth').AgentAuthResult = {
        agentId: authContext.agentId,
        governanceTitle: authContext.governanceTitle,
        teamId: authContext.teamId,
      }
      const authz = authorize(authResult, 'wake-agent', agentId)
      if (!authz.allowed) {
        return { error: authz.reason || 'Not authorized to wake this agent', status: 403 }
      }
    }

    // Gate 1: Manager gate — team agents cannot be woken without a MANAGER (R10.5)
    // This runs ALWAYS, even for internal calls — it's a system invariant, not just RBAC.
    const { getManagerId } = await import('@/lib/governance')
    const { isAgentInAnyTeam } = await import('@/lib/team-registry')
    if (!getManagerId() && isAgentInAnyTeam(agentId)) {
      return {
        error: 'Cannot wake team agent: no MANAGER exists on this host. Assign a MANAGER first.',
        status: 403,
      }
    }

    const agent = getAgent(agentId)
    if (!agent) {
      return { error: 'Agent not found', status: 404 }
    }

    const agentName = agent.name
    if (!agentName) {
      return { error: 'Agent has no name configured', status: 400 }
    }

    const workingDirectory = agent.workingDirectory ||
                            agent.preferences?.defaultWorkingDirectory ||
                            process.cwd()

    const runtime = getRuntime()
    const sessionName = computeSessionName(agentName, sessionIndex)

    // Check if session already exists
    const exists = await runtime.sessionExists(sessionName)
    if (exists) {
      updateAgentSessionInRegistry(agentId, sessionIndex, 'online', workingDirectory)
      return {
        data: {
          success: true,
          agentId,
          name: agentName,
          sessionName,
          sessionIndex,
          woken: true,
          alreadyRunning: true,
          message: `Agent "${agentName}" session ${sessionIndex} was already running`,
        },
        status: 200,
      }
    }

    // ── R17 GATE: Ensure ai-maestro-plugin is installed BEFORE creating tmux session.
    // Without the plugin, the agent has no hooks → no state detection → AI Maestro is blind.
    // An agent without ai-maestro-plugin cannot exist in a functional state (R17.5).
    // This gate runs BEFORE session creation so the plugin is ready when the client starts.
    // Delegates to the unified InstallElement AIO function.
    //
    // SCEN-013 PROP-P0-002 FIX (013.05): Make the R17 wake-gate client-aware.
    // Previously this block read ONLY .claude/settings.local.json to determine
    // whether the core plugin was installed. For Codex agents that file does
    // not exist (their manifest lives at .codex/installed-plugins/), so
    // hasPlugin was always false and InstallElement re-fired on every wake.
    // We now use scanAgentLocalConfig (the same scanner the UI Config tab uses)
    // — which dispatches to the correct per-client scanner — and isCorePlugin()
    // from ecosystem-constants for the boundary-aware identity check (single
    // source of truth, no literal name compare).
    //
    // Unsupported clients (gemini/opencode/kiro/aider/unknown) bail with HTTP
    // 501 instead of silently succeeding. We refuse rather than pretend the
    // gate passed because these clients have no validated plugin install path
    // yet — running them headless would skip R17 entirely.
    {
      const { detectClientType } = await import('@/lib/client-capabilities')
      const clientType = detectClientType(agent.program || '')

      // Refuse unsupported clients up-front. Only Claude and Codex have
      // validated InstallElement adapter coverage today (R18.3d). Gemini /
      // OpenCode / Kiro need their own wake-gate validation before they can
      // be enabled here.
      if (clientType !== 'claude' && clientType !== 'codex') {
        return {
          error: `Wake is not yet implemented for client "${clientType}". ` +
            `Only Claude and Codex agents are supported. ` +
            `Implement an InstallElement adapter for "${clientType}" and update wakeAgent before enabling this client.`,
          status: 501,
        }
      }

      const { InstallElement } = await import('@/services/element-management-service')
      const { scanAgentLocalConfig } = await import('@/services/agent-local-config-service')
      const { isCorePlugin } = await import('@/lib/ecosystem-constants')

      // Ensure .claude/ exists so the (legacy) Claude install path can write
      // settings.local.json without falling over. Harmless for Codex since
      // its install path uses .codex/.
      const { mkdirSync: mkdirR17 } = await import('fs')
      const { join: joinR17 } = await import('path')
      mkdirR17(joinR17(workingDirectory, '.claude'), { recursive: true })

      // Client-aware presence check via the unified scanner. Returns true
      // when ai-maestro-plugin is present and enabled at the client-native
      // path (Claude → .claude/settings.local.json, Codex → .codex/installed-plugins/).
      let hasPlugin = false
      const scanResult = scanAgentLocalConfig(agentId)
      if (scanResult.data) {
        const corePlugin = scanResult.data.plugins.find(p =>
          isCorePlugin(p.name, p.marketplace) && p.enabled !== false
        )
        hasPlugin = !!corePlugin
      }

      if (!hasPlugin) {
        console.log(`[Wake] R17: ai-maestro-plugin missing or disabled for "${agentName}" (client=${clientType}) — installing before wake...`)
        const installResult = await InstallElement({
          name: 'ai-maestro-plugin',
          marketplace: 'ai-maestro-plugins',
          action: 'install',
          scope: 'local',
          agentDir: workingDirectory,
          agentId,
          clientType: clientType as 'claude' | 'codex' | 'gemini' | 'opencode' | 'kiro' | 'unknown',
        })

        if (!installResult.success) {
          // Reject the wake — agent cannot function without the plugin.
          // Status 400 with sentinel error="role_missing_core" mirrors the
          // R9.13 roleMissing rejection (role_plugin_required, 409) so the
          // UI can render a single "core dependency missing" alert surface
          // for both R9.13 (role-plugin) and R17 (core-plugin) violations.
          // The route handler expands "role_missing_core" into a rich JSON
          // body with profileDeepLink and remediation hints — see
          // app/api/agents/[id]/wake/route.ts. PG02 in InstallElement
          // already set corePluginMissing=true on the registry, so the next
          // wake will be caught by the route-level check before we even
          // hit this gate.
          return {
            error: 'role_missing_core',
            status: 400,
          }
        }
        console.log(`[Wake] R17: ai-maestro-plugin installed for "${agentName}" (${installResult.operations.length} gates)`)
      } else if (agent.corePluginMissing) {
        // Plugin is present — clear stale flag
        const { updateAgent: updateAgentR17Clear } = await import('@/lib/agent-registry')
        await updateAgentR17Clear(agentId, { corePluginMissing: false } as import('@/types/agent').UpdateAgentRequest)
      }
    }

    // PRE-CREATE: build the env bag for `tmux new-session -e KEY=VAL`.
    //
    // WT-014#1 + WT-022#1 follow-up (was explicitly out of scope in dcd8c870).
    // The previous wake path did:
    //   1. runtime.createSession(name, cwd)                  ← empty env
    //   2. setupAMPForSession → runtime.setEnvironment(...)  ← race: pane already running
    //   3. sendKeys: "export AMP_DIR=...; <cmd>"              ← shell-export race
    //
    // That's the same env-injection race that dcd8c870 fixed in
    // sessions-service::createSession. Variables set via `tmux set-environment`
    // only reach FUTURE panes, not the already-running initial pane. The
    // `export` line inside send-keys depends on the shell being ready and can
    // be clobbered if the user attaches mid-boot or the login hooks are slow.
    // The ONLY atomic path is `tmux new-session -e KEY=VAL`, which requires
    // computing the env BEFORE createSession.
    //
    // AGENT_WORK_DIR    — used by the directory-guard hook (sandbox boundary)
    // AIM_AGENT_NAME/ID — used by AMP messaging + state-tracking hooks
    // AMP_DIR           — set if initAgentAMPHome succeeds (non-fatal otherwise)
    const initialEnv: Record<string, string> = {
      AGENT_WORK_DIR: workingDirectory,
      AIM_AGENT_NAME: agentName,
      AIM_AGENT_ID: agentId,
    }

    // AMP init runs pre-create so AMP_DIR lands in the initial pane's env.
    // If it fails we log and continue with no AMP_DIR — AMP isn't strictly
    // required for session creation.
    let ampDir = ''
    try {
      await initAgentAMPHome(agentName, agentId)
      ampDir = getAgentAMPDir(agentName, agentId) || ''
      if (ampDir) initialEnv.AMP_DIR = ampDir
    } catch (ampErr) {
      console.warn(`[Wake] Could not init AMP home for ${agentName}:`, ampErr)
    }

    // Create new tmux session with atomic env injection
    try {
      await runtime.createSession(sessionName, workingDirectory, initialEnv)
    } catch (error) {
      console.error(`[Wake] Failed to create tmux session:`, error)
      return { error: 'Failed to create tmux session', status: 500 }
    }

    // Persist session metadata
    await persistSession({
      id: sessionName,
      name: sessionName,
      workingDirectory,
      createdAt: new Date().toISOString(),
      agentId,
    })

    // Belt-and-braces: setEnvironment on the tmux session so any FUTURE pane
    // opened via tmux keybinding also sees the vars. The initial pane already
    // has them via the -e injection above.
    await setupAMPForSession(sessionName, agentName, agentId).catch(() => {})

    // Start the AI program if requested
    if (startProgram) {
      const program = (programOverride || agent.program || 'claude code').toLowerCase()
      console.log(`[Wake] Final program selection: "${program}" (override: ${programOverride}, agent.program: ${agent.program})`)

      if (program === 'none' || program === 'terminal') {
        // Terminal-only mode: env is already baked in via tmux -e (initialEnv
        // above). No shell-export needed. Just unset CLAUDECODE so the shell
        // knows it's not running under Claude Code.
        try {
          await runtime.sendKeys(sessionName, `unset CLAUDECODE`, { enter: true })
        } catch { /* non-fatal */ }
        console.log(`[Wake] Terminal only mode - no AI program started`)
      } else {
        let startCommand = resolveStartCommand(program)

        // Build full command with programArgs
        let fullCommand = startCommand
        if (agent.programArgs) {
          const args = sanitizeArgs(agent.programArgs)
          if (args) {
            fullCommand = `${startCommand} ${args}`
          }
        }

        // Small delay to let the session initialize
        await new Promise(resolve => setTimeout(resolve, 300))

        // Env vars (AMP_DIR, AIM_AGENT_NAME, AIM_AGENT_ID, AGENT_WORK_DIR) are
        // already in the initial pane's env via tmux -e. Just unset
        // CLAUDECODE + launch the program.
        try {
          await runtime.sendKeys(sessionName, `unset CLAUDECODE; ${fullCommand}`, { enter: true })
        } catch (error) {
          console.error(`[Wake] Failed to start program:`, error)
        }
      }
    }

    // R17-TRUST: Auto-accept trust prompt on first launch (BUG-003 fix: extracted to handleTrustAutoAccept)
    const isFirstLaunch = !agent.launchCount || agent.launchCount === 0
    if (startProgram && isFirstLaunch) {
      // Run in background — don't block the wake response (R17.23)
      handleTrustAutoAccept(sessionName, agentName).catch(() => {})
    }

    // Update agent status in registry
    updateAgentSessionInRegistry(agentId, sessionIndex, 'online', workingDirectory, true)

    console.log(`[Wake] Agent ${agentName} (${agentId}) session ${sessionIndex} woken up successfully`)

    return {
      data: {
        success: true,
        agentId,
        name: agentName,
        sessionName,
        sessionIndex,
        workingDirectory,
        woken: true,
        programStarted: startProgram,
        message: `Agent "${agentName}" session ${sessionIndex} has been woken up and is ready to use.`,
      },
      status: 200,
    }
  } catch (error) {
    console.error('[Wake] Error:', error)
    return {
      error: error instanceof Error ? error.message : 'Failed to wake agent',
      status: 500,
    }
  }
}

// ---------------------------------------------------------------------------
// POST /api/agents/[id]/hibernate -- hibernate an agent
// ---------------------------------------------------------------------------

export async function hibernateAgent(agentId: string, params: HibernateAgentParams): Promise<ServiceResult<{
  success: boolean
  agentId: string
  name?: string
  sessionName: string
  sessionIndex: number
  hibernated: boolean
  message: string
}>> {
  try {
    const { sessionIndex = 0, authContext } = params

    // ── Gate 0: Authorization ───────────────────────────────────
    // When authContext is provided (route call), check caller permissions.
    // When absent (internal call), skip — backward compatible.
    if (authContext) {
      if (!authContext.isSystemOwner) {
        const { authorize } = await import('@/lib/authorization')
        const authResult: import('@/lib/agent-auth').AgentAuthResult = {
          agentId: authContext.agentId,
          governanceTitle: authContext.governanceTitle,
          teamId: authContext.teamId,
        }
        const authz = authorize(authResult, 'hibernate-agent', agentId)
        if (!authz.allowed) {
          return { error: authz.reason || 'Not authorized to hibernate this agent', status: 403 }
        }
      }
    }

    const agent = getAgent(agentId)
    if (!agent) {
      return { error: 'Agent not found', status: 404 }
    }

    const agentName = agent.name
    if (!agentName) {
      return { error: 'Agent has no name configured', status: 400 }
    }

    // SCEN-013 PROP-P0-002 FIX (013.03): Make hibernate client-aware.
    // Previously this function sent Claude-specific keystrokes (C-c then
    // literal `"exit"`). For Codex the same keystrokes happen to fall
    // through to the tmux killSession at the bottom — so hibernate "worked"
    // by accident — but the graceful-shutdown phase did nothing useful and
    // any logs that watch for `/exit` would never see it. We now look up
    // the per-client cancel + exit verbs from client-capabilities.ts and
    // refuse outright for clients that have no validated hibernate path
    // yet (gemini / opencode / kiro / aider / unknown) so we never silently
    // produce a half-baked offline state.
    const { detectClientType, getClientCapabilities } = await import('@/lib/client-capabilities')
    const clientType = detectClientType(agent.program || '')

    if (clientType !== 'claude' && clientType !== 'codex') {
      return {
        error: `Hibernate is not yet implemented for client "${clientType}". ` +
          `Only Claude and Codex agents are supported. ` +
          `Implement a graceful-exit path for "${clientType}" before enabling this client.`,
        status: 501,
      }
    }

    const caps = getClientCapabilities(agent.program || clientType)
    const cancelKey = caps.cli.cancel || 'C-c'   // tmux key — e.g. 'C-c'
    const exitCommand = caps.cli.exit || '/exit' // typed-in-client command — e.g. '/exit'

    const runtime = getRuntime()
    const sessionName = computeSessionName(agentName, sessionIndex)

    // Check if session exists
    const exists = await runtime.sessionExists(sessionName)
    if (!exists) {
      // Session doesn't exist, just update the status and clean up any stale activity entry
      updateAgentSessionInRegistry(agentId, sessionIndex, 'offline')
      // Clear stale activity so that if this session name is reused, idle-checks start fresh
      sessionActivity.delete(sessionName)

      return {
        data: {
          success: true,
          agentId,
          sessionName,
          sessionIndex,
          hibernated: true,
          message: 'Session was already terminated, agent status updated',
        },
        status: 200,
      }
    }

    // Try to gracefully stop the AI client first (per-client). Both Claude
    // and Codex accept C-c to cancel any in-flight turn, then `/exit` (typed
    // literally with Enter) to leave the client. Codex has no hooks to
    // tear down, so the sequence is identical for both — only the verbs
    // differ in principle (Claude:/exit, Codex:/exit — but read from caps
    // so future clients can override). The killSession below is the
    // belt-and-braces fallback if the graceful path fails.
    try {
      await runtime.sendKeys(sessionName, cancelKey)
      await new Promise(resolve => setTimeout(resolve, 500))
      await runtime.sendKeys(sessionName, exitCommand, { literal: true, enter: true })
      await new Promise(resolve => setTimeout(resolve, 1000))
    } catch (e) {
      console.log(`[Hibernate] Graceful shutdown attempt failed for ${sessionName} (client=${clientType}), will force kill`)
    }

    // Kill the tmux session
    try {
      await runtime.killSession(sessionName)
    } catch (e) {
      console.log(`[Hibernate] Session ${sessionName} may have already closed`)
    }

    // Remove from session persistence
    await unpersistSession(sessionName)
    // Clear activity entry so that if the session name is reused later, idle-checks start fresh
    sessionActivity.delete(sessionName)

    // Post-gate: Invalidate AID session secret — the old AID_AUTH is no longer valid
    // A new secret will be generated when the agent is woken again.
    try {
      const { updateAgent: updAgent } = await import('@/lib/agent-registry')
      await updAgent(agentId, { metadata: { sessionSecretHash: null } } as any)
    } catch { /* non-fatal — secret will be overwritten on next wake */ }

    // Update agent status in registry
    updateAgentSessionInRegistry(agentId, sessionIndex, 'offline')

    console.log(`[Hibernate] Agent ${agentName} (${agentId}) session ${sessionIndex} hibernated successfully`)

    return {
      data: {
        success: true,
        agentId,
        name: agentName,
        sessionName,
        sessionIndex,
        hibernated: true,
        message: `Agent "${agentName}" session ${sessionIndex} has been hibernated. Use wake to restart.`,
      },
      status: 200,
    }
  } catch (error) {
    console.error('[Hibernate] Error:', error)
    return {
      error: error instanceof Error ? error.message : 'Failed to hibernate agent',
      status: 500,
    }
  }
}

// ---------------------------------------------------------------------------
// POST /api/agents/startup -- initialize all agents
// ---------------------------------------------------------------------------

export async function initializeStartup(): Promise<ServiceResult<{
  success: boolean
  message: string
  initialized: string[]
  failed: Array<{ agentId: string; error: string }>
}>> {
  try {
    console.log('[Startup] Initializing all agents...')
    const result = await initializeAllAgents()
    console.log(`[Startup] Complete: ${result.initialized.length} agents initialized`)

    return {
      data: {
        success: true,
        message: `Initialized ${result.initialized.length} agent(s)`,
        initialized: result.initialized,
        failed: result.failed,
      },
      status: 200,
    }
  } catch (error) {
    console.error('[Startup] Error:', error)
    return {
      error: error instanceof Error ? error.message : 'Unknown error',
      status: 500,
    }
  }
}

// ---------------------------------------------------------------------------
// GET /api/agents/startup -- get startup status
// ---------------------------------------------------------------------------

/** NT-004: Typed return for getStartupInfo */
interface StartupInfo {
  success: boolean
  discoveredAgents: number
  activeAgents: number
  agents: Array<{ agentId: string; initialized: boolean; subconscious: boolean }>
}

export function getStartupInfo(): ServiceResult<StartupInfo> {
  try {
    const status = getStartupStatus()
    return { data: { success: true, ...status }, status: 200 }
  } catch (error) {
    console.error('[Startup] Error:', error)
    return {
      error: error instanceof Error ? error.message : 'Unknown error',
      status: 500,
    }
  }
}

// ---------------------------------------------------------------------------
// POST /api/agents/health -- proxy health check
// ---------------------------------------------------------------------------

/** NT-005: Typed return for proxyHealthCheck -- JSON shape comes from the remote agent */
interface HealthCheckResult {
  [key: string]: unknown
}

export async function proxyHealthCheck(url: string): Promise<ServiceResult<HealthCheckResult>> {
  try {
    if (!url || typeof url !== 'string') {
      return { error: 'URL is required', status: 400 }
    }

    // CC-P1-601: Validate URL scheme — only allow http/https to prevent file://, gopher://, etc.
    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
    } catch {
      return { error: 'Invalid URL format', status: 400 }
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return { error: 'Only http and https URLs are allowed', status: 400 }
    }

    // CC-P1-601: Reject private/internal IP ranges (RFC 1918, loopback, link-local, metadata)
    const hostname = parsedUrl.hostname
    const privatePatterns = [
      /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
      /^169\.254\./, /^0\./, /^::1$/, /^fc00:/i, /^fe80:/i, /^fd/i,
      /^localhost$/i,
    ]
    const isPrivateIP = privatePatterns.some(pattern => pattern.test(hostname))

    // CC-P1-601: Only allow requests to known peer hosts from hosts.json
    // SF-010 accepted risk: hosts.json is writable via /api/hosts, so a compromised host entry
    // could be used as SSRF proxy. In Phase 2 with remote access, add private IP blocking
    // regardless of hosts.json.
    const knownHosts = getHosts()
    const isKnownHost = knownHosts.some(host => {
      try {
        const hostUrl = new URL(host.url)
        if (hostUrl.hostname === hostname) return true
      } catch { /* skip malformed host URLs */ }
      // Also check aliases for IP/hostname matches
      return host.aliases?.some(alias => {
        // Alias could be an IP, hostname, or full URL
        if (alias === hostname) return true
        try {
          const aliasUrl = new URL(alias)
          return aliasUrl.hostname === hostname
        } catch {
          return alias === hostname
        }
      })
    })

    if (isPrivateIP && !isKnownHost) {
      return { error: 'URL target is not a known peer host', status: 403 }
    }

    if (!isKnownHost) {
      return { error: 'URL target is not a known peer host — only hosts from hosts.json are allowed', status: 403 }
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    })
    clearTimeout(timeoutId)

    if (!response.ok) {
      return { error: `Agent returned HTTP ${response.status}`, status: response.status }
    }

    const data = await response.json()
    return { data, status: 200 }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { error: 'Timeout connecting to agent', status: 504 }
    }
    return {
      error: `Failed to connect to agent: ${error instanceof Error ? error.message : 'Unknown error'}`,
      status: 500,
    }
  }
}
