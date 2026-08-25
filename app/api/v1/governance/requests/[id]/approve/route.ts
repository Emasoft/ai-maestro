/**
 * Approve Cross-Host Governance Request
 *
 * POST /api/v1/governance/requests/:id/approve
 */

import { NextRequest, NextResponse } from 'next/server'
import { approveCrossHostRequest } from '@/services/cross-host-governance-service'
import { isValidUuid } from '@/lib/validation'
import { authenticateFromRequest } from '@/lib/agent-auth'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params

    // Identity auth — the caller must prove who they are (session cookie or Bearer token)
    const auth = authenticateFromRequest(request)
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
    }

    // MF-013: Validate request ID is a valid UUID before passing to service
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: 'Invalid request ID format' }, { status: 400 })
    }

    let body
    try { body = await request.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    // Password is OPTIONAL for an AID-authenticated agent (R32 / RIFM4UXN
    // Option A — an agent never faces a password gate; TRDD-IBKR7F74). The
    // service's title matrix (isManager / isChiefOfStaffAnywhere) authorizes,
    // and its AID path adds the self-approval ban. A caller with neither an
    // agent identity nor a password keeps the old 400.
    if (body?.password !== undefined && typeof body.password !== 'string') {
      return NextResponse.json({ error: 'password must be a string' }, { status: 400 })
    }
    if (!body?.password && !auth.agentId) {
      return NextResponse.json({ error: 'Missing required field: password' }, { status: 400 })
    }

    // SECURITY (IDOR / identity-trust): the approver MUST be the AUTHENTICATED
    // caller — NEVER a self-asserted body field. `approveCrossHostRequest`
    // verifies only the *global* governance password and then derives the
    // approval vote + authority class (isManager/isChiefOfStaffAnywhere) entirely
    // from `approverAgentId`. If we fell back to `body.approverAgentId` (the prior
    // behavior), any non-agent caller who knows the governance password (e.g. a
    // model-ON non-maestro user) could approve a cross-host governance request
    // *as any MANAGER/COS agent* — spoofing a vote that agent never cast. This
    // mirrors the secure pattern already used by the sibling reject route, which
    // also uses ONLY `auth.agentId`. Approval is an agent-only act (MANAGER/COS);
    // a true system owner is not a governance agent and approves by being
    // authenticated AS that agent (Bearer/AID), not by asserting a body identity.
    const approverAgentId = auth.agentId
    if (!approverAgentId || !isValidUuid(approverAgentId)) {
      return NextResponse.json({ error: 'Could not determine approver agent ID from auth' }, { status: 401 })
    }

    // null selects the service's AID path — only reachable with auth.agentId set
    // (checked above), so null is always route-vouched.
    const result = await approveCrossHostRequest(id, approverAgentId, body?.password ? body.password : null)
    // MF-004 (P8): Explicit error branching instead of fragile nullish coalescing
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data, { status: result.status })
  } catch (err) {
    // MF-011: Log full error internally, return generic message to prevent information disclosure
    console.error('[Governance Approve] POST error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
