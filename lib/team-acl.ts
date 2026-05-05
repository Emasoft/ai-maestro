/**
 * Team Resource ACL — checks whether an agent (or web UI request)
 * is allowed to access a given team's resources.
 *
 * All teams are closed after governance simplification (2026-03-27).
 * Access is restricted to the manager, chief-of-staff, and team members only.
 */

import { isManager, isOrchestrator } from './governance'
import { getTeam } from './team-registry'
import type { AuthContext } from './agent-auth'

export interface TeamAccessInput {
  teamId: string
  requestingAgentId?: string // undefined = web UI / system-owner request (must be paired with `authContext.isSystemOwner`)
  /**
   * LIB2-CRIT-02 fix (2026-05-06): the web-UI bypass is now gated on
   * `authContext.isSystemOwner`. Callers MUST pass the AuthContext
   * built from `authenticateFromRequest(request)` so the ACL can
   * distinguish a real web-UI session from a Tailscale peer that
   * simply omits `X-Agent-Id`. When `authContext` is missing, the
   * function fails closed — there is no "trust the missing field"
   * fallback anymore.
   */
  authContext?: AuthContext
}

export interface TeamAccessResult {
  allowed: boolean
  reason?: string
}

/**
 * Determine whether the requester may access the team's resources.
 *
 * Decision order (all teams are closed after governance simplification):
 *  1. Verified system-owner (web UI / sudo)  → allowed
 *  2. Team not found                          → denied (caller handles 404)
 *  3. Requester is MANAGER                    → allowed
 *  3b. Requester is ORCHESTRATOR              → allowed
 *  4. Requester is chief-of-staff             → allowed
 *  5. Requester is a member                   → allowed
 *  6. Otherwise                               → denied
 *
 * LIB2-CRIT-02 (2026-05-06) — the prior "if requestingAgentId is
 * undefined, allow" branch was a local-trust shortcut that combined
 * with the wider auth-bypass cluster (SRV-CRIT-02 X-Forwarded-From,
 * AUTH-CRIT-01 system-owner-on-failed-auth) to grant any local or
 * Tailscale peer MANAGER-equivalent team access by simply omitting a
 * header. The shortcut is removed; the function now requires either
 * a verified system-owner AuthContext OR a real agentId that maps to
 * a permitted team role.
 */
export function checkTeamAccess(input: TeamAccessInput): TeamAccessResult {
  // 1. System-owner short-circuit. Only callers whose AuthContext
  // explicitly carries `isSystemOwner: true` (constructed from a
  // verified web-UI session cookie or by buildSystemAuthContext for
  // internal background tasks) get the full allow. Missing context
  // falls through to deny.
  if (input.authContext?.isSystemOwner === true) {
    return { allowed: true }
  }

  // No agentId AND not system-owner → deny. The previous shortcut
  // accepted "no header" as proof of identity; that's the bug.
  if (!input.requestingAgentId) {
    return {
      allowed: false,
      reason: 'Access denied: anonymous request — provide a verified agent identity or a web-UI session.',
    }
  }

  // 2. Team not found — deny access; callers should check team existence for 404 responses
  const team = getTeam(input.teamId)
  if (!team) {
    return { allowed: false, reason: 'Team not found' }
  }

  // All teams are closed — always enforce ACL (open team bypass removed in governance simplification)

  // 3. MANAGER role always has access
  if (isManager(input.requestingAgentId)) {
    return { allowed: true }
  }

  // 3b. ORCHESTRATOR has access to THEIR OWN team only (not any team)
  if (isOrchestrator(input.requestingAgentId, input.teamId)) {
    return { allowed: true }
  }

  // 4. Chief-of-Staff of this team has access
  if (team.chiefOfStaffId === input.requestingAgentId) {
    return { allowed: true }
  }

  // 5. Team members have access
  if (team.agentIds.includes(input.requestingAgentId)) {
    return { allowed: true }
  }

  // 6. Everyone else is denied
  return { allowed: false, reason: 'Access denied: you are not a member of this team' }
}
