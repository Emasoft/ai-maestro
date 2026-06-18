import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/route-auth'

/**
 * GET /api/teams/[id]/composition-check
 *
 * Checks if a team satisfies R12 (Minimum Team Composition).
 * Returns which required titles are present and which are missing.
 *
 * Required titles (R12.1): chief-of-staff, architect, orchestrator, integrator, member
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // A2: this returned the full team roster (agent ids/names/titles) with NO
  // handler auth. Require authentication; any authenticated caller (system
  // owner or agent) may read team composition.
  const auth = requireAuth(request)
  if (!auth.ok) return auth.error
  try {
    const { id } = await params
    const { getTeam } = await import('@/lib/team-registry')
    const { getAgent } = await import('@/lib/agent-registry')

    const team = getTeam(id)
    if (!team) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 })
    }

    const REQUIRED_TITLES = ['chief-of-staff', 'architect', 'orchestrator', 'integrator', 'member'] as const

    // Collect titles present in the team
    const presentTitles = new Set<string>()
    const agentDetails: { id: string; name: string; title: string }[] = []

    for (const agentId of team.agentIds || []) {
      const agent = getAgent(agentId)
      if (agent) {
        const title = (agent.governanceTitle || agent.role || 'unknown').toLowerCase()
        presentTitles.add(title)
        agentDetails.push({ id: agent.id, name: agent.name, title })
      }
    }

    const missing = REQUIRED_TITLES.filter(t => !presentTitles.has(t))
    const present = REQUIRED_TITLES.filter(t => presentTitles.has(t))

    return NextResponse.json({
      teamId: team.id,
      teamName: team.name,
      complete: missing.length === 0,
      agentCount: (team.agentIds || []).length,
      requiredTitles: [...REQUIRED_TITLES],
      presentTitles: present,
      missingTitles: missing,
      agents: agentDetails,
    })
  } catch (error) {
    // API2-MIN-01: log full error server-side, return generic message to client
    console.error('[CompositionCheck] Error:', error)
    return NextResponse.json(
      { error: 'internal_error', code: 'team-composition-check' },
      { status: 500 }
    )
  }
}
