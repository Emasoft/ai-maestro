import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateFromRequest, buildAuthContext } from '@/lib/agent-auth'
import { isValidUuid } from '@/lib/validation'
import { getTeam } from '@/lib/team-registry'
import { checkTeamAccess } from '@/lib/team-acl'
import { listProjectItems, extractReposFromItems } from '@/lib/github-cli'

const AddRepoSchema = z.object({
  url: z.string().min(1).max(512),
  name: z.string().max(256).optional(),
}).strict()

// GET /api/teams/[id]/repos — List repos for a team
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'Invalid team ID' }, { status: 400 })
  }
  const auth = authenticateFromRequest(request)
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })

  // LIB2-CRIT-02 (2026-05-06): pass AuthContext so the system-owner
  // bypass is gated on a verified web-UI session, not a missing header.
  const access = checkTeamAccess({ teamId: id, requestingAgentId: auth.agentId, authContext: buildAuthContext(auth) })
  if (!access.allowed) return NextResponse.json({ error: access.reason }, { status: 403 })

  const team = getTeam(id)
  if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 })

  // If team has a GitHub project, scan items for repos
  if (team.githubProject) {
    try {
      const items = listProjectItems(team.githubProject.owner, team.githubProject.number)
      const repos = extractReposFromItems(items)
      return NextResponse.json({ repos, source: 'github-project' })
    } catch (error) {
      return NextResponse.json(
        { error: `GitHub project scan failed: ${(error as Error).message}` },
        { status: 500 }
      )
    }
  }

  return NextResponse.json({ repos: [], source: 'none' })
}

// POST /api/teams/[id]/repos — Register a repo with the team
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'Invalid team ID' }, { status: 400 })
  }
  const auth = authenticateFromRequest(request)
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })

  let raw: unknown
  try { raw = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = AddRepoSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) },
      { status: 400 },
    )
  }
  const { url, name } = parsed.data

  const team = getTeam(id)
  if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 })

  // TODO: Full repo registration with persistent storage (e.g., team.repos array in team-registry).
  // Currently returns success but only validates — no persistent write yet.
  // When implementing, add: updateTeam(id, { repos: [...(team.repos || []), { url, name }] })
  return NextResponse.json({ registered: false, stub: true, url, name, message: 'Repo registration not yet implemented — endpoint validates only' }, { status: 501 })
}
