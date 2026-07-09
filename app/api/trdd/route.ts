import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/route-auth'
import { resolveDesignDir } from '@/lib/trdd-design-dir'
import { searchTrdds, TRDD_ZONES, type TrddZone } from '@/lib/trdd-store'

/**
 * GET /api/trdd — search the TRDD corpus of a project.
 *
 * Query params (all optional): `column`, `id`, `keyword` (alias `q`; matches
 * title + body), `zone` (proposals|tasks|archived|refused), `agentId` (which
 * project's design/ to search; default = the server's own repo). Read-only ⇒
 * non-strict; any authenticated caller may search (fleet-monitor surface).
 */
export async function GET(request: NextRequest) {
  const auth = requireAuth(request)
  if (!auth.ok) return auth.error

  const sp = request.nextUrl.searchParams
  const zoneParam = sp.get('zone')
  if (zoneParam && !TRDD_ZONES.includes(zoneParam as TrddZone)) {
    return NextResponse.json(
      { error: `Invalid zone. Allowed: ${TRDD_ZONES.join(', ')}` },
      { status: 400 },
    )
  }

  const designDir = resolveDesignDir(sp.get('agentId'))
  const results = searchTrdds(designDir, {
    column: sp.get('column') || undefined,
    id: sp.get('id') || undefined,
    keyword: sp.get('keyword') || sp.get('q') || undefined,
    zone: (zoneParam as TrddZone) || undefined,
  })
  return NextResponse.json({ count: results.length, trdds: results })
}
