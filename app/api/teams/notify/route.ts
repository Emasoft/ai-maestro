import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { notifyTeamAgents } from '@/services/teams-service'
import { authenticateFromRequest, buildAuthContext } from '@/lib/agent-auth'
import { checkTeamAccess } from '@/lib/team-acl'
import { loadTeams } from '@/lib/team-registry'

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

  // ── TRDD-91TLL7DW fix — the caller was authenticated and then never checked ──
  // BUG: this route called `authenticateFromRequest` and never used `auth` again, so
  // caller-supplied `agentIds[]` went straight to `notifyTeamAgents` -> `notifyAgent`,
  // which terminates in a tmux send-keys primitive. The service sanitizes the MESSAGE
  // (control-character strip) and never asked whether the CALLER may address those
  // agents. Any authenticated agent, of any title, in or out of the team, could inject
  // keystrokes into any other agent's pane THROUGH THE SERVER.
  //
  // Why that matters beyond this route: the server holds the tmux socket, so an agent
  // confined by a sandbox that denies the socket does not need it — it asks the server.
  // Route authorization and process confinement are not alternatives; a missing check
  // here voids the confinement layer for this capability.
  //
  // Two checks are required and neither is sufficient alone:
  //   1. the caller may act on the named team at all, and
  //   2. every target id is a MEMBER of that team — otherwise a legitimate member of
  //      team A names team A and passes arbitrary agentIds, which is the same attack
  //      wearing a valid team name.
  const teams = loadTeams()
  const team = teams.find(t => t.name === parsed.data.teamName)
  if (!team) {
    return NextResponse.json({ error: 'Team not found' }, { status: 404 })
  }

  const access = checkTeamAccess({
    teamId: team.id,
    requestingAgentId: auth.agentId,
    authContext: buildAuthContext(auth),
  })
  if (!access.allowed) {
    return NextResponse.json({ error: access.reason || 'Access denied' }, { status: 403 })
  }

  const members = new Set(team.agentIds)
  const foreign = parsed.data.agentIds.filter(id => !members.has(id))
  if (foreign.length > 0) {
    return NextResponse.json(
      { error: `Access denied: ${foreign.length} target agent(s) are not members of team '${team.name}'` },
      { status: 403 },
    )
  }

  const result = await notifyTeamAgents(parsed.data)

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.data)
}
