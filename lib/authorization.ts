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
  | 'modify-agent'      // PATCH agent properties (name, folder, avatar, etc.) — NOT title
  | 'change-title'      // Change governance title — special rules: only MANAGER/COS, never self
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

  // Resolve title: prefer session secret (always current), fall back to registry lookup
  const title = auth.governanceTitle || lookupGovernanceTitle(auth.agentId)

  // ── Special rule: change-title ──────────────────────────────
  // Title changes have unique governance constraints:
  //   - No agent can change its OWN title (not even MANAGER)
  //   - Only MANAGER and COS can change titles at all
  //   - COS is restricted to agents in their own team
  if (action === 'change-title') {
    // Self-assignment is always forbidden
    if (targetAgentId && targetAgentId === auth.agentId) {
      return { allowed: false, reason: 'No agent can change its own governance title' }
    }

    // MANAGER can change any other agent's title
    if (title === 'manager') {
      return { allowed: true }
    }

    // COS can change titles of agents in their own team
    if (title === 'chief-of-staff') {
      if (!targetAgentId) {
        return { allowed: false, reason: 'Chief-of-Staff must specify target agent for title change' }
      }
      const cosTeamId = auth.teamId ?? lookupTeamIdForAgent(auth.agentId)
      const targetTeamId = lookupTeamIdForAgent(targetAgentId)
      if (cosTeamId && cosTeamId === targetTeamId) {
        return { allowed: true }
      }
      return { allowed: false, reason: 'Chief-of-Staff can only change titles of agents in their own team' }
    }

    // Everyone else: denied
    return { allowed: false, reason: `Only MANAGER or CHIEF-OF-STAFF can change governance titles` }
  }

  // ── Special rule: delete-agent ──────────────────────────────
  // Only system-owner and MANAGER can delete agents.
  // No agent can delete itself via API. COS cannot delete.
  if (action === 'delete-agent') {
    if (targetAgentId && targetAgentId === auth.agentId) {
      return { allowed: false, reason: 'No agent can delete itself via API' }
    }
    if (title === 'manager') {
      return { allowed: true }
    }
    return { allowed: false, reason: 'Only MANAGER can delete agents' }
  }

  // ── Special rule: manage-team (create/delete teams) ─────────
  // Only system-owner and MANAGER can create or delete teams.
  if (action === 'manage-team') {
    if (title === 'manager') {
      return { allowed: true }
    }
    return { allowed: false, reason: 'Only MANAGER can manage teams' }
  }

  // ── Universal rule: no agent can modify itself via API ──────
  // Agents cannot change their own properties, title, skills, or delete themselves.
  // They operate through their own Claude Code instance directly.
  // Only the MANAGER or COS (for their team) can modify other agents.
  if (targetAgentId && targetAgentId === auth.agentId) {
    return { allowed: false, reason: 'No agent can modify itself via the AI Maestro API' }
  }

  // ── General rules ──────────────────────────────────────────

  // MANAGER → always allowed (for actions on OTHER agents)
  if (title === 'manager') {
    return { allowed: true }
  }

  // CHIEF-OF-STAFF → own team agents only (target required for agent-scoped actions)
  if (title === 'chief-of-staff') {
    if (!targetAgentId) {
      return { allowed: false, reason: 'Chief-of-Staff must specify a target agent' }
    }
    const cosTeamId = auth.teamId ?? lookupTeamIdForAgent(auth.agentId)
    const targetTeamId = lookupTeamIdForAgent(targetAgentId)
    if (cosTeamId && cosTeamId === targetTeamId) {
      return { allowed: true }
    }
    return { allowed: false, reason: `Chief-of-Staff can only ${action} agents in their own team` }
  }

  // All other titles → denied (no agent can modify other agents)
  if (!targetAgentId) {
    return { allowed: false, reason: `${title || 'agent'} cannot ${action}` }
  }

  return { allowed: false, reason: `${title || 'agent'} cannot ${action} other agents` }
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
