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
  | 'link-session'      // Link a tmux session name to an agent record (registry write)
  | 'delete-session'    // Kill an agent's tmux session and/or unlink it (no agent delete)
  | 'register-agent'    // Register/overwrite an agent record (filesystem write primitive)
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
  // ── AUTH-CRIT-01 fix (2026-05-04) — fail-closed on errored auth result ──
  // BUG: previous version returned { allowed: true } for any auth result with
  // !auth.agentId, including failures where agentId is undefined because the
  // token was rejected. The error path coexisted with the system-owner path:
  // an `AgentAuthResult` from a failed authenticate() (e.g. malformed token)
  // would set { error: 'token_invalid', agentId: undefined } and slip into the
  // system-owner branch, granting unrestricted access to any caller that
  // forwarded the failed result. Verified by the comm-graph review agent.
  // FIX: check auth.error FIRST. Only when there is no error AND no agentId
  // is the caller a legitimate system-owner (web UI without agent identity).
  if (auth.error) {
    return { allowed: false, reason: auth.error }
  }

  // System-owner (web UI) → always allowed (no error AND no agentId)
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

  // ── Special rule: register-agent ───────────────────────────
  // SVC2-CRIT-04 fix (2026-05-06): registerAgent writes ~/.aimaestro/agents/<id>.json
  // and creates tmux sessions under arbitrary names. Only system-owner is permitted —
  // not even MANAGER, because registerAgent is the bootstrap primitive that mints
  // agent records. Use createAgent + ChangeTitle pipelines for in-band agent creation.
  if (action === 'register-agent') {
    return { allowed: false, reason: 'Only the system owner can register agent records' }
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
  } catch (err) {
    // AUTH-MIN-02 fix: surface the swallowed exception in logs instead of
    // silently falling back to 'autonomous'. A registry corruption or disk
    // error here was previously invisible.
    console.warn('[authorization] lookupGovernanceTitle failed, falling back to autonomous:', { agentId, err })
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
