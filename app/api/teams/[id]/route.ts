import { NextRequest, NextResponse } from 'next/server'
import { getTeamById, updateTeamById } from '@/services/teams-service'
import { getTeam } from '@/lib/team-registry'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { requireSudoToken } from '@/lib/sudo-guard'
import { isValidUuid } from '@/lib/validation'

// GET /api/teams/[id] - Get a single team
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'Invalid team ID format' }, { status: 400 })
  }
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }
  const requestingAgentId = auth.agentId
  const result = getTeamById(id, requestingAgentId)

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.data)
}

// PUT /api/teams/[id] - Update a team
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid team ID format' }, { status: 400 })
    }
    const auth = authenticateFromRequest(request)
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
    }
    const requestingAgentId = auth.agentId

    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    // CC-005: Strip type and chiefOfStaffId from body — only dedicated governance endpoints can change these
    // SF-015: Intentional defense-in-depth — updateTeamById() in teams-service.ts also strips these fields.
    // Both layers strip independently so neither can be bypassed if the other is refactored.
    const { type: _type, chiefOfStaffId: _cos, ...safeBody } = body

    // Phase 3: Snapshot agentIds before update to detect membership changes for auto-title transitions
    // Use getTeam (no ACL check) — ACL is checked inside updateTeamById
    const oldAgentIds: string[] = (() => {
      try { return getTeam(id)?.agentIds ?? [] } catch { return [] }
    })()

    const result = await updateTeamById(id, { ...safeBody, requestingAgentId })
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    // Auto-title transitions: delegate to ChangeTeam for membership changes
    // P0-001 (2026-04-14): ChangeTeam now requires authContext (positional
    // arg 3). It propagates to ChangeTitle internally. Before this fix the
    // PATCH /api/teams/{id} route silently failed to title newly added
    // agents (BUG-002 root cause) because ChangeTeam accepted an unused
    // `_authContext` and called ChangeTitle with no auth.
    if (safeBody.agentIds !== undefined) {
      const { ChangeTeam } = await import('@/services/element-management-service')
      const { buildAuthContext } = await import('@/lib/agent-auth')
      const changeTeamAuth = buildAuthContext(auth)
      const newAgentIds: string[] = result.data?.team?.agentIds ?? []
      const oldSet = new Set<string>(oldAgentIds)
      const newSet = new Set<string>(newAgentIds)
      // Agents added to the team → delegate to ChangeTeam (handles title + team add)
      for (const agentId of newAgentIds) {
        if (!oldSet.has(agentId)) {
          try {
            await ChangeTeam(agentId, { teamId: id, role: 'member' }, changeTeamAuth)
          } catch (err: unknown) {
            console.error(`[team PUT] ChangeTeam(add) failed for agent ${agentId}:`, err)
          }
        }
      }
      // Agents removed from the team → delegate to ChangeTeam (handles title revert + slot cleanup)
      for (const agentId of oldAgentIds) {
        if (!newSet.has(agentId)) {
          try {
            await ChangeTeam(agentId, { teamId: null }, changeTeamAuth)
          } catch (err: unknown) {
            console.error(`[team PUT] ChangeTeam(remove) failed for agent ${agentId}:`, err)
          }
        }
      }
    }

    return NextResponse.json(result.data)
  } catch (error) {
    console.error('Failed to update team:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// DELETE /api/teams/[id] - Delete a team
// Governance: requires governance password in request body (USER-only destructive operation)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'Invalid team ID format' }, { status: 400 })
  }
  // Sudo mode — DELETE /api/teams/[id] is classified "strict"
  const sudoErr = requireSudoToken(request, 'DELETE', '/api/teams/[id]')
  if (sudoErr) return sudoErr
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }
  const requestingAgentId = auth.agentId

  // Extract governance password from request body
  let password: string | undefined
  try {
    const body = await request.json()
    password = body?.password
  } catch {
    // No body is OK — DeleteTeam will reject if password is required
  }

  // Delegate to the all-in-one pipeline
  const { DeleteTeam } = await import('@/services/element-management-service')
  const delResult = await DeleteTeam(id, {
    authContext: { agentId: requestingAgentId, isSystemOwner: !requestingAgentId, governanceTitle: auth.governanceTitle, teamId: auth.teamId },
    password,
  })
  if (!delResult.success) {
    const status = delResult.error?.includes('not found') ? 404
      : delResult.error?.includes('password') ? 401
      : 403
    return NextResponse.json({ error: delResult.error }, { status })
  }
  return NextResponse.json({ success: true })
}
