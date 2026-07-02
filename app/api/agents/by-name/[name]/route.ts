import { NextRequest, NextResponse } from 'next/server'
import { lookupAgentByName } from '@/services/agents-core-service'
import { enforceAuth } from '@/lib/route-auth'

/**
 * GET /api/agents/by-name/[name]
 * Check if an agent exists by name on this host (rich resolution)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  // API2-MIN-02: full token verification at handler level (defense-in-depth
  // beyond the middleware structural check). The previous code relied
  // entirely on middleware credential-presence which doesn't validate the
  // token itself.
  const authErr = enforceAuth(request)
  if (authErr) return authErr

  try {
    const { name } = await params
    // SF-051: Validate name format (alphanumeric, hyphens, underscores only)
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      return NextResponse.json({ error: 'Invalid agent name format' }, { status: 400 })
    }
    const result = lookupAgentByName(name)

    if (result.status >= 400) {
      return NextResponse.json(result.data || { exists: false }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    // MF-003: Outer try-catch for unhandled service throws
    console.error('[By-Name GET] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
