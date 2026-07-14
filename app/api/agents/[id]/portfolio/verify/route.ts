import { NextRequest, NextResponse } from 'next/server'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { isValidUuid } from '@/lib/validation'
import { loadPortfolio, getTokenById } from '@/lib/portfolio-store'
import { explainPortfolioToken } from '@/lib/portfolio-check'

/**
 * GET /api/agents/[id]/portfolio/verify?token_id=…[&scope=…][&binds=…][&binds_agent=…][&binds_team=…]
 *
 * THE VERIFICATION SURFACE (ai-maestro#47, ask 2). `[id]` is the SUBJECT — the
 * agent whose enclave holds the token.
 *
 * WHY IT EXISTS. R41 says an approval/mandate is "signed, verifiable, binding".
 * Signed and binding were already true; VERIFIABLE was not — the crypto
 * (`lib/portfolio-sign.ts`, `lib/portfolio-ledger.ts`) was server-internal, with
 * no endpoint and no CLI. So the only evidence a receiving agent had that "the
 * MANAGER approved this" was a `## Approval log` line in a git file: auditable,
 * and forgeable by anyone with repo write. This route is the third party an agent
 * can ask instead.
 *
 * IT RETURNS A VERDICT, NOT A BOOLEAN. Per-check outcomes plus the reasons, plus
 * what the token actually binds. A caller told only "false" cannot distinguish a
 * tampered signature from an expired token from an approval for a *different*
 * card — and those demand different responses.
 *
 * ASK THE SPECIFIC QUESTION. `?binds=<trdd-id>` turns "is this token real?" into
 * "is this an approval *for this card*?". The vague question is the one a replayed
 * token passes.
 *
 * AUTHORIZATION: any authenticated caller (agent or user). Deliberately WIDER
 * than the portfolio GET (subject/issuer/system-owner), because the agent that
 * most needs to verify a mandate is precisely the one it is being waved at — the
 * receiver, who is neither subject nor issuer. Verification grants nothing: using
 * a token still requires holding it in your own enclave (matchPortfolioToken reads
 * the CALLER's portfolio), so learning that a token id is authentic confers no
 * authority over it. R32: no sudo gate — this is a read.
 */

// Reads runtime filesystem state (the portfolio store + the signed ledger).
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: subjectAgentId } = await params

    const auth = authenticateFromRequest(request)
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
    }

    const tokenId = request.nextUrl.searchParams.get('token_id')
    if (!tokenId || !isValidUuid(tokenId)) {
      return NextResponse.json(
        { error: 'token_id query param is required (UUID)' },
        { status: 400 },
      )
    }

    // Load the subject's file so the store's index resolves the id (same shape
    // the DELETE handler uses).
    loadPortfolio(subjectAgentId)
    const token = getTokenById(tokenId)
    if (!token || token.subject_agent_id !== subjectAgentId) {
      // A token that does not exist in the named enclave is NOT "invalid" in the
      // cryptographic sense — it is absent. Say so distinctly: a caller shown a
      // forged token id must not be told "the signature failed" (it never had one).
      return NextResponse.json(
        {
          token_id: tokenId,
          subject_agent_id: subjectAgentId,
          valid: false,
          found: false,
          reasons: ['No such token in this subject\'s portfolio.'],
        },
        { status: 404 },
      )
    }

    const sp = request.nextUrl.searchParams
    const verdict = await explainPortfolioToken(token, {
      scope: sp.get('scope') ?? undefined,
      trddId: sp.get('binds') ?? undefined,
      agentId: sp.get('binds_agent') ?? undefined,
      teamId: sp.get('binds_team') ?? undefined,
    })

    return NextResponse.json(
      { subject_agent_id: subjectAgentId, found: true, ...verdict },
      { status: 200 },
    )
  } catch (error) {
    console.error('[portfolio verify GET] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
