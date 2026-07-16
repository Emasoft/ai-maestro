// The OAuth-rotator cascade — ONE paradigm in three parts, each falling back to the
// next when it can't act: ROTATE → RENEW → REAUTHENTICATE.
//
// This is a FAITHFUL TypeScript port of the janitor plugin's
// scripts/oauth_rotator/cascade.py (TRDD-1GGQ4HWY, parent TRDD-KCRMSNL7): the
// ai-maestro server REPRODUCES the daemon's OAuth-continuity logic internally
// instead of coordinating with the external Python daemon. This file is the pure
// LEAF of that port — the SINGLE SOURCE OF TRUTH for per-account cascade
// classification, with no I/O and no dependency on the rest of the rotator, so
// the daemon tick and any nudge detectors can NEVER disagree about whether an
// account self-renews, can be renewed silently, or genuinely needs a human
// re-login. The logic must match cascade.py byte-for-byte in behaviour, because
// the two may read the SAME on-disk state.json (the machine-wide lock keeps them
// from writing it concurrently) — a divergence here would misclassify a live
// account's fallback and cause a silent dead rotation target.
//
// The three cascade layers (USER's authoritative design):
//  1. ROTATE — swap Claude Code's live keychain credential to the next stored
//     OAuth token when the live account hits a usage limit / expires. Usage-driven,
//     lives in the rotator's auto-rotate (needs the /api/oauth/usage probe); the
//     cascade does NOT re-implement it. The cascade owns the FALLBACK legs below,
//     applied to the ALTERNATE slots so a healthy account always exists to rotate TO.
//  2. RENEW — bring a degraded alternate back behind the scenes: RENEW_REFRESH
//     (slot has a refresh token, near expiry → silent HTTP token exchange) or
//     RENEW_COOKIE (no refresh but a live claude.ai session cookie → CDP capture
//     mints a fresh refresh-bearing slot).
//  3. REAUTHENTICATE — the ONLY human step: no refresh AND no live cookie and the
//     token is dead/near-dead → nudge the user to re-login (REAUTH_NUDGE).
//
// WAIT_SETUP_TOKEN is the benign in-between: a setup-token slot (no refresh, no
// session) that still has runway — nothing to do yet, do NOT nudge.

/**
 * Which leg of the ROTATE→RENEW→REAUTH cascade an ALTERNATE account sits in. (The
 * live account is ROTATE's concern, not this classification's — see {@link classify}.)
 * String values so a leg is JSON/log friendly, matching cascade.py's `str, Enum`.
 */
export enum CascadeLeg {
  HEALTHY = 'healthy', // has refresh, ample runway — self-renews; no action
  RENEW_REFRESH = 'renew_refresh', // has refresh, near expiry — keepalive refreshes it
  RENEW_COOKIE = 'renew_cookie', // no refresh, live session — bootstrap mints a refresh slot
  REAUTH_NUDGE = 'reauth_nudge', // no refresh, no session, dead/near — human must re-login
  WAIT_SETUP_TOKEN = 'wait_setup_token', // no refresh, no session, still runway — nothing yet
}

// Advisory defaults — mirror the env defaults in rotator.py (KEEPALIVE_AHEAD_H) and
// the detector's login grace. Callers pass the live values; these only matter when
// classify is used standalone (e.g. a unit test), so they are never a second source
// of truth for the real constants.
export const DEFAULT_KEEPALIVE_AHEAD_H = 2.0
export const DEFAULT_LOGIN_GRACE_DAYS = 1.0
// Consecutive keepalive-refresh failures after which a present-but-FAILING refresh
// token is treated as DEAD and escalated from RENEW_REFRESH down the cascade
// (TRDD-HJGR4I5W). A few ticks: long enough to ride out a transient token-endpoint
// flake, short enough to surface a truly-dead token within the hour.
export const DEFAULT_MAX_REFRESH_FAILURES = 3

/**
 * The cascade-relevant facts about ONE account — all non-secret metadata.
 *
 * `tokenExpiresH` is hours until the OAuth token's local `expiresAt` (null when
 * undatable). `hasSessionCookie` is whether a live claude.ai `sessionKey` cookie
 * exists for the account's seeded Chrome profile. `refreshFailures` is the per-slot
 * count of CONSECUTIVE failed keepalive-refresh exchanges (reset to 0 on any
 * success) — what lets classify tell a renewable refresh token apart from a
 * present-but-DEAD one (TRDD-HJGR4I5W). Defaults to 0 so synthetic call sites that
 * don't track it (the bootstrap-eligibility probe) are unaffected.
 */
export interface AccountState {
  email: string
  isLive: boolean
  hasRefresh: boolean
  tokenExpiresH: number | null
  hasSessionCookie: boolean
  refreshFailures?: number
}

export interface CascadeOptions {
  keepaliveAheadH?: number
  loginGraceDays?: number
  maxRefreshFailures?: number
}

/**
 * Classify ONE account into its cascade leg — the SSOT both daemon and detectors use.
 *
 * The LIVE account is owned by Claude Code (it refreshes its own rotating grant)
 * and, when exhausted, is handled by the ROTATE leg — NOT by the RENEW/REAUTH legs
 * here. So a live account always classifies HEALTHY from this function's POV.
 *
 * For an ALTERNATE (non-live) slot the rules match the rotator primitives exactly:
 * RENEW_REFRESH ⇔ keepalive eligibility (has refresh, datable, within the window);
 * RENEW_COOKIE ⇔ no USABLE refresh (absent OR present-but-dead) AND has a session
 * cookie (TRDD-J9TM3WQK — the dead-refresh case auto-recovers from a live cookie
 * instead of nudging REAUTH, which was the recurring "had to rotate auth manually"
 * cause); REAUTH_NUDGE ⇔ no usable refresh AND no session, token null/within grace.
 */
export function classify(acct: AccountState, opts: CascadeOptions = {}): CascadeLeg {
  const keepaliveAheadH = opts.keepaliveAheadH ?? DEFAULT_KEEPALIVE_AHEAD_H
  const loginGraceDays = opts.loginGraceDays ?? DEFAULT_LOGIN_GRACE_DAYS
  const maxRefreshFailures = opts.maxRefreshFailures ?? DEFAULT_MAX_REFRESH_FAILURES
  const refreshFailures = acct.refreshFailures ?? 0

  if (acct.isLive) return CascadeLeg.HEALTHY

  if (acct.hasRefresh) {
    // A refresh token that EXISTS but whose exchange keeps FAILING is dead — it can
    // never come back, so do NOT loop RENEW_REFRESH on it forever (TRDD-HJGR4I5W). A
    // dead refresh falls through the SAME RENEW→REAUTH cascade a MISSING one does: a
    // live claude.ai cookie mints a fresh refresh with NO human (RENEW_COOKIE); only
    // with NO cookie is the human nudged (TRDD-J9TM3WQK fixed the earlier jump
    // straight to REAUTH that skipped the cookie rung).
    if (refreshFailures >= maxRefreshFailures) {
      return acct.hasSessionCookie ? CascadeLeg.RENEW_COOKIE : CascadeLeg.REAUTH_NUDGE
    }
    // Datable AND within the keepalive window → the daemon will refresh it.
    if (acct.tokenExpiresH !== null && acct.tokenExpiresH <= keepaliveAheadH) {
      return CascadeLeg.RENEW_REFRESH
    }
    return CascadeLeg.HEALTHY
  }

  // No refresh token from here down.
  if (acct.hasSessionCookie) {
    // A live seeded session exists → the cookie-capture can mint a refresh slot.
    return CascadeLeg.RENEW_COOKIE
  }

  // No refresh AND no live session: the only fix is a human re-login — but only once
  // the setup-token is actually dead/near-dead. A setup-token with runway is benign
  // (WAIT) and must NOT be nudged.
  const tokenDays = acct.tokenExpiresH !== null ? acct.tokenExpiresH / 24.0 : null
  if (tokenDays === null || tokenDays <= loginGraceDays) return CascadeLeg.REAUTH_NUDGE
  return CascadeLeg.WAIT_SETUP_TOKEN
}

/**
 * The fleet-level RENEW/REAUTH buckets, in cascade order. ROTATE is reported
 * separately by the caller (usage-driven); this plan captures the fallback legs the
 * cascade owns, so the daemon can log ONE explicit cascade line and the detectors
 * can nudge from the same buckets.
 */
export interface CascadePlan {
  renewRefresh: readonly string[]
  renewCookie: readonly string[]
  reauthNudge: readonly string[]
  waiting: readonly string[]
  healthy: readonly string[]
}

/** A compact, log-friendly one-liner naming the non-empty fallback legs. */
export function cascadeSummaryLine(plan: CascadePlan): string {
  const parts: string[] = []
  if (plan.renewRefresh.length) parts.push(`renew-refresh=${plan.renewRefresh.join(',')}`)
  if (plan.renewCookie.length) parts.push(`renew-cookie=${plan.renewCookie.join(',')}`)
  if (plan.reauthNudge.length) parts.push(`reauth-nudge=${plan.reauthNudge.join(',')}`)
  if (plan.waiting.length) parts.push(`waiting=${plan.waiting.join(',')}`)
  return 'cascade: ' + (parts.length ? parts.join(' ') : 'all alternates healthy')
}

/**
 * Classify every account and bucket the ALTERNATES into the cascade's fallback legs
 * (sorted, stable). Live accounts land in `healthy` (see {@link classify}).
 */
export function cascadePlan(accounts: AccountState[], opts: CascadeOptions = {}): CascadePlan {
  const buckets: Record<CascadeLeg, string[]> = {
    [CascadeLeg.HEALTHY]: [],
    [CascadeLeg.RENEW_REFRESH]: [],
    [CascadeLeg.RENEW_COOKIE]: [],
    [CascadeLeg.REAUTH_NUDGE]: [],
    [CascadeLeg.WAIT_SETUP_TOKEN]: [],
  }
  for (const acct of accounts) {
    buckets[classify(acct, opts)].push(acct.email)
  }
  return {
    renewRefresh: [...buckets[CascadeLeg.RENEW_REFRESH]].sort(),
    renewCookie: [...buckets[CascadeLeg.RENEW_COOKIE]].sort(),
    reauthNudge: [...buckets[CascadeLeg.REAUTH_NUDGE]].sort(),
    waiting: [...buckets[CascadeLeg.WAIT_SETUP_TOKEN]].sort(),
    healthy: [...buckets[CascadeLeg.HEALTHY]].sort(),
  }
}
