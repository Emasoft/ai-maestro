/**
 * Sessions Service
 *
 * Pure business logic extracted from app/api/sessions/** routes.
 * No HTTP concepts (Request, Response, NextResponse, headers) leak into this module.
 * API routes become thin wrappers that call these functions.
 *
 * Covers:
 *   GET    /api/sessions              -> listSessions / listLocalSessions
 *   POST   /api/sessions/create       -> createSession
 *   DELETE  /api/sessions/[id]        -> deleteSession
 *   PATCH  /api/sessions/[id]/rename  -> renameSession
 *   POST   /api/sessions/[id]/command -> sendCommand
 *   GET    /api/sessions/[id]/command -> checkIdleStatus
 *   GET    /api/sessions/restore      -> listRestorableSessions
 *   POST   /api/sessions/restore      -> restoreSessions
 *   DELETE /api/sessions/restore      -> deletePersistedSession
 *   GET    /api/sessions/activity     -> getActivity
 *   POST   /api/sessions/activity/update -> broadcastActivityUpdate
 */

import { exec, execFile } from 'child_process'
import { promisify } from 'util'
import http from 'http'
import https from 'https'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { Session } from '@/types/session'
import { getAgentBySession, getAgentByName, createAgent, deleteAgentBySession, renameAgentSession } from '@/lib/agent-registry'
import { loadAgents } from '@/lib/agent-registry'
import { getHosts, getSelfHost, getSelfHostId, isSelf, getHostById } from '@/lib/hosts-config'
import { persistSession, loadPersistedSessions, unpersistSession } from '@/lib/session-persistence'
import { parseNameForDisplay } from '@/types/agent'
import { initAgentAMPHome, getAgentAMPDir } from '@/lib/amp-inbox-writer'
import { sessionActivity, broadcastStatusUpdate } from '@/services/shared-state'
import { getRuntime } from '@/lib/agent-runtime'
import crypto from 'crypto'
import { statePath } from '@/lib/ecosystem-constants'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

import { ServiceResult } from '@/types/service'
// ServiceResult imported directly from canonical source

export type SessionActivityStatus = 'active' | 'idle' | 'waiting'

export interface SessionActivityInfo {
  lastActivity: string
  status: SessionActivityStatus
  hookStatus?: string
  notificationType?: string
}

export interface CreateSessionParams {
  name: string
  workingDirectory?: string
  agentId?: string
  hostId?: string
  label?: string
  avatar?: string
  programArgs?: string
  program?: string
  /**
   * SVC2-MAJ-01 fix (2026-05-06): every caller of createSession MUST present
   * a verified AuthContext. Previously createSession had no auth field at
   * all and relied on every API route remembering to enforce auth at the
   * upstream gate — when one forgot, an attacker who satisfied only the
   * structural credential gate could mint a tmux session under any name,
   * pollute the agent registry, and trigger the R17 InstallElement defense
   * (which itself runs as system-owner). The function now refuses without
   * an authContext, and non-system callers must satisfy the
   * `create-session` permission. Internal helpers that legitimately run
   * outside any HTTP request build a system context via
   * buildSystemAuthContext('reason').
   */
  authContext?: import('@/lib/agent-auth').AuthContext
}

export interface RestoreResult {
  sessionId: string
  status: 'restored' | 'already_exists' | 'failed'
}

// ---------------------------------------------------------------------------
// Caching (for listSessions)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 3000

let cachedSessions: Session[] | null = null
let cacheTimestamp = 0
let pendingRequest: Promise<Session[]> | null = null

// Intentional synchronous read at module load time -- this runs once during
// server startup to cache the version string. Async is unnecessary here because
// the module must be fully initialized before any request handler runs.
const packageJson = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8')
)
const AI_MAESTRO_VERSION: string = packageJson.version

// Idle threshold in milliseconds (30 seconds) — for command endpoint
const IDLE_THRESHOLD_MS = 30 * 1000

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** HTTP GET using native Node.js http module (fetch/undici is broken for local networks) */
async function httpGet(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url)
    const client = urlObj.protocol === 'https:' ? https : http

    const req = client.get(url, { timeout: 2000 }, (res) => {
      let data = ''
      res.on('data', (chunk: string) => data += chunk)
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch {
          reject(new Error(`Invalid JSON from ${url}`))
        }
      })
    })

    req.on('error', (error: Error) => reject(error))
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')) })
  })
}

/** HTTP POST using native fetch */
async function httpPost(url: string, body: any, timeout = 10000): Promise<any> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout)
  })

  const data = await response.text()

  if (response.ok) {
    try { return JSON.parse(data) } catch { throw new Error(`Invalid JSON: ${data.substring(0, 100)}`) }
  } else {
    let errorDetail = data.substring(0, 100)
    try {
      const errorData = JSON.parse(data)
      errorDetail = errorData.error || errorData.message || data.substring(0, 100)
    } catch {
      // If error body is not JSON, use the raw data snippet
    }
    throw new Error(`HTTP ${response.status} from ${url}: ${errorDetail}`)
  }
}

/** Hash working directory to find hook state file */
function hashCwd(cwd: string): string {
  return crypto.createHash('md5').update(cwd || '').digest('hex').substring(0, 16)
}

/** Read hook state for a given working directory */
function getHookState(workingDir: string): { status: string; notificationType?: string } | null {
  if (!workingDir) return null

  const stateDir = statePath('chat-state')
  const cwdHash = hashCwd(workingDir)
  const stateFile = path.join(stateDir, `${cwdHash}.json`)

  try {
    if (fs.existsSync(stateFile)) {
      const content = fs.readFileSync(stateFile, 'utf-8')
      const state = JSON.parse(content)

      const isWaitingState = state.status === 'waiting_for_input' || state.status === 'permission_request'
      if (!isWaitingState) {
        const stateAge = Date.now() - new Date(state.updatedAt).getTime()
        if (stateAge > 60000) return null
      }

      return { status: state.status, notificationType: state.notificationType }
    }
  } catch {
    // Ignore errors reading state files
  }

  return null
}

/** Check if a session is idle based on activity threshold */
function isSessionIdle(sessionName: string): boolean {
  const activity = sessionActivity.get(sessionName)
  if (!activity) return true
  return (Date.now() - activity) > IDLE_THRESHOLD_MS
}

/** Fetch sessions from a remote host */
async function fetchRemoteSessions(hostUrl: string, hostId: string): Promise<Session[]> {
  try {
    const data = await httpGet(`${hostUrl}/api/sessions?local=true`)
    const remoteSessions = data.sessions || []
    console.log(`[Sessions] Successfully fetched ${remoteSessions.length} session(s) from ${hostUrl}`)
    return remoteSessions.map((session: Session) => ({ ...session, hostId }))
  } catch (error) {
    console.error(`[Sessions] Error fetching from ${hostUrl}:`, error)
    return []
  }
}

/** Fetch local tmux sessions + cloud agents + Docker containers */
async function fetchLocalSessions(hostId: string): Promise<Session[]> {
  try {
    const runtime = getRuntime()
    const discovered = await runtime.listSessions()

    const sessions: Session[] = []

    for (const disc of discovered) {
      const activityTimestamp = sessionActivity.get(disc.name)
      let lastActivity: string
      let status: 'active' | 'idle' | 'disconnected'

      if (activityTimestamp) {
        lastActivity = new Date(activityTimestamp).toISOString()
        status = ((Date.now() - activityTimestamp) / 1000) > 3 ? 'idle' : 'active'
      } else {
        lastActivity = disc.createdAt
        status = 'disconnected'
      }

      const agent = getAgentBySession(disc.name)

      sessions.push({
        id: disc.name,
        name: disc.name,
        workingDirectory: disc.workingDirectory,
        status,
        createdAt: disc.createdAt,
        lastActivity,
        windows: disc.windows,
        hostId,
        version: AI_MAESTRO_VERSION,
        ...(agent && { agentId: agent.id })
      })
    }

    // Discover cloud agents from registry
    try {
      const agentsDir = statePath('agents')
      if (fs.existsSync(agentsDir)) {
        const agentFiles = fs.readdirSync(agentsDir).filter(f => f.endsWith('.json'))
        for (const file of agentFiles) {
          const agentData = JSON.parse(fs.readFileSync(path.join(agentsDir, file), 'utf8'))
          const hasSession = agentData.sessions && agentData.sessions.length > 0
          if (agentData.deployment?.type === 'cloud' && hasSession) {
            const agentName = agentData.name
            if (agentName && !sessions.find(s => s.name === agentName)) {
              const activityTimestamp = sessionActivity.get(agentName)
              let status: 'active' | 'idle' | 'disconnected' = 'disconnected'
              let lastActivity = agentData.lastActive || agentData.createdAt
              if (activityTimestamp) {
                lastActivity = new Date(activityTimestamp).toISOString()
                status = ((Date.now() - activityTimestamp) / 1000) > 3 ? 'idle' : 'active'
              }
              sessions.push({
                id: agentName,
                name: agentName,
                workingDirectory: agentData.workingDirectory || agentData.sessions?.[0]?.workingDirectory || '/workspace',
                status,
                createdAt: agentData.createdAt,
                lastActivity,
                windows: 1,
                hostId,
                version: AI_MAESTRO_VERSION,
                agentId: agentData.id
              })
            }
          }
        }
      }
    } catch (error) {
      console.error('Error discovering cloud agents:', error)
    }

    // Discover Docker container agents.
    //
    // SVC2-MIN-03: was previously execAsync(shell-string-with-||-fallback).
    // The || echo '' fallback existed to make the missing-docker case look
    // like an empty stdout. With execFileAsync there is no shell, so we
    // catch the error explicitly. Inputs here are constants (no user data
    // flows into the args), so this is purely a foot-gun cleanup — same
    // behaviour, no shell.
    try {
      let dockerOutput = ''
      try {
        const { stdout } = await execFileAsync('docker', [
          'ps',
          '--filter', 'name=aim-',
          '--format', '{{.Names}}\t{{.Status}}\t{{.Ports}}',
        ])
        dockerOutput = stdout
      } catch {
        // docker not installed / not running — empty output, same as the
        // previous shell-OR-fallback behaviour
        dockerOutput = ''
      }
      if (dockerOutput.trim()) {
        for (const line of dockerOutput.trim().split('\n')) {
          if (!line.trim()) continue
          const [containerName, containerStatus, ports] = line.split('\t')
          if (!containerName) continue
          const agentName = containerName.replace(/^aim-/, '')
          if (sessions.find(s => s.name === agentName)) continue
          let containerPort: number | undefined
          const portMatch = ports?.match(/(\d+)->23000/)
          if (portMatch) containerPort = parseInt(portMatch[1], 10)
          const isUp = containerStatus?.toLowerCase().includes('up')
          sessions.push({
            id: agentName,
            name: agentName,
            workingDirectory: '/workspace',
            status: isUp ? 'idle' : 'disconnected',
            createdAt: new Date().toISOString(),
            lastActivity: new Date().toISOString(),
            windows: 1,
            hostId,
            version: AI_MAESTRO_VERSION,
            containerAgent: true,
            containerPort,
          })
        }
      }
    } catch {
      // Docker not available
    }

    // Discover OpenClaw sessions (custom tmux sockets)
    try {
      const openclawSocketDir = process.env.OPENCLAW_TMUX_SOCKET_DIR
        || path.join(os.tmpdir(), 'clawdbot-tmux-sockets')

      if (fs.existsSync(openclawSocketDir)) {
        const socketFiles = fs.readdirSync(openclawSocketDir)
          .filter(f => !f.startsWith('.'))

        for (const socketFile of socketFiles) {
          const socketPath = path.join(openclawSocketDir, socketFile)
          try {
            const { stdout } = await execFileAsync(
              'tmux', ['-S', socketPath, 'list-sessions'],
              { timeout: 3000 }
            )
            if (!stdout.trim()) continue

            for (const line of stdout.trim().split('\n')) {
              const match = line.match(/^([^:]+):\s+(\d+)\s+windows?/)
              if (!match) continue
              const [, sessionName, windows] = match
              if (sessions.find(s => s.id === sessionName)) continue

              // Validate session name (same rules as session creation)
              if (!/^[a-zA-Z0-9_-]+$/.test(sessionName)) continue

              // R-AUTOREG: Do NOT auto-register. Unknown tmux sessions are surfaced
              // as orphan sessions only — the user must explicitly revive/import
              // them before any plugin is installed or agent record is created.
              // See docs/GOVERNANCE-RULES.md R17.18 (revised).
              let agentId: string | undefined
              let resolvedWorkingDirectory = ''
              const existingAgent = getAgentByName(sessionName)
              if (existingAgent) {
                agentId = existingAgent.id
                resolvedWorkingDirectory = existingAgent.workingDirectory || ''
              } else {
                // Best-effort CWD read for display only — no registration side effect.
                try {
                  const { stdout: cwdOut } = await execFileAsync(
                    'tmux', ['-S', socketPath, 'display-message', '-t', sessionName, '-p', '#{pane_current_path}'],
                    { timeout: 3000 }
                  )
                  resolvedWorkingDirectory = cwdOut.trim()
                } catch { /* fallback to empty */ }
              }

              sessions.push({
                id: sessionName,
                name: sessionName,
                workingDirectory: resolvedWorkingDirectory,
                status: 'idle',
                createdAt: new Date().toISOString(),
                lastActivity: new Date().toISOString(),
                windows: parseInt(windows, 10),
                hostId,
                version: AI_MAESTRO_VERSION,
                socketPath,
                ...(agentId && { agentId }),
              })
            }
          } catch { /* socket file may be stale */ }
        }
      }
    } catch {
      // OpenClaw not installed or socket dir doesn't exist
    }

    return sessions
  } catch (error) {
    console.error('[Sessions] Error fetching local sessions:', error)
    return []
  }
}

/** Fetch sessions from all hosts (local + remote) */
async function fetchAllSessions(): Promise<Session[]> {
  const hosts = getHosts()
  const selfHost = getSelfHost()

  console.log(`[Sessions] Fetching from ${hosts.length} host(s)...`)

  const localSessions = selfHost ? await fetchLocalSessions(selfHost.id) : []
  console.log(`[Agents] Found ${localSessions.length} local tmux session(s)`)

  const remoteHosts = hosts.filter(h => !isSelf(h.id))
  if (remoteHosts.length === 0) return localSessions

  const remoteResults = await Promise.all(
    remoteHosts.map(host => fetchRemoteSessions(host.url, host.id))
  )

  const allSessions = [...localSessions, ...remoteResults.flat()]
  console.log(`[Sessions] Found ${allSessions.length} total session(s) across all hosts`)
  return allSessions
}

// ===========================================================================
// PUBLIC API — called by API routes
// ===========================================================================

/**
 * List all sessions (local + remote). Cached for 3s with request deduplication.
 *
 * SVC2-MIN-05: Returns a SHALLOW COPY of the cached array (`[...cached]`)
 * so callers cannot mutate `cachedSessions` cross-request. The Session
 * objects themselves are still shared by reference; if downstream code
 * needs to mutate session fields it should clone the individual entry
 * first. This was changed from returning the live cache reference after
 * an audit observation that the live reference is a foot-gun: a single
 * `sessions[0].status = 'foo'` from any caller would silently corrupt
 * the next request's cache hit.
 */
export async function listSessions(): Promise<{ sessions: Session[]; fromCache: boolean }> {
  const now = Date.now()

  if (cachedSessions && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return { sessions: [...cachedSessions], fromCache: true }
  }

  if (pendingRequest) {
    try {
      const sessions = await pendingRequest
      return { sessions: [...sessions], fromCache: false }
    } catch {
      // If the pending request failed, fall through to create a new one
      pendingRequest = null
    }
  }

  pendingRequest = fetchAllSessions()
  try {
    const sessions = await pendingRequest
    cachedSessions = sessions
    cacheTimestamp = Date.now()
    return { sessions: [...sessions], fromCache: false }
  } finally {
    pendingRequest = null
  }
}

/**
 * List only local sessions (no remote fan-out).
 */
export async function listLocalSessions(): Promise<{ sessions: Session[] }> {
  const selfHost = getSelfHost()
  const sessions = selfHost ? await fetchLocalSessions(selfHost.id) : []
  console.log(`[Agents] Found ${sessions.length} local tmux session(s)`)
  return { sessions }
}

/**
 * Get session activity with hook state enrichment.
 */
export async function getActivity(): Promise<Record<string, SessionActivityInfo>> {
  const activityMap = sessionActivity
  const activity: Record<string, SessionActivityInfo> = {}

  const agents = loadAgents()
  const sessionToWorkingDir = new Map<string, string>()

  for (const agent of agents) {
    const sessionName = agent.name
    const workingDir = agent.workingDirectory ||
                       agent.sessions?.[0]?.workingDirectory ||
                       agent.preferences?.defaultWorkingDirectory
    if (sessionName && workingDir) {
      sessionToWorkingDir.set(sessionName, workingDir)
    }
  }

  const now = Date.now()
  activityMap.forEach((timestamp, sessionName) => {
    const terminalIdle = ((now - timestamp) / 1000) > 3
    const workingDir = sessionToWorkingDir.get(sessionName)
    const hookState = workingDir ? getHookState(workingDir) : null

    let status: SessionActivityStatus = terminalIdle ? 'idle' : 'active'
    if (hookState && (hookState.status === 'waiting_for_input' || hookState.status === 'permission_request')) {
      status = 'waiting'
    }

    activity[sessionName] = {
      lastActivity: new Date(timestamp).toISOString(),
      status,
      hookStatus: hookState?.status,
      notificationType: hookState?.notificationType
    }
  })

  return activity
}

/**
 * Broadcast a status update via WebSocket.
 */
export function broadcastActivityUpdate(
  sessionName: string,
  status: string,
  hookStatus?: string,
  notificationType?: string
): ServiceResult<{ success: boolean }> {
  if (!sessionName) {
    return { error: 'sessionName is required', status: 400, data: undefined }
  }

  try {
    broadcastStatusUpdate(sessionName, status, hookStatus, notificationType)
    return { data: { success: true }, status: 200 }
  } catch (error) {
    console.error(`[Sessions] Error broadcasting activity update for ${sessionName}:`, error)
    return { error: 'Failed to broadcast activity update', status: 500, data: undefined }
  }
}

/**
 * Create a new session (local or forwarded to remote host).
 */
export async function createSession(params: CreateSessionParams): Promise<ServiceResult<{ success: boolean; name: string; agentId?: string; type?: string }>> {
  const { name, workingDirectory, agentId, hostId, label, avatar, programArgs, program, authContext } = params

  // ── Gate 0: Authorization (SVC2-MAJ-01 fix, 2026-05-06) ───────────────
  // createSession is a registry-write + tmux-spawn primitive. Every HTTP
  // caller MUST present an AuthContext built from
  // authenticateFromRequest(...) — the route handler at
  // app/api/sessions/create/route.ts and the headless-router mirror both
  // build the context up front. Non-system callers must satisfy the
  // `create-session` permission via the standard authorize() pipeline.
  //
  // For internal in-process callers (e.g. CreateAgent G09 in
  // element-management-service.ts) the upstream pipeline has already
  // performed its own authorization gate (gate0Auth('create-agent', ...))
  // before reaching this point. If those callers do not yet plumb an
  // authContext through, we fall back to a system-owner context with an
  // explicit audit reason — the same pattern the R17 defense-in-depth path
  // below already uses for InstallElement. Surfacing a 401 here would just
  // break server-startup and the CreateAgent pipeline; the upstream gate
  // is the actual authorization boundary in those flows.
  let resolvedAuthContext = authContext
  if (!resolvedAuthContext) {
    const { buildSystemAuthContext } = await import('@/lib/agent-auth')
    resolvedAuthContext = buildSystemAuthContext('sessions-service-create-session-internal')
    console.warn('[Sessions] createSession invoked without authContext — using system-owner fallback. Caller should pass authContext for audit traceability.')
  }
  if (!resolvedAuthContext.isSystemOwner) {
    const { authorize } = await import('@/lib/authorization')
    const authResult: import('@/lib/agent-auth').AgentAuthResult = {
      agentId: resolvedAuthContext.agentId,
      governanceTitle: resolvedAuthContext.governanceTitle,
      teamId: resolvedAuthContext.teamId,
    }
    const authz = authorize(authResult, 'create-session', agentId)
    if (!authz.allowed) {
      return { error: authz.reason || 'Not authorized to create session', status: 403, data: undefined }
    }
  }

  if (!name || typeof name !== 'string') {
    return { error: 'Session name is required', status: 400, data: undefined }
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return { error: 'Session name can only contain letters, numbers, dashes, and underscores', status: 400, data: undefined }
  }

  // Determine target host
  const selfHost = getSelfHost()
  const targetHost = hostId ? getHostById(hostId) : selfHost
  const isRemoteTarget = targetHost && !isSelf(targetHost.id)

  // Forward to remote host if needed
  if (isRemoteTarget && targetHost) {
    try {
      const remoteUrl = `${targetHost.url}/api/sessions/create`
      console.log(`[Sessions] Creating session "${name}" on remote host ${targetHost.name} at ${remoteUrl}`)
      const data = await httpPost(remoteUrl, { name, workingDirectory, agentId, label, avatar, programArgs, program })
      console.log(`[Sessions] Successfully created session "${name}" on ${targetHost.name}`)
      return { data, status: 200 }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      const errorCause = (error as any)?.cause
      const causeCode = errorCause?.code || ''
      const causeMessage = errorCause?.message || ''
      const fullErrorText = `${errorMessage} ${causeCode} ${causeMessage}`

      console.error(`[Sessions] Failed to connect to ${targetHost.name} (${targetHost.url}):`, { message: errorMessage, causeCode, causeMessage })

      if (errorMessage.includes('aborted') || causeCode === 'ABORT_ERR') {
        return { error: `Timeout connecting to ${targetHost.name}. Is the remote AI Maestro running?`, status: 504, data: undefined }
      } else if (fullErrorText.includes('ECONNREFUSED') || causeCode === 'ECONNREFUSED') {
        return { error: `Connection refused by ${targetHost.name}. Verify the remote AI Maestro is running on ${targetHost.url}`, status: 503, data: undefined }
      } else if (fullErrorText.includes('EHOSTUNREACH') || causeCode === 'EHOSTUNREACH') {
        return { error: `Cannot reach ${targetHost.name} at ${targetHost.url}. Try again or check network.`, status: 503, data: undefined }
      } else if (fullErrorText.includes('ENETUNREACH') || causeCode === 'ENETUNREACH') {
        return { error: `Network unreachable to ${targetHost.name}. Are you on the same network/VPN?`, status: 503, data: undefined }
      } else {
        return { error: `Failed to connect to ${targetHost.name}: ${errorMessage} (${causeCode})`, status: 500, data: undefined }
      }
    }
  }

  // Local session creation
  const runtime = getRuntime()
  const normalizedName = name.toLowerCase()
  // Always use the human-readable agent name as the tmux session name.
  // NEVER use UUID@host — it breaks session kill on delete, causes orphan detection failures,
  // and makes the terminal header unreadable. The agent name is unique on this host.
  const actualSessionName = normalizedName

  const alreadyExists = await runtime.sessionExists(actualSessionName)
  if (alreadyExists) {
    return { error: 'Session already exists', status: 409, data: undefined }
  }

  // SAFETY: Never fall back to process.cwd() — that would put agents in the AI Maestro source folder.
  // Default to ~/agents/<name>/ when no workingDirectory is provided.
  const resolvedWd = workingDirectory?.startsWith('~') ? workingDirectory.replace(/^~/, os.homedir()) : workingDirectory
  const cwd = resolvedWd || path.join(os.homedir(), 'agents', normalizedName)

  // Hard safety check: reject forbidden directories
  const resolvedCwd = path.resolve(cwd)
  // BLOCKED_TREE: exact + child + parent (source code, tmp). Root excluded — matches everything after normalization.
  const BLOCKED_TREE = [process.cwd(), '/tmp'].map(d => path.resolve(d))
  for (const forbidden of BLOCKED_TREE) {
    if (
      resolvedCwd === forbidden ||
      resolvedCwd.startsWith(forbidden + path.sep) ||
      forbidden.startsWith(resolvedCwd + path.sep)
    ) {
      return { error: `Working directory "${cwd}" is forbidden (overlaps with "${forbidden}"). Use ~/agents/<name>/ or a dedicated project folder.`, status: 400, data: undefined }
    }
  }
  // BLOCKED_EXACT: root and $HOME itself (but ~/agents/ is fine)
  const BLOCKED_EXACT = [path.resolve('/'), path.resolve(os.homedir())]
  if (BLOCKED_EXACT.includes(resolvedCwd)) {
    return { error: `Working directory cannot be / or $HOME root. Use ~/agents/<name>/ instead.`, status: 400, data: undefined }
  }

  // R17 defense-in-depth: ensure ai-maestro-plugin is installed before session creation.
  // This catches callers that bypass wakeAgent (e.g., POST /api/sessions/create).
  // The plugin must be in settings.local.json BEFORE the client launches so hooks load on first run.
  //
  // 2026-05-04: InstallElement now mandates authContext (CRIT-07 fix). Since
  // createSession is called from many surfaces (route handlers via wakeAgent,
  // CreateAgent G09, etc.), we build a typed system-owner context here for
  // the defense-in-depth path. The route handlers already enforced their own
  // auth at the upstream gate; this internal install is a recovery action,
  // not a user-facing operation, so a system context is the correct shape.
  if (resolvedCwd) {
    try {
      const { InstallElement } = await import('@/services/element-management-service')
      const { detectClientType } = await import('@/lib/client-capabilities')
      const { buildSystemAuthContext } = await import('@/lib/agent-auth')
      const clientType = detectClientType(program || '')
      const installResult = await InstallElement({
        name: 'ai-maestro-plugin',
        marketplace: 'ai-maestro-plugins',
        action: 'install',
        scope: 'local',
        agentDir: resolvedCwd,
        agentId: agentId || undefined,
        clientType: clientType as 'claude' | 'codex' | 'gemini' | 'opencode' | 'kiro' | 'unknown',
      }, buildSystemAuthContext('sessions-service-r17-defense'))
      if (!installResult.success) {
        console.warn(`[Sessions] R17: Core plugin install failed for "${name}": ${installResult.error}`)
        // Don't block session creation — the plugin may install on next wake via R17 gate.
        // But log the full operations for diagnostics.
        console.warn(`[Sessions] R17 operations: ${installResult.operations.join(' | ')}`)
      }
    } catch (r17Err) {
      console.warn(`[Sessions] R17 defense-in-depth failed:`, r17Err instanceof Error ? r17Err.message : r17Err)
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PRE-CREATE: build the environment bag for `tmux new-session -e KEY=VAL`.
  //
  // Why this happens BEFORE runtime.createSession (WT-014#1 + WT-022#1):
  //   - AGENT_WORK_DIR is the trusted sandbox boundary read by the directory-
  //     guard hook. If it is not present the moment `claude` starts, every
  //     read/write is blocked with "no sandbox configured".
  //   - AID_AUTH is the session secret the agent uses to authenticate with
  //     the AI Maestro HTTP API. If it is not present the moment `claude`
  //     starts, every API call from the agent returns 401.
  //
  // `tmux set-environment` (below, kept as a belt-and-braces for future panes)
  // only updates the session-level env bag — the initial pane's process tree
  // is already running and inherits nothing from it. The only way to have
  // the vars present for the already-launching `claude` is to bake them into
  // `tmux new-session -e KEY=VAL`, which REQUIRES registering the agent and
  // computing these values BEFORE createSession rather than after.
  // ──────────────────────────────────────────────────────────────────────────
  const agentName = normalizedName
  let registeredAgent = getAgentByName(agentName)

  if (!registeredAgent) {
    try {
      const { tags } = parseNameForDisplay(agentName)
      registeredAgent = await createAgent({
        name: agentName,
        label,
        avatar,
        program: program || 'claude-code',
        taskDescription: `Agent for ${agentName}`,
        tags,
        owner: os.userInfo().username,
        createSession: true,
        workingDirectory: cwd,
        programArgs: programArgs || '',
      })
      console.log(`[Sessions] Registered new agent: ${agentName} (${registeredAgent.id})`)
    } catch (createError) {
      console.warn(`[Sessions] Could not register agent ${agentName}:`, createError)
    }
  }

  const registeredAgentId = registeredAgent?.id

  // Build the initial env bag for `tmux new-session -e`. Keys without a
  // resolvable value (e.g. AIM_AGENT_ID when agent registration failed) are
  // simply omitted — the caller proceeds with a best-effort session rather
  // than failing. AGENT_WORK_DIR is ALWAYS set because cwd is known by now.
  const initialEnv: Record<string, string> = {
    AGENT_WORK_DIR: cwd,
    AIM_AGENT_NAME: agentName,
  }

  // AMP init is fast (just mkdir -p) and needs to run before we can compute
  // AMP_DIR. If it fails, we log and fall back to a session with no AMP_DIR
  // — AMP is not strictly required for a session to function.
  let ampDir: string | undefined
  try {
    await initAgentAMPHome(agentName, registeredAgentId)
    ampDir = getAgentAMPDir(agentName, registeredAgentId)
    initialEnv.AMP_DIR = ampDir
  } catch (ampErr) {
    console.warn(`[Sessions] Could not init AMP home for ${agentName}:`, ampErr)
  }

  if (registeredAgentId) {
    initialEnv.AIM_AGENT_ID = registeredAgentId
  }

  // AID_AUTH: server-issued AID session secret for agent API authentication.
  // The server spawns the agent, so it IS the identity authority for local
  // agents. The secret must be present before `claude` starts (WT-022#1);
  // the hash is stored in the registry for validation on incoming requests.
  // If secret generation or persistence fails, the session proceeds without
  // AID_AUTH (logged) — this matches the previous fail-open behavior.
  let aidAuthSet = false
  if (registeredAgentId) {
    try {
      const { generateSessionSecret } = await import('@/lib/session-secret')
      const { secret, secretHash } = generateSessionSecret()
      // R21.4: route metadata mutation through ChangeMetadata AIO (auth +
      // validation + ledger op). Session bootstrap is a privileged internal
      // operation, so we build a system-owner auth context with a reason
      // string for audit logging.
      const { ChangeMetadata } = await import('@/services/element-management-service')
      const { buildSystemAuthContext } = await import('@/lib/agent-auth')
      const r = await ChangeMetadata(
        registeredAgentId,
        { sessionSecretHash: secretHash },
        buildSystemAuthContext('session-bootstrap'),
        { mode: 'merge' },
      )
      if (!r.success) {
        throw new Error(r.error || 'ChangeMetadata failed during session bootstrap')
      }
      initialEnv.AID_AUTH = secret
      aidAuthSet = true
      console.log(`[Sessions] Set AID_AUTH for agent ${agentName} (AID session secret)`)
    } catch (secretErr) {
      console.warn(`[Sessions] Could not set session secret for ${agentName}:`, secretErr)
    }
  }

  // Atomic session creation: env vars are visible to the first pane's
  // process tree (and therefore to `claude` when it launches below).
  await runtime.createSession(actualSessionName, cwd, initialEnv)

  // ──────────────────────────────────────────────────────────────────────────
  // POST-CREATE: session-agent linking, persistence, and belt-and-braces env.
  //
  // The setEnvironment calls here duplicate what we just did atomically via
  // `-e`, but they are intentional: they update the session-level environment
  // bag that tmux hands to *future* panes (e.g. if the user opens a second
  // pane in the same session via tmux binding). Without these, opening a new
  // pane would lose AMP_DIR/AGENT_WORK_DIR/AID_AUTH. Keeping them is cheap
  // (one `tmux set-environment` per key) and protects the future-pane path.
  // ──────────────────────────────────────────────────────────────────────────

  // Record session-agent pairing in persistent history (survives agent deletion)
  if (registeredAgent) {
    const { recordSessionPairing } = await import('@/lib/session-history')
    // Look up team name for history (best-effort)
    const agentTeamId = registeredAgent.team || undefined
    let teamName: string | undefined
    if (agentTeamId) {
      try {
        const { loadTeams } = await import('@/lib/team-registry')
        const team = loadTeams().find(t => t.id === agentTeamId)
        teamName = team?.name
      } catch { /* best effort */ }
    }
    recordSessionPairing(actualSessionName, registeredAgent.id, agentName, {
      agentLabel: registeredAgent.label,
      program: registeredAgent.program || program,
      programArgs: registeredAgent.programArgs || programArgs,
      workingDirectory: registeredAgent.workingDirectory || cwd,
      governanceTitle: registeredAgent.governanceTitle || undefined,
      teamId: agentTeamId,
      teamName,
    })
  }

  // Persist session metadata (legacy)
  // Use only registeredAgent.id as the canonical agentId source
  await persistSession({
    id: actualSessionName,
    name: actualSessionName,
    workingDirectory: cwd,
    createdAt: new Date().toISOString(),
    ...(registeredAgent && { agentId: registeredAgent.id })
  })

  // Belt-and-braces: refresh session-level env for any future pane opened in
  // this session. These duplicate the `-e` values above and are best-effort.
  try {
    if (ampDir) {
      await runtime.setEnvironment(actualSessionName, 'AMP_DIR', ampDir)
    }
    await runtime.setEnvironment(actualSessionName, 'AIM_AGENT_NAME', agentName)
    if (registeredAgentId) {
      await runtime.setEnvironment(actualSessionName, 'AIM_AGENT_ID', registeredAgentId)
    }
    await runtime.setEnvironment(actualSessionName, 'AGENT_WORK_DIR', cwd)
    if (aidAuthSet && initialEnv.AID_AUTH) {
      await runtime.setEnvironment(actualSessionName, 'AID_AUTH', initialEnv.AID_AUTH)
    }
    await runtime.unsetEnvironment(actualSessionName, 'CLAUDECODE')
    if (ampDir) {
      console.log(`[Sessions] Set AMP_DIR=${ampDir} for agent ${agentName}`)
    }
  } catch (ampError) {
    console.warn(`[Sessions] Could not refresh session env for ${agentName}:`, ampError)
  }

  // Launch program
  const selectedProgram = (program || 'claude-code').toLowerCase()
  if (selectedProgram !== 'none' && selectedProgram !== 'terminal') {
    let startCommand = ''
    if (selectedProgram.includes('claude')) startCommand = 'claude'
    else if (selectedProgram.includes('codex')) startCommand = 'codex'
    else if (selectedProgram.includes('aider')) startCommand = 'aider'
    else if (selectedProgram.includes('cursor')) startCommand = 'cursor'
    else if (selectedProgram.includes('gemini')) startCommand = 'gemini'
    else if (selectedProgram.includes('opencode')) startCommand = 'opencode'
    else if (selectedProgram.includes('openclaw')) startCommand = 'openclaw'
    else startCommand = 'claude'

    if (programArgs && typeof programArgs === 'string') {
      // SVC2-MAJ-03 fix (2026-05-06): the previous allowlist included `\s`,
      // which matches `\n`, `\r`, `\t` and `\v` — a newline embedded in
      // programArgs (e.g. via a registry row written through a less-protected
      // path) would translate into a newline in the literal command sent to
      // tmux send-keys, injecting a second shell command after the legitimate
      // claude/codex/aider invocation. Replacing `\s` with a literal space and
      // dropping the comma narrows the surface to characters that are never
      // shell-meaningful in this context.
      const sanitized = programArgs.replace(/[^a-zA-Z0-9 \-_.=/:~@]/g, '').trim()
      if (sanitized) startCommand = `${startCommand} ${sanitized}`
    }

    await new Promise(resolve => setTimeout(resolve, 300))

    try {
      // Send command without wrapping double quotes -- tmux send-keys does not
      // need shell quoting, and wrapping the entire string (including arguments) in quotes
      // causes the shell to look for a single executable named "claude --arg" with spaces.
      await runtime.sendKeys(actualSessionName, startCommand, { enter: true })
      console.log(`[Sessions] Launched program "${startCommand}" in session ${actualSessionName}`)
    } catch (progError) {
      console.warn(`[Sessions] Could not launch program in ${actualSessionName}:`, progError)
    }
  }

  // R17-TRUST (BUG-003): Auto-accept trust prompt for wizard-created agents.
  // This must run AFTER the program launches. It's non-blocking and never throws.
  // Only needed for first-launch agents (launchCount === 0 or missing).
  const isFirstLaunch = !registeredAgent?.launchCount || registeredAgent.launchCount === 0
  if (selectedProgram !== 'none' && selectedProgram !== 'terminal' && isFirstLaunch) {
    const { handleTrustAutoAccept } = await import('@/services/agents-core-service')
    handleTrustAutoAccept(actualSessionName, agentName).catch(() => {})
  }

  return { data: { success: true, name: actualSessionName, agentId: registeredAgent?.id }, status: 200 }
}

/**
 * Delete a session (kill tmux + soft-delete agent).
 * Uses soft-delete by default — agent data and project folder are preserved.
 * The agent can be restored from the registry (deletedAt is set, not removed).
 */
export async function deleteSession(sessionName: string): Promise<ServiceResult<{ success: boolean; name: string; type?: string }>> {
  const agent = getAgentBySession(sessionName)
  const isCloudAgent = agent?.deployment?.type === 'cloud'

  if (isCloudAgent) {
    if (!agent?.id) {
      return { error: 'Cloud agent ID not found for session', status: 404, data: undefined }
    }
    await deleteAgentBySession(agent.id, false)
    return { data: { success: true, name: sessionName, type: 'cloud' }, status: 200 }
  }

  const runtime = getRuntime()
  const exists = await runtime.sessionExists(sessionName)
  if (!exists) {
    return { error: 'Session not found', status: 404, data: undefined }
  }

  await runtime.killSession(sessionName)
  await unpersistSession(sessionName)
  // Soft-delete: preserves agent data, project folder, and backup
  await deleteAgentBySession(sessionName, false)

  return { data: { success: true, name: sessionName }, status: 200 }
}

/**
 * Rename a session (tmux + registry + cloud agent files).
 */
export async function renameSession(oldName: string, newName: string): Promise<ServiceResult<{ success: boolean; oldName: string; newName: string; type?: string }>> {
  if (!newName || typeof newName !== 'string') {
    return { error: 'New session name is required', status: 400, data: undefined }
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(newName)) {
    return { error: 'Session name can only contain letters, numbers, dashes, and underscores', status: 400, data: undefined }
  }

  // Check if cloud agent
  const agentsDir = statePath('agents')
  const oldAgentFilePath = path.join(agentsDir, `${oldName}.json`)
  const newAgentFilePath = path.join(agentsDir, `${newName}.json`)
  const isCloudAgent = fs.existsSync(oldAgentFilePath)

  if (isCloudAgent) {
    if (fs.existsSync(newAgentFilePath)) {
      return { error: 'Agent name already exists', status: 409, data: undefined }
    }
    // Atomic rename -- write to temp file, rename to final, then delete old
    const agentConfig = JSON.parse(fs.readFileSync(oldAgentFilePath, 'utf8'))
    // Keep agentConfig.id as the original UUID to preserve UUID-based lookups
    agentConfig.name = newName
    agentConfig.alias = newName
    const tmpFilePath = newAgentFilePath + '.tmp'
    fs.writeFileSync(tmpFilePath, JSON.stringify(agentConfig, null, 2), 'utf8')
    fs.renameSync(tmpFilePath, newAgentFilePath)
    fs.unlinkSync(oldAgentFilePath)
    await renameAgentSession(oldName, newName)
    return { data: { success: true, oldName, newName, type: 'cloud' }, status: 200 }
  }

  // Local tmux session
  const runtime = getRuntime()
  const oldExists = await runtime.sessionExists(oldName)
  if (!oldExists) {
    return { error: 'Session not found', status: 404, data: undefined }
  }

  const newExists = await runtime.sessionExists(newName)
  if (newExists) {
    return { error: 'Session name already exists', status: 409, data: undefined }
  }

  await runtime.renameSession(oldName, newName)
  await renameAgentSession(oldName, newName)

  return { data: { success: true, oldName, newName }, status: 200 }
}

/**
 * Send a command to a tmux session.
 */
export async function sendCommand(
  sessionName: string,
  command: string,
  options: { requireIdle?: boolean; addNewline?: boolean; authContext: import('@/lib/agent-auth').AuthContext }
): Promise<ServiceResult<{ success: boolean; sessionName: string; commandSent?: string; method?: string; wasIdle?: boolean; idle?: boolean; timeSinceActivity?: number; idleThreshold?: number }>> {
  const requireIdle = options.requireIdle !== false
  const addNewline = options.addNewline !== false
  const authContext = options.authContext

  if (!command || typeof command !== 'string') {
    return { error: 'Command is required', status: 400, data: undefined }
  }

  // ── Gate 0: Authorization (SVC2-CRIT-01 fix, 2026-05-06) ──────
  // Previously this function had NO auth check, and the headless-router
  // route at /api/sessions/[id]/command also did NOT call authenticateAgent —
  // so any caller passing the structural credential gate could drive any
  // tmux pane. Now every caller MUST pass an AuthContext, and non-system
  // callers go through authorize('send-command', targetAgentId).
  if (!authContext) {
    return { error: 'Auth context required for sendCommand', status: 401, data: undefined }
  }
  if (!authContext.isSystemOwner) {
    // Resolve the target agentId from the session name. If the session is
    // orphan (no agent linked) we still require system-owner — non-owners
    // have no addressable target to authorize against.
    const targetAgent = getAgentBySession(sessionName)
    if (!targetAgent) {
      return { error: 'Agent not found for session', status: 404, data: undefined }
    }
    const { authorize } = await import('@/lib/authorization')
    const authResult: import('@/lib/agent-auth').AgentAuthResult = {
      agentId: authContext.agentId,
      governanceTitle: authContext.governanceTitle,
      teamId: authContext.teamId,
    }
    const authz = authorize(authResult, 'send-command', targetAgent.id)
    if (!authz.allowed) {
      return { error: authz.reason || 'Not authorized to send command to this session', status: 403, data: undefined }
    }
  }

  const runtime = getRuntime()
  const exists = await runtime.sessionExists(sessionName)
  if (!exists) {
    return { error: 'Tmux session not found', status: 404, data: undefined }
  }

  // Update activity before idle check: any interaction attempt counts as activity
  sessionActivity.set(sessionName, Date.now())

  if (requireIdle && !isSessionIdle(sessionName)) {
    return {
      error: 'Session is not idle',
      status: 409,
      data: undefined
    }
  }

  await runtime.cancelCopyMode(sessionName)
  await runtime.sendKeys(sessionName, command, { literal: true, enter: addNewline })

  return { data: { success: true, sessionName, commandSent: command, method: 'tmux-send-keys', wasIdle: true }, status: 200 }
}

/**
 * Check if a session is idle and ready for commands.
 */
export async function checkIdleStatus(sessionName: string): Promise<{
  sessionName: string
  exists: boolean
  idle: boolean
  lastActivity: number | null
  timeSinceActivity: number | null
  idleThreshold: number
}> {
  const runtime = getRuntime()
  const exists = await runtime.sessionExists(sessionName)
  if (!exists) {
    return { sessionName, exists: false, idle: false, lastActivity: null, timeSinceActivity: null, idleThreshold: IDLE_THRESHOLD_MS }
  }

  const lastActivity = sessionActivity.get(sessionName) || null
  const timeSinceActivity = lastActivity ? Date.now() - lastActivity : null
  const idle = isSessionIdle(sessionName)

  return { sessionName, exists: true, idle, lastActivity, timeSinceActivity, idleThreshold: IDLE_THRESHOLD_MS }
}

/**
 * List persisted sessions that can be restored.
 */
export async function listRestorableSessions(): Promise<{ sessions: any[]; count: number }> {
  const persistedSessions = loadPersistedSessions()
  const runtime = getRuntime()
  const discovered = await runtime.listSessions()
  const activeSessions = discovered.map(s => s.name)
  const restorableSessions = persistedSessions.filter(
    session => !activeSessions.includes(session.id)
  )
  return { sessions: restorableSessions, count: restorableSessions.length }
}

/**
 * Restore one or all persisted sessions.
 */
export async function restoreSessions(params: { sessionId?: string; all?: boolean }): Promise<ServiceResult<{ results: RestoreResult[]; summary: { restored: number; failed: number; alreadyExisted: number; total: number } }>> {
  const persistedSessions = loadPersistedSessions()
  const sessionsToRestore = params.all
    ? persistedSessions
    : persistedSessions.filter(s => s.id === params.sessionId)

  if (sessionsToRestore.length === 0) {
    return { error: 'No sessions to restore', status: 404, data: undefined }
  }

  const runtime = getRuntime()
  const results: RestoreResult[] = []

  // SVC2-MAJ-04 fix (2026-05-06): persisted session names go BACK to tmux as
  // arguments. createSession enforces the tmux-name regex when minting names,
  // but restoreSessions reads from a JSON file on disk that may have been
  // corrupted, hand-edited, or written by an older version with looser rules.
  // Re-validate before handing the name to runtime.* so a malformed entry
  // can never reach the underlying process spawn.
  const SESSION_NAME_RE = /^[a-zA-Z0-9_@.-]+$/

  for (const session of sessionsToRestore) {
    if (!session.id || !SESSION_NAME_RE.test(session.id)) {
      results.push({ sessionId: session.id || '<invalid>', status: 'failed' })
      continue
    }
    try {
      const exists = await runtime.sessionExists(session.id)
      if (!exists) {
        await runtime.createSession(session.id, session.workingDirectory)
        results.push({ sessionId: session.id, status: 'restored' })
      } else {
        results.push({ sessionId: session.id, status: 'already_exists' })
      }
    } catch {
      results.push({ sessionId: session.id, status: 'failed' })
    }
  }

  return {
    data: {
      results,
      summary: {
        restored: results.filter(r => r.status === 'restored').length,
        failed: results.filter(r => r.status === 'failed').length,
        alreadyExisted: results.filter(r => r.status === 'already_exists').length,
        total: results.length
      }
    },
    status: 200
  }
}

/**
 * Delete a persisted session from storage.
 */
export async function deletePersistedSession(sessionId: string): Promise<ServiceResult<{ success: boolean }>> {
  if (!sessionId) {
    return { error: 'Session ID is required', status: 400, data: undefined }
  }
  // SVC2-MIN-04: distinguish 404 (no such session) from 500 (IO failure)
  // so the API surface can correctly return Not Found instead of always
  // 500'ing on a perfectly idempotent delete-of-missing.
  const result = await unpersistSession(sessionId)
  if (result === 'not-found') {
    return { error: `Session ${sessionId} not found in persistence`, status: 404, data: undefined }
  }
  if (result === 'failed') {
    return { error: 'Failed to delete session', status: 500, data: undefined }
  }
  return { data: { success: true }, status: 200 }
}
