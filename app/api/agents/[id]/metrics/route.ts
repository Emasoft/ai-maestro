import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/route-auth'
import { getMetrics, updateMetrics } from '@/services/agents-metrics-service'
import { isValidUuid } from '@/lib/validation'

/**
 * An agent owns its own metrics. They are counters it reports about itself, so
 * `modify-agent` would be inverted here: that action is not self-drive, and the
 * agent itself is the only caller this endpoint was ever written for. The web UI
 * (system owner) carries no agentId and passes through.
 */
function denyForeignMetrics(agentId: string | undefined, pathId: string): NextResponse | null {
  if (agentId && agentId !== pathId) {
    return NextResponse.json(
      { error: 'Forbidden — you may only update your own metrics' },
      { status: 403 }
    )
  }
  return null
}

/**
 * GET /api/agents/[id]/metrics
 * Get agent metrics.
 *
 * Read-open to any authenticated caller, deliberately: `GET /api/agents/[id]`
 * already returns the whole record — metrics included — to the same caller, so
 * an ownership gate here would be theater. What it does need is a real verify:
 * middleware.ts only regex-matches the credential SHAPE, so a route that calls
 * no auth helper serves anyone holding a plausible-looking token. That is the
 * gap CC-GOV-008 closed on the sibling route.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAuth(request)
  if (!auth.ok) return auth.error

  try {
    const { id: agentId } = await params
    // SF-009: Validate UUID format for agent ID (defense-in-depth)
    if (!isValidUuid(agentId)) {
      return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
    }
    const result = getMetrics(agentId)

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    // MF-003: Outer try-catch for unhandled service throws
    console.error('[Metrics GET] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/agents/[id]/metrics
 * Update agent metrics (full update or increment)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // #114: Authenticate before any side effect. `enforceAuth` did that and then
  // threw the identity away, so the route could not authorize even in principle
  // — any agent token wrote any agent's metrics (TRDD-YEE33F3A).
  const auth = requireAuth(request)
  if (!auth.ok) return auth.error

  try {
    const { id: agentId } = await params
    // SF-009: Validate UUID format for agent ID (defense-in-depth)
    if (!isValidUuid(agentId)) {
      return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
    }
    const denial = denyForeignMetrics(auth.agentId, agentId)
    if (denial) return denial

    let body
    try { body = await request.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const result = await updateMetrics(agentId, body, auth.context)

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    // MF-003: Outer try-catch for unhandled service throws
    console.error('[Metrics PATCH] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
