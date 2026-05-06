import { NextRequest, NextResponse } from 'next/server'
import { enforceAuth } from '@/lib/route-auth'
import { renameSession } from '@/services/sessions-service'

export const dynamic = 'force-dynamic'

/**
 * @deprecated Use PATCH /api/agents/[id] to update agent alias instead.
 * This endpoint uses tmux session names directly, while the agent endpoint
 * uses agent IDs for proper multi-host support.
 * Removal target: v0.28.0
 */
// NT-011: warn-once guard to avoid flooding logs on every request
let _deprecationWarned = false
function logDeprecation() {
  if (_deprecationWarned) return
  _deprecationWarned = true
  console.warn('[DEPRECATED] PATCH /api/sessions/[id]/rename - Use PATCH /api/agents/[id] to update alias instead')
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  // #114: Authenticate before any side effect.
  const authErr = enforceAuth(request)
  if (authErr) return authErr

  logDeprecation()
  try {
    let jsonBody
    try { jsonBody = await request.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    // NT-003: Use standard two-line pattern instead of tuple destructuring
    const { id: oldName } = await params
    const { newName } = jsonBody

    // API2-MIN-03: validate oldName matches tmux session naming constraints
    // (alphanumeric + a few safe punctuation characters). Same regex as the
    // session-name regex elsewhere in the codebase. This is defense-in-depth:
    // renameSession would catch the malformed name downstream, but reject
    // here means we don't even reach the service if the path is corrupt.
    if (!oldName || typeof oldName !== 'string' || !/^[a-zA-Z0-9_@.-]+$/.test(oldName)) {
      return NextResponse.json({ error: 'Invalid session name in URL' }, { status: 400 })
    }

    // SF-021: Validate newName matches tmux session naming constraints
    if (!newName || typeof newName !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(newName)) {
      return NextResponse.json({ error: 'newName is required and must match ^[a-zA-Z0-9_-]+$' }, { status: 400 })
    }

    const result = await renameSession(oldName, newName)

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json(result.data, { status: result.status })
  } catch (error) {
    console.error('Failed to rename session:', error)
    return NextResponse.json({ error: 'Failed to rename session' }, { status: 500 })
  }
}
