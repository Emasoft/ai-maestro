/**
 * THE THIRD AUTHORIZATION CHECK (R28) — portfolio / mandate token.
 *
 * Mirrors lib/ibct-scope-check.ts exactly in shape: a per-operation required
 * scope map + a checker that returns `null` (pass) or an error string
 * (refuse). It runs in each gated pipeline IMMEDIATELY AFTER the IBCT block,
 * after (1) AID identity and (2) TITLE privilege already passed.
 *
 * SHIPPED EMPTY (D2): `OPERATIONS_REQUIRING_TOKEN` starts `{}` so the check is
 * a pure no-op with ZERO behavior change. Enabling an op (the ONLY
 * behavior-changing flip, per-op reversible) makes that op require a portfolio
 * token from delegated callers (COS and below). MANAGER and the system-owner
 * are the mint authority and bypass the check for their own R29 authority.
 *
 * R34 anti-forgery: a matched token is trusted ONLY if it is ledger-anchored —
 * its `ledger_seq` resolves to a real `issue_portfolio_token` entry in the
 * host-signed portfolio ledger. A token written straight to the file with no
 * chained, host-signed entry is refused.
 */

import type { AuthContext } from '@/lib/agent-auth'
import type { PortfolioToken } from '@/types/portfolio'
import { findActiveTokens } from '@/lib/portfolio-store'
import { verifyPortfolioToken } from '@/lib/portfolio-sign'
import { ledgerHasIssue } from '@/lib/portfolio-ledger'

/**
 * Map of gated operation → required portfolio scope (IBCT `resource:action`
 * grammar). SHIPPED EMPTY (D2). The targeted v1 set, enabled per-op when the
 * USER decides, is `{ CreateAgent: 'agent:create', CreateTeam: 'team:create' }`
 * — kept narrow (only ops R28-R31 actually gate).
 */
export const OPERATIONS_REQUIRING_TOKEN: Record<string, string> = {
  // EMPTY by default — see header. Do NOT add ops without the governance
  // decision (D2 / spec §7). Enabling an op here is the only behavior change.
}

/** Result of the granular match used by consume-after-success callers. */
export type PortfolioMatch =
  | { ok: true; token: PortfolioToken | null }
  | { ok: false; reason: string }

/**
 * What a caller ASKS of a token. Every field is optional: a caller that asks
 * nothing gets the token's intrinsic validity (signature, ledger anchor, issuer,
 * status, expiry, uses). A caller that names a scope/target additionally asks the
 * SPECIFIC question — "is this an approval *for this card*?" — which is the only
 * question worth asking before obeying a mandate.
 */
export interface PortfolioQuestion {
  scope?: string
  agentId?: string
  teamId?: string
  trddId?: string
}

/**
 * Per-check outcome. `null` = the caller did not ask (so it does not count
 * toward `valid`); it is NOT a pass. Reporting "not asked" and "passed" as the
 * same `true` is how a verifier quietly stops verifying.
 */
export interface PortfolioVerdictChecks {
  signature_valid: boolean
  ledger_anchored: boolean
  issuer_title_current: boolean
  status_active: boolean
  not_expired: boolean
  uses_available: boolean
  scope_satisfied: boolean | null
  binds_target: boolean | null
}

/** The answer a verifier returns: a verdict with its reasoning, never a bare boolean. */
export interface PortfolioVerdict {
  token_id: string
  valid: boolean
  checks: PortfolioVerdictChecks
  /** Empty iff valid. One line per failed check, in the caller's language. */
  reasons: string[]
  /** What this token actually authorizes — so the caller can see it, not infer it. */
  binds: {
    kind: PortfolioToken['kind']
    scope: string
    subject_agent_id: string
    target_agent_id: string | null
    target_team_id: string | null
    target_trdd_id: string | null
    issuer_agent_id: string
    issuer_title: PortfolioToken['issuer_title']
    uses_remaining: number | null
    issued_at: string
    expires_at: string | null
    ledger_seq: number | null
    status: PortfolioToken['status']
  }
}

/**
 * Does a held scope satisfy a required scope? Exact match, or a `resource:*`
 * (or `*:*`) wildcard on the held scope covers the required scope's resource.
 * Same normalization rule the IBCT scope check applies.
 */
function scopeSatisfies(heldScope: string, requiredScope: string): boolean {
  if (heldScope === requiredScope) return true
  if (heldScope === '*:*') return true
  const [reqResource] = requiredScope.split(':')
  if (heldScope === `${reqResource}:*`) return true
  return false
}

/**
 * Re-check the issuer's CURRENT title at verify time (defence-in-depth): a
 * demoted MANAGER/COS's tokens must die even if the revoke sweep missed them.
 * Synchronous registry read; fail closed on any error.
 */
function issuerStillValid(token: PortfolioToken): boolean {
  try {
    // Lazy CommonJS require (sync, inside this sync guard) to avoid a circular
    // import with agent-registry. (@typescript-eslint is not loaded by the current
    // next/core-web-vitals config, so no no-require-imports disable is needed — and
    // an eslint-disable for an unloaded rule is itself a build error.)
    const reg = require('@/lib/agent-registry') as {
      loadAgents: () => Array<{ id: string; governanceTitle?: string; deletedAt?: string | null }>
    }
    const issuer = reg.loadAgents().find(a => a.id === token.issuer_agent_id && !a.deletedAt)
    if (!issuer) return false
    const title = (issuer.governanceTitle || '').toLowerCase()
    return title === token.issuer_title
  } catch (err) {
    console.warn('[portfolio-check] issuer-title re-check failed, denying token:', err)
    return false
  }
}

/**
 * THE VERIFIER (#47 ask 2). Answer, with reasons, whether `token` is authentic
 * and whether it authorizes what the caller is asking about.
 *
 * It exists because an approval recorded ONLY as a `## Approval log` line in a
 * git-tracked file is auditable but FORGEABLE — anyone with repo write can type
 * it. A receiving agent could not tell an authority's mandate from a peer's
 * invention. This function is what it asks instead, and the answer is a verdict
 * (which checks passed, what the token actually binds) rather than a boolean,
 * because "no" without "why" cannot be acted on.
 *
 * Every gate-relevant predicate lives HERE and the gate below calls it, so a
 * token the verifier calls valid is EXACTLY one the gate would accept. Two
 * separate implementations of "is this token good" would drift, and the drift
 * would always favor the attacker.
 */
export async function explainPortfolioToken(
  token: PortfolioToken,
  question: PortfolioQuestion = {},
): Promise<PortfolioVerdict> {
  const now = Date.now()
  const reasons: string[] = []

  const signature_valid = verifyPortfolioToken(token)
  if (!signature_valid) {
    reasons.push(
      'Host signature does not match the token bytes — the record was tampered with, or was never minted by this host.',
    )
  }

  // R34: the JSON record alone is not trusted; it must be anchored in the
  // host-signed ledger. A token written straight into the store with no chained
  // entry is a forgery by construction.
  let ledger_anchored = false
  if (token.ledger_seq === null) {
    reasons.push('Token carries no ledger anchor (ledger_seq is null) — not provably issued.')
  } else {
    ledger_anchored = await ledgerHasIssue(token.token_id, token.ledger_seq)
    if (!ledger_anchored) {
      reasons.push(
        `Ledger anchor does not resolve: no issue_portfolio_token entry for this token at seq ${token.ledger_seq}.`,
      )
    }
  }

  const issuer_title_current = issuerStillValid(token)
  if (!issuer_title_current) {
    reasons.push(
      `Issuer ${token.issuer_agent_id} no longer holds the title it minted under (${token.issuer_title}), or no longer exists.`,
    )
  }

  const status_active = token.status === 'active'
  if (!status_active) reasons.push(`Token status is "${token.status}", not "active".`)

  const not_expired = token.expires_at === null || new Date(token.expires_at).getTime() > now
  if (!not_expired) reasons.push(`Token expired at ${token.expires_at}.`)

  const uses_available = token.uses_remaining === null || token.uses_remaining > 0
  if (!uses_available) reasons.push('One-shot approval already consumed (uses_remaining is 0).')

  let scope_satisfied: boolean | null = null
  if (question.scope) {
    scope_satisfied = scopeSatisfies(token.scope, question.scope)
    if (!scope_satisfied) {
      reasons.push(`Token scope "${token.scope}" does not satisfy the required "${question.scope}".`)
    }
  }

  // A pin only constrains when the token HAS it: an unpinned token is broader,
  // not invalid. But a pinned token asked about a DIFFERENT target must refuse —
  // that is what stops one card's approval being replayed onto another.
  let binds_target: boolean | null = null
  const asksTarget = !!(question.agentId || question.teamId || question.trddId)
  const isPinned = !!(token.target_agent_id || token.target_team_id || token.target_trdd_id)
  if (asksTarget || isPinned) {
    binds_target = true
    if (token.target_agent_id && token.target_agent_id !== question.agentId) {
      binds_target = false
      reasons.push(`Token is pinned to agent ${token.target_agent_id}, not ${question.agentId ?? '(none asked)'}.`)
    }
    if (token.target_team_id && token.target_team_id !== question.teamId) {
      binds_target = false
      reasons.push(`Token is pinned to team ${token.target_team_id}, not ${question.teamId ?? '(none asked)'}.`)
    }
    // TRDD ids are WRITTEN uppercase but MATCHED case-insensitively (the IND base
    // rule). Comparing them raw would let a correctly-cited card read as "pinned
    // to a different TRDD" — a false forgery verdict, the worst kind of wrong here.
    if (
      token.target_trdd_id &&
      token.target_trdd_id.toUpperCase() !== (question.trddId ?? '').toUpperCase()
    ) {
      binds_target = false
      reasons.push(`Token is pinned to TRDD-${token.target_trdd_id}, not ${question.trddId ? `TRDD-${question.trddId.toUpperCase()}` : '(none asked)'}.`)
    }
  }

  const checks: PortfolioVerdictChecks = {
    signature_valid,
    ledger_anchored,
    issuer_title_current,
    status_active,
    not_expired,
    uses_available,
    scope_satisfied,
    binds_target,
  }

  const valid = Object.values(checks).every(c => c === true || c === null)

  return {
    token_id: token.token_id,
    valid,
    checks,
    reasons,
    binds: {
      kind: token.kind,
      scope: token.scope,
      subject_agent_id: token.subject_agent_id,
      target_agent_id: token.target_agent_id ?? null,
      target_team_id: token.target_team_id ?? null,
      target_trdd_id: token.target_trdd_id ?? null,
      issuer_agent_id: token.issuer_agent_id,
      issuer_title: token.issuer_title,
      uses_remaining: token.uses_remaining,
      issued_at: token.issued_at,
      expires_at: token.expires_at,
      ledger_seq: token.ledger_seq,
      status: token.status,
    },
  }
}

/**
 * Find a portfolio token that satisfies `operation` for `ctx` against an
 * optional `target`. Returns:
 *   { ok: true, token }  — a satisfying token (or `null` when the op is not
 *                          gated / caller is bypass authority — nothing to
 *                          consume)
 *   { ok: false, reason }— denial string naming the required scope + authority.
 *
 * The pipeline uses the returned `token.token_id` to consume a one-shot
 * approval AFTER the side effect persists (consume-after-success).
 */
export async function matchPortfolioToken(
  ctx: AuthContext,
  operation: string,
  target?: { agentId?: string; teamId?: string; trddId?: string },
): Promise<PortfolioMatch> {
  // System-owner / MAESTRO-UI — they ARE the mint authority.
  if (ctx.isSystemOwner) return { ok: true, token: null }
  // Defence-in-depth: no agent id ⇒ treat as system-owner-equivalent.
  if (!ctx.agentId) return { ok: true, token: null }

  const requiredScope = OPERATIONS_REQUIRING_TOKEN[operation]
  // Operation not gated (the default for EVERY op while the map is empty).
  if (!requiredScope) return { ok: true, token: null }

  // MANAGER self-empowerment bypass — it IS the issuer for its own R29
  // authority. Gate only the DELEGATED callers (COS and below).
  if ((ctx.governanceTitle || '').toLowerCase() === 'manager') {
    return { ok: true, token: null }
  }

  const tokens = findActiveTokens(ctx.agentId)
  for (const t of tokens) {
    // ONE predicate set for the gate and the verifier (see explainPortfolioToken).
    // If these ever became two implementations they would drift, and the drift
    // would always favor the attacker: the verifier says "authentic", the gate
    // lets it through on different grounds.
    // eslint-disable-next-line no-await-in-loop
    const verdict = await explainPortfolioToken(t, {
      scope: requiredScope,
      agentId: target?.agentId,
      teamId: target?.teamId,
      trddId: target?.trddId,
    })
    if (verdict.valid) return { ok: true, token: t }
  }

  return {
    ok: false,
    reason: `Portfolio token required: operation "${operation}" needs an approval/mandate token with scope "${requiredScope}" granted by a MANAGER (or your team's CHIEF-OF-STAFF). No valid, ledger-anchored token found.`,
  }
}

/**
 * THE THIRD CHECK — string|null mirror of checkIbctScope. Returns null when
 * authorized (op not gated, bypass authority, or a satisfying token), or an
 * error string to refuse. The pipeline uses `matchPortfolioToken` instead when
 * it also needs the matched token id for consume-after-success.
 */
export async function checkPortfolioToken(
  ctx: AuthContext,
  operation: string,
  target?: { agentId?: string; teamId?: string },
): Promise<string | null> {
  const m = await matchPortfolioToken(ctx, operation, target)
  return m.ok ? null : m.reason
}
