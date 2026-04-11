/**
 * Agent Authentication for Internal APIs
 *
 * Bridges AMP API key auth, AID governance tokens, and browser session cookies
 * to governance-restricted internal API calls.
 *
 * Four outcomes:
 * 1. Valid session cookie (aim_session) → system owner (web UI) → { agentId: undefined }
 * 2. Bearer aim_tk_* → AID governance token → { agentId, governanceTitle, teamId }
 * 3. Bearer amp_live_sk_* → legacy AMP API key → { agentId }
 * 4. No valid credentials → { error, status: 401 }
 *
 * SF-058 CLOSED: No auth headers AND no session cookie → rejected.
 * The web UI user must log in with governance password to get the session cookie.
 * Agents use Bearer tokens. There is no "free" system-owner access anymore.
 */
import { authenticateRequest } from './amp-auth'
import { validateGovernanceToken } from './aid-token'
import { extractSessionFromCookie, validateSession } from './session-auth'
import { isSessionSecret, validateSessionSecret } from './session-secret'

export interface AgentAuthResult {
  /** Verified agent ID, or undefined for system owner / web UI */
  agentId?: string
  /** Governance title — from AID token (embedded) or registry (session secret / AMP key) */
  governanceTitle?: string
  /** Team ID — from AID token (embedded) or registry (session secret / AMP key). null = no team. */
  teamId?: string | null
  /** Error message if authentication failed */
  error?: string
  /** HTTP status code for the error */
  status?: number
}

/**
 * Authenticate a caller from HTTP header values.
 *
 * @param authHeader - Value of Authorization header (or null)
 * @param agentIdHeader - Value of X-Agent-Id header (or null)
 * @param cookieHeader - Value of Cookie header (or null) — for browser session auth
 * @returns AgentAuthResult with agentId for success, error for failure, or empty for system owner
 */
export function authenticateAgent(
  authHeader: string | null,
  agentIdHeader: string | null,
  cookieHeader?: string | null
): AgentAuthResult {
  // Case 1: No Bearer token — check for browser session cookie
  if (authHeader === null && agentIdHeader === null) {
    // If no governance password is configured, allow open access.
    // Otherwise the user is locked out with no way to reach Settings to set it.
    try {
      const { loadGovernance } = require('./governance')
      if (!loadGovernance().passwordHash) {
        return {} // Open access — system owner
      }
    } catch { /* governance module not available — enforce auth */ }

    const sessionToken = extractSessionFromCookie(cookieHeader ?? null)
    if (sessionToken && validateSession(sessionToken)) {
      // Valid session cookie → system owner (web UI user)
      return {}
    }
    // SF-058 CLOSED: no credentials at all → reject
    return {
      error: 'Authentication required. Log in at /api/auth/login or provide a Bearer token.',
      status: 401
    }
  }

  // Case 2: X-Agent-Id present without Authorization → reject (identity spoofing)
  if (agentIdHeader && !authHeader) {
    return {
      error: 'Agent identity requires authentication. Include Authorization: Bearer <api-key> header.',
      status: 401
    }
  }

  // Case 3: Authorization header present → validate token
  if (authHeader) {
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader

    // Case 3a: AID governance token (aim_tk_*) — includes title + team
    if (token.startsWith('aim_tk_')) {
      const aidRecord = validateGovernanceToken(token)
      if (!aidRecord) {
        return {
          error: 'Invalid or expired governance token',
          status: 401
        }
      }

      // If X-Agent-Id is also present, it must match
      if (agentIdHeader && agentIdHeader !== aidRecord.agent_id) {
        return {
          error: 'X-Agent-Id does not match authenticated agent identity',
          status: 403
        }
      }

      return {
        agentId: aidRecord.agent_id,
        governanceTitle: aidRecord.governance_title,
        teamId: aidRecord.team_id
      }
    }

    // Case 3b: Server-issued session secret (mst_*) — local agents only
    // The server generated this at session launch and set it as a tmux env var.
    // Title + team are looked up from current registry state (always fresh).
    if (isSessionSecret(token)) {
      const agentRecord = findAgentBySessionSecret(token)
      if (!agentRecord) {
        return {
          error: 'Invalid or expired session secret',
          status: 401
        }
      }

      if (agentIdHeader && agentIdHeader !== agentRecord.id) {
        return {
          error: 'X-Agent-Id does not match authenticated agent identity',
          status: 403
        }
      }

      // Look up current governance context from registry (always fresh — no stale token)
      const govContext = resolveGovernanceContext(agentRecord.id)
      return {
        agentId: agentRecord.id,
        governanceTitle: govContext.title,
        teamId: govContext.teamId
      }
    }

    // Case 3c: Legacy AMP API key (amp_live_sk_* or amp_test_sk_*)
    const result = authenticateRequest(authHeader)

    if (!result.authenticated || !result.agentId) {
      return {
        error: result.message || 'Invalid or expired API key',
        status: 401
      }
    }

    // If X-Agent-Id is also present, it must match the authenticated agent
    if (agentIdHeader && agentIdHeader !== result.agentId) {
      return {
        error: 'X-Agent-Id does not match authenticated agent identity',
        status: 403
      }
    }

    return { agentId: result.agentId }
  }

  // Unreachable: all cases handled above. Throw to catch logic bugs instead of silently granting access.
  throw new Error('Unreachable: authenticateAgent logic error')
}

/**
 * Convenience: authenticate from a Request/NextRequest object.
 * Extracts Authorization, X-Agent-Id, and Cookie headers automatically.
 * Use this in API routes to avoid repeating the 3-header extraction pattern.
 */
export function authenticateFromRequest(request: { headers: { get(name: string): string | null } }): AgentAuthResult {
  return authenticateAgent(
    request.headers.get('Authorization'),
    request.headers.get('X-Agent-Id'),
    request.headers.get('Cookie')
  )
}

/**
 * Authorization context passed to Change* functions in element-management-service.
 *
 * Phase 1 (current): Optional parameter. When omitted, the caller is treated as
 * system-owner (full access). The dispatch layer (updateAgentById) already enforces
 * governance roles before calling Change* functions, so this is a belt-and-suspenders
 * layer for direct callers and for future Phase 2 mandatory enforcement.
 *
 * Phase 2 (SF-058): Will become required. All callers must provide auth context.
 */
export interface AuthContext {
  /** Verified agent ID, or undefined for system owner / web UI */
  agentId?: string
  /** True when the caller is the system owner (web UI user) — full access */
  isSystemOwner: boolean
  /** CC-GOV-004: Governance title from auth result — avoids redundant registry lookup */
  governanceTitle?: string
  /** CC-GOV-004: Team ID from auth result — avoids redundant registry lookup */
  teamId?: string | null
}

/**
 * Build an AuthContext from an AgentAuthResult.
 * Convenience for API routes that call Change* functions directly.
 */
export function buildAuthContext(authResult: AgentAuthResult): AuthContext {
  return {
    agentId: authResult.agentId,
    isSystemOwner: !authResult.agentId,
    governanceTitle: authResult.governanceTitle,
    teamId: authResult.teamId,
  }
}

/**
 * Build a system-owner AuthContext for internal callers that run outside
 * any HTTP request (server startup, scheduled tasks, cron jobs, migrations,
 * tests, CLI utilities). This replaces the legacy "undefined authContext =
 * authorized" bypass in gate0Auth — internal callers must now explicitly
 * state that they are acting as the host operator.
 *
 * The system-owner context goes through the same authorize() pipeline as
 * user/agent contexts, so every action still needs to match an allowed
 * permission for the system-owner role. There is no silent pass-through.
 *
 * SECURITY: callers must not accept `reason` from untrusted input. The
 * parameter is purely for audit logging so server logs show which internal
 * subsystem claimed the context.
 *
 * @param reason Short description logged for audit (e.g. "server-startup",
 *               "scheduled-health-check", "cemetery-gc").
 */
export function buildSystemAuthContext(reason: string): AuthContext {
  if (!reason || typeof reason !== 'string') {
    throw new Error('buildSystemAuthContext: reason is required for audit logging')
  }
  return {
    agentId: undefined,
    isSystemOwner: true,
    governanceTitle: 'system',
    teamId: null,
  }
}

// ============================================================================
// Session Secret Helpers (local agent identity)
// ============================================================================

/**
 * Find an agent by their session secret.
 * Uses the validateSessionSecret import (mockable in tests).
 */
function findAgentBySessionSecret(secret: string): { id: string; name: string } | null {
  try {
    // Dynamic import to avoid circular dependency with agent-registry

    const agentRegistry = require('./agent-registry')
    const agents: Array<{ id: string; name: string; metadata?: Record<string, unknown> }> = agentRegistry.loadAgents()
    for (const agent of agents) {
      const storedHash = agent.metadata?.sessionSecretHash as string | undefined
      if (storedHash && validateSessionSecret(secret, storedHash)) {
        return { id: agent.id, name: agent.name }
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Resolve current governance title and team for an agent.
 * Always returns current state (no stale-token problem).
 */
function resolveGovernanceContext(agentId: string): { title: string; teamId: string | null } {
  try {
    // Dynamic imports to avoid circular dependencies

    const governance = require('./governance')
    if (governance.isManager(agentId)) return { title: 'manager', teamId: resolveTeamId(agentId) }
    if (governance.isChiefOfStaffAnywhere(agentId)) return { title: 'chief-of-staff', teamId: resolveTeamId(agentId) }


    const agentRegistry = require('./agent-registry')
    const agent = agentRegistry.getAgent(agentId)
    const title = (agent?.governanceTitle as string) || 'autonomous'
    return { title, teamId: resolveTeamId(agentId) }
  } catch {
    return { title: 'autonomous', teamId: null }
  }
}

function resolveTeamId(agentId: string): string | null {
  try {

    const teamRegistry = require('./team-registry')
    const teams = teamRegistry.loadTeams()
    for (const team of teams) {
      if (
        team.agentIds?.includes(agentId) ||
        team.chiefOfStaffId === agentId ||
        team.orchestratorId === agentId
      ) {
        return team.id
      }
    }
    return null
  } catch {
    return null
  }
}
