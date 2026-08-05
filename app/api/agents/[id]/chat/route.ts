/**
 * Agent Chat API
 *
 * GET  /api/agents/:id/chat — Get conversation messages
 * POST /api/agents/:id/chat — Send message to agent's tmux session
 *
 * Thin wrapper — business logic in services/agents-chat-service.ts
 */

import { NextRequest, NextResponse } from 'next/server'
import { getConversationMessages, sendChatMessage } from '@/services/agents-chat-service'
import { isValidUuid } from '@/lib/validation'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { authorize } from '@/lib/authorization'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id: agentId } = await params
    // SF-009: Validate UUID format for agent ID (defense-in-depth)
    if (!isValidUuid(agentId)) {
      return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
    }
    const searchParams = request.nextUrl.searchParams
    const since = searchParams.get('since')
    // CC-P3-004: NaN guard — fall back to 100 if parseInt yields NaN
    // API2-MIN-04: cap upper bound at 500 to prevent caller-controlled
    // memory-DoS via huge `?limit=` values.
    const rawLimit = parseInt(searchParams.get('limit') || '100', 10) || 100
    const limit = Math.min(Math.max(rawLimit, 1), 500)

    const result = await getConversationMessages(agentId, { since, limit })
    if (result.error) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    // API2-MIN-01: log full error server-side but return generic message to client.
    console.error('[Chat API] GET Error:', error)
    return NextResponse.json(
      { success: false, error: 'internal_error', code: 'agent-chat-get' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/agents/:id/chat — send a message to the agent's tmux session.
 *
 * This route ends in `runtime.sendKeys(sessionName, message, { literal: true,
 * enter: true })`. It types arbitrary text into a live agent's terminal and
 * presses Enter. That is the `send-command` capability, whatever the endpoint is
 * named, so it carries the `send-command` action.
 *
 * It previously called `enforceAuth` alone, which AUTHENTICATES and stops — it
 * does not even return the caller's identity. So any principal holding any valid
 * agent token could type into any other agent's pane: a MEMBER into the
 * MANAGER's terminal, an instruction into a peer's prompt, a shell command into
 * a pane sitting at a shell. It was a complete bypass of the `send-command`
 * matrix and of sudo-mode, reachable through the one route nobody thought of as
 * a control surface because it is called "chat".
 *
 * Deliberately NOT classified strict: the dashboard's chat box is the human
 * typing to their own agent, and a sudo prompt per message would be absurd.
 * `authorize()` grants the system-owner, so the UI is unaffected — including the
 * chat box that carries the MANAGER its orders from the USER.
 *
 * TRDD-BF3JN4TL (R42, USER mandate 2026-07-14): an AGENT is held to the
 * `send-command` matrix, which is now SELF-ONLY. It may type into its own pane
 * (it can already do that); it may type into NOBODY else's — not a MANAGER into
 * a MEMBER's, not a COS into its own team's. Messaging is the only channel of
 * agent-to-agent influence. The earlier "MANAGER anywhere, COS in-team" grant is
 * SUPERSEDED.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }

  try {
    const { id: agentId } = await params
    // SF-009: Validate UUID format for agent ID (defense-in-depth)
    if (!isValidUuid(agentId)) {
      return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
    }

    const authz = authorize(auth, 'send-command', agentId)
    if (!authz.allowed) {
      return NextResponse.json({ error: authz.reason || 'Forbidden' }, { status: 403 })
    }
    // CC-P2-005: Guard against malformed JSON body
    let body
    try { body = await request.json() } catch {
      return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
    }

    // CC-P2-006: Validate message field exists and is a string
    if (!body.message || typeof body.message !== 'string') {
      return NextResponse.json({ success: false, error: 'Missing or invalid "message" field (must be a non-empty string)' }, { status: 400 })
    }
    // ai-maestro#117 — mark ONLY when an agent drove this. `auth.agentId` is set for an agent
    // Bearer and undefined for the human/system-owner cookie, which is the dashboard chat box —
    // a human typing, whose presence must still be recorded. Same discriminator the veto route
    // uses. R42 makes the agent case self-only, so the marked pane is the caller's own.
    const result = await sendChatMessage(agentId, body.message, {
      markAsInjected: Boolean(auth.agentId),
    })
    if (result.error) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    // API2-MIN-01: log full error server-side but return generic message to client.
    console.error('[Chat API] POST Error:', error)
    return NextResponse.json(
      { success: false, error: 'internal_error', code: 'agent-chat-post' },
      { status: 500 }
    )
  }
}
