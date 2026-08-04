import { NextRequest, NextResponse } from 'next/server'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { requireSudoToken } from '@/lib/sudo-guard'
import { resolveDesignDir, isValidTrddId } from '@/lib/trdd-design-dir'
import { advanceColumn } from '@/lib/trdd-store'
import { withAuthorizedTrdd } from '@/lib/trdd-authz'

/**
 * POST /api/trdd/[id]/promote — advance an OPEN (design/tasks/) TRDD's `column`
 * forward along the pipeline (planned → todo → dispatch → dev → …), in place, no
 * folder move; `updated` is bumped and an optional log line appended.
 *
 * This is the pipeline-advance convenience, distinct from /approve (the
 * proposal→planned gate) and /archive (the terminal move). Body:
 * `{column (required), note?, approver?, agentId?}`. STRICT.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!isValidTrddId(id)) {
    return NextResponse.json({ error: 'Invalid TRDD id (expected 8-char base36)' }, { status: 400 })
  }

  const sudoErr = requireSudoToken(request, 'POST', '/api/trdd/[id]/promote')
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

  const column = typeof body.column === 'string' ? body.column.trim() : ''
  if (!column) {
    return NextResponse.json({ error: 'Body must include a target {column}' }, { status: 400 })
  }

  const designDir = resolveDesignDir(typeof body.agentId === 'string' ? body.agentId : null)

  // TRDD-K2WJH7RF: promotion IS the approval act, so it shares approve's rule —
  // same tier, same self-approval ban. Letting them diverge would make `promote`
  // a way to launder an approval the caller could not grant.
  // TRDD-6D6SQNI6: decision and write share one hold on the card.
  const outcome = await withAuthorizedTrdd(auth, designDir, id, 'promote', () =>
    advanceColumn(designDir, id, column, {
      iso: new Date().toISOString(),
      note: typeof body.note === 'string' ? body.note : undefined,
      approver: typeof body.approver === 'string' ? body.approver : auth.agentId || undefined,
    }),
  )
  if (outcome.denied) return outcome.denied

  const result = outcome.value
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result)
}
