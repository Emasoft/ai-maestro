/**
 * Communication Graph — Title-based message routing rules.
 *
 * Defines which governance titles can send messages to which other titles.
 * This is a directed graph: (sender, recipient) means sender can message recipient.
 * Missing connections are FORBIDDEN — the AMP routing layer returns 403.
 *
 * The user (human maestro) can message any agent and receive responses from any agent.
 * Subagents cannot send messages at all — they have no AMP identity.
 *
 * See docs_dev/2026-04-03-communication-graph.md for the full spec.
 */

import type { AgentRole } from '@/types/agent'

/**
 * Directed graph of allowed message routes.
 * Key: sender role (lowercase, matching AgentRole type). Value: set of roles the sender can message.
 *
 * IMPORTANT: The user (maestro) is NOT a node in this graph — the user can message any agent
 * and any agent can message back the user. Agents are discouraged from initiating messages to
 * the user (only respond when contacted). The user must be authenticated to send messages,
 * to prevent agents from sending messages on the user's behalf. This graph governs
 * agent-to-agent communication only.
 */
// 2026-04-22 update — graph tightened. COS, MAINTAINER, and AUTONOMOUS
// boundaries narrowed so MANAGER is the sole contact point for the
// governance-layer titles (MAINTAINER and AUTONOMOUS). COS is now strictly
// the team gateway (reaches team roles + MANAGER, but NOT MAINTAINER
// or AUTONOMOUS). AUTONOMOUS reaches MANAGER + other AUTONOMOUS only.
// MAINTAINER reaches MANAGER only. See docs/GOVERNANCE-RULES.md §R6.
const COMMUNICATION_GRAPH: Record<AgentRole, ReadonlySet<AgentRole>> = {
  'manager':        new Set<AgentRole>(['manager', 'chief-of-staff', 'orchestrator', 'architect', 'integrator', 'member', 'autonomous', 'maintainer']),
  'chief-of-staff': new Set<AgentRole>(['manager', 'chief-of-staff', 'orchestrator', 'architect', 'integrator', 'member']),
  'orchestrator':   new Set<AgentRole>(['chief-of-staff', 'architect', 'integrator', 'member']),
  'architect':      new Set<AgentRole>(['chief-of-staff', 'orchestrator']),
  'integrator':     new Set<AgentRole>(['chief-of-staff', 'orchestrator']),
  'member':         new Set<AgentRole>(['chief-of-staff', 'orchestrator']),
  'autonomous':     new Set<AgentRole>(['manager', 'autonomous']),
  'maintainer':     new Set<AgentRole>(['manager']),
}

/** All valid agent roles for the communication graph. */
export const ALL_ROLES: readonly AgentRole[] = Object.keys(COMMUNICATION_GRAPH) as AgentRole[]

/** Check if a role string is a valid AgentRole in the communication graph. */
export function isValidRole(role: string): role is AgentRole {
  return role in COMMUNICATION_GRAPH
}

/** Check if sender role can message recipient role. */
export function canSendMessage(senderRole: AgentRole, recipientRole: AgentRole): boolean {
  return COMMUNICATION_GRAPH[senderRole]?.has(recipientRole) ?? false
}

/** Get all roles that a sender can message. */
export function getAllowedRecipients(senderRole: AgentRole): AgentRole[] {
  const set = COMMUNICATION_GRAPH[senderRole]
  return set ? [...set] : []
}

/** Routing suggestions when a connection is forbidden.
 *  Updated 2026-04-22 for tightened graph: MAINTAINER and AUTONOMOUS are
 *  now governance-layer titles that only speak to/from MANAGER (and each
 *  other, for AUTONOMOUS peers). COS is strictly a team gateway — it no
 *  longer reaches MAINTAINER or AUTONOMOUS. All cross-layer routing goes
 *  through MANAGER. */
const ROUTING_SUGGESTIONS: Record<string, string> = {
  // Workers → MANAGER: go through COS
  'orchestrator->manager':   'Route through chief-of-staff',
  'architect->manager':      'Route through chief-of-staff',
  'integrator->manager':     'Route through chief-of-staff',
  'member->manager':         'Route through chief-of-staff',
  // Workers → peers: go through ORCHESTRATOR
  'architect->member':       'Route through orchestrator',
  'architect->integrator':   'Route through orchestrator',
  'architect->architect':    'Route through orchestrator',
  'integrator->architect':   'Route through orchestrator',
  'integrator->member':      'Route through orchestrator',
  'integrator->integrator':  'Route through orchestrator',
  'member->architect':       'Route through orchestrator',
  'member->integrator':      'Route through orchestrator',
  'member->member':          'Route through orchestrator',
  // Team titles → AUTONOMOUS: only MANAGER reaches AUTONOMOUS from the
  // team side. COS is no longer a gateway to AUTONOMOUS.
  'orchestrator->autonomous': 'Route through manager',
  'architect->autonomous':    'Route through manager',
  'integrator->autonomous':   'Route through manager',
  'member->autonomous':       'Route through manager',
  'chief-of-staff->autonomous': 'Route through manager',
  // AUTONOMOUS → team titles: contact MANAGER only. AUTONOMOUS no longer
  // reaches COS directly.
  'autonomous->chief-of-staff': 'Contact manager instead',
  'autonomous->orchestrator': 'Contact manager instead',
  'autonomous->architect':    'Contact manager instead',
  'autonomous->integrator':   'Contact manager instead',
  'autonomous->member':       'Contact manager instead',
  'autonomous->maintainer':   'Contact manager instead',
  // ORCHESTRATOR → ORCHESTRATOR (cross-team): go through COS
  'orchestrator->orchestrator': 'Route through chief-of-staff for cross-team coordination',
  // Team titles → MAINTAINER: only MANAGER reaches MAINTAINER now.
  // COS is no longer a gateway to MAINTAINER.
  'chief-of-staff->maintainer': 'Route through manager',
  'orchestrator->maintainer': 'Route through manager',
  'architect->maintainer':    'Route through manager',
  'integrator->maintainer':   'Route through manager',
  'member->maintainer':       'Route through manager',
  // MAINTAINER → anyone-but-MANAGER: contact MANAGER only.
  'maintainer->chief-of-staff': 'Contact manager instead',
  'maintainer->orchestrator': 'Contact manager instead',
  'maintainer->architect':    'Contact manager instead',
  'maintainer->integrator':   'Contact manager instead',
  'maintainer->member':       'Contact manager instead',
  'maintainer->maintainer':   'Contact manager instead (MAINTAINER-to-MAINTAINER coordination routes through MANAGER)',
  'maintainer->autonomous':   'Contact manager instead',
}

export interface MessageRouteValidation {
  allowed: boolean
  reason?: string
  suggestion?: string
}

/**
 * Validate a message route between two agent roles.
 * Returns allowed=true or a reason + routing suggestion.
 *
 * Pass isUserMessage=true when the human user (maestro) is the sender —
 * the user can message any agent. Agents can also respond to the user
 * (but are discouraged from initiating contact unless responding to a user message).
 */
export function validateMessageRoute(
  senderRole: string | null | undefined,
  recipientRole: string | null | undefined,
  options: { isSubagent?: boolean; isUserMessage?: boolean } = {}
): MessageRouteValidation {
  // Subagents are always blocked
  if (options.isSubagent) {
    return {
      allowed: false,
      reason: 'Subagents cannot send messages. Only the main agent with an AMP identity can communicate.',
    }
  }

  // User (maestro) can message any agent
  if (options.isUserMessage) {
    return { allowed: true }
  }

  // Null/missing roles — fail closed
  if (!senderRole) {
    return { allowed: false, reason: 'Sender has no governance title — cannot determine communication permissions' }
  }
  if (!recipientRole) {
    // If recipient has no title, treat as MEMBER (default, most restrictive for senders)
    // This is safe: only MANAGER, COS, and ORCHESTRATOR can reach MEMBER
    return canSendMessage(senderRole as AgentRole, 'member')
      ? { allowed: true }
      : { allowed: false, reason: `${senderRole} cannot send messages to agents without a governance title`, suggestion: 'Route through chief-of-staff or orchestrator' }
  }

  if (!isValidRole(senderRole)) {
    return { allowed: false, reason: `Unknown sender role: ${senderRole}` }
  }
  if (!isValidRole(recipientRole)) {
    return { allowed: false, reason: `Unknown recipient role: ${recipientRole}` }
  }

  if (canSendMessage(senderRole, recipientRole)) {
    return { allowed: true }
  }

  const key = `${senderRole}->${recipientRole}`
  return {
    allowed: false,
    reason: `${senderRole.toUpperCase()} cannot send messages to ${recipientRole.toUpperCase()}`,
    suggestion: ROUTING_SUGGESTIONS[key] || 'Check the communication graph for allowed routes',
  }
}
