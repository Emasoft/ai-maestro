import { NextRequest, NextResponse } from 'next/server'
import { enforceAuth, requireAuth } from '@/lib/route-auth'
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

  // ── TRDD-91TLL7DW — authentication is not identity handoff ──
  // enforceAuth proves WHO called; the body's `sessionName` names WHOSE session
  // to update. requireAuth re-resolves the same credential into the VERIFIED
  // identity + AuthContext that the service now cross-checks (the teams/notify
  // pattern — the ownership decision lives in the service so the headless
  // router's twin handler gets it too).
  const auth = requireAuth(request)
  if (!auth.ok) return auth.error

  try {
    let body
    try { body = await request.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const { sessionName, status, hookStatus, notificationType } = body

    // TRDD-91TLL7DW — the old API2-MIN-10 "known limitation" is CLOSED. That
    // comment accepted cross-session broadcasts as "a misleading UI badge for a
    // few seconds", rejected tightening on hook-frequency perf grounds, and
    // UNDERSTATED the stakes: notificationType === 'idle_prompt' drains the
    // target session's command QUEUE (a command-injection primitive). The check
    // now lives in broadcastActivityUpdate (the service), covering the headless
    // router's twin handler too; loadAgents() is mtime-cached, so the perf
    // objection was never real. Only sessionName FORMAT is validated here.
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

    const result = broadcastActivityUpdate(
      sessionName,
      status,
      hookStatus,
      notificationType,
      // TRDD-91TLL7DW — pass the VERIFIED caller identity (never a body field).
      // The service resolves sessionName back to it and 403s a mismatch, so an
      // authenticated agent cannot broadcast activity (or an idle_prompt, which
      // drains the command queue) for a session it does not own.
      auth.agentId,
    )

    if (result.error) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      )
    }

    return NextResponse.json(result.data, { status: result.status })
  } catch (error) {
    // API2-MIN-01: log full error server-side, return generic message to client
    console.error('[Activity Update API] Error:', error)
    return NextResponse.json(
      { success: false, error: 'internal_error', code: 'sessions-activity-update' },
      { status: 500 }
    )
  }
}
