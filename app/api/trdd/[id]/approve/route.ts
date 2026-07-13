import { NextRequest, NextResponse } from 'next/server'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { requireSudoToken } from '@/lib/sudo-guard'
import { resolveDesignDir, isValidTrddId } from '@/lib/trdd-design-dir'
import { promoteTrdd } from '@/lib/trdd-store'
import { authorizeTrddVerb } from '@/lib/trdd-authz'

/**
 * POST /api/trdd/[id]/approve — approve a PROPOSAL into the task queue: sets
 * column=planned, appends an "APPROVED" line to `## Approval log`, and git-mv's
 * the file design/proposals/ → design/tasks/ (the overlay's promotion protocol).
 *
 * Body (all optional): `{approver?, tier?, rationale?, agentId?}`. `approver`
 * defaults to the authenticated caller. STRICT — mutates git-tracked authorized
 * state (a promoted TRDD is now cleared to execute).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!isValidTrddId(id)) {
    return NextResponse.json({ error: 'Invalid TRDD id (expected 8-char base36)' }, { status: 400 })
  }

  const sudoErr = requireSudoToken(request, 'POST', '/api/trdd/[id]/approve')
  if (sudoErr) return sudoErr
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }

  let body: Record<string, unknown> = {}
  try {
    body = (await request.json()) ?? {}
  } catch {
    body = {}
  }

  const designDir = resolveDesignDir(typeof body.agentId === 'string' ? body.agentId : null)

  // TRDD-K2WJH7RF: the real `manage-trdd` decision. The sudo-guard DEFERRED this
  // route (it will not read the task corpus), so this call is the only thing
  // standing between an agent and an approval it has no authority to grant —
  // including approving its OWN proposal, or one reserved for the USER.
  const authzErr = authorizeTrddVerb(auth, designDir, id, 'approve')
  if (authzErr) return authzErr

  const result = promoteTrdd(designDir, id, {
    approver: typeof body.approver === 'string' ? body.approver : auth.agentId || 'user',
    tier: typeof body.tier === 'number' ? body.tier : undefined,
    rationale: typeof body.rationale === 'string' ? body.rationale : undefined,
    iso: new Date().toISOString(),
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result)
}
