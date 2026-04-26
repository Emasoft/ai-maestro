import { NextResponse } from 'next/server'
import { loadTeams } from '@/lib/team-registry'
import { loadAgents } from '@/lib/agent-registry'

/**
 * GET /api/teams/names — Returns all team names and agent names for client-side collision checking.
 * Called once when the Create Team dialog opens to pre-load the full list for real-time validation.
 */
// NT-041: Force dynamic — reads runtime filesystem state (teams + agents registry files)
export const dynamic = 'force-dynamic'

// Auth required via global /api/* middleware. Returns names only — no
// secret fields — so any authenticated caller can use it for collision
// checking.
export async function GET() {
  try {
    const teams = loadTeams()
    // loadAgents() is called per request; fine at typical dashboard traffic.
    const agents = loadAgents()
    // NT-007: Response shape: { teamNames: string[], agentNames: string[] }
    // Used by Create Team dialog for client-side name collision checking
    return NextResponse.json({
      teamNames: teams.map(t => t.name),
      agentNames: agents.map(a => a.name).filter(Boolean),
    })
  } catch (error) {
    console.error('[teams/names] GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
