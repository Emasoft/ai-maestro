import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyPassword } from '@/lib/governance'
import { createNewTeam } from '@/services/teams-service'
import { enforceAuth } from '@/lib/route-auth'

export const dynamic = 'force-dynamic'

const safeOwnerRepo = /^[a-zA-Z0-9_.-]+$/

const CreateWithProjectSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(512).optional(),
  password: z.string().min(1).max(256),
  githubProject: z.object({
    owner: z.string().min(1).max(64).regex(safeOwnerRepo, 'Must be alphanumeric with _.-'),
    repo: z.string().min(1).max(64).regex(safeOwnerRepo, 'Must be alphanumeric with _.-'),
    number: z.number().int().min(1),
  }).strict().optional(),
  chiefOfStaffId: z.string().uuid().optional(),
  orchestratorId: z.string().uuid().optional(),
}).strict()

// POST /api/teams/create-with-project
export async function POST(request: NextRequest) {
  const authErr = enforceAuth(request)
  if (authErr) return authErr

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

    // Verify governance password
    const passwordValid = await verifyPassword(body.password)
    if (!passwordValid) {
      return NextResponse.json({ error: 'Invalid governance password' }, { status: 403 })
    }

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
