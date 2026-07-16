import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/route-auth'
import { isValidUuid } from '@/lib/validation'
import { getAgentSessionStatus, wakeAgent } from '@/services/agents-core-service'

/**
 * POST /api/agents/[id]/continuity/ensure-resume
 *
 * The server route behind `aimaestro-continuity.sh ensure-resume <self>` (TRDD-DXJZM3BW, NPT of
 * KCRMSNL7). Idempotent: if the agent already has a live tmux session it is a no-op
 * ('already-live'); otherwise it resumes the agent via the EXISTING wakeAgent path (real
 * actuation reusing existing infra — no new keystroke surface, no stub).
 *
 * R42 self-only: an AGENT may ensure ONLY itself is resumed; the human system owner may ensure
 * any agent (fleet management). The SERVER-INTERNAL fleet-wide liveness scan + cross-agent
 * actuation is TRDD-CHN16JXZ — deliberately NOT this self-scoped route, because an agent must
 * never drive another (R42); the server does cross-agent work internally, not via this verb.
 */
export async function POST(
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
      { error: 'forbidden: an agent may ensure only its own resume (R42)' },
      { status: 403 },
    )
  }

  const st = await getAgentSessionStatus(id)
  if (st.error || !st.data) {
    return NextResponse.json({ error: st.error ?? 'session status unavailable' }, { status: st.status ?? 500 })
  }

  // Already live → idempotent no-op.
  if (st.data.hasSession && st.data.exists) {
    return NextResponse.json({ ensured: true, action: 'already-live', idle: st.data.idle })
  }

  // Not live → wake via the existing path. wakeAgent Gate 0 re-checks authorization against the
  // same AuthContext (belt-and-braces on the self-only check above), and reports idempotency via
  // `alreadyRunning`.
  const woken = await wakeAgent(id, { authContext: auth.context })
  if (woken.error || !woken.data) {
    return NextResponse.json({ error: woken.error ?? 'wake failed' }, { status: woken.status ?? 500 })
  }

  return NextResponse.json({
    ensured: true,
    action: woken.data.alreadyRunning ? 'already-live' : 'resumed',
    sessionName: woken.data.sessionName,
  })
}
