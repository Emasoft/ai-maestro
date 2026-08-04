import { NextRequest, NextResponse } from 'next/server'
import { authenticateFromRequest, buildAuthContext } from '@/lib/agent-auth'
import { requireSudoToken } from '@/lib/sudo-guard'
import { resolveDesignDir, isValidTrddId } from '@/lib/trdd-design-dir'
import { promoteTrdd } from '@/lib/trdd-store'
import { withAuthorizedTrdd } from '@/lib/trdd-authz'
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
 * Body (all optional): `{approver?, rationale?, agentId?}`. `approver` defaults
 * to the authenticated caller. The approval requirement is read from the card's
 * own `min-approval-requirement:` (the retired numeric `tier` body field is gone —
 * ai-maestro#66 Q9). STRICT — mutates git-tracked authorized state (a promoted
 * TRDD is now cleared to execute).
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
  // TRDD-6D6SQNI6: the decision, the mint and the write are ONE critical section on the
  // card. The mint stays INSIDE it deliberately — minting before authority is established
  // would leave a signed approval token in the audit ledger for an approval that never
  // happened, and moving it after the write would be too late to pass it in.
  const outcome = await withAuthorizedTrdd(auth, designDir, id, 'approve', async () => {
    // Mint the proof, now that the authority is established. A null token means the
    // audit ledger was unavailable — the approval still stands (it was authorized,
    // and the prose log records it exactly as before), but it will report as
    // UNVERIFIABLE. Failing the approval instead would turn a logging outage into a
    // governance outage: the fleet could not approve anything until the ledger came
    // back. The honest degradation is an approval that says it cannot prove itself.
    const approvalToken = await mintTrddDecisionToken(buildAuthContext(auth), id, 'approval')

    const result = await promoteTrdd(designDir, id, {
      approver: typeof body.approver === 'string' ? body.approver : auth.agentId || 'user',
      rationale: typeof body.rationale === 'string' ? body.rationale : undefined,
      iso: new Date().toISOString(),
      approvalToken,
    })
    return { approvalToken, result }
  })
  if (outcome.denied) return outcome.denied

  const { approvalToken, result } = outcome.value
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ ...result, approvalToken, verifiable: !!approvalToken })
}
