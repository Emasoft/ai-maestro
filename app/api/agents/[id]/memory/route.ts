import { NextRequest, NextResponse } from 'next/server'
import { getMemory, initializeMemory } from '@/services/agents-memory-service'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { authorize } from '@/lib/authorization'
import { isValidUuid } from '@/lib/validation'

/**
 * GET /api/agents/:id/memory
 * Get agent's memory (sessions and projects)
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: agentId } = await params
    if (!isValidUuid(agentId)) {
      return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
    }
    const result = await getMemory(agentId)

    if (result.error) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    console.error('[Memory GET] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/agents/:id/memory
 * Initialize schema and optionally populate from current tmux sessions
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: agentId } = await params
    if (!isValidUuid(agentId)) {
      return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
    }
    // NT-003 fix: Use explicit try/catch instead of silently swallowing JSON parse errors
    let body: Record<string, unknown>
    try { body = await request.json() } catch {
      body = {}
    }
    // SF-009: Authenticate caller (cookie for web UI, Bearer for agents)
    const auth = authenticateFromRequest(request)
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
    }
    const authz = authorize(auth, 'modify-agent', agentId)
    if (!authz.allowed) {
      return NextResponse.json({ error: authz.reason || 'Forbidden' }, { status: 403 })
    }

    const result = await initializeMemory(agentId, {
      populateFromSessions: body.populateFromSessions as boolean | undefined,
      force: body.force as boolean | undefined,
    })

    if (result.error) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    console.error('[Memory POST] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
