import { NextRequest, NextResponse } from 'next/server'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { requireSudoToken } from '@/lib/sudo-guard'
import { resolveDesignDir, isValidTrddId } from '@/lib/trdd-design-dir'
import { archiveTrdd, isoLocal } from '@/lib/trdd-store'
import { withAuthorizedTrdd, rejectUnarchivableState } from '@/lib/trdd-authz'

const ARCHIVE_STATES = ['completed', 'cancelled', 'superseded'] as const

/**
 * POST /api/trdd/[id]/archive — move a once-approved TRDD to a terminal-DONE
 * state: sets column to completed|cancelled|superseded, appends the log line, and
 * git-mv's the file (from proposals/ or tasks/) → design/archived/. `failed` is
 * NOT here — it is retryable and stays in tasks/ (overlay rule).
 *
 * Body: `{state (required), reason?, supersededBy?, approver?, agentId?}`. STRICT.
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

  const state = body.state
  if (typeof state !== 'string' || !ARCHIVE_STATES.includes(state as (typeof ARCHIVE_STATES)[number])) {
    return NextResponse.json(
      { error: `Body must include {state}: one of ${ARCHIVE_STATES.join(', ')}` },
      { status: 400 },
    )
  }

  const designDir = resolveDesignDir(typeof body.agentId === 'string' ? body.agentId : null)

  // TRDD-K2WJH7RF. Two gates, and they are deliberately different in KIND:
  //
  //  1. DATA invariant — `archive failed` is refused for EVERYONE, the human
  //     owner included. A failed TRDD is retryable and stays on the board;
  //     giving up on it is an explicit `cancelled`. This cannot live in
  //     authorize(), which grants the system-owner unconditionally.
  const stateErr = rejectUnarchivableState((body as Record<string, unknown>).state)
  if (stateErr) return stateErr

  //  2. AUTHORIZATION — the owner or MANAGER. The sudo-guard deferred this route.
  //     TRDD-6D6SQNI6: decided and written under ONE hold on the card, so a peer cannot
  //     change the fields the decision reads between the two.
  const outcome = await withAuthorizedTrdd(auth, designDir, id, 'archive', () =>
    archiveTrdd(designDir, id, {
      approver: typeof body.approver === 'string' ? body.approver : auth.agentId || 'user',
      state: state as (typeof ARCHIVE_STATES)[number],
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
