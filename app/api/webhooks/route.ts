import { NextRequest, NextResponse } from 'next/server'
import { listAllWebhooks, createNewWebhook } from '@/services/webhooks-service'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { validateSsrfUrl } from '@/lib/ssrf-guard'

/**
 * GET /api/webhooks
 * List all webhook subscriptions
 *
 * MIN-02: handler-level auth — middleware only checks credential
 * presence, not validity. Add full token verification here.
 */
export async function GET(request: NextRequest) {
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401 })
  }

  const result = listAllWebhooks()

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.data)
}

/**
 * POST /api/webhooks
 * Create a new webhook subscription
 * Requires authentication to prevent unauthorized webhook creation (MF-003)
 */
export async function POST(request: NextRequest) {
  // Authenticate -- webhook creation is a write path that can trigger HTTP requests to arbitrary URLs
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401 })
  }

  let body
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // API2-MAJ-13: SSRF guard — webhook URLs become a probe primitive once
  // the worker fires them. Reject private IPs, loopback, link-local,
  // metadata service, and Tailscale CGNAT (internal mesh peers must not
  // be reachable through webhook callbacks).
  if (body && typeof body === 'object' && typeof body.url === 'string') {
    const ssrfErr = validateSsrfUrl(body.url, { allowHttp: false, blockTailscale: true })
    if (ssrfErr) {
      return NextResponse.json({ error: ssrfErr }, { status: 400 })
    }
  }

  const result = createNewWebhook(body, auth.agentId)

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.data, { status: result.status })
}
