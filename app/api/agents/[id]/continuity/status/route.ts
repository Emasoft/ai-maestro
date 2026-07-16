import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/route-auth'
import { isValidUuid } from '@/lib/validation'
import { getContinuityStatus } from '@/lib/continuity-status'

/**
 * GET /api/agents/[id]/continuity/status
 *
 * The server route behind `aimaestro-continuity.sh status <self>` (TRDD-DXJZM3BW, NPT of
 * KCRMSNL7). Returns the 5-field continuity status contract — a DELIBERATE metadata ceiling
 * (TRDD-H24DF6ZC Constraint 1): account_healthy, window_5h_pct, window_7d_pct,
 * cache_ttl_minutes, next_action. NO token material is ever in this response (R16).
 *
 * R42 self-only: an AGENT may read ONLY its own continuity status; the human system owner may
 * read any agent's (fleet view). The underlying account/window data is host-shared, but the
 * route is still self-scoped so no agent can probe another agent's endpoint.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireAuth(request)
  if (!auth.ok) return auth.error

  const { id } = await params
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
  }

  // R42: agents act only on themselves; the human owner is exempt.
  if (!auth.context.isSystemOwner && auth.context.agentId !== id) {
    return NextResponse.json(
      { error: 'forbidden: an agent may read only its own continuity status (R42)' },
      { status: 403 },
    )
  }

  const status = await getContinuityStatus()
  return NextResponse.json(status)
}
