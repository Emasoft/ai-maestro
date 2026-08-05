/**
 * Agent Directory API
 *
 * GET /api/agents/directory
 *   Returns the agent directory for this host
 *   Used by peer hosts to sync agent locations
 *
 * Thin wrapper — business logic in services/agents-directory-service.ts
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDirectory } from '@/services/agents-directory-service'

// This handler never reads its Request (`_request` is unused), which is what makes Next.js
// full-route-cache it. But `getDirectory()` calls `rebuildLocalDirectory()` on every invocation
// and then reads the live registry — the returned `entries` and `stats` are a snapshot of which
// agents exist RIGHT NOW. Cached, a peer host syncing against this endpoint would receive the
// agent set as it stood on the machine that ran `yarn build`, forever: agents created since would
// be invisible to the mesh and deleted ones would keep being advertised, with no error and no log
// line. The route is unreachable today only because middleware 401s it first — a different layer,
// which is exactly why this must not depend on that gate staying where it is.
export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest) {
  try {
    const result = getDirectory()
    if (result.error) {
      return NextResponse.json({ success: false, error: result.error }, { status: result.status || 500 })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    // MF-016: Outer try-catch for unhandled service throws
    console.error('[Directory GET] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
