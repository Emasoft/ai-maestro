import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { authenticateFromRequest, buildAuthContext } from '@/lib/agent-auth'
import { isValidUuid } from '@/lib/validation'
import type { PortfolioToken } from '@/types/portfolio'
import { canIssue } from '@/lib/portfolio-issue-guard'
import { signPortfolioToken } from '@/lib/portfolio-sign'
import {
  issueToken,
  setLedgerSeq,
  findActiveTokens,
  loadPortfolio,
  getTokenById,
  revokeToken,
} from '@/lib/portfolio-store'
import { emitPortfolioOp, issueDiff, revokeDiff } from '@/lib/portfolio-ledger'

/**
 * Portfolio issuance / list / revoke route (R28). `[id]` is the SUBJECT — the
 * agent being EMPOWERED (its enclave stores the token).
 *
 * R32 (THE load-bearing constraint): this route is AGENT-PRIMARY. Agent
 * callers (Bearer aim_tk_*) are authorized by the R28 chain — (1) AID identity
 * verified by authenticateFromRequest, (2) TITLE + standing authority enforced
 * by canIssue. They NEVER face a sudo gate: this route does NOT import or call
 * requireSudoToken, and is intentionally NOT classified strict in
 * security-registry.json. The system-owner / USER (dashboard) path goes
 * through the SAME authenticate + canIssue flow (canIssue grants system-owner).
 */

// Reads/writes runtime filesystem state (the portfolio store + ledger).
export const dynamic = 'force-dynamic'

// Bound the requested TTL so an agent cannot mint a forever-token by accident.
// Approval tokens ≤ aim_tk_ (1h, D2); mandate tokens bounded-until-team-complete
// but still capped at a generous ceiling so a leaked mandate eventually dies.
const MAX_APPROVAL_TTL_SECONDS = 3600 // 1h — matches aim_tk_
const DEFAULT_APPROVAL_TTL_SECONDS = 3600
const MAX_MANDATE_TTL_SECONDS = 30 * 24 * 3600 // 30d ceiling (revoke ends it sooner)

/**
 * POST /api/agents/[id]/portfolio — mint a token for the subject `[id]`.
 * Body: { kind, scope, target_agent_id?, target_team_id?, ttl_seconds?, uses? }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: subjectAgentId } = await params

    // (1) AID identity — agent callers prove possession; USER carries the
    // session cookie. R32: NO sudo gate on either path here.
    const auth = authenticateFromRequest(request)
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
    }
    const ctx = buildAuthContext(auth)

    let body: {
      kind?: string
      scope?: string
      target_agent_id?: string
      target_team_id?: string
      ttl_seconds?: number
      uses?: number
    }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const kind = body.kind
    const scope = body.scope
    if (kind !== 'approval' && kind !== 'mandate') {
      return NextResponse.json({ error: 'kind must be "approval" or "mandate"' }, { status: 400 })
    }
    if (!scope || typeof scope !== 'string' || !scope.includes(':')) {
      return NextResponse.json({ error: 'scope is required ("resource:action")' }, { status: 400 })
    }

    // (2) MINT authority — TITLE + standing authority. R32: no sudo consulted.
    const decision = canIssue(ctx, {
      kind,
      scope,
      subject_agent_id: subjectAgentId,
      target_agent_id: body.target_agent_id,
      target_team_id: body.target_team_id,
    })
    if (!decision.ok) {
      return NextResponse.json(
        { error: 'portfolio_mint_forbidden', message: decision.reason },
        { status: 403 },
      )
    }

    // Build the token. Issuer title comes from the AID-derived context; the
    // system-owner mints "on behalf of" a manager grant (records 'manager').
    const issuerTitle =
      (ctx.governanceTitle || '').toLowerCase() === 'chief-of-staff' ? 'chief-of-staff' : 'manager'
    const now = new Date()

    const ttlCeil = kind === 'approval' ? MAX_APPROVAL_TTL_SECONDS : MAX_MANDATE_TTL_SECONDS
    const ttlReq =
      typeof body.ttl_seconds === 'number' && body.ttl_seconds > 0
        ? Math.min(body.ttl_seconds, ttlCeil)
        : kind === 'approval'
          ? DEFAULT_APPROVAL_TTL_SECONDS
          : MAX_MANDATE_TTL_SECONDS
    const expiresAt = new Date(now.getTime() + ttlReq * 1000).toISOString()

    // Approval = one-shot (uses 1, capped); mandate = unlimited (null).
    const uses =
      kind === 'approval'
        ? typeof body.uses === 'number' && body.uses > 0
          ? Math.min(body.uses, 1)
          : 1
        : null

    const token: PortfolioToken = {
      token_id: randomUUID(),
      kind,
      subject_agent_id: subjectAgentId,
      scope,
      ...(body.target_agent_id ? { target_agent_id: body.target_agent_id } : {}),
      ...(body.target_team_id ? { target_team_id: body.target_team_id } : {}),
      issuer_agent_id: ctx.agentId ?? 'system-owner',
      issuer_title: issuerTitle,
      ...(ctx.teamId ? { issuer_team_id: ctx.teamId } : {}),
      uses_remaining: uses,
      issued_at: now.toISOString(),
      expires_at: expiresAt,
      issuer_sig: '', // filled below
      ledger_seq: null, // filled after the ledger append (R34 anchor)
      status: 'active',
    }
    token.issuer_sig = signPortfolioToken(token)

    // Persist, then anchor in the host-signed ledger and write back the seq.
    await issueToken(token)
    const seq = await emitPortfolioOp('issue_portfolio_token', token.token_id, issueDiff(token), {
      action: 'issue-portfolio-token',
      agentId: ctx.agentId ?? null,
      actor: ctx.agentId ? 'agent' : 'user',
    })
    if (seq !== null) {
      await setLedgerSeq(token.token_id, seq)
      token.ledger_seq = seq
    } else {
      // Ledger append failed → the token is NOT anchored and would be refused
      // by the R34 check anyway. Revoke it so we don't leave a dead record.
      await revokeToken(token.token_id)
      return NextResponse.json(
        { error: 'portfolio_ledger_unavailable', message: 'Token could not be anchored in the audit ledger; not issued.' },
        { status: 503 },
      )
    }

    return NextResponse.json(
      {
        token_id: token.token_id,
        kind: token.kind,
        subject_agent_id: token.subject_agent_id,
        scope: token.scope,
        expires_at: token.expires_at,
        ledger_seq: token.ledger_seq,
      },
      { status: 201 },
    )
  } catch (error) {
    console.error('[portfolio POST] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * GET /api/agents/[id]/portfolio — list the subject's ACTIVE tokens.
 * Visible to: the subject itself, an issuer of any of its tokens, or the
 * system-owner.
 */
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
    const ctx = buildAuthContext(auth)

    const all = loadPortfolio(subjectAgentId)
    const isSelf = ctx.agentId === subjectAgentId
    const isIssuer = !!ctx.agentId && all.some(t => t.issuer_agent_id === ctx.agentId)
    if (!ctx.isSystemOwner && !isSelf && !isIssuer) {
      return NextResponse.json(
        { error: 'portfolio_read_forbidden', message: 'Only the subject, an issuer, or the system owner may read this portfolio.' },
        { status: 403 },
      )
    }

    const active = findActiveTokens(subjectAgentId).map(t => ({
      token_id: t.token_id,
      kind: t.kind,
      scope: t.scope,
      target_agent_id: t.target_agent_id ?? null,
      target_team_id: t.target_team_id ?? null,
      issuer_agent_id: t.issuer_agent_id,
      issuer_title: t.issuer_title,
      uses_remaining: t.uses_remaining,
      issued_at: t.issued_at,
      expires_at: t.expires_at,
      ledger_seq: t.ledger_seq,
      status: t.status,
    }))
    return NextResponse.json({ subject_agent_id: subjectAgentId, tokens: active }, { status: 200 })
  } catch (error) {
    console.error('[portfolio GET] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/agents/[id]/portfolio?token_id=… — revoke a token.
 * Allowed to: the token's issuer, or the system-owner. R32: no sudo gate.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: subjectAgentId } = await params
    const auth = authenticateFromRequest(request)
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
    }
    const ctx = buildAuthContext(auth)

    const tokenId = request.nextUrl.searchParams.get('token_id')
    if (!tokenId || !isValidUuid(tokenId)) {
      return NextResponse.json({ error: 'token_id query param is required (UUID)' }, { status: 400 })
    }

    // Ensure the subject's portfolio is loaded so getTokenById resolves it.
    loadPortfolio(subjectAgentId)
    const token = getTokenById(tokenId)
    if (!token || token.subject_agent_id !== subjectAgentId) {
      return NextResponse.json({ error: 'Token not found in this subject portfolio' }, { status: 404 })
    }

    const isIssuer = !!ctx.agentId && token.issuer_agent_id === ctx.agentId
    if (!ctx.isSystemOwner && !isIssuer) {
      return NextResponse.json(
        { error: 'portfolio_revoke_forbidden', message: 'Only the token issuer or the system owner may revoke it.' },
        { status: 403 },
      )
    }

    const revoked = await revokeToken(tokenId)
    if (revoked) {
      // Fire-and-forget audit (revocation does not gate anything).
      void emitPortfolioOp('revoke_portfolio_token', tokenId, revokeDiff(token), {
        action: 'revoke-portfolio-token',
        agentId: ctx.agentId ?? null,
        actor: ctx.agentId ? 'agent' : 'user',
      })
    }
    return NextResponse.json({ token_id: tokenId, revoked }, { status: 200 })
  } catch (error) {
    console.error('[portfolio DELETE] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
