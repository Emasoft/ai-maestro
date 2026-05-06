import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateFromRequest, buildAuthContext } from '@/lib/agent-auth'

const BatchAgentSchema = z.object({
  name: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_@.-]+$/, 'Agent name must be alphanumeric with _@.-'),
  governanceTitle: z.string().max(32).optional(),
  client: z.string().max(32).optional(),
  program: z.string().max(32).optional(),
  programArgs: z.string().max(2048).optional(),
}).strict()

const BatchCreateSchema = z.object({
  agents: z.array(BatchAgentSchema).min(1).max(10),
}).strict()

/**
 * POST /api/teams/[id]/batch-create-agents
 *
 * Create multiple agents in a team in one call.
 * Each agent gets the specified governanceTitle (applied after team join).
 *
 * Body: { agents: [{ name, governanceTitle, client?, program?, programArgs? }] }
 * Response: { success, created: [{ id, name, governanceTitle }], errors: [] }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // CC-GOV-002: Auth required — only system owner can batch-create agents
    const auth = authenticateFromRequest(request)
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
    }
    if (auth.agentId) {
      return NextResponse.json({ error: 'Only system owner can batch-create agents' }, { status: 403 })
    }

    const { id: teamId } = await params
    const { getTeam } = await import('@/lib/team-registry')

    const team = getTeam(teamId)
    if (!team) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 })
    }

    let raw: unknown
    try { raw = await request.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = BatchCreateSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) },
        { status: 400 },
      )
    }
    const body = parsed.data

    // Check for intra-batch name collisions (same name appears twice in the request)
    const nameSet = new Set<string>()
    for (const agentSpec of body.agents) {
      const n = agentSpec.name.toLowerCase().trim()
      if (nameSet.has(n)) {
        return NextResponse.json({ error: `Duplicate agent name "${n}" in batch` }, { status: 400 })
      }
      nameSet.add(n)
    }

    const { CreateAgent } = await import('@/services/element-management-service')

    const created: Array<{ id: string; name: string; governanceTitle: string }> = []
    const errors: Array<{ name: string; error: string }> = []

    for (const agentSpec of body.agents) {
      const result = await CreateAgent({
        name: agentSpec.name,
        client: agentSpec.client || 'claude',
        program: agentSpec.program,
        programArgs: agentSpec.programArgs,
        teamId,
        governanceTitle: agentSpec.governanceTitle || 'member',
        // SEC-PHASE-1: authContext is mandatory for Change* pipelines invoked by CreateAgent
        authContext: buildAuthContext(auth),
      })

      if (result.success && result.agentId) {
        const { getAgent } = await import('@/lib/agent-registry')
        const agent = getAgent(result.agentId)
        created.push({
          id: result.agentId,
          name: agentSpec.name,
          governanceTitle: agent?.governanceTitle || agentSpec.governanceTitle || 'member',
        })
      } else {
        errors.push({ name: agentSpec.name, error: result.error || 'Unknown error' })
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      teamId,
      teamName: team.name,
      created,
      errors,
      summary: `${created.length} created, ${errors.length} failed`,
    }, { status: errors.length === 0 ? 201 : 207 })
  } catch (error) {
    // API2-MIN-01: log full error server-side, return generic message to client
    console.error('[BatchCreateAgents] Error:', error)
    return NextResponse.json(
      { error: 'internal_error', code: 'teams-batch-create-agents' },
      { status: 500 }
    )
  }
}
