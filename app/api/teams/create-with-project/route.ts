import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createNewTeam } from '@/services/teams-service'
import { requireAuth } from '@/lib/route-auth'
import { requireSudoToken } from '@/lib/sudo-guard'

export const dynamic = 'force-dynamic'

const safeOwnerRepo = /^[a-zA-Z0-9_.-]+$/

const CreateWithProjectSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(512).optional(),
  // code-review F2: this route used to gate SOLELY on this in-body password
  // via verifyPassword() -- the exact "any agent that knows the governance
  // password string can create a team" bypass TRDD-1LX5LMBD closed for the
  // sibling POST /api/teams (which is strict + STRICT_AGENT_RULES
  // 'manage-team'). Kept OPTIONAL and UNVALIDATED-BUT-IGNORED (same
  // treatment as `governancePassword` in app/api/teams/route.ts) so an
  // older client that still sends it gets a normal 200/403 from the sudo
  // gate below instead of a schema-validation 400.
  password: z.string().max(256).optional(),
  githubProject: z.object({
    owner: z.string().min(1).max(64).regex(safeOwnerRepo, 'Must be alphanumeric with _.-'),
    // Optional: absent = org/user-level board (browse-only kanban) — ai-maestro#133.
    repo: z.string().min(1).max(64).regex(safeOwnerRepo, 'Must be alphanumeric with _.-').optional(),
    number: z.number().int().min(1),
  }).strict().optional(),
  chiefOfStaffId: z.string().uuid().optional(),
  orchestratorId: z.string().uuid().optional(),
}).strict()

// POST /api/teams/create-with-project
export async function POST(request: NextRequest) {
  // R28/R29/R38: forward the verified caller so createNewTeam's MANAGER-RBAC
  // gate fires. Previously enforceAuth discarded the identity, so the team was
  // created with NO requestingAgentId — the gate (which 403s a non-MANAGER
  // agent) was skipped entirely. The system owner (web UI, password-verified
  // below) passes as isSystemOwner.
  const auth = requireAuth(request)
  if (!auth.ok) return auth.error

  // code-review F2: strict-route gate, at parity with POST /api/teams
  // (TRDD-1LX5LMBD). For a USER/web-UI caller this requires a fresh sudo
  // token (the UI must call this route via sudoFetch); for an AGENT caller
  // it runs authorize('manage-team') -- MANAGER-only, matching R9.1. This
  // REPLACES the ad-hoc in-body `password` check below, which let ANY
  // caller who merely knew the governance password string create a team.
  const sudoErr = requireSudoToken(request, 'POST', '/api/teams/create-with-project')
  if (sudoErr) return sudoErr

  try {
    let raw: unknown
    try { raw = await request.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = CreateWithProjectSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) },
        { status: 400 },
      )
    }
    const body = parsed.data

    // Delegate to createNewTeam — the All-In-One function that handles:
    // - MANAGER existence check
    // - COS validation (must be AUTONOMOUS) or auto-creation
    // - Auto-MEMBER titling for all team agents
    // - Orchestrator assignment
    const result = await createNewTeam({
      name: body.name.trim(),
      description: body.description?.trim(),
      chiefOfStaffId: body.chiefOfStaffId,
      orchestratorId: body.orchestratorId,
      requestingAgentId: auth.agentId,
      authContext: auth.context,
    })

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status || 500 })
    }

    // Guard: data must exist after error check passes (ServiceResult contract)
    if (!result.data?.team) {
      return NextResponse.json({ error: 'Team creation returned no data' }, { status: 500 })
    }

    const team = result.data.team

    // Post-creation: GitHub project linking (not part of createNewTeam)
    if (body.githubProject) {
      // Zod schema already validated owner/repo/number format and shell-injection safety
      const { updateTeam } = await import('@/lib/team-registry')
      await updateTeam(team.id, { githubProject: body.githubProject })

      // Configure GitHub project template
      try {
        const { configureProjectTemplate } = await import('@/lib/github-cli')
        const fieldIds = configureProjectTemplate(
          body.githubProject.owner,
          body.githubProject.number
        )
        console.log('[create-with-project] Project template configured with field IDs:', Object.keys(fieldIds))
      } catch (err) {
        // Non-fatal — project template can be configured later
        console.warn('[create-with-project] Failed to configure project template:', err)
      }
    }

    return NextResponse.json({
      team,
      message: `Team "${team.name}" created successfully`
    }, { status: 201 })

  } catch (error) {
    console.error('[create-with-project] Error:', error)
    return NextResponse.json(
      { error: 'Failed to create team' },
      { status: 500 }
    )
  }
}
