/**
 * Communication Graph — Title-based message routing rules.
 *
 * Defines which governance titles can send messages to which other titles.
 * This is a directed graph with THREE edge types (2026-04-22 expansion):
 *   - 'allow'      : sender S may freely initiate messages to recipient R.
 *   - 'deny'       : sender S is forbidden from sending to R (returns 403).
 *   - 'reply-only' : sender S may send EXACTLY ONE reply to R only if R
 *                    previously sent a message to S. Used for every team
 *                    agent's edge to the HUMAN USER — team agents (COS,
 *                    ORCH, ARCH, INT, MEM) may not initiate chat with the
 *                    user; they may only answer once when the user addresses
 *                    them. MAINTAINER and AUTONOMOUS have 'allow' edges to
 *                    H because they are governance-layer titles that may
 *                    contact the user directly.
 *
 * The HUMAN USER (H) is now a first-class node in the graph (previously
 * 'exempt'). The user can message every node ('H -> *' = allow) including
 * other humans. Incoming to H is open for M/T/A and reply-only for team
 * titles. Subagents still have no AMP identity (R6.9) and cannot send at
 * all regardless of their spawning agent's edges.
 *
 * See docs/GOVERNANCE-RULES.md §R6 and
 * reports/governance/*-communication-graph-notation.md for the full spec.
 */

import type { AgentRole } from '@/types/agent'

/** Extra pseudo-title used only in the graph — represents the human user. */
export type GraphNode = AgentRole | 'human'

/** Edge type between two graph nodes. */
export type EdgeType = 'allow' | 'deny' | 'reply-only'

/**
 * Allow-edges: sender S may freely initiate messages to these recipients.
 * Every (S, R) pair not listed in ALLOW_EDGES[S] and not listed in
 * REPLY_ONLY_EDGES[S] is implicitly 'deny'.
 *
 * 2026-04-22 update:
 *   - COS narrowed to team gateway only (no edges to MAINT, AUTO, H-initiate).
 *   - MAINTAINER narrowed to MANAGER + H only.
 *   - AUTONOMOUS narrowed to MANAGER + peer AUTONOMOUS + H.
 *   - H (HUMAN USER) is now a first-class node with 'allow' outbound to every
 *     other node including self (user-to-user human messaging).
 *
 * 2026-05-04 update — MANAGER → in-team-non-COS edges flipped from allow
 * to deny (orchestrator, architect, integrator, member). Real-world test
 * showed great confusion when MANAGER bypassed COS to issue directives
 * directly to team agents — COS or ORCHESTRATOR ended up uninformed or
 * issued contradictory instructions on the same task. The COS is now
 * the SOLE inbound/outbound gateway for closed-team agents. MANAGER
 * still freely reaches COS (the gateway), peer MANAGERs, AUTONOMOUS
 * (out-of-team), MAINTAINER (out-of-team), and the HUMAN user. The user
 * (HUMAN) remains exempt — H still has unconditional allow to every node.
 */
const ALLOW_EDGES: Record<GraphNode, ReadonlySet<GraphNode>> = {
  // 2026-05-04: removed orchestrator/architect/integrator/member — MANAGER
  // routes team-directed traffic exclusively through COS now.
  'manager':        new Set<GraphNode>(['human', 'manager', 'chief-of-staff', 'autonomous', 'maintainer']),
  'chief-of-staff': new Set<GraphNode>(['manager', 'chief-of-staff', 'orchestrator', 'architect', 'integrator', 'member']),
  'orchestrator':   new Set<GraphNode>(['chief-of-staff', 'architect', 'integrator', 'member']),
  'architect':      new Set<GraphNode>(['chief-of-staff', 'orchestrator']),
  'integrator':     new Set<GraphNode>(['chief-of-staff', 'orchestrator']),
  'member':         new Set<GraphNode>(['chief-of-staff', 'orchestrator']),
  'autonomous':     new Set<GraphNode>(['human', 'manager', 'autonomous']),
  'maintainer':     new Set<GraphNode>(['human', 'manager']),
  // HUMAN USER: full outbound access, including user-to-user (H -> H).
  'human':          new Set<GraphNode>(['human', 'manager', 'chief-of-staff', 'orchestrator', 'architect', 'integrator', 'member', 'autonomous', 'maintainer']),
}

/**
 * Reply-only edges: sender S may send exactly ONE reply to recipient R
 * if R previously sent S a message. Used only for team agents' edges to
 * the human user (C, O, R, I, E → H). MAINTAINER and AUTONOMOUS have
 * 'allow' edges to H, not 'reply-only'.
 *
 * Enforcement note: the title-level check here only says "this edge CAN
 * carry a message if it's a reply". Actual per-message "already-replied"
 * state lives in the AMP inbox layer — the server checks
 * `options.inReplyToMessageId` at validateMessageRoute and rejects a
 * reply-only edge when the field is absent.
 */
const REPLY_ONLY_EDGES: Record<GraphNode, ReadonlySet<GraphNode>> = {
  'manager':        new Set<GraphNode>(),
  'chief-of-staff': new Set<GraphNode>(['human']),
  'orchestrator':   new Set<GraphNode>(['human']),
  'architect':      new Set<GraphNode>(['human']),
  'integrator':     new Set<GraphNode>(['human']),
  'member':         new Set<GraphNode>(['human']),
  'autonomous':     new Set<GraphNode>(),
  'maintainer':     new Set<GraphNode>(),
  'human':          new Set<GraphNode>(),
}

/** All valid graph nodes (agent roles + the human user). */
export const ALL_NODES: readonly GraphNode[] = Object.keys(ALLOW_EDGES) as GraphNode[]

/** All valid agent roles (excludes the human pseudo-node). */
export const ALL_ROLES: readonly AgentRole[] = ALL_NODES.filter((n): n is AgentRole => n !== 'human')

/** Check if a role string is a valid AgentRole in the communication graph. */
export function isValidRole(role: string): role is AgentRole {
  return role in ALLOW_EDGES && role !== 'human'
}

/** Check if a node string is a valid GraphNode (AgentRole or 'human'). */
export function isValidNode(node: string): node is GraphNode {
  return node in ALLOW_EDGES
}

/**
 * Return the edge type between two graph nodes.
 *   - 'allow'      : unconditional forward delivery
 *   - 'reply-only' : forward only if this is a reply to a prior inbound
 *                    message from the recipient (i.e. recipient->sender
 *                    edge fired first). Caller must pass
 *                    options.inReplyToMessageId to validateMessageRoute.
 *   - 'deny'       : forbidden.
 */
export function getEdgeType(sender: GraphNode, recipient: GraphNode): EdgeType {
  if (ALLOW_EDGES[sender]?.has(recipient)) return 'allow'
  if (REPLY_ONLY_EDGES[sender]?.has(recipient)) return 'reply-only'
  return 'deny'
}

/**
 * Check if sender role can message recipient role WITHOUT a reply context.
 * Reply-only edges return false here — call getEdgeType if you need the
 * full three-way answer.
 */
export function canSendMessage(senderRole: AgentRole, recipientRole: AgentRole): boolean {
  return getEdgeType(senderRole, recipientRole) === 'allow'
}

/** Get all recipients that the sender can freely reach (allow edges only). */
export function getAllowedRecipients(senderRole: AgentRole): AgentRole[] {
  const set = ALLOW_EDGES[senderRole]
  if (!set) return []
  return [...set].filter((n): n is AgentRole => n !== 'human')
}

/** Routing suggestions when a connection is forbidden.
 *  Updated 2026-04-22 for tightened graph: MAINTAINER and AUTONOMOUS are
 *  now governance-layer titles that only speak to/from MANAGER (and each
 *  other, for AUTONOMOUS peers). COS is strictly a team gateway — it no
 *  longer reaches MAINTAINER or AUTONOMOUS. All cross-layer routing goes
 *  through MANAGER.
 *
 *  Updated 2026-05-04: MANAGER → in-team-non-COS now denied. The COS is
 *  the SOLE gateway for both inbound to closed-team agents AND outbound
 *  directives from MANAGER. Cross-team coordination, top-down directives,
 *  and any MANAGER-initiated task all route through COS. The HUMAN user
 *  remains the only node exempt from this rule. */
const ROUTING_SUGGESTIONS: Record<string, string> = {
  // 2026-05-04: MANAGER → in-team-non-COS — go through COS
  'manager->orchestrator':   'Route through chief-of-staff (COS is the sole team gateway)',
  'manager->architect':      'Route through chief-of-staff (COS is the sole team gateway)',
  'manager->integrator':     'Route through chief-of-staff (COS is the sole team gateway)',
  'manager->member':         'Route through chief-of-staff (COS is the sole team gateway)',
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
  /** The edge type that was matched. Useful for logging and UI hints. */
  edgeType?: EdgeType
}

/**
 * Validate a message route between two agent roles.
 * Returns allowed=true or a reason + routing suggestion.
 *
 * Options:
 *   - isSubagent: true → always reject (subagents have no AMP identity).
 *   - isUserMessage: true → sender is the human user (maestro). The user
 *       can message every node in the graph including other humans.
 *       Incoming to agents is always 'allow' from H.
 *   - recipientIsHuman: true → recipient is the human user. Sender must
 *       be an agent with either an 'allow' or 'reply-only' edge to H.
 *       For 'reply-only' edges, inReplyToMessageId is REQUIRED.
 *   - inReplyToMessageId: the id of the inbound user→agent message this
 *       call is replying to. Only meaningful when recipientIsHuman=true
 *       and the sender's edge to H is 'reply-only'. Unlocks a single
 *       reply; subsequent replies to the same message are enforced by
 *       the AMP inbox layer (not this function).
 */
export function validateMessageRoute(
  senderRole: string | null | undefined,
  recipientRole: string | null | undefined,
  options: {
    isSubagent?: boolean
    isUserMessage?: boolean
    recipientIsHuman?: boolean
    inReplyToMessageId?: string
  } = {}
): MessageRouteValidation {
  // Subagents are always blocked (R6.9)
  if (options.isSubagent) {
    return {
      allowed: false,
      reason: 'Subagents cannot send messages. Only the main agent with an AMP identity can communicate.',
    }
  }

  // User (maestro) can message any node including other humans.
  // Sender 'human' is short-circuited here rather than going through the
  // isValidRole check below (which excludes 'human' on purpose so agent
  // role validation stays typed).
  if (options.isUserMessage || senderRole === 'human') {
    return { allowed: true, edgeType: 'allow' }
  }

  // Null/missing sender role — fail closed
  if (!senderRole) {
    return { allowed: false, reason: 'Sender has no governance title — cannot determine communication permissions' }
  }

  // Recipient is the human user (H). Look up the sender's edge to H.
  if (options.recipientIsHuman || recipientRole === 'human') {
    if (!isValidRole(senderRole)) {
      return { allowed: false, reason: `Unknown sender role: ${senderRole}` }
    }
    const edgeToHuman = getEdgeType(senderRole as AgentRole, 'human')
    if (edgeToHuman === 'allow') {
      return { allowed: true, edgeType: 'allow' }
    }
    if (edgeToHuman === 'reply-only') {
      if (!options.inReplyToMessageId) {
        return {
          allowed: false,
          reason: `${senderRole.toUpperCase()} cannot initiate messages to the human user — may only reply to an inbound user message`,
          suggestion: 'Use amp-reply with the original user message ID to answer (one reply per inbound user message).',
          edgeType: 'reply-only',
        }
      }
      // ADVISORY ONLY: this layer only checks that the caller passed SOMETHING
      // in inReplyToMessageId. It does NOT load the referenced message, verify
      // its sender/recipient pair, or mark it `replied=true`. The full
      // "one-reply-per-inbound" invariant lives in the AMP inbox layer and is
      // tracked as a follow-up in TRDD-80557822. Until that ships the
      // reply-only edge can be unlocked by any truthy string. The path is only
      // reachable once the human user becomes an AMP recipient (Phase 2 maestro
      // auth) — today `recipientIsHuman` is always false so this branch is dead.
      return { allowed: true, edgeType: 'reply-only' }
    }
    return {
      allowed: false,
      reason: `${senderRole.toUpperCase()} cannot send messages to the human user`,
      suggestion: 'Route through manager — only MANAGER/MAINTAINER/AUTONOMOUS may initiate user-directed messages',
      edgeType: 'deny',
    }
  }

  if (!recipientRole) {
    // If recipient has no title, treat as MEMBER (default, most restrictive for senders)
    // This is safe: only MANAGER, COS, and ORCHESTRATOR can reach MEMBER.
    return canSendMessage(senderRole as AgentRole, 'member')
      ? { allowed: true, edgeType: 'allow' }
      : { allowed: false, reason: `${senderRole} cannot send messages to agents without a governance title`, suggestion: 'Route through chief-of-staff or orchestrator', edgeType: 'deny' }
  }

  if (!isValidRole(senderRole)) {
    return { allowed: false, reason: `Unknown sender role: ${senderRole}` }
  }
  if (!isValidRole(recipientRole)) {
    return { allowed: false, reason: `Unknown recipient role: ${recipientRole}` }
  }

  const edge = getEdgeType(senderRole, recipientRole)
  if (edge === 'allow') {
    return { allowed: true, edgeType: 'allow' }
  }
  // Note: reply-only edges only exist for ->H today; agent->agent is
  // always 'allow' or 'deny'. If that changes, enforcement logic for
  // inReplyToMessageId in agent-to-agent calls would slot in here.

  const key = `${senderRole}->${recipientRole}`
  return {
    allowed: false,
    reason: `${senderRole.toUpperCase()} cannot send messages to ${recipientRole.toUpperCase()}`,
    suggestion: ROUTING_SUGGESTIONS[key] || 'Check the communication graph for allowed routes',
    edgeType: 'deny',
  }
}
