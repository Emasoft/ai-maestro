import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyPassword, loadGovernance, getManagerId } from '@/lib/governance'
import { getTeam, updateTeam, TeamValidationException } from '@/lib/team-registry'
import { getAgent } from '@/lib/agent-registry'
import { isChiefOfStaffAnywhere } from '@/lib/governance'
// NT-007: Use recordAttempt (the canonical name) instead of deprecated recordFailure alias
import { checkRateLimit, recordAttempt, resetRateLimit } from '@/lib/rate-limit'
import { isValidUuid } from '@/lib/validation'
import { enforceAuth } from '@/lib/route-auth'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { authorize } from '@/lib/authorization'

const AssignCosSchema = z.object({
  agentId: z.string().uuid().nullable(),
  // RIFM4UXN Option A: password is OPTIONAL. A MANAGER authenticates by AID and
  // supplies none (R29/R32 — an agent never faces a password gate); the USER/UI
  // still sends it as the human's explicit governance confirmation (verified below).
  password: z.string().min(1).max(256).optional(),
}).strict()

// NT-008 fix: Force dynamic rendering for consistency with other POST-only routes
export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Authentication first (also enforces the kill-switch / read-only write block).
  // Authorization (MANAGER-by-AID vs the human system-owner) and the USER/UI
  // password confirmation are handled below, once the body is parsed.
  const authErr = enforceAuth(request)
  if (authErr) return authErr
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401 })
  }

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

    // ── Authorization (RIFM4UXN Option A — R29/R32/R9.11) ──────────────────
    // A MANAGER agent (by AID) OR the human system-owner may reassign a COS.
    // authorize('manage-team') grants exactly those and denies every other
    // agent + every non-maestro user. An agent needs NO governance password
    // (R32 — an agent never faces a password gate); the human/UI keeps its
    // explicit password confirmation below. This replaces the old
    // "password IS the authorization" gate, which made a shipped #64 verb
    // (reassign-cos) un-callable by the very MANAGER agent it was built for.
    const authz = authorize(auth, 'manage-team')
    if (!authz.allowed) {
      return NextResponse.json({ error: authz.reason ?? 'Forbidden' }, { status: 403 })
    }

    // ── Self-assign ban ────────────────────────────────────────────────────
    // An agent may not install ITSELF as this team's COS. Without this, an
    // AID-authenticated MANAGER agent could seize the sole team gateway for
    // itself — a fleet-takeover primitive (CORE, ai-maestro#69). The human/UI
    // path (no agentId) is exempt; the human may assign anyone. `null` (remove
    // COS) is never a self-assign, so it is unaffected.
    if (auth.agentId && cosAgentId && cosAgentId === auth.agentId) {
      return NextResponse.json(
        { error: 'An agent cannot assign itself as Chief-of-Staff' },
        { status: 403 },
      )
    }

    // ── USER/UI convenience path: verify the governance password ───────────
    // The web UI still sends the governance password as the human's explicit
    // confirmation — verify it (rate-limited) exactly as before, so the human
    // side is unchanged. A MANAGER-AID call (auth.agentId set) supplied none
    // and skips this entirely (R32).
    if (!auth.agentId) {
      const config = loadGovernance()
      if (!config.passwordHash) {
        return NextResponse.json({ error: 'Governance password not set' }, { status: 400 })
      }
      if (password === undefined) {
        return NextResponse.json({ error: 'Governance password required' }, { status: 400 })
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
      if (!(await verifyPassword(password))) {
        recordAttempt(rateLimitKey)
        return NextResponse.json({ error: 'Invalid governance password' }, { status: 401 })
      }
      // Password verified successfully — reset rate limit counter
      resetRateLimit(rateLimitKey)
    }

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
