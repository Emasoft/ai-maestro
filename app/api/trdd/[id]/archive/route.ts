import { NextRequest, NextResponse } from 'next/server'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { requireSudoToken } from '@/lib/sudo-guard'
import { resolveDesignDir, isValidTrddId } from '@/lib/trdd-design-dir'
import { archiveTrdd, isoLocal } from '@/lib/trdd-store'
import { withAuthorizedTrdd, rejectUnarchivableState, rejectIncompleteChecklist, trddActorIdentity } from '@/lib/trdd-authz'

const ARCHIVE_STATES = ['completed', 'cancelled', 'superseded'] as const

/**
 * POST /api/trdd/[id]/archive — archive a TRDD: git-mv the file (from proposals/ or
 * tasks/) → design/archived/, write `status: archived`, append the log line.
 * - `state` given (completed|cancelled|superseded) → the column is set to it.
 * - `state` omitted → archive AS-IS: the column is kept (TRDD-MQE5D28T D2). This is how
 *   a `failed` card is archived — it stays `failed`, now definitive.
 * WHO may archive what is decided in authorize() on the card as on disk (D3).
 *
 * Body: `{state?, reason?, supersededBy?, approver?, agentId?}`. STRICT.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!isValidTrddId(id)) {
    return NextResponse.json({ error: 'Invalid TRDD id (expected 8-char base36)' }, { status: 400 })
  }

  const sudoErr = requireSudoToken(request, 'POST', '/api/trdd/[id]/archive')
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

  // Absent → archive as-is (D2). Present → must be one of ARCHIVE_STATES.
  // `null` counts as absent, matching rejectUnarchivableState.
  const state = body.state ?? undefined
  if (state !== undefined && (typeof state !== 'string' || !ARCHIVE_STATES.includes(state as (typeof ARCHIVE_STATES)[number]))) {
    return NextResponse.json(
      { error: `{state}, when given, must be one of ${ARCHIVE_STATES.join(', ')} — omit it to archive the card as-is` },
      { status: 400 },
    )
  }

  const designDir = resolveDesignDir(auth, typeof body.agentId === 'string' ? body.agentId : null)

  // TRDD-K2WJH7RF. Two gates, and they are deliberately different in KIND:
  //
  //  1. DATA invariant — a TARGET state outside completed|cancelled|superseded
  //     (e.g. `failed`) is refused for EVERYONE, the human owner included; an
  //     absent state means archive as-is. This cannot live in authorize(), which
  //     grants the system-owner unconditionally.
  const stateErr = rejectUnarchivableState((body as Record<string, unknown>).state)
  if (stateErr) return stateErr

  //  1b. DATA invariant — TRDD-P6MSMQ2I. A terminal `completed` requires an acceptance
  //     checklist that EXISTS and is fully ticked. This gate was enforced by the LINTER
  //     only, so this route minted precisely the false completion the gate forbids and
  //     `trddgrep validate` then reported a standing ERROR about a card the API had just
  //     created. Placed with the other DATA invariant and BEFORE authorization on purpose:
  //     an unfinished card is not archivable by anyone, the human owner included, so this
  //     is not a permission that authorize() could grant.
  const checklistErr = rejectIncompleteChecklist(designDir, id, state)
  if (checklistErr) return checklistErr

  //  2. AUTHORIZATION — the owner or MANAGER. The sudo-guard deferred this route.
  //     TRDD-6D6SQNI6: decided and written under ONE hold on the card, so a peer cannot
  //     change the fields the decision reads between the two.
  const outcome = await withAuthorizedTrdd(auth, designDir, id, 'archive', () =>
    archiveTrdd(designDir, id, {
      // #168: the ONE identity helper — `name#uuid` for an agent, `user` for the owner.
      approver: trddActorIdentity(auth.agentId),
      state: state as (typeof ARCHIVE_STATES)[number] | undefined,
      reason: typeof body.reason === 'string' ? body.reason : undefined,
      supersededBy: typeof body.supersededBy === 'string' ? body.supersededBy : undefined,
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