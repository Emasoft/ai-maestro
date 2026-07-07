import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { listAllTeams, createNewTeam } from '@/services/teams-service'
import { authenticateFromRequest, buildAuthContext } from '@/lib/agent-auth'
import { requireSudoToken } from '@/lib/sudo-guard'

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
  // TRDD-1LX5LMBD: superseded by the strict-route sudo gate below (`POST
  // /api/teams` is now classified "strict" + STRICT_AGENT_RULES
  // 'manage-team'). Field kept OPTIONAL and UNVALIDATED-BUT-IGNORED so an
  // older client that still sends it gets a normal 200/403 from the new
  // gate instead of a schema-validation 400.
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
// Team creation is a governance action (R9.1 + WF-003) — gated as a strict
// route (TRDD-1LX5LMBD).
export async function POST(request: NextRequest) {
  // Authenticate requesting agent identity for governance checks
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }
  const requestingAgentId = auth.agentId

  // ── strict-route gate (R32 dual-path, TRDD-1LX5LMBD) ──────────────────
  // `POST_/api/teams` is classified "strict" in security-registry.json, so
  // requireSudoToken is the load-bearing authz layer here, mirroring
  // DELETE/PUT /api/teams/[id] below: for a USER/web-UI caller it requires a
  // fresh sudo token (the Create Team dialog now calls sudoFetch, which
  // handles the 403→password-modal→retry loop transparently); for an AGENT
  // caller it runs authorize('manage-team') — MANAGER-only, matching R9.1.
  //
  // This REPLACES the previous ad-hoc in-body `governancePassword` check,
  // which (a) let the web UI create a team with ZERO password prompt
  // (SCEN-001 S017 caught this — buildAuthContext's isSystemOwner branch
  // skipped the check entirely) and (b) let ANY non-MANAGER agent create a
  // team merely by knowing the governance password string, bypassing the
  // title-based authorize() check every other team-mutating route enforces.
  const sudoErr = requireSudoToken(request, 'POST', '/api/teams')
  if (sudoErr) return sudoErr

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

  const { name, description, agentIds, type, chiefOfStaffId, githubProject } = body

  // Thread the verified AuthContext so createNewTeam can run the R28 portfolio
  // check (check #3). The web-UI session is a system-owner (no agentId) and a
  // MANAGER agent both bypass the check inside matchPortfolioToken; a delegated
  // caller is gated once an op is enabled in OPERATIONS_REQUIRING_TOKEN.
  const result = await createNewTeam({ name, description, agentIds, type, chiefOfStaffId, githubProject, requestingAgentId, authContext: buildAuthContext(auth) })
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.data, { status: result.status })
}
