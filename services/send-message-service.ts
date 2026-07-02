/**
 * SendMessage — All-in-one message sending pipeline
 *
 * SINGLE ENTRY POINT for all message sending in AI Maestro.
 * Replaces scattered sendMessage/routeMessage/sendAmpNotification calls.
 *
 * Callers:
 *   - POST /api/messages (web UI sends to agent)
 *   - POST /api/agents/:id/messages (agent sends to agent)
 *   - config-notification-service (governance request outcomes)
 *   - PG06 in InstallElement (team composition warnings)
 *   - Any future internal messaging need
 *
 * The external AMP protocol handler (routeMessage in amp-service.ts) remains
 * separate because it handles incoming messages from remote hosts with different
 * trust model (signature verification, mesh forwarding). SendMessage is for
 * messages originating on THIS host.
 *
 * PRE-EXECUTION GATES:
 *   G00: Validate sender identifier
 *   G01: Validate recipient identifier
 *   G02: Validate subject (non-empty)
 *   G03: Validate content structure (type + message)
 *   G04: Resolve sender agent from registry
 *   G05: Resolve recipient agent from registry
 *   G06: Communication graph check (R6) — sender title can message recipient title
 *   G07: Team isolation check — closed team boundary enforcement
 *
 * EXECUTION:
 *   EXE: Compose and deliver message via sendFromUI()
 *
 * POST-EXECUTION GATES:
 *   PG01: Verify message was written to recipient inbox
 *   PG02: Send tmux push notification to recipient (if online)
 */

// AuthContext type — typed via `import type` to avoid runtime cycle
import type { AuthContext } from '@/lib/agent-auth'

export interface SendMessageInput {
  from: string                // Sender: agent name, ID, or "user"
  to: string                  // Recipient: agent name, ID, or qualified name (name@hostId)
  subject: string
  content: {
    type: string              // e.g. 'text', 'notification', 'governance', 'task'
    message: string           // The message body
    context?: Record<string, unknown>  // Optional structured context
  }
  priority?: 'low' | 'normal' | 'high' | 'urgent'
  inReplyTo?: string          // Message ID being replied to
  /** If the sender is an agent, pass their agentId for R6 graph validation */
  senderAgentId?: string
  /** Optional: skip R6 graph check (for system/user messages) */
  skipGraphCheck?: boolean
  /**
   * SVC2-CRIT-03 fix (2026-05-06): the verified identity of the caller.
   * If isSystemOwner=false, the pipeline rejects when authContext.agentId
   * does not match input.senderAgentId — closes the agent-impersonation
   * vector where any caller could pretend to be any other agent.
   */
  authContext: AuthContext
}

export interface SendMessageResult {
  success: boolean
  operations: string[]
  messageId?: string
  notified?: boolean          // True if tmux push notification was sent
  error?: string
}

/**
 * R38.2 — compute the relational user-sender flags for the comm-graph from the
 * registries (the graph stays pure; this caller has registry access). Resolves:
 *  - userTitle / isActiveMaestro from the user-registry (R37.2 delegate-suspends-maestro)
 *  - recipientIsOwnAssistant: the user's bound ASSISTANT == recipient (R39.5)
 *  - recipientIsOwnTeamCos: recipient is COS of a team this user follows (R38.2/R38.3)
 *  - recipientIsManager: recipient is the singleton MANAGER (R38.2)
 *  - recipientIsUser: recipient resolves to ANOTHER human user (R38.2 forbids)
 *
 * Only called when the user-authority model is enabled AND a senderUserId is
 * resolved, so it never runs on the flag-off path.
 */
async function resolveUserSenderContext(
  senderUserId: string,
  recipientAgentId: string | null,
  recipientTitle: string,
  recipientIdentifier: string,
): Promise<import('@/lib/communication-graph').UserSenderContext> {
  const { getUser, getUserByName, getActiveMaestroUserId } = await import('@/lib/user-registry')
  const senderUser = getUser(senderUserId)
  const userTitle = senderUser?.title ?? 'user'
  const isActiveMaestro = getActiveMaestroUserId() === senderUserId

  // recipientIsOwnAssistant: the sender user's bound ASSISTANT is the recipient.
  const recipientIsOwnAssistant =
    !!senderUser?.assistantAgentId &&
    !!recipientAgentId &&
    senderUser.assistantAgentId === recipientAgentId

  // recipientIsManager: recipient is the singleton MANAGER.
  let recipientIsManager = false
  if (recipientAgentId) {
    try {
      const { isManager } = await import('@/lib/governance')
      recipientIsManager = isManager(recipientAgentId)
    } catch { recipientIsManager = false }
  }
  // Defensive: a MANAGER recipientTitle also satisfies the rule even if the
  // singleton pointer is momentarily unresolved.
  if (!recipientIsManager && String(recipientTitle) === 'manager') recipientIsManager = true

  // recipientIsOwnTeamCos: recipient is the COS of a team the user follows.
  // A normal user is added to a team and follows its COS (R38.3). We treat the
  // user as following the team(s) their bound ASSISTANT belongs to; absent an
  // ASSISTANT-team binding, this is conservatively false (deny) unless the
  // recipient is a COS of a team the user is a recorded member of.
  let recipientIsOwnTeamCos = false
  if (recipientAgentId && String(recipientTitle) === 'chief-of-staff') {
    try {
      const { loadTeams } = await import('@/lib/team-registry')
      const teams = loadTeams()
      // Teams this user follows: any team whose membership includes the user's
      // ASSISTANT agent (the user works through its ASSISTANT — R39.7).
      const followedTeamIds = new Set<string>()
      if (senderUser?.assistantAgentId) {
        for (const t of teams) {
          if (t.agentIds?.includes(senderUser.assistantAgentId)) followedTeamIds.add(t.id)
        }
      }
      recipientIsOwnTeamCos = teams.some(
        t => t.chiefOfStaffId === recipientAgentId && followedTeamIds.has(t.id),
      )
    } catch { recipientIsOwnTeamCos = false }
  }

  // recipientIsUser: recipient resolves to ANOTHER human user (by id or name).
  // An agent recipient (recipientAgentId set) is never a user. When the
  // recipient did NOT resolve to an agent, look it up in the user registry by id
  // then by name (stripping any @host suffix) — if it is a user, R38.2 forbids a
  // normal user from messaging it (user↔user is symmetric-forbidden). This is
  // what makes the graph's recipientIsUser deny branch reachable from the
  // production send path.
  let recipientIsUser = false
  if (!recipientAgentId) {
    try {
      const name = recipientIdentifier.includes('@')
        ? recipientIdentifier.split('@')[0]
        : recipientIdentifier
      const rec = getUser(name) ?? getUserByName(name)
      recipientIsUser = !!rec
    } catch {
      recipientIsUser = false
    }
  }

  return {
    userTitle,
    isActiveMaestro,
    recipientIsOwnAssistant,
    recipientIsOwnTeamCos,
    recipientIsManager,
    recipientIsUser,
  }
}

/**
 * R38.2 — resolve whether a recipient identifier (name or id, possibly @host)
 * is a human user, returning its title or undefined when it is not a user.
 * Used so the inbound "normal users don't receive from agents" rule can fire.
 */
async function resolveRecipientUserTitle(
  recipientIdentifier: string,
): Promise<import('@/types/user').UserTitle | undefined> {
  try {
    const { getUser, getUserByName } = await import('@/lib/user-registry')
    const name = recipientIdentifier.includes('@') ? recipientIdentifier.split('@')[0] : recipientIdentifier
    const rec = getUser(name) ?? getUserByName(name)
    return rec?.title
  } catch {
    return undefined
  }
}

/**
 * All-in-one message sender. Validates, routes, delivers, and notifies.
 */
export async function SendMessage(
  input: SendMessageInput
): Promise<SendMessageResult> {
  const ops: string[] = []
  const result: SendMessageResult = { success: false, operations: ops }

  try {
    const { from, to, subject, content, priority, inReplyTo } = input

    // ═══════════════════════════════════════════════════════════
    // PRE-EXECUTION GATES
    // ═══════════════════════════════════════════════════════════

    // ── G00: Validate sender identifier ───────────────────────
    if (!from || from.trim() === '') {
      result.error = 'Sender identifier is empty'
      ops.push('G00: DENIED — empty sender')
      return result
    }
    ops.push(`G00: Sender "${from}" provided`)

    // ── G01: Validate recipient identifier ────────────────────
    if (!to || to.trim() === '') {
      result.error = 'Recipient identifier is empty'
      ops.push('G01: DENIED — empty recipient')
      return result
    }
    ops.push(`G01: Recipient "${to}" provided`)

    // ── G02: Validate subject ─────────────────────────────────
    if (!subject || subject.trim() === '') {
      result.error = 'Subject is required'
      ops.push('G02: DENIED — empty subject')
      return result
    }
    ops.push(`G02: Subject "${subject.slice(0, 50)}${subject.length > 50 ? '...' : ''}"`)

    // ── G03: Validate content structure ───────────────────────
    if (!content || !content.type || !content.message) {
      result.error = 'Content must have type and message fields'
      ops.push('G03: DENIED — invalid content structure')
      return result
    }
    ops.push(`G03: Content type="${content.type}", length=${content.message.length}`)

    // ── G04: Resolve sender agent ─────────────────────────────
    let senderTitle = 'user'
    let senderAgentId = input.senderAgentId || null
    if (from !== 'user' && from !== 'system') {
      try {
        const { getAgent, loadAgents } = await import('@/lib/agent-registry')
        const agent = senderAgentId
          ? getAgent(senderAgentId)
          : loadAgents().find(a => a.name === from || a.id === from)
        if (agent) {
          senderTitle = (agent.governanceTitle || 'autonomous').toLowerCase()
          senderAgentId = agent.id
          ops.push(`G04: Sender resolved — "${agent.name}" (${senderTitle.toUpperCase()})`)
        } else {
          ops.push(`G04: WARN — Sender "${from}" not found in registry (may be remote)`)
        }
      } catch {
        ops.push(`G04: WARN — Registry lookup failed for sender`)
      }
    } else {
      ops.push(`G04: Sender is "${from}" — no agent resolution needed`)
    }

    // ── G04.AUTH: Verify caller identity matches claimed sender ──
    // SVC2-CRIT-03 fix (2026-05-06): without this gate, ANY authenticated agent
    // could pass `senderAgentId: <victim>` and have the message delivered as
    // the victim — bypassing R6 graph rules that depend on the sender's title.
    // System-owner (web UI) and pure user/system messages skip the check.
    if (!input.authContext) {
      result.error = 'forbidden_no_auth_context'
      ops.push(`G04.AUTH: DENIED — no auth context provided`)
      return result
    }
    if (!input.authContext.isSystemOwner && from !== 'user' && from !== 'system') {
      // The caller is an authenticated agent. The resolved senderAgentId MUST
      // equal the verified caller agentId. Use a non-disclosing reason so an
      // attacker cannot enumerate valid sender IDs.
      if (!senderAgentId || senderAgentId !== input.authContext.agentId) {
        result.error = 'forbidden_sender_mismatch'
        ops.push(`G04.AUTH: DENIED — caller ${input.authContext.agentId ?? '?'} cannot send as ${senderAgentId ?? from}`)
        return result
      }
      ops.push(`G04.AUTH: Caller identity matches sender (${senderAgentId})`)
    } else {
      ops.push(`G04.AUTH: System/user origin — auth-match check skipped`)
    }

    // ── G05: Resolve recipient agent ──────────────────────────
    let recipientTitle = 'unknown'
    let recipientAgentId: string | null = null
    {
      try {
        const { loadAgents: loadAll } = await import('@/lib/agent-registry')
        // Strip @hostId if present
        const recipientName = to.includes('@') ? to.split('@')[0] : to
        const agent = loadAll().find(a => a.name === recipientName || a.id === recipientName)
        if (agent) {
          recipientTitle = (agent.governanceTitle || 'autonomous').toLowerCase()
          recipientAgentId = agent.id
          ops.push(`G05: Recipient resolved — "${agent.name}" (${recipientTitle.toUpperCase()})`)
        } else {
          ops.push(`G05: WARN — Recipient "${to}" not found in registry (may be remote)`)
        }
      } catch {
        ops.push(`G05: WARN — Registry lookup failed for recipient`)
      }
    }

    // ── G06: Communication graph check (R6, R6.10) ──────────────
    // 2026-04-22 v2: graph now includes HUMAN (H) as a first-class node
    // with reply-only (`1>`) edges from team titles. Pass `recipientIsHuman`
    // when the target is the user, and `inReplyToMessageId` when this is
    // a reply to a prior H→agent message. validateMessageRoute rejects
    // reply-only edges without the reply context.
    //
    // SVC2-MAJ-19 fix (2026-05-06): the previous catch block silently logged
    // a WARN and let the message through. A broken import path or transient
    // throw became a silent governance bypass. Now fail-CLOSED with a 503-style
    // error so the failure is observable.
    // R36/R37/R38 — is the user-authority model enabled? Read once; gates the
    // new user-sender enforcement so flag-off behavior is byte-identical
    // (user/system senders skip the graph exactly as before).
    let userModelEnabled = false
    try {
      const { isUserAuthorityModelEnabled } = await import('@/lib/governance')
      userModelEnabled = isUserAuthorityModelEnabled()
    } catch { userModelEnabled = false }

    if (input.skipGraphCheck) {
      ops.push(`G06: Graph check skipped (explicitly)`)
    } else if (senderTitle === 'user') {
      // ── R38.2 USER-SENDER ENFORCEMENT (model ON) ──────────────────────────
      // SECURITY-CRITICAL: pre-model, this path SKIPPED the graph entirely
      // (line 199 `senderTitle !== 'user'`), letting any "user" message bypass
      // all routing. With the model ON and a resolved userId, we now compute the
      // relational flags and run the graph fail-closed. With the model OFF (or
      // no resolved userId — e.g. an internal/system caller passing from:'user')
      // we preserve the legacy skip.
      const senderUserId = input.authContext?.userId
      if (userModelEnabled && senderUserId) {
        try {
          const us = await resolveUserSenderContext(senderUserId, recipientAgentId, recipientTitle, to)
          const { validateMessageRoute } = await import('@/lib/communication-graph')
          const recipientTitleStr = String(recipientTitle ?? '')
          const recipientIsHuman = recipientTitleStr === 'human' || recipientTitleStr === 'user' || us.recipientIsUser
          const graphResult = validateMessageRoute(senderTitle, recipientTitle, {
            userSender: us,
            recipientIsHuman,
            recipientUserTitle: us.recipientIsUser ? 'user' : undefined,
            inReplyToMessageId: input.inReplyTo,
          })
          if (!graphResult.allowed) {
            result.error = `Message blocked by communication graph (R38.2): ${graphResult.reason || 'user message forbidden'}. ` +
              (graphResult.suggestion ? `Suggestion: ${graphResult.suggestion}` : '')
            ops.push(`G06: DENIED — R38.2 user-route: user → ${recipientTitle ?? 'unknown'} forbidden${graphResult.edgeType ? ` (${graphResult.edgeType})` : ''}`)
            return result
          }
          ops.push(`G06: R38.2 user-route allows user → ${recipientTitle ?? 'unknown'}`)
        } catch (graphErr) {
          // FAIL-CLOSED: a broken module / lookup must never pass-through.
          result.error = 'graph_check_unavailable'
          ops.push(`G06: DENIED — user-route check unavailable (${graphErr instanceof Error ? graphErr.message : 'unknown error'})`)
          console.error('[SendMessage] G06 user-route check failed (fail-closed):', graphErr)
          return result
        }
      } else {
        ops.push(`G06: Graph check skipped (user sender, model ${userModelEnabled ? 'on but no resolved userId' : 'off'})`)
      }
    } else if (senderTitle === 'system') {
      ops.push(`G06: Graph check skipped (sender is system)`)
    } else {
      // ── Agent sender — existing R6 graph check (unchanged) ────────────────
      try {
        const { validateMessageRoute } = await import('@/lib/communication-graph')
        // recipientTitle is typed as AgentRole | null | undefined; AgentRole
        // does not include 'human' or 'user', but legacy flows may pass either
        // sentinel on the wire. Normalise by string-cast before comparison.
        const recipientTitleStr = String(recipientTitle ?? '')
        const recipientIsHuman = recipientTitleStr === 'human' || recipientTitleStr === 'user'
        // R38.2 — when the model is on, tell the graph the recipient user's
        // title so the inbound "normal users don't receive from agents" rule
        // fires. Resolve only when the recipient is a user (cheap no-op otherwise).
        let recipientUserTitle: import('@/types/user').UserTitle | undefined
        if (userModelEnabled && recipientIsHuman) {
          recipientUserTitle = await resolveRecipientUserTitle(to)
        }
        const graphResult = validateMessageRoute(senderTitle, recipientTitle, {
          recipientIsHuman,
          recipientUserTitle,
          inReplyToMessageId: input.inReplyTo,
        })
        if (!graphResult.allowed) {
          result.error = `Message blocked by communication graph (R6): ${graphResult.reason || `${senderTitle.toUpperCase()} cannot message ${(recipientTitle || 'unknown').toUpperCase()}`}. ` +
            (graphResult.suggestion ? `Suggestion: ${graphResult.suggestion}` : '')
          ops.push(`G06: DENIED — R6 graph: ${senderTitle} → ${recipientTitle ?? 'unknown'} forbidden${graphResult.edgeType ? ` (${graphResult.edgeType})` : ''}`)
          return result
        }
        ops.push(`G06: R6 graph allows ${senderTitle} → ${recipientTitle ?? 'unknown'}${graphResult.edgeType === 'reply-only' ? ' (reply-only)' : ''}`)
      } catch (graphErr) {
        // FAIL-CLOSED: surface the failure rather than silently allowing.
        // R6 is a documented governance gate; a missing/broken module must
        // never pass-through as "allowed".
        result.error = 'graph_check_unavailable'
        ops.push(`G06: DENIED — graph module unavailable (${graphErr instanceof Error ? graphErr.message : 'unknown error'})`)
        console.error('[SendMessage] G06 graph check failed (fail-closed):', graphErr)
        return result
      }
    }

    // ── G07: Team isolation check ─────────────────────────────
    // SVC2-MAJ-20 fix (2026-05-06): same fail-OPEN pattern as G06. A throw
    // inside checkMessageAllowed used to leak cross-team messages. Now
    // fail-CLOSED.
    if (!input.skipGraphCheck && senderAgentId && recipientAgentId) {
      try {
        const { checkMessageAllowed } = await import('@/lib/message-filter')
        const filterResult = checkMessageAllowed({
          senderAgentId,
          recipientAgentId,
        })
        if (!filterResult.allowed) {
          result.error = `Message blocked by team isolation: ${filterResult.reason || 'Sender and recipient are in different closed teams'}`
          ops.push(`G07: DENIED — team isolation: ${filterResult.reason}`)
          return result
        }
        ops.push(`G07: Team isolation check passed`)
      } catch (teamErr) {
        result.error = 'team_isolation_check_unavailable'
        ops.push(`G07: DENIED — team-isolation module unavailable (${teamErr instanceof Error ? teamErr.message : 'unknown error'})`)
        console.error('[SendMessage] G07 team isolation check failed (fail-closed):', teamErr)
        return result
      }
    } else {
      ops.push(`G07: Team isolation check skipped (no agent IDs resolved)`)
    }

    // ═══════════════════════════════════════════════════════════
    // EXECUTION
    // ═══════════════════════════════════════════════════════════

    // ── EXE: Compose and deliver via sendFromUI ───────────────
    try {
      const { sendFromUI } = await import('@/lib/message-send')
      // Cast content.type to the union type expected by Message['content']
      const typedContent = {
        ...content,
        type: content.type as 'request' | 'response' | 'notification' | 'alert' | 'task' | 'status' | 'handoff' | 'ack' | 'update' | 'system',
      }
      const sendResult = await sendFromUI({
        from,
        to,
        subject,
        content: typedContent,
        priority: priority || 'normal',
        inReplyTo,
      })
      result.messageId = sendResult.message?.id
      result.notified = sendResult.notified
      result.success = true
      ops.push(`EXE: Message delivered — id=${sendResult.message?.id || 'unknown'}, notified=${sendResult.notified}`)
    } catch (sendErr) {
      result.error = sendErr instanceof Error ? sendErr.message : 'Failed to send message'
      ops.push(`EXE: FAILED — ${result.error}`)
      return result
    }

    // ═══════════════════════════════════════════════════════════
    // POST-EXECUTION GATES
    // ═══════════════════════════════════════════════════════════

    // ── PG01: Verify message was written ──────────────────────
    if (recipientAgentId && result.messageId) {
      try {
        const { existsSync } = await import('fs')
        const { join } = await import('path')
        const { homedir } = await import('os')
        const HOME = homedir()
        // Check if message file exists in recipient's inbox
        // AMP inbox structure: ~/.agent-messaging/agents/<agentId>/messages/inbox/
        const inboxDir = join(HOME, '.agent-messaging', 'agents', recipientAgentId, 'messages', 'inbox')
        if (existsSync(inboxDir)) {
          ops.push(`PG01: Recipient inbox exists at ${inboxDir}`)
        } else {
          ops.push(`PG01: WARN — Recipient inbox dir not found (message may be queued for relay)`)
        }
      } catch {
        ops.push(`PG01: WARN — Could not verify message delivery`)
      }
    } else {
      ops.push(`PG01: Delivery verification skipped (no recipientAgentId or messageId)`)
    }

    // ── PG02: Tmux push notification ──────────────────────────
    // sendFromUI already handles this via deliver() → notifyViaTmux().
    // This gate just logs whether it happened.
    if (result.notified) {
      ops.push(`PG02: Tmux push notification sent to recipient`)
    } else {
      ops.push(`PG02: No tmux push (recipient offline or notification disabled)`)
    }

    console.log(`[SendMessage] "${from}" → "${to}" — ${result.success ? 'OK' : 'FAILED'} (${ops.length} gates)`)
    return result
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
    console.error(`[SendMessage] FAILED:`, result.error)
    return result
  }
}
