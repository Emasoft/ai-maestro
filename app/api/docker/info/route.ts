import { NextRequest, NextResponse } from 'next/server'
import { enforceAuth } from '@/lib/route-auth'
import { getDockerInfo } from '@/services/config-service'

export const dynamic = 'force-dynamic'

/**
 * GET /api/docker/info
 * Check if Docker is available on this host.
 */
export async function GET(req: NextRequest) {
  // TRDD-1V7UZ38I: this spawns `docker version` and returns the daemon version; it had no gate at all.
  // Checked BEFORE getDockerInfo() so a refused caller never triggers the subprocess.
  const authErr = enforceAuth(req)
  if (authErr) return authErr

  const result = await getDockerInfo()
  // SF-005: Add standard error guard for consistency with other routes
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.data, { status: result.status })
}
