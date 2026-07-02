import { NextRequest, NextResponse } from 'next/server'
import { hibernateAgent } from '@/services/agents-core-service'
import { isValidUuid } from '@/lib/validation'
import { authenticateFromRequest, buildAuthContext } from '@/lib/agent-auth'

/**
 * POST /api/agents/[id]/hibernate
 * Hibernate an agent by stopping its session and updating status.
 * Identity auth only — all governance checks are inside hibernateAgent Gate 0.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    // SF-009: Validate UUID format for agent ID (defense-in-depth)
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
    }

    // Identity auth: verify caller identity, build auth context for Gate 0
    const auth = authenticateFromRequest(request)
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
    }

    // Parse optional body for sessionIndex
    let sessionIndex = 0
    try {
      const body = await request.json()
      if (typeof body.sessionIndex === 'number') {
        // SF-061: Bounds check sessionIndex to prevent out-of-range values
        if (body.sessionIndex < 0 || body.sessionIndex > 99) {
          return NextResponse.json({ error: 'Invalid sessionIndex' }, { status: 400 })
        }
        sessionIndex = body.sessionIndex
      }
    } catch {
      // No body or invalid JSON, use defaults
    }

    // Delegate to hibernateAgent — Gate 0 handles authorization internally
    const result = await hibernateAgent(id, {
      sessionIndex,
      authContext: buildAuthContext(auth),
    })

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    // MF-003: Outer try-catch for unhandled service throws
    console.error('[Hibernate POST] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
