import { NextRequest, NextResponse } from 'next/server'
import { queryEmailIndex } from '@/services/agents-messaging-service'
import { authenticateFromRequest } from '@/lib/agent-auth'

/**
 * GET /api/agents/email-index
 *
 * Returns a mapping of email addresses to agent identity.
 * Used by external gateways to build routing tables.
 *
 * Query parameters:
 *   ?address=email@example.com - Lookup single address
 *   ?agentId=uuid-123 - Get all addresses for an agent
 *   ?federated=true - Query all known hosts (not just local)
 */
export async function GET(request: NextRequest) {
  // ── TRDD-91TLL7DW — this route had NO authentication call at all ──
  // `agentId` came straight from the query string into the service with zero
  // credential checks, so any unauthenticated caller (the middleware only checks
  // credential SHAPE) could enumerate any agent's email identity — and, via
  // ?federated=true, trigger cross-host fan-out queries. Every sibling read that
  // discloses agent identity (agents/route.ts GET, governance/reachable,
  // role-plugins/status) already authenticates; this one simply never did.
  // The remote mesh caller (fetchRemoteEmailIndex in
  // services/agents-messaging-service.ts) already sends its host credential
  // because middleware.ts rejects every uncredentialed /api/* request; a guard
  // added only to the un-authenticated past changed nothing it relied on.
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }
  try {
    // NT-027: Use request.nextUrl.searchParams for consistent URL parsing
    const searchParams = request.nextUrl.searchParams

    const result = await queryEmailIndex({
      addressQuery: searchParams.get('address'),
      agentIdQuery: searchParams.get('agentId'),
      federated: searchParams.get('federated') === 'true',
      isFederatedSubQuery: request.headers.get('X-Federated-Query') === 'true',
    })

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    // SF-046: Outer try-catch for unhandled service throws
    console.error('[Email Index GET] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
