import { NextRequest, NextResponse } from 'next/server'
import { listMessages, sendMessage } from '@/services/agents-messaging-service'
import { isValidUuid } from '@/lib/validation'
import { requireAuth } from '@/lib/route-auth'

/**
 * GET /api/agents/[id]/messages
 * List messages for an agent (inbox, sent, or stats)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  // R28/R32/R38: reading a mailbox is authenticated, and an agent may read ONLY
  // its own inbox (the verified AID must equal the path agentId); the system
  // owner (web UI) may read any. Closes the prior unauthenticated IDOR — the GET
  // had no auth, so any caller could read any agent's messages by UUID.
  const auth = requireAuth(request)
  if (!auth.ok) return auth.error
  try {
    const { id } = await params
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
    }
    if (auth.agentId && auth.agentId !== id) {
      return NextResponse.json({ error: 'Forbidden — you may only read your own mailbox' }, { status: 403 })
    }
    // SF-001 fix: Use NextRequest.nextUrl.searchParams instead of new URL(request.url)
    const searchParams = request.nextUrl.searchParams

    const result = await listMessages(id, {
      box: searchParams.get('box') || undefined,
      status: searchParams.get('status') || undefined,
      priority: searchParams.get('priority') || undefined,
      from: searchParams.get('from') || undefined,
      to: searchParams.get('to') || undefined,
    })

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    console.error('[Messages GET] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/agents/[id]/messages
 * Send a message from this agent to another agent
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  // AMP send-message mutation — authenticate before any dispatch.
  // Agents use their AID bearer token; the web UI uses the session cookie.
  // SVC2-MAJ-06 fix (2026-05-06): forward AuthContext so the service can
  // verify caller identity matches the path agentId.
  const auth = requireAuth(request)
  if (!auth.ok) return auth.error

  try {
    const { id } = await params
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
    }
    let body
    try { body = await request.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const result = await sendMessage(id, body, auth.context)

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data, { status: result.status })
  } catch (error) {
    console.error('[Messages POST] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
