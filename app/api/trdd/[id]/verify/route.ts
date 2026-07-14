import { NextRequest, NextResponse } from 'next/server'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { resolveDesignDir, isValidTrddId } from '@/lib/trdd-design-dir'
import { verifyTrddDecision } from '@/lib/trdd-approval-token'

/**
 * GET /api/trdd/[id]/verify — "was this card's approval issued by the authority it
 * claims, for THIS card?" (ai-maestro#47, ask 2 — the verb the MANAGER asked for,
 * placed where it is actually used.)
 *
 * Answers from the SIGNED TOKEN, not from the card's prose: the card's
 * `approval-judge:` / `## Approval log` lines are exactly what a forger rewrites, so
 * the only thing taken from the file is the token ID. Who approved, under what
 * title, and for which card all come from the host-signed, ledger-anchored token.
 *
 * NOT strict, and NOT sudo-gated: this is a READ, and the caller who most needs it
 * is the agent being handed a mandate. A verifier that is hard to reach is a
 * verifier nobody calls — and an unasked verifier protects no one.
 */

// Reads the TRDD corpus + the portfolio store/ledger from disk.
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    if (!isValidTrddId(id)) {
      return NextResponse.json({ error: 'Invalid TRDD id (expected 8-char base36)' }, { status: 400 })
    }

    const auth = authenticateFromRequest(request)
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
    }

    const agentId = request.nextUrl.searchParams.get('agentId')
    const designDir = resolveDesignDir(agentId)

    const verdict = await verifyTrddDecision(designDir, id)
    if (!verdict) {
      return NextResponse.json({ error: `TRDD ${id} not found` }, { status: 404 })
    }
    return NextResponse.json(verdict, { status: 200 })
  } catch (error) {
    console.error('[trdd verify GET] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
