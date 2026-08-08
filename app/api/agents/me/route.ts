/**
 * GET /api/agents/me  (TRDD-COOLOZ1N ruling 2)
 *
 * WHOAMI for agent callers: returns the CALLER's own agent identity, derived
 * from its AID credential. This is what gives every CLI a real `<self>` — the
 * shared shell resolver (scripts/shell-helpers/common.sh::_resolve_agent_id)
 * maps the literal `self` / `<self>` to this route, so an agent never has to
 * know or pass its own name.
 *
 * SELF-ONLY-BY-CONSTRUCTION, same shape as POST /api/sessions/me/restart:
 * there is NO `[id]` parameter and the route reads NOTHING from the request
 * beyond the credential — no body, query, or header can name another agent,
 * so "who is agent B" is unrepresentable here.
 *
 * WHY NOT sudo-strict (R32): a read of one's OWN identity has no cross-target
 * for sudo to protect; it is a normal authenticated route (the structural
 * middleware still blocks anonymous callers). Deliberately absent from
 * security-registry.json.
 *
 * Headless boundary, stated as data: the headless router does not serve this
 * route (nor any /api/agents/[id]/panel route) — the panel CLI, its consumer,
 * is a FULL-mode surface today. If the panel routes ever gain headless parity,
 * this route goes with them.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAgent } from '@/lib/agent-registry'
import { authenticateFromRequest } from '@/lib/agent-auth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }

  // AGENT-only. The system-owner (session cookie → no agentId) has no "me"
  // agent — a human names the agent it wants; only an AID bearer has a self.
  if (!auth.agentId) {
    return NextResponse.json(
      {
        error: 'no_self_agent',
        message: 'me is for agent callers (AID_AUTH). A human caller names the agent explicitly.',
      },
      { status: 400 }
    )
  }

  const agent = getAgent(auth.agentId)
  if (!agent) {
    return NextResponse.json({ error: 'agent_not_found' }, { status: 404 })
  }

  return NextResponse.json({ id: agent.id, name: agent.name })
}
