import { NextRequest, NextResponse } from 'next/server'
import { forwardMessage } from '@/services/messages-service'
import { authenticateFromRequest, buildAuthContext } from '@/lib/agent-auth'

// CC-P1-412: Wrap request.json() in try/catch for malformed JSON
export async function POST(request: NextRequest) {
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }
  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  // R28/R32/R38 sender ownership (TRDD-YEE33F3A). `fromSession` lands verbatim
  // in the forwarded message's `from`/`forwardedBy`, is written to that agent's
  // sent folder, and is the identity the governance filter is evaluated against.
  // This route authenticated and then discarded the result, so any authenticated
  // caller could forward AS any agent — and, by forwarding to itself, read any
  // agent's mail. Override with the verified identity, exactly as
  // `POST /api/messages` already does for `body.from` ("prevents sender
  // spoofing"). The system owner (web UI, no agentId) keeps the supplied value.
  if (auth.agentId) {
    body.fromSession = auth.agentId
  }
  // The previous guard here required `body.to` and `body.message` — two fields
  // the service never reads. It rejected the Message Center's real payload
  // ({messageId, fromSession, toSession, forwardNote}) with a 400 while an
  // attacker passed it trivially by adding two ignored keys. The service
  // validates the fields it actually uses; this checked the wrong contract.
  try {
    const result = await forwardMessage({ ...body, authContext: buildAuthContext(auth) })
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data, { status: result.status })
  } catch (error) {
    console.error('[Forward] Error:', error)
    return NextResponse.json({ error: 'Failed to forward message' }, { status: 500 })
  }
}
