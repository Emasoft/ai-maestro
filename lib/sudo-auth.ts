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
import bcrypt from 'bcryptjs'
import { loadGovernance } from './governance'

const SUDO_TOKEN_TTL_MS = 60_000 // 60 seconds
const SUDO_TOKEN_BYTES = 32

interface SudoRecord {
  /** hash of the token (we never keep raw tokens in memory longer than needed) */
  tokenHash: string
  expiresAt: number
  /** who earned this token — agentId for agents, or 'system-owner' for web user */
  subject: string
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
 * Verify the governance password and issue a new sudo token.
 * Returns the raw token string (show once, never stored) or throws on
 * password mismatch / missing password.
 */
export async function issueSudoToken(password: string, subject: string): Promise<{ token: string; expiresAt: number }> {
  const config = loadGovernance()
  if (!config.passwordHash) {
    throw new Error('sudo_mode_unavailable: governance password not set')
  }
  const ok = await bcrypt.compare(password, config.passwordHash)
  if (!ok) {
    throw new Error('sudo_mode_bad_password')
  }

  sweep()
  const raw = randomBytes(SUDO_TOKEN_BYTES).toString('base64url')
  const tokenHash = hashToken(raw)
  const expiresAt = Date.now() + SUDO_TOKEN_TTL_MS

  // Keyed by hash for O(1) lookup without exposing raw tokens
  tokens.set(tokenHash, { tokenHash, expiresAt, subject })
  return { token: raw, expiresAt }
}

type ValidationResult =
  | { ok: true; subject: string }
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
  return { ok: true, subject: rec.subject }
}

/** Diagnostic: how many sudo tokens are currently outstanding. */
export function activeSudoTokenCount(): number {
  sweep()
  return tokens.size
}
