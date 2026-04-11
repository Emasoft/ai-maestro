import { NextRequest, NextResponse } from 'next/server'
import { enforceAuth } from '@/lib/route-auth'
import { listRestorableSessions, restoreSessions, deletePersistedSession } from '@/services/sessions-service'

/**
 * GET /api/sessions/restore
 * Returns list of persisted sessions that can be restored
 */
export async function GET() {
  try {
    // NT-013: listRestorableSessions returns raw data, not a ServiceResult.
    // Phase 2 standardization will migrate this to the { data, error, status } pattern.
    const result = await listRestorableSessions()
    return NextResponse.json(result)
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.error('Failed to load restorable sessions:', errMsg)
    return NextResponse.json({ error: 'Failed to load restorable sessions' }, { status: 500 })
  }
}

/**
 * POST /api/sessions/restore
 * Restores one or all persisted sessions
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
    const { sessionId, all } = body

    // Validate types: sessionId must be string if provided, all must be boolean if provided
    if (sessionId !== undefined && typeof sessionId !== 'string') {
      return NextResponse.json({ error: 'Invalid sessionId — must be a string' }, { status: 400 })
    }
    if (all !== undefined && typeof all !== 'boolean') {
      return NextResponse.json({ error: 'Invalid all — must be a boolean' }, { status: 400 })
    }

    const result = await restoreSessions({ sessionId, all })

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ success: true, ...result.data }, { status: result.status })
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.error('Failed to restore sessions:', errMsg)
    return NextResponse.json({ error: 'Failed to restore sessions' }, { status: 500 })
  }
}

/**
 * DELETE /api/sessions/restore?sessionId=<id>
 * Permanently deletes a persisted session from storage
 */
export async function DELETE(request: NextRequest) {
  // #114: Authenticate before any side effect.
  const authErr = enforceAuth(request)
  if (authErr) return authErr

  try {
    const { searchParams } = new URL(request.url)
    const sessionId = searchParams.get('sessionId')

    const result = await deletePersistedSession(sessionId || '')

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json(result.data, { status: result.status })
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.error('Failed to delete persisted session:', errMsg)
    return NextResponse.json({ error: 'Failed to delete session' }, { status: 500 })
  }
}
