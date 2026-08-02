/**
 * GET /api/statusline/:sessionId — serve one session's last statusline observation.
 *
 * TRDD-D8OYFG35. The read half of the ingest pipeline. Deliberately NOT console-gated: the whole
 * point of feeding these numbers to the server is that every agent on the fleet — including one
 * driven from a phone over Tailscale — can read them. Console-locality belongs on the WRITE, where
 * the fact originates; on the read it would only break remote work, which is a feature here.
 *
 * `enforceAuth` (a cookie session or a Bearer token) is the gate, the same as every other fleet
 * read. Agents authenticate with their AID bearer, the dashboard with its session cookie.
 */
import { NextRequest, NextResponse } from 'next/server'
import { enforceAuth } from '@/lib/route-auth'
import { isValidStatuslineSessionId } from '@/lib/statusline-normalize'
import { readStatuslineSnapshot, STATUSLINE_FRESH_MS } from '@/lib/statusline-store'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, context: { params: Promise<{ sessionId: string }> }) {
  const authErr = enforceAuth(request)
  if (authErr) return authErr

  const { sessionId } = await context.params

  // Refuse a malformed id with 400 rather than letting it fall through to a 404. They mean
  // different things to a caller: "you asked wrongly" is fixable by the caller, "there is no such
  // session" is not, and collapsing them sends people looking in the wrong place.
  if (!isValidStatuslineSessionId(sessionId)) {
    return NextResponse.json(
      { error: 'invalid_session_id', message: 'sessionId must match [A-Za-z0-9_-]{1,128}' },
      { status: 400 },
    )
  }

  const snapshot = await readStatuslineSnapshot(sessionId)
  if (!snapshot) {
    return NextResponse.json({ error: 'not_found', sessionId }, { status: 404 })
  }

  // `fresh` is computed here rather than stored, because staleness is a property of WHEN YOU ASK,
  // not of the record. A stored flag would be wrong the millisecond after it was written.
  const ageMs = Date.now() - snapshot.capturedAt
  return NextResponse.json({ snapshot, ageMs, fresh: ageMs <= STATUSLINE_FRESH_MS })
}
