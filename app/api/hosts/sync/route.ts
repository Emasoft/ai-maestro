import { NextRequest, NextResponse } from 'next/server'
import { triggerMeshSync, getMeshStatus } from '@/services/hosts-service'
import { authenticateFromRequest } from '@/lib/agent-auth'

// Force this route to be dynamic
export const dynamic = 'force-dynamic'

/**
 * POST /api/hosts/sync
 *
 * Manually trigger synchronization with all known peers.
 */
export async function POST(request: NextRequest) {
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }
  const result = await triggerMeshSync()
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.data, { status: result.status })
}

/**
 * GET /api/hosts/sync
 *
 * Get the current mesh status without triggering a sync.
 */
export async function GET(request: NextRequest) {
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }
  const result = await getMeshStatus()
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.data, { status: result.status })
}
