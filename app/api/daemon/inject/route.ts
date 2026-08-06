/**
 * POST /api/daemon/inject — the authenticated daemon→agent recovery channel (TRDD-APN5WB2L, #60).
 *
 * NO session cookie, NO bearer token, NO sudo gate: the ONLY credential is the Ed25519 signature
 * over the canonical request, verified against the enrolled daemon key. That is deliberate and is
 * the whole design — the janitor daemon is a launchd process with no browser session, no AID and
 * no pane, so every other credential in this system is unavailable to it by construction.
 *
 * Everything that makes this safe lives in `verifyDaemonRequest` (signature, two-sided freshness,
 * replay, and the two-verb grant) and in `daemonInject` (the exhaustive verb switch). This handler
 * adds nothing but transport, on purpose: a security decision made in a route handler is one that
 * the headless mode cannot share, and an unshared decision drifts (the R10.6 lesson).
 */
import { NextRequest, NextResponse } from 'next/server'
import { daemonInject } from '@/services/daemon-inject-service'
import { internalError } from '@/lib/error-response'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const result = await daemonInject(body)
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data, { status: result.status })
  } catch (error) {
    return internalError(error, 'Daemon inject')
  }
}
