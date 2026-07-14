import { NextRequest, NextResponse } from 'next/server'
import { authenticateFromRequest, buildAuthContext } from '@/lib/agent-auth'
import { requireSudoToken } from '@/lib/sudo-guard'
import { resolveDesignDir, isValidTrddId } from '@/lib/trdd-design-dir'
import { promoteTrdd } from '@/lib/trdd-store'
import { authorizeTrddVerb } from '@/lib/trdd-authz'
import { mintTrddDecisionToken } from '@/lib/trdd-approval-token'

/**
 * POST /api/trdd/[id]/approve — approve a PROPOSAL into the task queue: sets
 * column=planned, appends an "APPROVED" line to `## Approval log`, and git-mv's
 * the file design/proposals/ → design/tasks/ (the overlay's promotion protocol).
 *
 * It also MINTS the approval token (ai-maestro#47): a host-signed, ledger-anchored
 * record, pinned to this card, of who approved it and under what title. Until now
 * the only evidence of an approval was the prose line — auditable, and typeable by
 * anyone with repo write. `aimaestro-trdd.sh verify <id>` is what reads the token
 * back, and the mint happens HERE because this route is the one place the server
 * has already established that the caller really holds the authority to approve.
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

  // Mint the proof, now that the authority is established. A null token means the
  // audit ledger was unavailable — the approval still stands (it was authorized,
  // and the prose log records it exactly as before), but it will report as
  // UNVERIFIABLE. Failing the approval instead would turn a logging outage into a
  // governance outage: the fleet could not approve anything until the ledger came
  // back. The honest degradation is an approval that says it cannot prove itself.
  const approvalToken = await mintTrddDecisionToken(buildAuthContext(auth), id, 'approval')

  const result = promoteTrdd(designDir, id, {
    approver: typeof body.approver === 'string' ? body.approver : auth.agentId || 'user',
    tier: typeof body.tier === 'number' ? body.tier : undefined,
    rationale: typeof body.rationale === 'string' ? body.rationale : undefined,
    iso: new Date().toISOString(),
    approvalToken,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ ...result, approvalToken, verifiable: !!approvalToken })
}
