import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getTeamById, updateTeamById } from '@/services/teams-service'
import { getTeam } from '@/lib/team-registry'
import { authenticateFromRequest, buildAuthContext } from '@/lib/agent-auth'
import { requireSudoToken } from '@/lib/sudo-guard'
import { isValidUuid } from '@/lib/validation'

// SCEN-005.03 + SCEN-010.02 (second option, 2026-04-30): allow editing the
// linked GitHub Project on an existing team. `null` clears the link;
// `undefined` (omitted) leaves it unchanged. The shape mirrors the
// `create-with-project` schema so the same `gh CLI` shell-injection guard
// applies on update.
const safeOwnerRepo = /^[a-zA-Z0-9_.-]+$/

const UpdateTeamSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().max(512).optional(),
  agentIds: z.array(z.string().uuid()).max(50).optional(),
  // type and chiefOfStaffId are stripped by defense-in-depth below,
  // but accepting them here avoids strict() rejecting the body
  type: z.string().max(32).optional(),
  chiefOfStaffId: z.string().uuid().nullable().optional(),
  // SCEN-001 2026-04-20 fix (BUG-002): the Title Assignment Dialog's
  // ORCHESTRATOR → MEMBER demotion path calls `updateTeamOrchestratorId(null)`
  // to clear the team's orchestratorId slot before re-titling. Without this
  // schema entry, .strict() rejected the body with 400, and the whole flow
  // aborted before setGovernanceTitle('member') ever ran — leaving the agent
  // at governanceTitle=null. The orchestratorId slot is a team-level property,
  // not a governance-gated field, so accepting it here is safe.
  orchestratorId: z.string().uuid().nullable().optional(),
  githubProject: z.union([
    z.object({
      owner: z.string().min(1).max(64).regex(safeOwnerRepo, 'Must be alphanumeric with _.-'),
      repo: z.string().min(1).max(64).regex(safeOwnerRepo, 'Must be alphanumeric with _.-'),
      number: z.number().int().min(1),
    }).strict(),
    z.null(),
  ]).optional(),
}).strict()

const DeleteTeamSchema = z.object({
  password: z.string().min(1).max(256).optional(),
  // Proposal 7 (2026-04-20): cascade-delete team agents through the
  // DeleteAgent pipeline. Opt-in via the "Delete Agents Too" checkbox.
  deleteAgents: z.boolean().optional(),
}).strict()

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

    let raw: unknown
    try { raw = await request.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = UpdateTeamSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) },
        { status: 400 },
      )
    }

    // CC-005: Strip type and chiefOfStaffId from body — only dedicated governance endpoints can change these
    // SF-015: Intentional defense-in-depth — updateTeamById() in teams-service.ts also strips these fields.
    // Both layers strip independently so neither can be bypassed if the other is refactored.
    const { type: _type, chiefOfStaffId: _cos, ...safeBody } = parsed.data

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
    if (safeBody.agentIds !== undefined) {
      const { ChangeTeam } = await import('@/services/element-management-service')
      // CRITICAL (SCEN-007/010/020 P0): Build authContext from the authenticated
      // request so ChangeTeam can propagate it to its internal ChangeTitle calls.
      // Without this, ChangeTitle.Gate0 rejects with "authContext is mandatory"
      // and the governanceTitle silently fails to persist — leaving the registry
      // with null governanceTitle for every agent added to a team via this route.
      const teamAuthContext = buildAuthContext(auth)
      const newAgentIds: string[] = result.data?.team?.agentIds ?? []
      const oldSet = new Set<string>(oldAgentIds)
      const newSet = new Set<string>(newAgentIds)
      // Agents added to the team → delegate to ChangeTeam (handles title + team add)
      for (const agentId of newAgentIds) {
        if (!oldSet.has(agentId)) {
          try {
            await ChangeTeam(agentId, { teamId: id, role: 'member' }, teamAuthContext)
          } catch (err: unknown) {
            console.error(`[team PUT] ChangeTeam(add) failed for agent ${agentId}:`, err)
          }
        }
      }
      // Agents removed from the team → delegate to ChangeTeam (handles title revert + slot cleanup)
      for (const agentId of oldAgentIds) {
        if (!newSet.has(agentId)) {
          try {
            await ChangeTeam(agentId, { teamId: null }, teamAuthContext)
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

  // Extract governance password + optional deleteAgents cascade flag from request body
  let password: string | undefined
  let deleteAgents = false
  try {
    const raw = await request.json()
    const parsed = DeleteTeamSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) },
        { status: 400 },
      )
    }
    password = parsed.data.password
    // Proposal 7 (2026-04-20): cascade-delete team agents via the
    // DeleteAgent pipeline. Single parse captures both password and
    // the cascade flag; unknown fields already blocked by .strict().
    deleteAgents = parsed.data.deleteAgents ?? false
  } catch {
    // No body is OK — DeleteTeam will reject if password is required
  }

  // Delegate to the all-in-one pipeline.
  const { DeleteTeam } = await import('@/services/element-management-service')
  const delResult = await DeleteTeam(id, {
    authContext: { agentId: requestingAgentId, isSystemOwner: !requestingAgentId, governanceTitle: auth.governanceTitle, teamId: auth.teamId },
    password,
    deleteAgents,
  })
  if (!delResult.success) {
    const status = delResult.error?.includes('not found') ? 404
      : delResult.error?.includes('password') ? 401
      : 403
    return NextResponse.json({ error: delResult.error }, { status })
  }
  return NextResponse.json({ success: true })
}
