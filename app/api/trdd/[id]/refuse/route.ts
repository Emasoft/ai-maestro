import { NextRequest, NextResponse } from 'next/server'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { requireSudoToken } from '@/lib/sudo-guard'
import { resolveDesignDir, isValidTrddId } from '@/lib/trdd-design-dir'
import { refuseTrdd } from '@/lib/trdd-store'

/**
 * POST /api/trdd/[id]/refuse — refuse a PROPOSAL at the gate: sets column=refused,
 * appends a "REFUSED" line to `## Approval log`, and git-mv's the file
 * design/proposals/ → design/refused/ (the overlay's refusal protocol; a refused
 * proposal is terminal and never re-approved).
 *
 * Body (all optional): `{approver?, tier?, reason?, agentId?}`. STRICT.
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

  const designDir = resolveDesignDir(typeof body.agentId === 'string' ? body.agentId : null)
  const result = refuseTrdd(designDir, id, {
    approver: typeof body.approver === 'string' ? body.approver : auth.agentId || 'user',
    tier: typeof body.tier === 'number' ? body.tier : undefined,
    reason: typeof body.reason === 'string' ? body.reason : undefined,
    iso: new Date().toISOString(),
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result)
}
