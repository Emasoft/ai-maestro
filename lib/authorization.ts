/**
 * Centralized Authorization (RBAC)
 *
 * Single point of RBAC decisions for AI Maestro governance.
 * Replaces per-endpoint governance checks with a consistent policy.
 *
 * Auth hierarchy:
 *   system-owner (web UI) → all allowed
 *   MANAGER → all allowed
 *   CHIEF-OF-STAFF → own team agents only
 *   Others → self only
 */

import type { AgentAuthResult } from './agent-auth'

// ============================================================================
// Types
// ============================================================================

export type AuthAction =
  | 'modify-agent'      // PATCH agent properties (title, name, folder, etc.)
  | 'delete-agent'      // DELETE agent
  | 'send-command'      // Send command to agent's tmux session
  | 'restart-session'   // Restart agent session
  | 'hibernate-agent'   // Hibernate agent
  | 'wake-agent'        // Wake agent
  | 'manage-team'       // Create/modify/delete teams
  | 'manage-skills'     // Install/remove skills on an agent
  | 'view-agent'        // Read agent data (currently open, for future lockdown)

export interface AuthorizationResult {
  allowed: boolean
  reason?: string
}

// ============================================================================
// Authorization
// ============================================================================

/**
 * Authorize an action based on authenticated identity.
 *
 * @param auth - Result from authenticateAgent()
 * @param action - What the caller wants to do
 * @param targetAgentId - Agent being acted upon (if applicable)
 * @returns Whether the action is allowed, with reason if denied
 */
export function authorize(
  auth: AgentAuthResult,
  action: AuthAction,
  targetAgentId?: string
): AuthorizationResult {
  // System-owner (web UI) → always allowed
  if (!auth.agentId) {
    return { allowed: true }
  }

  // Resolve title: prefer AID token (embedded), fall back to registry lookup
  const title = auth.governanceTitle || lookupGovernanceTitle(auth.agentId)

  // MANAGER → always allowed
  if (title === 'manager') {
    return { allowed: true }
  }

  // CHIEF-OF-STAFF → own team agents only
  if (title === 'chief-of-staff') {
    if (!targetAgentId) {
      // Non-targeted actions (e.g., manage-team) — COS can manage their own team
      return { allowed: true }
    }
    // Check if target is in the same team as the COS
    const cosTeamId = auth.teamId ?? lookupTeamIdForAgent(auth.agentId)
    const targetTeamId = lookupTeamIdForAgent(targetAgentId)
    if (cosTeamId && cosTeamId === targetTeamId) {
      return { allowed: true }
    }
    return { allowed: false, reason: `Chief-of-Staff can only ${action} agents in their own team` }
  }

  // All other titles → self only
  if (targetAgentId && targetAgentId === auth.agentId) {
    return { allowed: true }
  }

  if (!targetAgentId) {
    // Non-targeted actions by non-privileged agents → denied
    return { allowed: false, reason: `${title || 'agent'} cannot ${action}` }
  }

  return { allowed: false, reason: `${title || 'agent'} can only ${action} itself` }
}

// ============================================================================
// Governance Lookup Helpers (for legacy AMP key path)
// ============================================================================

/**
 * Look up governance title from registry. Used when AID token is not available
 * (legacy AMP API key path where title is not embedded in the token).
 */
function lookupGovernanceTitle(agentId: string): string {
  try {
    // Check if agent is the MANAGER
    const { isManager, isChiefOfStaffAnywhere } = require('./governance')
    if (isManager(agentId)) return 'manager'
    if (isChiefOfStaffAnywhere(agentId)) return 'chief-of-staff'

    // Fall back to agent record
    const { getAgent } = require('./agent-registry')
    const agent = getAgent(agentId)
    return (agent?.governanceTitle as string) || 'autonomous'
  } catch {
    return 'autonomous'
  }
}

/**
 * Find which team an agent belongs to. Returns team ID or null.
 */
function lookupTeamIdForAgent(agentId: string): string | null {
  try {
    const { loadTeams } = require('./team-registry')
    const teams = loadTeams()
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
