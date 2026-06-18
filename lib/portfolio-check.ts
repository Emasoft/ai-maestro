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
    // eslint-disable-next-line @typescript-eslint/no-var-requires
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
  target?: { agentId?: string; teamId?: string },
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
    if (!scopeSatisfies(t.scope, requiredScope)) continue
    if (t.target_agent_id && t.target_agent_id !== target?.agentId) continue
    if (t.target_team_id && t.target_team_id !== target?.teamId) continue
    if (!issuerStillValid(t)) continue
    if (!verifyPortfolioToken(t)) continue // tamper check (host signature)
    // R34 ledger anchor: the token must reference a real issue entry.
    if (t.ledger_seq === null) continue
    // eslint-disable-next-line no-await-in-loop
    if (!(await ledgerHasIssue(t.token_id, t.ledger_seq))) continue
    return { ok: true, token: t }
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
