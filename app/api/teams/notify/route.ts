import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { notifyTeamAgents } from '@/services/teams-service'
import { authenticateFromRequest, buildAuthContext } from '@/lib/agent-auth'

const NotifyTeamSchema = z.object({
  agentIds: z.array(z.string().uuid()).min(1).max(50),
  teamName: z.string().min(1).max(128),
}).strict()

// NT-008 fix: Force dynamic rendering for consistency with other POST-only routes
export const dynamic = 'force-dynamic'

// POST /api/teams/notify - Notify team agents about a meeting
export async function POST(request: NextRequest) {
  // Authenticate requesting agent identity (CC-P1-304)
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }

  let raw: unknown
  try { raw = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = NotifyTeamSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) },
      { status: 400 },
    )
  }

  // ── TRDD-91TLL7DW — the caller was authenticated and then never checked ──
  // BUG: this route called `authenticateFromRequest` and never used `auth` again, so
  // caller-supplied `agentIds[]` reached `notifyTeamAgents` -> `notifyAgent`, which
  // terminates in a tmux send-keys primitive. Any authenticated agent, of any title, in
  // or out of the team, could inject keystrokes into any other agent's pane.
  //
  // The authorization itself deliberately lives in the SERVICE, not here. The first
  // version of this fix put both checks in this route and left the vulnerability fully
  // live in headless mode, where `services/headless-router.ts` calls notifyTeamAgents
  // directly and never executes this file. Guarding a route in a codebase whose second
  // server mode reimplements routes protects exactly one of the two modes.
  //
  // This route's only remaining job is to hand the service the caller's VERIFIED
  // identity. Passing `auth.agentId` (never a body field) is what makes it verified.
  const result = await notifyTeamAgents({
    ...parsed.data,
    requestingAgentId: auth.agentId,
    authContext: buildAuthContext(auth),
  })

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.data)
}
