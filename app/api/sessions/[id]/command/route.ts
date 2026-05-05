import { NextRequest, NextResponse } from 'next/server'
import { sendCommand, checkIdleStatus } from '@/services/sessions-service'
import { authenticateFromRequest, buildAuthContext } from '@/lib/agent-auth'
import { authorize } from '@/lib/authorization'

/**
 * @deprecated Use /api/agents/[id]/session with PATCH method instead.
 * This endpoint uses tmux session names directly, while the agent endpoint
 * uses agent IDs and looks up the session from the agent's tools configuration.
 * Removal target: v0.28.0
 */
// NT-011: warn-once guard to avoid flooding logs on every request
let _deprecationWarned = false
function logDeprecation() {
  if (_deprecationWarned) return
  _deprecationWarned = true
  console.warn('[DEPRECATED] /api/sessions/[id]/command - Use /api/agents/[id]/session (PATCH) instead')
}

/**
 * POST /api/sessions/[id]/command
 * Send a command to a terminal session via tmux send-keys
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  logDeprecation()
  try {
    const { id: sessionName } = await params
    // SF-MF-023: Validate session name format (tmux naming rules)
    if (!/^[a-zA-Z0-9_@.-]+$/.test(sessionName)) {
      return NextResponse.json({ error: 'Invalid session name' }, { status: 400 })
    }

    // Auth + RBAC: sending commands to a session is a sensitive operation
    const auth = authenticateFromRequest(request)
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
    }
    // Resolve agent ID from session name for RBAC target
    const { getAgentBySession } = await import('@/lib/agent-registry')
    const targetAgent = getAgentBySession(sessionName)
    if (!targetAgent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }
    const authz = authorize(auth, 'send-command', targetAgent.id)
    if (!authz.allowed) {
      return NextResponse.json({ error: authz.reason || 'Forbidden' }, { status: 403 })
    }

    let body
    try { body = await request.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    // SF-022: Validate command is a non-empty string before passing to service
    if (!body.command || typeof body.command !== 'string') {
      return NextResponse.json(
        { success: false, error: 'command must be a non-empty string' },
        { status: 400 }
      )
    }

    const result = await sendCommand(sessionName, body.command, {
      requireIdle: body.requireIdle,
      addNewline: body.addNewline,
      authContext: buildAuthContext(auth),
    })

    if (result.error && !result.data) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      )
    }

    if (result.error && result.data) {
      // Session not idle case: has both data and error
      return NextResponse.json(
        { ...result.data, error: result.error },
        { status: result.status }
      )
    }

    return NextResponse.json(result.data, { status: result.status })
  } catch (error) {
    console.error('[Session Command API] Error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/sessions/[id]/command
 * Check if a session is idle and ready for commands
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  logDeprecation()
  try {
    // CC-GOV-012: Auth required for idle status check
    const authCheck = authenticateFromRequest(request)
    if (authCheck.error) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status || 401 })
    }

    const { id: sessionName } = await params
    // SF-MF-023: Validate session name format (tmux naming rules)
    if (!/^[a-zA-Z0-9_@.-]+$/.test(sessionName)) {
      return NextResponse.json({ error: 'Invalid session name' }, { status: 400 })
    }
    // SF-018: Wrap checkIdleStatus in try-catch with proper error response
    let data
    try {
      data = await checkIdleStatus(sessionName)
    } catch (idleError) {
      console.error('[Session Command API] checkIdleStatus error:', idleError)
      return NextResponse.json(
        { success: false, error: idleError instanceof Error ? idleError.message : 'Failed to check idle status' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, ...data })
  } catch (error) {
    console.error('[Session Command API] Error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
