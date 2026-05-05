/**
 * Message Filter — enforces closed-team messaging isolation
 *
 * Determines whether a message from sender to recipient is allowed
 * based on governance roles (MANAGER, Chief-of-Staff) and closed-team
 * membership. Open-world agents (not in any closed team) can message
 * freely unless the recipient is inside a closed team.
 */

import { loadGovernance } from './governance'
import { loadTeams } from './team-registry'
import { getAgent } from './agent-registry'
import { isValidUuid } from './validation'
import { canSendMessage, isValidRole } from './communication-graph'
import type { AgentRole } from '@/types/agent'

/**
 * Look up a same-host agent's governance title for the title-graph
 * pre-check. Mirrors the resolution order in
 * `lib/agent-auth.ts::resolveGovernanceContext` but without the
 * `require()` round-trip. Returns null when the agent is unknown to
 * this host so the caller can decide how to fail.
 *
 * Resolution order:
 *   1. governance.json — explicit MANAGER assignment wins
 *   2. team-registry.json — chief-of-staff anywhere wins next
 *   3. registry.json — agent.governanceTitle as the persisted source
 *   4. fall back to 'autonomous' (the safest default; AUTONOMOUS has
 *      a documented allow edge to MANAGER and to itself only)
 */
function lookupSameHostTitle(agentId: string): AgentRole | null {
  try {
    const gov = loadGovernance()
    if (gov.managerId === agentId) return 'manager'
    const teams = loadTeams()
    if (teams.some(t => t.chiefOfStaffId === agentId)) return 'chief-of-staff'
    const agent = getAgent(agentId)
    if (!agent) return null
    const raw = (agent.governanceTitle as string | undefined) || 'autonomous'
    if (isValidRole(raw)) return raw as AgentRole
    return 'autonomous'
  } catch {
    return null
  }
}

export interface MessageFilterInput {
  senderAgentId: string | null // null = mesh-forwarded message with no attestation
  recipientAgentId: string
  // Layer 2: attested sender identity from a verified role attestation (cross-host)
  senderRole?: AgentRole | null       // verified governance role from attestation
  senderHostId?: string | null        // host that signed the attestation
}

export interface MessageFilterResult {
  allowed: boolean
  reason?: string
}

/**
 * Check whether a message from sender to recipient is allowed.
 *
 * Algorithm (R6.1–R6.7):
 * 1. Mesh-forwarded (senderAgentId null): denied if recipient is in a closed team (unverified sender)
 * 1b. Unresolved recipient (alias, not UUID) from closed-team sender: denied (prevents bypass)
 * 2. Neither in a closed team: allowed (open world, current behavior) (R6.4)
 * 3. Sender is MANAGER: always allowed (R6.3)
 * 4. Sender is COS of any closed team: can reach MANAGER, other COS, own team members (R6.2)
 * 5. Normal closed-team member: can reach same-team members and own COS (R6.1)
 * 6. Outside sender to closed-team recipient: denied (R6.5) — always reached after Steps 2–5
 *
 * IMPORTANT (R6.7): Uses getClosedTeamsForAgent (plural) to correctly handle
 * COS agents who belong to multiple closed teams simultaneously.
 */
export function checkMessageAllowed(input: MessageFilterInput): MessageFilterResult {
  const { senderAgentId, recipientAgentId } = input

  // Single snapshot of all state — avoids redundant file reads from governance helpers
  // Loaded before null-sender check so closedTeams is available for mesh-forward denial
  const teams = loadTeams()
  const governance = loadGovernance()

  // Derive closed-team membership from the single snapshot
  const closedTeams = teams.filter(t => t.type === 'closed')

  // Step 1: Mesh-forwarded messages — apply attestation-aware rules
  if (senderAgentId === null) {
    const recipientInClosedTeam = closedTeams.some(t => t.agentIds.includes(recipientAgentId))

    // Layer 2: If sender has a verified role attestation, apply governance rules
    if (input.senderRole && input.senderHostId) {
      // 2026-05-04: Attested MANAGER may reach the COS of any closed team
      // (the SOLE team gateway), peer MANAGERs (none in mesh today, future),
      // open-world agents (not in any closed team), AUTONOMOUS, MAINTAINER,
      // and the human user. MANAGER may NOT directly contact in-team
      // non-COS agents — the COS is the team gateway. This matches
      // lib/communication-graph.ts ALLOW_EDGES['manager'].
      if (input.senderRole === 'manager') {
        // MANAGER → COS of any closed team: gateway edge, allowed
        if (closedTeams.some(t => t.chiefOfStaffId === recipientAgentId)) {
          return { allowed: true }
        }
        // MANAGER → in-team-non-COS: denied (route through COS)
        if (recipientInClosedTeam) {
          return {
            allowed: false,
            reason: 'MANAGER cannot send messages to MEMBER inside a closed team — route through chief-of-staff (COS is the sole team gateway, R6 2026-05-04)',
          }
        }
        // MANAGER → out-of-team agent (open-world / AUTONOMOUS / MAINTAINER /
        // peer MANAGER / human): allowed.
        return { allowed: true }
      }
      // Attested COS: can reach MANAGER, other COS, open-world agents
      if (input.senderRole === 'chief-of-staff') {
        // COS → MANAGER: always allowed
        if (governance.managerId === recipientAgentId) {
          return { allowed: true }
        }
        // COS → other COS: allowed
        if (closedTeams.some(t => t.chiefOfStaffId === recipientAgentId)) {
          return { allowed: true }
        }
        // COS → agent not in any closed team: allowed
        if (!recipientInClosedTeam) {
          return { allowed: true }
        }
        // COS → closed-team member: denied unless same team (requires peer cache lookup — Layer 3+)
        return { allowed: false, reason: 'Cross-host COS message denied: recipient is in a closed team on this host' }
      }
    }

    // No attestation or member role: deny if recipient is in a closed team (unverified sender)
    if (recipientInClosedTeam) {
      return { allowed: false, reason: 'Mesh message denied: recipient is in a closed team and sender identity is unverified' }
    }
    return { allowed: true }
  }

  // Step 1b: Unresolved recipient (alias instead of UUID) with sender in closed team → deny
  // Prevents governance bypass via alias that skips agentIds membership checks
  const isUuidLike = isValidUuid(recipientAgentId)
  if (!isUuidLike) {
    const senderInClosedTeam = closedTeams.some(t => t.agentIds.includes(senderAgentId))
    if (senderInClosedTeam) {
      return { allowed: false, reason: 'Cannot send to unresolved recipient from closed team' }
    }
  }

  const senderTeams = closedTeams.filter(t => t.agentIds.includes(senderAgentId))
  const recipientTeams = closedTeams.filter(t => t.agentIds.includes(recipientAgentId))
  // Defense-in-depth: also include teams where sender is COS via chiefOfStaffId,
  // in case COS was not added to agentIds (data corruption edge case).
  const senderCosTeams = closedTeams.filter(t => t.chiefOfStaffId === senderAgentId)
  const allSenderTeamIds = [...new Set([...senderTeams.map(t => t.id), ...senderCosTeams.map(t => t.id)])]
  const senderInClosed = senderTeams.length > 0 || senderCosTeams.length > 0
  const recipientInClosed = recipientTeams.length > 0

  // Helper: is the given agentId the manager?
  // When governance.managerId is null (no manager appointed), this returns false for all agents.
  const agentIsManager = (id: string) => governance.managerId === id
  // Helper: is the given agentId chief-of-staff in any closed team?
  const agentIsCOS = (id: string) => closedTeams.some(t => t.chiefOfStaffId === id)

  // Step 2: Neither party is in a closed team — open world, allow freely (R6.4)
  if (!senderInClosed && !recipientInClosed) {
    return { allowed: true }
  }

  // Step 3: MANAGER routing — 2026-05-04 update
  // MANAGER may freely reach the COS of any closed team (the SOLE team
  // gateway), peer MANAGERs, AUTONOMOUS, MAINTAINER, the human user, and
  // any agent not in a closed team. MANAGER may NOT directly contact
  // in-team non-COS agents (orchestrator, architect, integrator, member)
  // — must route through COS. Real-world test 2026-05-03 showed great
  // confusion when MANAGER bypassed COS to issue directives directly.
  // This matches lib/communication-graph.ts ALLOW_EDGES['manager'].
  if (agentIsManager(senderAgentId)) {
    // MANAGER → COS of any closed team: gateway edge, allowed
    if (agentIsCOS(recipientAgentId)) {
      return { allowed: true }
    }
    // MANAGER → in-team-non-COS recipient: denied (route through COS)
    if (recipientInClosed) {
      return {
        allowed: false,
        reason: 'MANAGER cannot send messages to MEMBER inside a closed team — route through chief-of-staff (COS is the sole team gateway, R6 2026-05-04)',
      }
    }
    // MANAGER → out-of-team agent (open world, AUTONOMOUS, MAINTAINER,
    // peer MANAGER, human user): allowed.
    return { allowed: true }
  }

  // Step 4: Sender is Chief-of-Staff of some closed team (R6.2)
  if (agentIsCOS(senderAgentId)) {
    // COS can always reach the MANAGER
    if (agentIsManager(recipientAgentId)) {
      return { allowed: true }
    }
    // COS-to-COS bridge: any COS can message any other COS
    if (agentIsCOS(recipientAgentId)) {
      return { allowed: true }
    }
    // COS can message members of ANY of their closed teams (R6.7 — plural, not singular)
    // Uses allSenderTeamIds to cover COS-not-in-agentIds edge case
    const cosTeamMembers = closedTeams
      .filter(t => allSenderTeamIds.includes(t.id))
      .flatMap(t => t.agentIds)
    if (cosTeamMembers.includes(recipientAgentId)) {
      return { allowed: true }
    }
    // G1: COS can message agents NOT in any closed team (v2 Rule 6)
    // This includes open-team agents and unaffiliated agents
    if (!recipientInClosed) {
      return { allowed: true }
    }
    return {
      allowed: false,
      reason: 'Chief-of-Staff can only message MANAGER, other Chiefs-of-Staff, own team members, and agents not in any closed team',
    }
  }

  // Step 5: Sender is a normal member of a closed team (R6.1)
  // SF-038: By design, closed-team members CANNOT directly message MANAGER.
  // They must go through their team's Chief-of-Staff (COS), who relays to MANAGER.
  // This enforces the chain-of-command hierarchy: Member -> COS -> MANAGER.
  // MANAGER reachability is intentionally absent here.
  if (senderInClosed) {
    // Can message members of the same closed team
    const shareTeam = senderTeams.some(team =>
      recipientTeams.some(rt => rt.id === team.id)
    )
    if (shareTeam) {
      return { allowed: true }
    }
    // Can message the COS of their own team (chain-of-command escalation path)
    const canReachCOS = senderTeams.some(team => team.chiefOfStaffId === recipientAgentId)
    if (canReachCOS) {
      return { allowed: true }
    }
    return {
      allowed: false,
      reason: 'Closed team members can only message within their team',
    }
  }

  // Step 5b — open-world senders need title-graph approval (AUTH-MAJ-01 fix)
  //
  // Pre-2026-05-04: this step blanket-allowed any open-world sender to
  // reach MANAGER (`agentIsManager(recipientAgentId)`) or any COS
  // (`agentIsCOS(recipientAgentId)`). That bypassed
  // `lib/communication-graph.ts ALLOW_EDGES`, which forbids
  // ORCHESTRATOR / ARCHITECT / INTEGRATOR / MEMBER → MANAGER and
  // AUTONOMOUS / MAINTAINER → COS. An open-world member-titled agent
  // could therefore reach the MANAGER directly, defeating the
  // chain-of-command (R6.1).
  //
  // Fix: consult the title graph for open-world senders against MANAGER
  // / COS recipients. Two layers (team-membership + title graph) compose
  // by intersection — the message is allowed only if BOTH allow it.
  // Recipient title is `manager` when they are the MANAGER, otherwise
  // `chief-of-staff` when they hold a COS slot anywhere. Sender title is
  // looked up from registry + governance with a fallback to 'autonomous'
  // (matches lib/agent-auth.ts::resolveGovernanceContext).
  const _recipIsManager = agentIsManager(recipientAgentId)
  const _recipIsCOS = agentIsCOS(recipientAgentId)
  if (_recipIsManager || _recipIsCOS) {
    const senderTitle = lookupSameHostTitle(senderAgentId) ?? 'autonomous'
    const recipientTitle: AgentRole = _recipIsManager ? 'manager' : 'chief-of-staff'
    if (canSendMessage(senderTitle, recipientTitle)) {
      return { allowed: true }
    }
    return {
      allowed: false,
      reason: `${senderTitle.toUpperCase()} cannot send messages to ${recipientTitle.toUpperCase()} per the communication graph (R6, 2026-05-04)`,
    }
  }

  // Step 6: Sender is NOT in any closed team but recipient IS in a closed team (R6.5)
  // Remaining case: open-world sender → normal closed-team member (not MANAGER/COS).
  return {
    allowed: false,
    reason: 'Cannot message agents in closed teams from outside',
  }
}
