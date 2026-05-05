import { NextRequest, NextResponse } from 'next/server'
import { registerAgent } from '@/services/agents-core-service'
import { requireAuth } from '@/lib/route-auth'

export const dynamic = 'force-dynamic'

/**
 * POST /api/agents/register
 * Register an agent from session name or cloud config.
 *
 * SVC2-CRIT-04 fix (2026-05-06): forward AuthContext so the service can
 * enforce that:
 *   - Explicit body.id requires system-owner.
 *   - Session-only registration requires either system-owner or that the
 *     caller's agentId matches the existing-by-session lookup.
 */
export async function POST(request: NextRequest) {
  const auth = requireAuth(request)
  if (!auth.ok) return auth.error

  try {
    let body
    try { body = await request.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const result = await registerAgent({ ...body, authContext: auth.context })

    if (result.error) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      )
    }
    return NextResponse.json(result.data)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 })
  }
}
