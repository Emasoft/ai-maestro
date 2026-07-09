import { NextRequest, NextResponse } from 'next/server'
import {
  getMessage,
  updateMessage,
  deleteMessageById,
  forwardMessage,
} from '@/services/agents-messaging-service'
import { requireAuth } from '@/lib/route-auth'
import { isValidUuid } from '@/lib/validation'

// SF-019: Allowed box values for runtime validation
const VALID_BOX_VALUES: readonly string[] = ['inbox', 'sent']

/**
 * R28/R32/R38 mailbox ownership (TRDD-YEE33F3A).
 *
 * A mailbox has an OWNER, so it is authorized by ownership, not by the title
 * matrix — no title, not even MANAGER or the owner's own COS, may read or
 * mutate another agent's mail. Identical to the sibling
 * `GET /api/agents/[id]/messages` guard.
 *
 * Every verb here previously called `authenticateFromRequest` and then
 * DISCARDED the result, so any holder of any valid agent token could act on any
 * agent's mailbox by UUID. The sharpest was POST (forward): its path `id`
 * becomes the forwarded message's `from`, so it was a sender-forgery primitive
 * — and, aimed back at the caller, a read primitive for anyone's mail.
 *
 * The system owner (web UI, no `agentId`) may target any agent.
 */
function denyForeignMailbox(agentId: string | undefined, pathId: string): NextResponse | null {
  if (agentId && agentId !== pathId) {
    return NextResponse.json(
      { error: 'Forbidden — you may only access your own mailbox' },
      { status: 403 }
    )
  }
  return null
}

/**
 * GET /api/agents/[id]/messages/[messageId]
 * Get a specific message for an agent
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; messageId: string } }
) {
  const auth = requireAuth(request)
  if (!auth.ok) return auth.error
  try {
    const { id, messageId } = await params
    // SF-009: Validate UUID format for agent ID (defense-in-depth)
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
    }
    // SF-048: Validate messageId format (defense-in-depth)
    if (!isValidUuid(messageId)) {
      return NextResponse.json({ error: 'Invalid message ID format' }, { status: 400 })
    }
    const denial = denyForeignMailbox(auth.agentId, id)
    if (denial) return denial
    // NT-027: Use request.nextUrl.searchParams for consistent URL parsing
    const searchParams = request.nextUrl.searchParams
    // SF-019: Validate box parameter against allowed values before casting
    const boxParam = searchParams.get('box') || 'inbox'
    if (!VALID_BOX_VALUES.includes(boxParam)) {
      return NextResponse.json({ error: `Invalid box parameter. Allowed: ${VALID_BOX_VALUES.join(', ')}` }, { status: 400 })
    }
    const box = boxParam as 'inbox' | 'sent'

    const result = await getMessage(id, messageId, box, auth.context)

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    // MF-003: Outer try-catch for unhandled service throws
    console.error('[Messages MessageId GET] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/agents/[id]/messages/[messageId]
 * Update message status (mark as read, archive)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; messageId: string } }
) {
  const auth = requireAuth(request)
  if (!auth.ok) return auth.error
  try {
    const { id, messageId } = await params
    // SF-009: Validate UUID format for agent ID (defense-in-depth)
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
    }
    // SF-048: Validate messageId format (defense-in-depth)
    if (!isValidUuid(messageId)) {
      return NextResponse.json({ error: 'Invalid message ID format' }, { status: 400 })
    }
    const denial = denyForeignMailbox(auth.agentId, id)
    if (denial) return denial
    let body
    try { body = await request.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const result = await updateMessage(id, messageId, body, auth.context)

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    // MF-003: Outer try-catch for unhandled service throws
    console.error('[Messages MessageId PATCH] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/agents/[id]/messages/[messageId]
 * Delete a message
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; messageId: string } }
) {
  const auth = requireAuth(request)
  if (!auth.ok) return auth.error
  try {
    const { id, messageId } = await params
    // SF-009: Validate UUID format for agent ID (defense-in-depth)
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
    }
    // SF-048: Validate messageId format (defense-in-depth)
    if (!isValidUuid(messageId)) {
      return NextResponse.json({ error: 'Invalid message ID format' }, { status: 400 })
    }
    const denial = denyForeignMailbox(auth.agentId, id)
    if (denial) return denial

    const result = await deleteMessageById(id, messageId, auth.context)

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    // MF-003: Outer try-catch for unhandled service throws
    console.error('[Messages MessageId DELETE] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/agents/[id]/messages/[messageId]
 * Forward a message to another agent
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; messageId: string } }
) {
  const auth = requireAuth(request)
  if (!auth.ok) return auth.error
  try {
    const { id, messageId } = await params
    // SF-009: Validate UUID format for agent ID (defense-in-depth)
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
    }
    // SF-048: Validate messageId format (defense-in-depth)
    if (!isValidUuid(messageId)) {
      return NextResponse.json({ error: 'Invalid message ID format' }, { status: 400 })
    }
    // The sharpest verb on this route: `id` becomes the forwarded message's
    // sender. Refuse before reading the body so a foreign-mailbox forward never
    // reaches the message store.
    const denial = denyForeignMailbox(auth.agentId, id)
    if (denial) return denial
    let body
    try { body = await request.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const result = await forwardMessage(id, messageId, body, auth.context)

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data, { status: result.status })
  } catch (error) {
    // MF-003: Outer try-catch for unhandled service throws
    console.error('[Messages MessageId POST] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
