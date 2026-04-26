import { NextRequest, NextResponse } from 'next/server'
import { enforceAuth } from '@/lib/route-auth'
import { broadcastActivityUpdate } from '@/services/sessions-service'

// Disable caching
export const dynamic = 'force-dynamic'

/**
 * POST /api/sessions/activity/update
 * Called by Claude Code hook to broadcast status updates in real-time
 */
export async function POST(request: NextRequest) {
  // #114: Authenticate before any side effect.
  const authErr = enforceAuth(request)
  if (authErr) return authErr

  try {
    let body
    try { body = await request.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const { sessionName, status, hookStatus, notificationType } = body

    // Validate sessionName format: only alphanumeric, hyphens, underscores, @, and dots allowed
    // (tmux session names are restricted to this charset per CLAUDE.md)
    if (sessionName && (typeof sessionName !== 'string' || !/^[a-zA-Z0-9_@.-]+$/.test(sessionName))) {
      return NextResponse.json(
        { success: false, error: 'Invalid sessionName format — only alphanumeric, hyphens, underscores, @, and dots allowed' },
        { status: 400 }
      )
    }

    // Validate status is one of the known activity statuses
    // All status values the hook can send (8-state model + legacy values)
    const VALID_STATUSES = ['active', 'idle', 'busy', 'offline', 'error', 'waiting', 'stopped', 'waiting_for_input', 'permission_request', 'subagents_running', 'compacting', 'elicitation', 'exited']
    if (status && !VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        { success: false, error: `Invalid status '${status}'. Must be one of: ${VALID_STATUSES.join(', ')}` },
        { status: 400 }
      )
    }

    // Validate hookStatus type — must be string if provided
    if (hookStatus !== undefined && typeof hookStatus !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Invalid hookStatus — must be a string' },
        { status: 400 }
      )
    }

    // Validate notificationType type — must be string if provided
    if (notificationType !== undefined && typeof notificationType !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Invalid notificationType — must be a string' },
        { status: 400 }
      )
    }

    const result = broadcastActivityUpdate(sessionName, status, hookStatus, notificationType)

    if (result.error) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      )
    }

    return NextResponse.json(result.data, { status: result.status })
  } catch (error) {
    console.error('[Activity Update API] Error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
