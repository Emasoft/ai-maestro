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
  // LIB2-CRIT-02 (2026-05-06): forward AuthContext to teams-service so the
  // ACL inside getTeamById can distinguish a verified web-UI session from
  // an anonymous request.
  const result = getTeamById(id, requestingAgentId, buildAuthContext(auth))

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

    // CC-005: Strip type, chiefOfStaffId, and orchestratorId from body — only
    // dedicated governance endpoints can change these.
    // SF-015: Intentional defense-in-depth — updateTeamById() in teams-service.ts also
    // strips these fields. Both layers strip independently so neither can be bypassed
    // if the other is refactored.
    // L2-H2 fix (2026-06-18, TRDD-f9f71e4a Gap 2): orchestratorId is now stripped here,
    // exactly like chiefOfStaffId. The orchestrator slot is team authority (isOrchestrator
    // → kanban-write + team resolution), so it is no longer settable via the general PUT —
    // it goes ONLY through PUT/DELETE /api/teams/[id]/orchestrator, which validates in-team
    // eligibility and applies the orchestrator title via the ChangeTitle pipeline. The
    // schema still ACCEPTS orchestratorId (so older clients don't get a 400) but it is
    // silently ignored, identical to type/chiefOfStaffId.
    const { type: _type, chiefOfStaffId: _cos, orchestratorId: _orch, ...safeBody } = parsed.data

    // ── strict-route gate (R32 dual-path) ──────────────────────────────────
    // `PUT_/api/teams/[id]` is classified "strict" in security-registry.json so
    // requireSudoToken is the load-bearing authz layer: for an AGENT caller it
    // runs authorize('manage-team') (MANAGER-only); for the USER/web-UI it
    // requires a fresh sudo token.
    //
    // GOV-AUDIT fix (2026-06-21): the gate previously ran ONLY when the body
    // carried `agentIds`. That dropped the strict gate for `name`/`description`/
    // `githubProject` edits, letting the request fall straight through to
    // updateTeamById → checkTeamAccess — which authorizes ANY team MEMBER. The
    // net effect was an RBAC bypass: a non-MANAGER MEMBER/ORCHESTRATOR agent
    // could rename the team and (worse) relink `team.githubProject`, redirecting
    // where the kanban gh CLI files issues, with NO manage-team authorization.
    //
    // The fix runs the gate for:
    //   • EVERY agent caller (auth.agentId set) — so authorize('manage-team')
    //     ALWAYS fires and a non-MANAGER agent is 403'd regardless of which
    //     field it edits; AND
    //   • the USER/web-UI path when a privileged, side-effecting field is
    //     present — `agentIds` (membership → ChangeTeam/ChangeTitle, governance)
    //     or `githubProject` (the gh-CLI issue target).
    // A system-owner rename/description edit stays sudo-free (requireSudoToken's
    // user branch is reached only when a privileged field is present), preserving
    // the documented "don't nag for trivial edits" UX without leaving the
    // governance fields ungated.
    //
    // L2-H2 (2026-06-18): orchestratorId is STRIPPED above (option b), so it can
    // no longer be set through this route and needs no per-field gate here.
    const touchesPrivilegedField =
      safeBody.agentIds !== undefined || safeBody.githubProject !== undefined
    if (auth.agentId || touchesPrivilegedField) {
      const sudoErr = requireSudoToken(request, 'PUT', '/api/teams/[id]')
      if (sudoErr) return sudoErr
    }

    // Phase 3: Snapshot agentIds before update to detect membership changes for auto-title transitions
    // Use getTeam (no ACL check) — ACL is checked inside updateTeamById
    const oldAgentIds: string[] = (() => {
      try { return getTeam(id)?.agentIds ?? [] } catch { return [] }
    })()

    // LIB2-CRIT-02 (2026-05-06): forward AuthContext.
    const result = await updateTeamById(id, { ...safeBody, requestingAgentId, authContext: buildAuthContext(auth) })
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
  // M1 fix (2026-06-19): `requestingAgentId` is no longer extracted here — the
  // AuthContext for DeleteTeam below is now derived via buildAuthContext(auth),
  // which already carries agentId/isSystemOwner/userId/userTitle.

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
  // M1 fix (2026-06-19 R26-R40 audit): derive the AuthContext via buildAuthContext
  // instead of hard-coding `isSystemOwner: !requestingAgentId`. The hard-coded form
  // set isSystemOwner=true for ANY no-agent caller — including a model-ON non-maestro
  // USER ({ userId, userTitle:'user' }, no agentId) — handing an ordinary user
  // system-owner authority to delete a team. buildAuthContext applies the model-aware
  // flip (system-owner only when userTitle ∈ {maestro, maestro-delegate}) and forwards
  // userId/userTitle so DeleteTeam's gate0Auth → authorize() can deny-by-default.
  // FLAG-OFF: a web session resolves to {} (no userId) → buildAuthContext sets
  // isSystemOwner = !agentId = true — identical to the old literal for the only
  // caller class that existed before the model.
  const { DeleteTeam } = await import('@/services/element-management-service')
  const delResult = await DeleteTeam(id, {
    authContext: buildAuthContext(auth),
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
