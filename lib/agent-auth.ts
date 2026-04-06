/**
 * Agent Authentication for Internal APIs
 *
 * Bridges AMP API key auth and AID governance tokens to governance-restricted
 * internal API calls. Agents prove identity via Bearer token.
 *
 * Four outcomes:
 * 1. No auth headers → system owner (web UI) → { agentId: undefined }
 * 2. Bearer aim_tk_* → AID governance token → { agentId, governanceTitle, teamId }
 * 3. Bearer amp_live_sk_* → legacy AMP API key → { agentId }
 * 4. X-Agent-Id without valid Bearer, or invalid Bearer → { error, status: 401 }
 *
 * AID tokens (aim_tk_*) embed governance context (title + team) from issuance time,
 * avoiding registry lookups on every request. AMP keys require downstream lookup.
 *
 * PHASE 2 REQUIRED: Make auth mandatory. Currently (Phase 1), governance enforcement
 * is opt-in -- endpoints skip RBAC checks when auth headers are omitted. This means
 * any localhost client can bypass governance by simply not sending Authorization headers.
 * Phase 2 must require auth on all governance-enforced endpoints. (SF-058)
 */
import { authenticateRequest } from './amp-auth'
import { validateGovernanceToken } from './aid-token'

export interface AgentAuthResult {
  /** Verified agent ID, or undefined for system owner / web UI */
  agentId?: string
  /** Governance title from AID token (avoids registry lookup). Only set for aim_tk_ tokens. */
  governanceTitle?: string
  /** Team ID from AID token. Only set for aim_tk_ tokens. null = no team. */
  teamId?: string | null
  /** Error message if authentication failed */
  error?: string
  /** HTTP status code for the error */
  status?: number
}

/**
 * Authenticate an agent from HTTP header values.
 *
 * @param authHeader - Value of Authorization header (or null)
 * @param agentIdHeader - Value of X-Agent-Id header (or null)
 * @returns AgentAuthResult with agentId for success, error for failure, or empty for system owner
 */
export function authenticateAgent(authHeader: string | null, agentIdHeader: string | null): AgentAuthResult {
  // Case 1: No auth attempt at all → system owner / web UI
  // Use strict null checks: request.headers.get() returns null when absent, "" when present but empty.
  // Falsy check would treat empty string "" as no auth, granting system owner access incorrectly.
  if (authHeader === null && agentIdHeader === null) {
    return {}
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

    // Case 3b: Legacy AMP API key (amp_live_sk_* or amp_test_sk_*)
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
}

/**
 * Build an AuthContext from an AgentAuthResult.
 * Convenience for API routes that call Change* functions directly.
 */
export function buildAuthContext(authResult: AgentAuthResult): AuthContext {
  return {
    agentId: authResult.agentId,
    isSystemOwner: !authResult.agentId,
  }
}
