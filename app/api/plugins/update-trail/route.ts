/**
 * GET /api/plugins/update-trail?limit=N&target=<pluginId>   (TRDD-MNN0VAS6)
 *
 * Read-only: the per-invocation `claude plugin update` trail the fleet-plugins-update
 * lane records (lib/plugin-update-trail). The janitor attributes interrupted cache
 * extractions from these rows — a last-run-only summary cannot see earlier fires.
 * Auth required; not strict (pure read of our own state root).
 */
import { NextResponse } from 'next/server'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { readUpdateTrail } from '@/lib/plugin-update-trail'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }
  try {
    const { searchParams } = new URL(request.url)
    const limitRaw = Number(searchParams.get('limit') ?? '50')
    const limit = Number.isFinite(limitRaw) ? limitRaw : 50
    const target = searchParams.get('target') || undefined
    return NextResponse.json({ rows: readUpdateTrail({ limit, target }) })
  } catch (error) {
    console.error('GET /api/plugins/update-trail failed:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
