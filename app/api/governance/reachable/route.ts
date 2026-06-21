import { NextRequest, NextResponse } from 'next/server'
import { getReachableAgents } from '@/services/governance-service'
import { enforceAuth } from '@/lib/route-auth'

// SF-033: Delegate entirely to governance-service.ts to eliminate duplicate cache.
// The service layer maintains its own bounded cache with TTL eviction.
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  // SECURITY: require a real (cryptographically-verified) authenticated caller
  // before exposing an agent's communication-reachability graph. The global
  // /api/* middleware is only a STRUCTURAL credential-shape filter (it lets a
  // syntactically-valid-but-unknown cookie through — see lib/route-auth.ts), so
  // without this gate an unauthenticated caller could enumerate the comm-graph
  // (who any agent can message) by passing a client-supplied agentId. This
  // matches the auth requirement on the sibling read routes (transfers GET,
  // groups GET) — authentication only, no specific identity, so the legitimate
  // UI/system-owner use of computing reachability for an arbitrary agent is
  // preserved.
  const authErr = enforceAuth(request)
  if (authErr) return authErr

  try {
    const agentId = request.nextUrl.searchParams.get('agentId')
    const result = getReachableAgents(agentId)

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json(result.data)
  } catch (error) {
    console.error('Error computing reachable agents:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
