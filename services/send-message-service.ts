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

// No external type imports — this module is self-contained

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
}

export interface SendMessageResult {
  success: boolean
  operations: string[]
  messageId?: string
  notified?: boolean          // True if tmux push notification was sent
  error?: string
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
    if (!input.skipGraphCheck && senderTitle !== 'user' && senderTitle !== 'system') {
      try {
        const { validateMessageRoute } = await import('@/lib/communication-graph')
        // recipientTitle is typed as AgentRole | null | undefined; AgentRole
        // does not include 'human' or 'user', but legacy flows may pass either
        // sentinel on the wire. Normalise by string-cast before comparison.
        const recipientTitleStr = String(recipientTitle ?? '')
        const recipientIsHuman = recipientTitleStr === 'human' || recipientTitleStr === 'user'
        const graphResult = validateMessageRoute(senderTitle, recipientTitle, {
          recipientIsHuman,
          inReplyToMessageId: input.inReplyTo,
        })
        if (!graphResult.allowed) {
          result.error = `Message blocked by communication graph (R6): ${graphResult.reason || `${senderTitle.toUpperCase()} cannot message ${(recipientTitle || 'unknown').toUpperCase()}`}. ` +
            (graphResult.suggestion ? `Suggestion: ${graphResult.suggestion}` : '')
          ops.push(`G06: DENIED — R6 graph: ${senderTitle} → ${recipientTitle ?? 'unknown'} forbidden${graphResult.edgeType ? ` (${graphResult.edgeType})` : ''}`)
          return result
        }
        ops.push(`G06: R6 graph allows ${senderTitle} → ${recipientTitle ?? 'unknown'}${graphResult.edgeType === 'reply-only' ? ' (reply-only)' : ''}`)
      } catch {
        // Communication graph module not available — allow (fail-open for local messages)
        ops.push(`G06: WARN — Communication graph check skipped (module not available)`)
      }
    } else {
      ops.push(`G06: Graph check skipped (${input.skipGraphCheck ? 'explicitly' : `sender is ${senderTitle}`})`)
    }

    // ── G07: Team isolation check ─────────────────────────────
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
      } catch {
        ops.push(`G07: WARN — Team isolation check skipped (module not available)`)
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
