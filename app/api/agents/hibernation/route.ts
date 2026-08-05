import { NextRequest, NextResponse } from 'next/server'
import { gatherHibernationRoster } from '@/services/agent-hibernation-service'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { internalError } from '@/lib/error-response'

// Never statically generated: the answer is a live reading of tmux and the registry, and Next's
// full route cache would freeze it into a build-time snapshot that reports the fleet as it was.
export const dynamic = 'force-dynamic'

/**
 * GET /api/agents/hibernation
 *
 * For every live agent: `running | hibernated | crashed | never_woken`, plus the persistence rows
 * that reference agents no longer in the registry. Nothing in the registry answers this on its own
 * — `Agent['status']` is `active | idle | offline | deleted` (types/agent.ts:465) — four values,
 * NONE of them `hibernated`; this said three until ai-maestro#114 caught it, and the omission made
 * the correct argument below look wrong to anyone who checked it. So a hibernated agent, a crashed one and one
 * never woken all read `offline`.
 *
 * AUTH IS REQUIRED AND IS THE POINT. A roster names every agent, its uuid and its tmux session
 * name — a map of the fleet, the same metadata class `GET /api/agents` gates for the same stated
 * reason (CC-GOV-008: prevent metadata leaks via Tailscale). It is also why there is no
 * unauthenticated CLI equivalent: with the server down there is nothing to validate a caller
 * against, so the answer is simply not available. A janitor does not call this route at all — the
 * in-server daemon publishes each janitor the slice it is entitled to.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = authenticateFromRequest(request)
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
    }

    const roster = await gatherHibernationRoster()
    return NextResponse.json(roster, { status: 200 })
  } catch (error) {
    return internalError(error, 'Hibernation GET')
  }
}
