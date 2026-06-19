/**
 * Sudo-mode token layer.
 *
 * A sudo token is a short-lived credential (60s default) that proves the
 * caller re-entered the governance password within the last minute. Used
 * by endpoints classified "strict" in security-registry.json.
 *
 * TOKEN LIFECYCLE:
 *   1. Caller POSTs /api/auth/sudo-password with { password: "..." }.
 *   2. Server verifies the password with bcrypt against governance.passwordHash.
 *   3. Server generates a random 32-byte token, stores it with expiry, and
 *      returns it to the caller (who keeps it in memory, NOT in a cookie).
 *   4. Caller sends it on the next strict request as `X-Sudo-Token: ...`.
 *   5. Strict route handlers call validateAndConsumeSudoToken(token) which
 *      deletes the token (one-shot use) and returns ok/expired/missing.
 *
 * Tokens are stored in an in-memory map attached to globalThis so they
 * survive Next.js HMR in dev mode (same pattern as session-auth). On actual
 * process restart, all in-flight sudo tokens are invalidated — the user
 * re-enters the password.
 */

import { randomBytes, timingSafeEqual } from 'crypto'
import { verifyPasswordAuto } from '@/lib/argon2'
import { loadGovernance, isUserAuthorityModelEnabled } from './governance'

import { loadSecurityConfig } from '@/lib/security-config'

function getSudoTokenTtlMs(): number {
  return loadSecurityConfig().sessionAuth.sudoTokenTtlSeconds * 1000
}
const SUDO_TOKEN_BYTES = 32

/** A method+pathTemplate a sudo token is bound to (SUDO-01). */
export interface SudoOperation {
  method: string
  path: string
}

interface SudoRecord {
  /** hash of the token (we never keep raw tokens in memory longer than needed) */
  tokenHash: string
  expiresAt: number
  /**
   * Who earned this token. Under R32 only the USER/UI mints sudo tokens, so
   * this is always 'system-owner' for freshly-issued tokens. The field stays
   * a string (not a literal) so legacy in-flight tokens issued before R32 still
   * round-trip without a type break.
   */
  subject: string
  /**
   * SUDO-01 (R32): the operation this token was minted for. When present, the
   * guard refuses to consume the token on any OTHER (method, pathTemplate),
   * preventing a token minted for op A on subject X from being replayed for op
   * B. Optional during the two-phase rollout (R-3): a token minted without an
   * operation (legacy / unbound) is tolerated by the guard.
   */
  operation?: SudoOperation
}

interface SudoGlobals {
  __aiMaestroSudoTokens?: Map<string, SudoRecord>
}

const g = globalThis as unknown as SudoGlobals
const tokens: Map<string, SudoRecord> =
  g.__aiMaestroSudoTokens ?? new Map<string, SudoRecord>()
if (!g.__aiMaestroSudoTokens) g.__aiMaestroSudoTokens = tokens

function hashToken(token: string): string {
  // Deterministic hash so we can look up by token → record. bcrypt is too
  // slow for every request; a plain SHA256 is fine because the tokens
  // themselves are already high-entropy (256 bits) and short-lived (60s).
  const crypto = require('crypto') as typeof import('crypto')
  return crypto.createHash('sha256').update(token).digest('hex')
}

/** Purge expired records. Called lazily on every issue/validate call. */
function sweep(): void {
  const now = Date.now()
  for (const [key, rec] of tokens.entries()) {
    if (rec.expiresAt <= now) tokens.delete(key)
  }
}

/**
 * Resolve which password hash to verify `password` against, per R37.4.
 *
 * - Model OFF (default): the single global `governance.passwordHash` — exactly
 *   the legacy behavior. `subject` is opaque ('system-owner'); it is NOT used to
 *   pick a hash. This keeps every pre-model caller and test byte-identical.
 * - Model ON (R37.4): the ACTING user's own `UserRecord.passwordHash` (looked up
 *   by `subject`=userId). While a MAESTRO-DELEGATE acts, the delegate's record is
 *   the active maestro (getActiveMaestroUserId), so sudo accepts the DELEGATE's
 *   password, not the original maestro's.
 *
 * R32 GUARD: under the model, `subject` MUST resolve to a USER record. Sudo is
 * USER-via-UI only (R32.2) — an agent id never reaches here, and if one is
 * passed we reject rather than fall back to a hash, so an agent can never mint a
 * sudo token through a mis-routed call.
 *
 * Throws `sudo_mode_unavailable` when no usable hash exists.
 */
function resolveSudoPasswordHash(subject: string): string {
  // FLAG-OFF (and the safe default if the flag read fails): global hash.
  let modelOn = false
  try {
    modelOn = isUserAuthorityModelEnabled()
  } catch {
    modelOn = false
  }

  if (!modelOn) {
    const config = loadGovernance()
    if (!config.passwordHash) {
      throw new Error('sudo_mode_unavailable: governance password not set')
    }
    return config.passwordHash
  }

  // FLAG-ON (R37.4): per-user verification against the acting user's own hash.
  // R32 guard: subject must resolve to a UserRecord. The legacy sentinel
  // 'system-owner' is NOT a user id — under the model, callers pass the acting
  // user's id (the sudo-password route resolves it from the auth context).
  const { getUser } = require('./user-registry') as typeof import('./user-registry')
  const user = getUser(subject)
  if (!user) {
    // Never silently fall back to the global hash for an unknown/agent subject —
    // that would let a mis-routed agent call mint a token (R32 violation).
    throw new Error('sudo_subject_not_a_user: sudo is USER-via-UI only (R32) — subject must resolve to a user record')
  }
  if (!user.passwordHash) {
    throw new Error('sudo_mode_unavailable: user has no sudo password set')
  }
  return user.passwordHash
}

/**
 * Verify the governance password and issue a new sudo token.
 * Returns the raw token string (show once, never stored) or throws on
 * password mismatch / missing password.
 *
 * R37.4: under the user-authority model the password is verified against the
 * ACTING user's own hash (see resolveSudoPasswordHash). With the model OFF the
 * single global governance password is used — identical to pre-model behavior.
 */
export async function issueSudoToken(
  password: string,
  subject: string,
  operation?: SudoOperation
): Promise<{ token: string; expiresAt: number }> {
  const passwordHash = resolveSudoPasswordHash(subject)
  const ok = await verifyPasswordAuto(passwordHash, password)
  if (!ok) {
    throw new Error('sudo_mode_bad_password')
  }

  sweep()
  const raw = randomBytes(SUDO_TOKEN_BYTES).toString('base64url')
  const tokenHash = hashToken(raw)
  const expiresAt = Date.now() + getSudoTokenTtlMs()

  // Keyed by hash for O(1) lookup without exposing raw tokens. `operation` is
  // stored verbatim (SUDO-01) so the guard can verify op binding at consume.
  tokens.set(tokenHash, { tokenHash, expiresAt, subject, operation })
  return { token: raw, expiresAt }
}

type ValidationResult =
  | { ok: true; subject: string; operation?: SudoOperation }
  | { ok: false; reason: 'missing' | 'expired' | 'unknown' }

/**
 * One-shot validation: if the token is valid, consume it (delete from map)
 * and return the subject. Otherwise return a reason. One-shot means an
 * attacker who captures the token can't replay it — but the caller must
 * handle network retries by re-issuing a new sudo token.
 */
export function validateAndConsumeSudoToken(rawToken: string | null | undefined): ValidationResult {
  if (!rawToken || typeof rawToken !== 'string') {
    return { ok: false, reason: 'missing' }
  }
  sweep()
  const tokenHash = hashToken(rawToken)
  const rec = tokens.get(tokenHash)
  if (!rec) {
    return { ok: false, reason: 'unknown' }
  }
  // Constant-time comparison on the hash for defense in depth
  const a = Buffer.from(rec.tokenHash)
  const b = Buffer.from(tokenHash)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'unknown' }
  }
  if (rec.expiresAt <= Date.now()) {
    tokens.delete(tokenHash)
    return { ok: false, reason: 'expired' }
  }
  tokens.delete(tokenHash) // one-shot
  return { ok: true, subject: rec.subject, operation: rec.operation }
}

/** Diagnostic: how many sudo tokens are currently outstanding. */
export function activeSudoTokenCount(): number {
  sweep()
  return tokens.size
}

/**
 * SUDO-05 (R32): count the outstanding (non-expired) tokens for a given
 * subject. The mint route uses this to cap how many USER ('system-owner')
 * sudo tokens may be live at once, so a flood of un-consumed tokens can't
 * accumulate. Sweeps expired records first so the count is accurate.
 */
export function countBySubject(subject: string): number {
  sweep()
  let n = 0
  for (const rec of tokens.values()) {
    if (rec.subject === subject) n++
  }
  return n
}

// AUTH-MIN-04 fix: schedule a periodic sweep so expired tokens don't
// accumulate in low-traffic deployments. The previous lazy-only sweep would
// leave expired entries in memory until the next issue/validate call. Skip
// during tests so we don't hold the event loop open.
if (process.env.NODE_ENV !== 'test') {
  const SUDO_SWEEP_INTERVAL_MS = 60_000 // 60s — sudo TTL is 60s, so this is a single TTL window
  const sweepInterval = setInterval(sweep, SUDO_SWEEP_INTERVAL_MS)
  // Don't keep the Node.js event loop alive solely for this timer — a
  // graceful shutdown shouldn't be delayed by it.
  if (typeof sweepInterval.unref === 'function') {
    sweepInterval.unref()
  }
}
