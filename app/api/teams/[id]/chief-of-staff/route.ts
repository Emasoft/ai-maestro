import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyPassword, loadGovernance, getManagerId } from '@/lib/governance'
import { getTeam, updateTeam, TeamValidationException } from '@/lib/team-registry'
import { getAgent, updateAgent } from '@/lib/agent-registry'
import { isChiefOfStaffAnywhere } from '@/lib/governance'
// NT-007: Use recordAttempt (the canonical name) instead of deprecated recordFailure alias
import { checkRateLimit, recordAttempt, resetRateLimit } from '@/lib/rate-limit'
import { isValidUuid } from '@/lib/validation'
import { enforceAuth } from '@/lib/route-auth'

const AssignCosSchema = z.object({
  agentId: z.string().uuid().nullable(),
  password: z.string().min(1).max(256),
}).strict()

// NT-008 fix: Force dynamic rendering for consistency with other POST-only routes
export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Authentication first — the handler then re-verifies the governance
  // password for the COS assignment, which is its own layer.
  const authErr = enforceAuth(request)
  if (authErr) return authErr

  try {
    const { id } = await params
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid team ID format' }, { status: 400 })
    }
    let raw: unknown
    try { raw = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

    const parsed = AssignCosSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) },
        { status: 400 },
      )
    }
    const { agentId: cosAgentId, password } = parsed.data

    const config = loadGovernance()
    if (!config.passwordHash) {
      return NextResponse.json({ error: 'Governance password not set' }, { status: 400 })
    }

    // Separate check/record pattern (not checkAndRecordAttempt) so only failed attempts are penalized
    const rateLimitKey = `governance-cos-auth:${id}`
    const rateCheck = checkRateLimit(rateLimitKey)
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: `Too many failed password attempts. Try again in ${Math.ceil(rateCheck.retryAfterMs / 1000)}s` },
        { status: 429 }
      )
    }

    // Password auth is stronger than ACL — only managers know the governance password
    if (!(await verifyPassword(password))) {
      recordAttempt(rateLimitKey)
      return NextResponse.json({ error: 'Invalid governance password' }, { status: 401 })
    }
    // Password verified successfully — reset rate limit counter
    resetRateLimit(rateLimitKey)

    const team = getTeam(id)
    if (!team) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 })
    }

    const managerId = getManagerId()

    if (cosAgentId === null) {
      // Capture old COS id before updateTeam clears it
      const oldCosId = team.chiefOfStaffId

      // Remove COS — team stays closed (governance simplification: all teams are closed)
      const updated = await updateTeam(id, { chiefOfStaffId: null }, managerId)

      // Auto-reject pending configure-agent requests from the removed COS (11a safeguard)
      if (oldCosId) {
        try {
          const { loadGovernanceRequests, rejectGovernanceRequest } = await import('@/lib/governance-request-registry')
          const file = loadGovernanceRequests()
          const pendingFromCOS = file.requests.filter((r: { type: string; status: string; requestedBy: string }) =>
            r.type === 'configure-agent' && r.status === 'pending' && r.requestedBy === oldCosId
          )
          for (const req of pendingFromCOS) {
            await rejectGovernanceRequest(req.id, managerId || 'system', `COS role revoked for team '${team.name}'`)
          }
          if (pendingFromCOS.length > 0) {
            console.log(`[governance] Auto-rejected ${pendingFromCOS.length} pending config request(s) from removed COS ${oldCosId}`)
          }
        } catch (err) {
          console.warn('[governance] Failed to auto-reject pending config requests:', err instanceof Error ? err.message : err)
        }
      }

      // ChangeTitle handles: registry + role-plugin cleanup (only if no longer COS anywhere)
      // SCEN-001 fix (2026-04-13): Gate 0 requires authContext; this route
      // has already verified the governance password, so it is safe to
      // invoke ChangeTitle with a system-owner authContext.
      if (oldCosId && !isChiefOfStaffAnywhere(oldCosId)) {
        try {
          const { ChangeTitle } = await import('@/services/element-management-service')
          await ChangeTitle(oldCosId, null, { authContext: { isSystemOwner: true as const } })
        } catch (err) {
          console.warn('[governance] Failed ChangeTitle on COS removal:', err instanceof Error ? err.message : err)
        }
      }

      return NextResponse.json({ success: true, team: updated })
    }

    if (typeof cosAgentId !== 'string' || !cosAgentId.trim()) {
      return NextResponse.json({ error: 'agentId must be a non-empty string or null' }, { status: 400 })
    }
    // NT-002: Validate cosAgentId format before registry lookup
    if (!isValidUuid(cosAgentId)) {
      return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
    }

    const agent = getAgent(cosAgentId)
    if (!agent) {
      return NextResponse.json({ error: `Agent '${cosAgentId}' not found` }, { status: 404 })
    }

    // Assign COS — auto-upgrade team to closed (R1.3); validateTeamMutation auto-adds COS to agentIds (R4.6)
    const updated = await updateTeam(id, { chiefOfStaffId: cosAgentId, type: 'closed' }, managerId)

    // ChangeTitle handles: registry write + role-plugin sync
    // (COS team assignment was already done by updateTeam above)
    // SCEN-001 fix (2026-04-13): Gate 0 requires authContext.
    try {
      const { ChangeTitle } = await import('@/services/element-management-service')
      await ChangeTitle(cosAgentId, 'chief-of-staff', { authContext: { isSystemOwner: true as const } })
    } catch (err) {
      console.warn('[governance] Failed ChangeTitle for COS:', err instanceof Error ? err.message : err)
    }

    return NextResponse.json({ success: true, team: updated, chiefOfStaffName: agent.name || agent.alias })
  } catch (error) {
    // TeamValidationException carries the correct HTTP status code from business rule validation
    if (error instanceof TeamValidationException) {
      return NextResponse.json({ error: error.message }, { status: error.code })
    }
    console.error('Failed to set chief-of-staff:', error)
    // NT-001: Return generic message instead of exposing internal error details
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
