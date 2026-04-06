import { NextRequest, NextResponse } from 'next/server'

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
    const { id: teamId } = await params
    const { getTeam } = await import('@/lib/team-registry')

    const team = getTeam(teamId)
    if (!team) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 })
    }

    let body: { agents: Array<{ name: string; governanceTitle?: string; client?: string; program?: string; programArgs?: string }> }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    if (!Array.isArray(body.agents) || body.agents.length === 0) {
      return NextResponse.json({ error: 'Body must contain a non-empty "agents" array' }, { status: 400 })
    }

    if (body.agents.length > 10) {
      return NextResponse.json({ error: 'Maximum 10 agents per batch' }, { status: 400 })
    }

    const { CreateAgent } = await import('@/services/element-management-service')

    const created: Array<{ id: string; name: string; governanceTitle: string }> = []
    const errors: Array<{ name: string; error: string }> = []

    for (const agentSpec of body.agents) {
      if (!agentSpec.name) {
        errors.push({ name: '(unnamed)', error: 'Agent name is required' })
        continue
      }

      const result = await CreateAgent({
        name: agentSpec.name,
        client: agentSpec.client || 'claude',
        program: agentSpec.program,
        programArgs: agentSpec.programArgs,
        teamId,
        governanceTitle: agentSpec.governanceTitle || 'member',
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
    console.error('[BatchCreateAgents] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
