import { NextRequest, NextResponse } from 'next/server'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { requireSudoToken } from '@/lib/sudo-guard'
import { resolveDesignDir, isValidTrddId } from '@/lib/trdd-design-dir'
import { archiveTrdd } from '@/lib/trdd-store'

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
  const result = archiveTrdd(designDir, id, {
    approver: typeof body.approver === 'string' ? body.approver : auth.agentId || 'user',
    state: state as (typeof ARCHIVE_STATES)[number],
    reason: typeof body.reason === 'string' ? body.reason : undefined,
    supersededBy: typeof body.supersededBy === 'string' ? body.supersededBy : undefined,
    iso: new Date().toISOString(),
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result)
}
