import { NextRequest, NextResponse } from 'next/server'
import { wakeAgent } from '@/services/agents-core-service'
import { isValidUuid } from '@/lib/validation'
import { authenticateFromRequest, buildAuthContext } from '@/lib/agent-auth'

/**
 * POST /api/agents/[id]/wake
 * Wake a hibernated agent.
 * Identity auth only — all governance checks (MANAGER/COS, team-agent gate)
 * are inside wakeAgent Gate 0.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
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

    // Parse optional body
    let startProgram = true
    let sessionIndex = 0
    let program: string | undefined
    try {
      const body = await request.json()
      if (body.startProgram === false) {
        startProgram = false
      }
      if (typeof body.sessionIndex === 'number') {
        sessionIndex = body.sessionIndex
      }
      if (typeof body.program === 'string') {
        // SF-010: Do not lowercase program name -- case-sensitive filesystems need exact case
        program = body.program
      }
    } catch {
      // No body or invalid JSON — use defaults (CC-P1-611: removed debug logging)
    }

    // Delegate to wakeAgent — Gate 0 handles authorization internally
    const result = await wakeAgent(id, {
      startProgram,
      sessionIndex,
      program,
      authContext: buildAuthContext(auth),
    })

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    // MF-003: Outer try-catch for unhandled service throws
    console.error('[Wake POST] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
