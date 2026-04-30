import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { listAllTeams, createNewTeam } from '@/services/teams-service'
import { authenticateFromRequest } from '@/lib/agent-auth'

// SCEN-005.03 + SCEN-010.02 (second option, 2026-04-30): allow the user to
// OPTIONALLY link an existing GitHub Projects v2 board to the team at create
// time. The team's kanban then syncs with that GitHub Project (existing
// behaviour for teams that already have `team.githubProject` set). The
// `safeOwnerRepo` regex prevents shell-injection through the gh CLI; it
// matches the pattern used by `app/api/teams/create-with-project/route.ts`.
const safeOwnerRepo = /^[a-zA-Z0-9_.-]+$/

const CreateTeamSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(512).optional(),
  agentIds: z.array(z.string().uuid()).max(50).optional(),
  type: z.literal('closed').optional(),
  chiefOfStaffId: z.string().uuid().optional(),
  governancePassword: z.string().max(256).optional(),
  // Optional link to an existing GitHub Projects v2 board. Server-side this
  // is forwarded to createNewTeam, which persists it via team-registry and
  // best-effort calls configureProjectTemplate (gh CLI) — failure to reach
  // GitHub is logged but does NOT block team creation.
  githubProject: z.object({
    owner: z.string().min(1).max(64).regex(safeOwnerRepo, 'Must be alphanumeric with _.-'),
    repo: z.string().min(1).max(64).regex(safeOwnerRepo, 'Must be alphanumeric with _.-'),
    number: z.number().int().min(1),
  }).strict().optional(),
}).strict()

// NT-009: Force dynamic -- reads runtime filesystem state (team registry)
export const dynamic = 'force-dynamic'

// GET /api/teams - List all teams
// Auth required via global /api/* middleware. Returns only team metadata
// that any authenticated caller on this host is allowed to see.
// CC-P1-309: Add standard result.error check for consistency with other routes
export async function GET() {
  const result = listAllTeams()
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.data, { status: result.status })
}

// POST /api/teams - Create a new team
// Requires governance password (R9.1 + WF-003: team creation is a governance action)
export async function POST(request: NextRequest) {
  // Authenticate requesting agent identity for governance checks
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }
  const requestingAgentId = auth.agentId

  let raw: unknown
  try { raw = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = CreateTeamSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) },
      { status: 400 },
    )
  }
  const body = parsed.data

  // Governance password required for team creation when called by an agent.
  // Two exemptions:
  //   1. System-owner (web UI with session cookie) — already authenticated via login.
  //   2. MANAGER agent (AID/session-secret auth) — team creation is a core MANAGER duty.
  // All other agents must provide the governance password.
  const isSystemOwner = !auth.agentId && !auth.error
  const isManager = auth.governanceTitle?.toUpperCase() === 'MANAGER'
  if (!isSystemOwner && !isManager) {
    const { verifyPassword } = await import('@/lib/governance')
    if (!body.governancePassword) {
      return NextResponse.json({ error: 'Governance password required for team creation. Include "governancePassword" in request body.' }, { status: 403 })
    }
    if (!(await verifyPassword(body.governancePassword))) {
      return NextResponse.json({ error: 'Invalid governance password' }, { status: 403 })
    }
  }

  const { name, description, agentIds, type, chiefOfStaffId, githubProject } = body

  const result = await createNewTeam({ name, description, agentIds, type, chiefOfStaffId, githubProject, requestingAgentId })
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.data, { status: result.status })
}
