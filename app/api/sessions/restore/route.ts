import { NextRequest, NextResponse } from 'next/server'
import { enforceAuth } from '@/lib/route-auth'
import { listRestorableSessions, restoreSessions, deletePersistedSession } from '@/services/sessions-service'

/**
 * GET /api/sessions/restore
 * Returns list of persisted sessions that can be restored
 */
export async function GET(request: NextRequest) {
  // TRDD-R268J32X. This took NO `request` at all, so it COULD NOT authenticate — while its POST
  // and DELETE siblings twenty lines below both do (SVC2-MAJ-12). Their comments say
  // "authenticate before re-spawning" and "before deleting": that pass reasoned about SIDE
  // EFFECTS, and a read that discloses was never in scope. `listRestorableSessions` returns whole
  // `PersistedSession` records — `workingDirectory` is an absolute home path, plus every session
  // name, agent id and timestamp — so unauthenticated it enumerates the fleet and leaks the
  // owner's filesystem layout.
  //
  // Read as a DECISION it would be defensible; the evidence says oversight. `sessions/activity/
  // update` is the same subtree's genuinely-decided case and it left a comment explaining exactly
  // why a looser policy is intended there. This left none, and `lib/agent-auth`'s header records
  // the project ruling: "SF-058 CLOSED: No auth headers AND no session cookie → rejected. There
  // is no 'free' system-owner access anymore."
  //
  // enforceAuth (authentication only) matches the siblings. Breaks no client: no browser code
  // calls this route — verified with a positive control on the same grep, which found
  // BuildAction.tsx for a route that IS called. The headless router reimplements this handler and
  // had the identical gap; fixed there in the same commit, because a guard added only here is
  // half-applied by construction.
  const authErr = enforceAuth(request)
  if (authErr) return authErr

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
