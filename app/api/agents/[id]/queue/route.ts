import { NextRequest, NextResponse } from 'next/server'
import { authenticateFromRequest, buildAuthContext } from '@/lib/agent-auth'
import { requireSudoToken } from '@/lib/sudo-guard'
import { requireAuth } from '@/lib/route-auth'
import { authorize } from '@/lib/authorization'
import { isValidUuid } from '@/lib/validation'
import { getAgentById, onQueueEnqueued } from '@/services/agents-core-service'
import { enqueueCommand, listQueue } from '@/lib/command-queue'

/**
 * POST /api/agents/[id]/queue — enqueue a command for an agent to fire once it
 * is next at a safe idle prompt. Body: {command | commandKey, when?, wakeFirst?}.
 *
 * Classified "strict" in security-registry.json: a queued command WILL be
 * injected into a live agent terminal, so it is gated exactly like the
 * command-send route — a USER caller needs a fresh sudo token, an AGENT caller
 * authorizes by AID + title (requireSudoToken R32 dual-path). Ordering mirrors
 * the strict-POST sibling ensure-core: sudo FIRST, then auth.
 *
 * TRDD-8RVDY7ND: sudo/auth alone proves WHO is calling, never WHAT they may
 * target — sudoErr/authenticateFromRequest do not check `id` against the
 * caller at all. Measured: this route called neither `authorize()` nor any
 * cross-agent check, so ANY authenticated agent (any title, any target state)
 * could enqueue an arbitrary command into ANY other agent's terminal — worse
 * than the R42.8 unblock exception (which at least demands the target be
 * blocked), and inconsistent with every sibling drive route (PATCH
 * .../session, POST .../chat, and this route's own DELETE .../[entryId]
 * sibling all gate cross-agent via the `send-command` matrix, whose doc
 * comment on the DELETE sibling already — falsely — claimed "Enqueue is
 * gated"). `send-command` sits in DRIVE_ACTIONS (lib/authorization.ts), so
 * R42 refuses it for any cross-agent target unconditionally; SELF_DRIVE
 * exempts an agent enqueuing for itself, and the system owner is unaffected
 * (authorize() grants isSystemOwner outright). This is the SAME matrix the
 * sibling routes use — no new authorization concept.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
  }

  const sudoErr = requireSudoToken(request, 'POST', '/api/agents/[id]/queue')
  if (sudoErr) return sudoErr

  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }

  const authz = authorize(auth, 'send-command', id)
  if (!authz.allowed) {
    return NextResponse.json({ error: authz.reason || 'Forbidden' }, { status: 403 })
  }

  const agentRes = getAgentById(id)
  if (agentRes.error || !agentRes.data) {
    return NextResponse.json(
      { error: agentRes.error || 'Agent not found' },
      { status: agentRes.status || 404 },
    )
  }

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const result = enqueueCommand(id, {
    command: body.command,
    commandKey: body.commandKey,
    when: body.when,
    wakeFirst: body.wakeFirst,
    // Provenance, taken from the VERIFIED auth result — never from the body, or
    // a caller could forge an owner and cancel anything. A system-owner has no
    // agentId; record it as 'user' so no agentId can ever collide with it.
    enqueuedBy: auth.agentId ?? 'user',
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  // Best-effort enqueue-side dispatch (wakeFirst wake / now-if-idle immediate
  // drain). It awaits only a fast session-existence probe then fires the
  // wake/drain without blocking — a failure here never fails the 201 (the entry
  // is already persisted and will drain on the next idle window).
  try {
    await onQueueEnqueued(id, result.entry, buildAuthContext(auth))
  } catch (err) {
    console.error('[Queue POST] enqueue-side dispatch failed:', err)
  }

  return NextResponse.json({ entry: result.entry }, { status: 201 })
}

/**
 * GET /api/agents/[id]/queue — list an agent's pending queued commands (FIFO
 * order). Read-only ⇒ non-strict; any authenticated caller may inspect any
 * agent's queue (fleet-monitor surface, like /full and /prompt).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireAuth(request)
  if (!auth.ok) return auth.error

  const { id } = await params
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
  }

  return NextResponse.json({ queue: listQueue(id) })
}
