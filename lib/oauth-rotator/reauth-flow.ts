// The dashboard re-login flow (TRDD-OX5TT5OT).
//
// A slot whose refresh token is DEAD cannot be repaired by any amount of retrying — only a human
// consenting again can mint a new token pair. Before this module the sole path to that consent was
// a CLI buried in the janitor's plugin cache that an agent had to remember to mention, which the
// USER ruled a defect: "the ai-maestro server should do those things automatically by itself. never
// an user should be asked to do these manually."
//
// The shape is FORCED, not chosen. The OAuth app's registered redirect URI is Anthropic's own
// manual-callback page (`network.OAUTH_REDIRECT_URI`), so we cannot register a callback of our own
// and cannot receive the code out-of-band. That page DISPLAYS `<code>#<state>`; the human copies it
// back. Paste-the-code is what the registration permits.
//
// WHY NOT the janitor's transport: its capture launches a real Chrome on a per-account profile and
// drives it over CDP, because it must re-capture with NO human present. A re-login has a human
// present by definition, so the profile, the CDP attach, the Playwright dependency and the macOS
// OSCrypt trap it documents at length are all machinery for a problem this flow does not have.
//
// This writes a SLOT, never the live credential — that is the whole reason it is safe to expose.
// The live `Claude Code-credentials` is owned by Claude Code and refreshing it here would race its
// single-use rotating grant.

import * as crypto from 'crypto'

import {
  accountEmail,
  exchangeAuthorizationCode,
  DEFAULT_OAUTH_SCOPES,
  OAUTH_CLIENT_ID,
  OAUTH_REDIRECT_URI,
  type NetworkDeps,
} from './network'
import { expiresInH, fileSlot } from './slots'

const AUTHORIZE_URL = 'https://claude.ai/oauth/authorize'

/** How long a started flow stays completable. Long enough for a human to log in and copy a string,
 *  short enough that an abandoned verifier is not sitting in memory for an hour. */
const STATE_TTL_MS = 10 * 60 * 1000

/** Cap on live flows. A human runs one at a time; the cap exists so a caller that starts flows and
 *  never finishes them cannot grow the map without bound. Oldest is evicted rather than refused —
 *  refusing would let one abandoned flow lock the owner out of their own repair for the whole TTL. */
const MAX_PENDING = 8

interface PendingReauth {
  /** The PKCE verifier. NEVER sent to the client — only its SHA-256 challenge goes in the URL, and
   *  the verifier is what proves, at exchange time, that the code came back to the same server that
   *  requested it. Shipping it to the browser would discard the entire point of PKCE. */
  verifier: string
  /** Which account the owner MEANT to re-login, for the UI only. The account actually filed is
   *  whoever /roles resolves the new token to — see completeReauth. */
  emailHint: string | null
  expiresAt: number
  /** Single-use marker. The entry is TOMBSTONED rather than deleted on use so a replay is
   *  distinguishable from a state we never issued; both are refused, but they mean different
   *  things to the human ("you already used this" vs "this did not come from here"). */
  consumed: boolean
}

/**
 * In-memory, per-process. A server restart invalidates every in-flight flow, and that is CORRECT:
 * the user simply clicks the button again, whereas a verifier persisted to disk would be a
 * credential-adjacent secret at rest bought for nothing.
 */
const pending = new Map<string, PendingReauth>()

function b64url(b: Buffer): string {
  return b.toString('base64url')
}

/**
 * The PKCE S256 challenge for a verifier — `BASE64URL(SHA256(ASCII(verifier)))`, RFC 7636 §4.2.
 * Exported so the test can pin it against the RFC's own vector: {@link startReauth} mints a random
 * verifier, so the only way to check the derivation is to check THIS function — and it must be the
 * one the flow actually calls, not a copy of it, or the test proves nothing about what ships.
 */
export function pkceChallengeFor(verifier: string): string {
  return b64url(crypto.createHash('sha256').update(verifier, 'utf8').digest())
}

/** Drop expired entries (including consumed tombstones, which expire on the same clock). */
function prune(now: number): void {
  for (const [state, entry] of pending) {
    if (entry.expiresAt <= now) pending.delete(state)
  }
}

export interface StartReauthResult {
  /** The claude.ai consent URL to open. Carries the PKCE CHALLENGE — never the verifier. */
  authorizeUrl: string
  /** Opaque handle the client hands back to completeReauth. Not a secret; the secret is the
   *  verifier this state keys, which stays here. */
  state: string
}

/**
 * Begin a re-login: mint a PKCE verifier + S256 challenge and a single-use state, stash the
 * verifier server-side keyed by that state, and return the consent URL to open.
 *
 * `emailHint` is display-only. Which account gets filed is decided at the END of the flow by
 * /roles, because the human might log in as somebody else and the token is authoritative about
 * whose it is.
 */
export function startReauth(opts?: {
  emailHint?: string | null
  now?: number
  /** TEST-ONLY randomness seam. Production callers MUST NOT pass this — a caller that supplied a
   *  constant would make the verifier and state predictable, which is the one thing PKCE and the
   *  CSRF state exist to prevent. It exists so a test can KNOW the verifier and then assert it
   *  appears nowhere in the response or the URL; that negative cannot be asserted from outside
   *  without knowing the value. */
  randomBytes?: (n: number) => Buffer
}): StartReauthResult {
  const now = opts?.now ?? Date.now()
  const rand = opts?.randomBytes ?? crypto.randomBytes
  prune(now)
  // Evict oldest-first while over the cap (Map iterates in insertion order).
  while (pending.size >= MAX_PENDING) {
    const oldest = pending.keys().next()
    if (oldest.done) break
    pending.delete(oldest.value)
  }

  const verifier = b64url(rand(32))
  const challenge = pkceChallengeFor(verifier)
  const state = b64url(rand(32))

  pending.set(state, {
    verifier,
    emailHint: opts?.emailHint?.trim() || null,
    expiresAt: now + STATE_TTL_MS,
    consumed: false,
  })

  const params = new URLSearchParams({
    code: 'true',
    client_id: OAUTH_CLIENT_ID,
    response_type: 'code',
    redirect_uri: OAUTH_REDIRECT_URI,
    scope: DEFAULT_OAUTH_SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  })
  return { authorizeUrl: `${AUTHORIZE_URL}?${params.toString()}`, state }
}

/** Why a completion was refused. Each value names ONE cause, so the UI can tell the human what to
 *  do next — "start a new login" and "re-paste, you truncated it" are different instructions. */
export type ReauthFailure =
  | 'unknown_state'
  | 'expired_state'
  | 'replayed_state'
  | 'state_mismatch'
  | 'empty_code'
  | 'exchange_failed'
  | 'account_unresolved'
  | 'slot_locked'

export interface CompleteReauthOk {
  ok: true
  /** The account actually filed — resolved from the new token, not from the hint. */
  email: string
  /** False when the grant carried no refresh token: the slot is filed but will die again in hours,
   *  so the repair did NOT hold. Never collapsed into `ok` — a re-login that reports success while
   *  fixing nothing is the failure this whole flow exists to end. */
  hasRefreshToken: boolean
  /** Hours of runway on the new token, or null when the response carried no expiry. */
  expiresInH: number | null
}
export interface CompleteReauthErr {
  ok: false
  reason: ReauthFailure
  /** HTTP status from the token endpoint — only on `exchange_failed` (0 = network/parse failure). */
  status?: number
}
export type CompleteReauthResult = CompleteReauthOk | CompleteReauthErr

/**
 * Finish a re-login: verify the state, exchange the pasted code for a token pair, and file it as a
 * SLOT under the account the token actually belongs to.
 *
 * `pastedCode` is whatever the human copied off Anthropic's callback page — normally `code#state`.
 * A bare code (no `#`) is ACCEPTED because that page's rendering has varied and refusing would make
 * the only repair path unusable; but when a `#state` IS present it MUST match, and a paste from a
 * different flow is refused. The load-bearing guard is not this string: it is the server-side state
 * map plus the console + MAESTRO gate on the route, and an attacker who could satisfy those is
 * already at the owner's keyboard.
 *
 * On success the slot's `refresh_failures` and `refresh_dead_fp` are gone — fileSlot REPLACES the
 * state.json entry wholesale — so the retry ban lifts on the very next rotator beat without any
 * separate un-gating step.
 */
export async function completeReauth(
  state: string,
  pastedCode: string,
  deps?: NetworkDeps & { now?: number },
): Promise<CompleteReauthResult> {
  const now = deps?.now ?? Date.now()
  const entry = pending.get(state)
  if (!entry) return { ok: false, reason: 'unknown_state' }
  if (entry.expiresAt <= now) {
    pending.delete(state)
    return { ok: false, reason: 'expired_state' }
  }
  if (entry.consumed) return { ok: false, reason: 'replayed_state' }

  const hash = pastedCode.indexOf('#')
  const code = (hash === -1 ? pastedCode : pastedCode.slice(0, hash)).trim()
  const pastedState = hash === -1 ? '' : pastedCode.slice(hash + 1).trim()
  // A mismatch or a truncated paste does NOT consume the flow: both are far more likely to be a
  // copy/paste slip than an attack, and burning the state would force a whole new login for a typo.
  // Nothing about the verifier is exposed by a failed match, so there is nothing to protect by
  // burning it.
  if (pastedState && pastedState !== state) return { ok: false, reason: 'state_mismatch' }
  if (!code) return { ok: false, reason: 'empty_code' }

  // From here the flow IS consumed — the authorization code is single-use at the endpoint too, so
  // a retry with the same string could never succeed and would only be a replay window.
  entry.consumed = true

  const exchanged = await exchangeAuthorizationCode({ code, verifier: entry.verifier, state }, deps)
  if (!exchanged.ok) return { ok: false, reason: 'exchange_failed', status: exchanged.status }

  // The token is authoritative about whose it is: the human may have logged in as a different
  // account than the one the button named. File under the ACTUAL account or not at all — filing a
  // token under the wrong email would put a working credential where nothing looks for it.
  const email = await accountEmail(exchanged.blob, deps)
  if (!email) return { ok: false, reason: 'account_unresolved' }

  const inner = exchanged.blob.claudeAiOauth as Record<string, unknown>
  const expiresAt = typeof inner.expiresAt === 'number' ? inner.expiresAt : null
  const filed = await fileSlot(email, exchanged.blob, { via: 'dashboard-reauth', expiresAt })
  // Nothing is written on a lock timeout, so a lost race can never half-file an account.
  if (!filed) return { ok: false, reason: 'slot_locked' }

  return {
    ok: true,
    email,
    hasRefreshToken: exchanged.hasRefreshToken,
    expiresInH: expiresInH(exchanged.blob),
  }
}

/** Test-only: drop every pending flow so one test's state cannot leak into the next. */
export function __resetPendingReauthsForTest(): void {
  pending.clear()
}
