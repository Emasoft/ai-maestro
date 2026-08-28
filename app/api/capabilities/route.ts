/**
 * GET /api/capabilities — the public capability set (TRDD-TLSE2FEF, ai-maestro#88).
 *
 * UNAUTHENTICATED BY DESIGN: whitelisted in `middleware.ts` (and mirrored in
 * `services/headless-router.ts`, which reimplements every route for headless mode). The body is
 * `{ capabilities: { <verb>: <integer revision> } }` and nothing else — no version, no host, no
 * environment. The map itself lives in `lib/capabilities.ts`; read its header before editing it.
 */
import { NextResponse } from 'next/server'
import { capabilitiesResponse } from '@/lib/capabilities'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request): Promise<NextResponse> {
  return NextResponse.json(capabilitiesResponse(), { status: 200 })
}
