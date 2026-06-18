import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { setTeamOrchestrator } from '@/services/teams-service'
import { getTeam } from '@/lib/team-registry'
import { isManager, isChiefOfStaff } from '@/lib/governance'
import { authenticateFromRequest, buildAuthContext } from '@/lib/agent-auth'
import { requireSudoToken } from '@/lib/sudo-guard'
import { isValidUuid } from '@/lib/validation'

/**
 * Dedicated team-orchestrator-slot endpoint (TRDD-f9f71e4a, option b).
 *
 * WHY this exists: `team.orchestratorId` is team AUTHORITY — `isOrchestrator()`
 * grants kanban-write and resolves an agent into the team's authority graph
 * (teamId / AID-token scope). Setting it through the general `PUT /api/teams/[id]`
 * let a team MEMBER self-elevate (no sudo, no eligibility check, no title). That
 * field is now STRIPPED on the general PUT; the slot may be changed ONLY here,
 * with two factors enforced:
 *
 *   1. SECURITY (this file):
 *      - USER / web-UI path (system-owner session, no `agentId`) → sudo required
 *        (`requireSudoToken`), because per R32 only the USER/UI uses sudo.
 *      - AGENT path (authenticated via AID, has `agentId`) → NO sudo; authorized by
 *        AID + title: MANAGER (any team) OR this team's own CHIEF-OF-STAFF (R32/R28).
 *        Any other agent (a MEMBER, an ORCHESTRATOR, a foreign COS) is 403.
 *   2. GOVERNANCE CORRECTNESS (services/teams-service.ts::setTeamOrchestrator):
 *      the target must be an EXISTING agent that is a MEMBER of this team, and the
 *      orchestrator title is applied through the SAME ChangeTitle('orchestrator')
 *      pipeline the create path uses. Clearing the slot (null) is allowed.
 */

const SetOrchestratorSchema = z.object({
  // null clears the slot; a UUID sets it. The eligibility (existing + in-team) check
  // happens in the service layer, which has the agent registry + team membership.
  orchestratorId: z.string().uuid().nullable(),
}).strict()

/**
 * Shared auth gate for both PUT and DELETE.
 *   - Resolves the caller identity.
 *   - USER/UI (system-owner) → must present a fresh sudo token.
 *   - Agent (has agentId) → must be MANAGER or this team's COS; sudo is NOT used.
 * Returns a NextResponse to short-circuit on failure, or `{ authContext }` on success.
 */
function authorizeOrchestratorChange(
  request: NextRequest,
  teamId: string,
  method: 'PUT' | 'DELETE'
): NextResponse | { authContext: ReturnType<typeof buildAuthContext> } {
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }

  // System-owner / web-UI session (no agentId) → USER path: sudo required (R32).
  if (!auth.agentId) {
    const sudoErr = requireSudoToken(request, method, '/api/teams/[id]/orchestrator')
    if (sudoErr) return sudoErr
    return { authContext: buildAuthContext(auth) }
  }

  // Agent path (authenticated via AID) → authorize by title, NEVER by sudo (R32).
  // MANAGER may manage any team's orchestrator; a CHIEF-OF-STAFF may manage only
  // their own team's slot. Everyone else (MEMBER / ORCHESTRATOR / foreign COS) is denied.
  const team = getTeam(teamId)
  if (!team) {
    return NextResponse.json({ error: 'Team not found' }, { status: 404 })
  }
  const allowed = isManager(auth.agentId) || isChiefOfStaff(auth.agentId, teamId)
  if (!allowed) {
    return NextResponse.json(
      { error: 'Access denied: only the MANAGER or this team’s Chief-of-Staff may change the orchestrator slot.' },
      { status: 403 },
    )
  }
  return { authContext: buildAuthContext(auth) }
}

// PUT /api/teams/[id]/orchestrator — set (or clear, via { orchestratorId: null }) the slot
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid team ID format' }, { status: 400 })
    }

    let raw: unknown
    try { raw = await request.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const parsed = SetOrchestratorSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) },
        { status: 400 },
      )
    }

    const gate = authorizeOrchestratorChange(request, id, 'PUT')
    if (gate instanceof NextResponse) return gate

    const result = await setTeamOrchestrator(id, parsed.data.orchestratorId, gate.authContext)
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    console.error('Failed to set team orchestrator:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/teams/[id]/orchestrator — clear the slot
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid team ID format' }, { status: 400 })
    }

    const gate = authorizeOrchestratorChange(request, id, 'DELETE')
    if (gate instanceof NextResponse) return gate

    const result = await setTeamOrchestrator(id, null, gate.authContext)
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    console.error('Failed to clear team orchestrator:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
