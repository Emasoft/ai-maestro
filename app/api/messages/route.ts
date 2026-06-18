import { NextRequest, NextResponse } from 'next/server'
import { getMessages, sendMessage, updateMessage, removeMessage } from '@/services/messages-service'
import { authenticateFromRequest, buildAuthContext } from '@/lib/agent-auth'

/**
 * R28/R32/R38 ownership rule for the `?agent=` query param (read AND write).
 * An authenticated agent may only act on its OWN mailbox, so its verified
 * `auth.agentId` overrides any client-supplied `agent` param (mirrors the
 * POST `body.from = auth.agentId` override). The system owner (web UI, no
 * `auth.agentId`) may target any agent and keeps the supplied param.
 * This is an AID+title check (R32: never a sudo gate).
 */
function resolveAuthorizedAgentParam(
  auth: ReturnType<typeof authenticateFromRequest>,
  suppliedAgent: string | null,
): string | null {
  return auth.agentId || suppliedAgent
}

/**
 * GET /api/messages?agent=<agentId|alias|sessionName>&status=<status>&from=<from>&box=<inbox|sent>
 */
export async function GET(request: NextRequest) {
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }
  try {
    const { searchParams } = new URL(request.url)
    // R28/R38: an authenticated agent may read ONLY its own mailbox; the
    // system owner (web UI) may query any agent. See resolveAuthorizedAgentParam.
    const agentParam = resolveAuthorizedAgentParam(auth, searchParams.get('agent'))
    const result = await getMessages({
      agent: agentParam,
      id: searchParams.get('id'),
      action: searchParams.get('action'),
      box: searchParams.get('box') || 'inbox',
      limit: searchParams.get('limit'),
      status: searchParams.get('status'),
      priority: searchParams.get('priority'),
      from: searchParams.get('from'),
      to: searchParams.get('to'),
    }, buildAuthContext(auth))
    // NT-002: Use standard if (result.error) pattern instead of ?? which hides errors when data is {}
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data, { status: result.status })
  } catch (error) {
    console.error('GET /api/messages failed:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/messages - Send a new message
 *
 * Authentication: If an agent provides Authorization + X-Agent-Id headers,
 * the sender identity is verified via API key and body.from is overridden
 * with the authenticated agent ID (prevents sender spoofing).
 * If no auth headers are present, the request is treated as coming from
 * the system owner / web UI, and body.from is used as-is.
 */
export async function POST(request: NextRequest) {
  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Authenticate sender identity when auth headers are present
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }
  // If authenticated agent, override body.from with verified identity
  // and mark the message as from a verified sender
  if (auth.agentId) {
    body.from = auth.agentId
    body.fromVerified = true
  }

  try {
    // SVC2-CRIT-03 fix (2026-05-06): forward AuthContext so SendMessage's
    // G04.AUTH gate can compare caller identity to claimed sender.
    const result = await sendMessage({ ...body, authContext: buildAuthContext(auth) })
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data, { status: result.status })
  } catch (error) {
    console.error('POST /api/messages failed:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/messages?agent=<id>&id=<messageId>&action=<action>
 * MF-002: Added auth check to prevent unauthorized message modification
 */
export async function PATCH(request: NextRequest) {
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    // R28/R32/R38: an authenticated agent may mark-read/archive ONLY its own
    // messages — its verified identity overrides the supplied agent param
    // (same ownership rule as the GET fix and the POST body.from override);
    // the system owner may target any agent.
    const agent = resolveAuthorizedAgentParam(auth, searchParams.get('agent'))
    const id = searchParams.get('id')
    const action = searchParams.get('action')
    // Validate required query params are non-empty strings
    if (!agent || !id || !action) {
      return NextResponse.json({ error: 'Missing required query params: agent, id, action' }, { status: 400 })
    }
    const result = await updateMessage(agent, id, action, buildAuthContext(auth))
    // NT-002: Use standard if (result.error) pattern
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data, { status: result.status })
  } catch (error) {
    console.error('PATCH /api/messages failed:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/messages?agent=<id>&id=<messageId>
 * MF-002: Added auth check to prevent unauthorized message deletion
 */
export async function DELETE(request: NextRequest) {
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    // R28/R32/R38: an authenticated agent may delete ONLY its own messages —
    // its verified identity overrides the supplied agent param (same ownership
    // rule as the GET fix and the POST body.from override); the system owner
    // may target any agent.
    const agent = resolveAuthorizedAgentParam(auth, searchParams.get('agent'))
    const id = searchParams.get('id')
    // Validate required query params are non-empty strings
    if (!agent || !id) {
      return NextResponse.json({ error: 'Missing required query params: agent, id' }, { status: 400 })
    }
    const result = await removeMessage(agent, id, buildAuthContext(auth))
    // NT-002: Use standard if (result.error) pattern
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data, { status: result.status })
  } catch (error) {
    console.error('DELETE /api/messages failed:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
