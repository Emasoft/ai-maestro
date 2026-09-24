import { NextRequest, NextResponse } from 'next/server'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { requireSudoToken } from '@/lib/sudo-guard'
import { resolveDesignDir, isValidTrddId } from '@/lib/trdd-design-dir'
import { refuseTrdd, isoLocal } from '@/lib/trdd-store'
import { withAuthorizedTrdd, trddActorIdentity } from '@/lib/trdd-authz'

/**
 * POST /api/trdd/[id]/refuse — refuse a PROPOSAL at the gate: sets column=refused
 * and appends a "REFUSED" line to `## Approval log`. NO folder move — `refused` is a
 * column value, not a zone (owner ruling 2026-09-24, TRDD-MQE5D28T); the card stays
 * in design/proposals/, remains editable, and may be re-proposed
 * (`trddgrep move <id> proposal`) or archived by its own author.
 *
 * Body (all optional): `{approver?, reason?, agentId?}`. STRICT.
 *
 * `tier` is NOT in that list and never was — this docstring advertised it until ai-maestro#69,
 * while the handler below has only ever read approver/reason/agentId. It is the same retired
 * numeric field `approve` dropped in ai-maestro#66 Q9: the approval requirement is the card's
 * own `min-approval-requirement:`, not something the refuser supplies.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!isValidTrddId(id)) {
    return NextResponse.json({ error: 'Invalid TRDD id (expected 8-char base36)' }, { status: 400 })
  }

  const sudoErr = requireSudoToken(request, 'POST', '/api/trdd/[id]/refuse')
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

  const designDir = resolveDesignDir(auth, typeof body.agentId === 'string' ? body.agentId : null)

  // TRDD-K2WJH7RF: refusing a proposal carries the SAME authority as approving
  // it — deciding is one gate, whichever way it goes. The sudo-guard deferred.
  // TRDD-6D6SQNI6: decision and write share one hold on the card.
  const outcome = await withAuthorizedTrdd(auth, designDir, id, 'refuse', () =>
    refuseTrdd(designDir, id, {
      // #168: the ONE identity helper — `name#uuid` for an agent, `user` for the owner.
      approver: trddActorIdentity(auth.agentId),
      reason: typeof body.reason === 'string' ? body.reason : undefined,
      iso: isoLocal().iso,
    }),
  )
  if (outcome.denied) return outcome.denied

  const result = outcome.value
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result)
}