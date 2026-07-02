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
import type { UserTitle } from '@/types/user'

/** Extra pseudo-title used only in the graph — represents the human user. */
export type GraphNode = AgentRole | 'human'

/**
 * R38.2 relational user-sender block (TRDD R36/R37/R38). Populated ONLY by
 * callers that have registry access AND only when the user-authority model is
 * ENABLED (governance.userAuthorityModelEnabled). The comm-graph stays PURE —
 * it never reads a registry; the caller computes these relationship flags and
 * hands them in. With the model OFF this block is never supplied and the legacy
 * `isUserMessage`/`human` path is taken instead (byte-identical to pre-model
 * behavior).
 */
export interface UserSenderContext {
  /** The sending user's authority title (R36/R37). */
  userTitle: UserTitle
  /** True when the sender is the MAESTRO OR the currently-acting MAESTRO-DELEGATE (R37.2). */
  isActiveMaestro: boolean
  /** Recipient is THIS user's own bound ASSISTANT agent (R38.2/R39.5). */
  recipientIsOwnAssistant: boolean
  /** Recipient is the COS of a team this user follows (R38.2/R38.3). */
  recipientIsOwnTeamCos: boolean
  /** Recipient is the singleton MANAGER (R38.2). */
  recipientIsManager: boolean
  /** Recipient resolves to ANOTHER human user (R38.2 forbids for a normal user). */
  recipientIsUser: boolean
}

/**
 * R39.5 ASSISTANT-sender block. An ASSISTANT may message ONLY its own user and
 * the active MAESTRO. Populated only by flag-on callers; the comm-graph itself
 * stays registry-free.
 */
export interface AssistantSenderContext {
  /** Recipient is THIS assistant's own user. */
  recipientIsOwnUser: boolean
  /** Recipient is the currently-acting MAESTRO (R37.2). */
  recipientIsActiveMaestro: boolean
}

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
  // R38.2 NOTE (user-authority model): this static full-Y row applies ONLY when
  // the sender is the active MAESTRO (the admin). When the model is ENABLED,
  // validateMessageRoute branches on the relational `userSender` block BEFORE
  // consulting this row — a NORMAL user is decided relationally (own ASSISTANT /
  // own-team COS / MANAGER only; never another user). With the model OFF this
  // row is the legacy full-Y human node (no behavior change).
  'human':          new Set<GraphNode>(['human', 'manager', 'chief-of-staff', 'orchestrator', 'architect', 'integrator', 'member', 'autonomous', 'maintainer']),
  // R39.7 ASSISTANT invisibility: NO static edge to any node. An ASSISTANT's
  // real targets (its own user + the active MAESTRO) are RELATIONAL and decided
  // in validateMessageRoute via assistantSender. The empty set means no agent
  // title can reach an ASSISTANT through a static edge either (it is never a
  // recipient in any other row), which IS the invisibility encoding.
  'assistant':      new Set<GraphNode>([]),
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
  'assistant':      new Set<GraphNode>(),
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
  // R38.2 — normal (non-MAESTRO) users may message ONLY their own ASSISTANT,
  // their own-team COS, and the MANAGER. Used as the suggestion for any denied
  // user-sender route when the user-authority model is enabled.
  'user->*':                  'Normal users may only message their own ASSISTANT, their own-team COS, or the MANAGER (R38.2)',
  // R39.5/R39.7 — an ASSISTANT may message ONLY its own user and the MAESTRO.
  'assistant->*':             'An ASSISTANT may only message its own user and the MAESTRO (R39.5)',
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
 *   - isUserMessage: true → LEGACY (user-authority model OFF) flag: the sender
 *       is the human user and may message every node including other humans.
 *       Used by callers when governance.userAuthorityModelEnabled is false, so
 *       flag-off behavior is byte-identical to pre-model. When the model is ON,
 *       callers DO NOT set this — they pass `userSender` instead.
 *   - userSender: R38.2 relational block (user-authority model ON). When
 *       present it drives the user-send decision: the active MAESTRO may message
 *       anything; a normal user may message ONLY its own ASSISTANT, its own-team
 *       COS, or the MANAGER, and NEVER another user (symmetric — no user↔user).
 *   - assistantSender: R39.5 relational block — an ASSISTANT sender may reach
 *       ONLY its own user and the active MAESTRO.
 *   - recipientUserTitle: when the recipient is a human user, its title — used
 *       for inbound R38.2 rules (a normal user does not receive from other users).
 *   - recipientIsHuman: true → recipient is the human user. Sender must
 *       be an agent with either an 'allow' or 'reply-only' edge to H.
 *       For 'reply-only' edges, inReplyToMessageId is REQUIRED.
 *   - inReplyToMessageId: the id of the inbound user→agent message this
 *       call is replying to. Only meaningful when recipientIsHuman=true
 *       and the sender's edge to H is 'reply-only'. Unlocks a single
 *       reply; subsequent replies to the same message are enforced by
 *       the AMP inbox layer (not this function).
 *
 * FAIL-CLOSED CONTRACT (user-authority model ON): a `human` sender with NO
 * `userSender` block is DENIED — the caller failed to resolve the relationship,
 * and the secure default is to refuse rather than fall through to the legacy
 * full-Y short-circuit. The legacy short-circuit is reachable ONLY via the
 * explicit `isUserMessage` flag (which model-on callers never set).
 */
export function validateMessageRoute(
  senderRole: string | null | undefined,
  recipientRole: string | null | undefined,
  options: {
    isSubagent?: boolean
    isUserMessage?: boolean
    userSender?: UserSenderContext
    assistantSender?: AssistantSenderContext
    recipientUserTitle?: UserTitle
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

  // ── R38.2 user-sender branch (user-authority model ON) ───────────────────
  // Reached only when a flag-on caller supplies the relational block. This
  // REPLACES the blanket short-circuit for users: the active MAESTRO is the
  // admin (full allow incl. user↔user); a normal user is restricted to its own
  // ASSISTANT / own-team COS / MANAGER and may NEVER reach another user.
  if (options.userSender) {
    const us = options.userSender
    if (us.isActiveMaestro) {
      // MAESTRO / acting-delegate is the admin — may message any node,
      // including other humans (R37/R38.1).
      return { allowed: true, edgeType: 'allow' }
    }
    // Normal (non-MAESTRO) user.
    if (us.recipientIsUser) {
      return {
        allowed: false,
        reason: 'user-to-user messaging is forbidden (R38.2)',
        suggestion: ROUTING_SUGGESTIONS['user->*'],
        edgeType: 'deny',
      }
    }
    if (us.recipientIsOwnAssistant || us.recipientIsOwnTeamCos || us.recipientIsManager) {
      return { allowed: true, edgeType: 'allow' }
    }
    return {
      allowed: false,
      reason: 'Normal users may only message their own ASSISTANT, their own-team COS, or the MANAGER (R38.2)',
      suggestion: ROUTING_SUGGESTIONS['user->*'],
      edgeType: 'deny',
    }
  }

  // ── R39.5 ASSISTANT-sender branch ────────────────────────────────────────
  // An ASSISTANT may message ONLY its own user and the active MAESTRO.
  if (senderRole === 'assistant') {
    const as = options.assistantSender
    if (as && (as.recipientIsOwnUser || as.recipientIsActiveMaestro)) {
      return { allowed: true, edgeType: 'allow' }
    }
    return {
      allowed: false,
      reason: 'An ASSISTANT may only message its own user and the MAESTRO (R39.5)',
      suggestion: ROUTING_SUGGESTIONS['assistant->*'],
      edgeType: 'deny',
    }
  }

  // ── R39.7 ASSISTANT invisibility (inbound) ───────────────────────────────
  // No agent title may reach an ASSISTANT. The bound-user/MAESTRO paths to an
  // ASSISTANT come through the userSender branch above (recipientIsOwnAssistant),
  // so any route that lands here with an assistant recipient is an agent sender
  // and must be denied (the ASSISTANT is invisible to other agents).
  if (recipientRole === 'assistant') {
    return {
      allowed: false,
      reason: 'An ASSISTANT is invisible to other agents and cannot be messaged by them (R39.7)',
      edgeType: 'deny',
    }
  }

  // LEGACY user/maestro short-circuit (user-authority model OFF). Reachable via
  // the explicit `isUserMessage` flag OR a raw `human` sender. Model-on callers
  // never set `isUserMessage`; a raw `human` sender with no userSender is the
  // genuinely-unresolved case handled by the fail-closed guard below.
  if (options.isUserMessage) {
    return { allowed: true, edgeType: 'allow' }
  }
  if (senderRole === 'human') {
    // FAIL-CLOSED (user-authority model): a human sender that reached here has
    // NO resolved userSender block and did NOT set the legacy isUserMessage
    // flag. Under the legacy model the caller always sets isUserMessage; under
    // the new model the caller always sets userSender. Either way, an
    // unresolved human sender is refused rather than granted the old full-Y
    // default — this closes the blanket-allow hole (R38.2).
    return {
      allowed: false,
      reason: 'user sender context unresolved — cannot route (R38.2)',
      edgeType: 'deny',
    }
  }

  // Null/missing sender role — fail closed
  if (!senderRole) {
    return { allowed: false, reason: 'Sender has no governance title — cannot determine communication permissions' }
  }

  // Recipient is the human user (H). Look up the sender's edge to H.
  if (options.recipientIsHuman || recipientRole === 'human') {
    // R38.2 inbound (user-authority model ON): a NORMAL user does NOT receive
    // messages from other users, nor from arbitrary agents. The legitimate
    // inbound paths to a user are: (a) its own ASSISTANT or the MAESTRO — both
    // handled by the assistantSender / userSender branches ABOVE, which return
    // before reaching here; (b) the MAESTRO addressing the user — also a
    // userSender(isActiveMaestro) send handled above. So any sender that lands
    // HERE with a NORMAL-user recipient is a non-assistant AGENT (or an
    // unresolved user), which R38.2/R39.7 forbid. Only enforced when the caller
    // supplied recipientUserTitle (i.e. the model is on); legacy callers leave
    // it undefined and the historical reply-only-to-human logic below applies.
    if (options.recipientUserTitle === 'user') {
      return {
        allowed: false,
        reason: 'Normal users do not receive messages from other users or arbitrary agents — only their own ASSISTANT or the MAESTRO may reach them (R38.2/R39.7)',
        edgeType: 'deny',
      }
    }
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
      // ════════════════════════════════════════════════════════════════════
      // SECURITY NOTE: AUTH-MAJ-02 (audit 2026-05-04)
      // ════════════════════════════════════════════════════════════════════
      // ADVISORY ONLY: this layer only checks that `inReplyToMessageId` is a
      // non-empty string. It does NOT (yet):
      //   - load the referenced message from the AMP inbox
      //   - verify the original sender/recipient pair matches the requested
      //     route (i.e. that the human user really did message THIS agent
      //     and not some other one)
      //   - check whether that message was already replied to (one-reply-
      //     per-inbound is not enforced here)
      //
      // ANY truthy string fed to inReplyToMessageId currently unlocks the
      // reply-only edge. The 2026-05-04 audit (auth_comm_review.md
      // AUTH-MAJ-02) flagged this as the largest unreviewed forge surface
      // in the comm-graph. Two mitigations are in place that keep it from
      // being exploitable today:
      //
      //   1. Defensive empty-string check below — a literal "" is rejected
      //      so a caller that simply sets the field with `|| ''` does not
      //      unlock anything.
      //   2. The recipient-is-human branch is currently dead code: today
      //      `recipientIsHuman` is always false, because the human user
      //      is not yet an AMP-routable address. This branch only goes
      //      live with Phase 2 maestro auth.
      //
      // Full enforcement (load + verify + mark replied) is tracked as
      // TRDD-80557822 and lives in the AMP inbox layer rather than this
      // pure-data graph file. Until that ships, ANY caller that constructs
      // a route through this branch MUST also re-validate at the inbox
      // layer — DO NOT treat `allowed: true` returned here as proof the
      // reply is real.
      // ════════════════════════════════════════════════════════════════════
      if (!options.inReplyToMessageId || options.inReplyToMessageId.trim() === '') {
        return {
          allowed: false,
          reason: `${senderRole.toUpperCase()} reply-only edge requires a non-empty inReplyToMessageId`,
          suggestion: 'Pass the original inbound message id when calling amp-reply.',
          edgeType: 'reply-only',
        }
      }
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
    // AUTH-MIN-05: deliberate "most-restrictive default" for an unknown
    // recipient title. Rationale:
    //   - A null/undefined recipientRole can mean: registry corruption, an
    //     agent that lost its title due to a migration, a newly-added title
    //     not yet mapped here, or an agent referenced before its title was
    //     assigned.
    //   - Treating an unknown title as MEMBER picks the recipient title with
    //     the MOST inbound restrictions — only MANAGER, CHIEF-OF-STAFF, and
    //     ORCHESTRATOR can reach MEMBER (see ALLOW_EDGES). Any other sender
    //     is denied. That's strictly safer than picking AUTONOMOUS (which is
    //     reachable from many senders) or HUMAN (reply-only).
    //   - If a new title is added to GovernanceTitle but not added to
    //     ALLOW_EDGES, it will fall through here and behave like MEMBER —
    //     the same fail-closed default. Adding a real ALLOW_EDGES entry for
    //     the new title is required, but the system stays safe in the gap.
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
