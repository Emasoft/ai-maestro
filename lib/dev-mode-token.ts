/**
 * Dev-mode login token (TRDD-A9335BZ6).
 *
 * The credential that lets development continue while the owner is away: a
 * single, owner-minted, revocable secret that stands in for the governance
 * password at `POST /api/auth/login`. It is minted ONLY from Settings →
 * Security, behind the governance password AND a verified passkey, and the
 * plaintext is returned exactly once — `mintDevToken()` is the only place it
 * ever exists in cleartext.
 *
 * WHY THERE IS NO `AI_MAESTRO_DEV_MODE` ENV VAR, AND WHY YOU MUST NOT ADD ONE:
 * the enable switch is dashboard-owned and lives in `governance.json`, because
 * a bare env var that can weaken authentication is exactly the pattern the
 * USER-ratified rule of TRDD-CC9PY337 deletes rather than gates — "a dev box is
 * NOT a safe host: agents run under the SAME UID as the server, so a
 * prompt-injected agent appends one `export` to ~/.zshrc and the next restart
 * picks it up". That rule's own procedure routes a security-weakening setting
 * WITH a dashboard equivalent to the dashboard. A `process.env` read here would
 * also trip the regression fence in `tests/unit/test-only-env.test.ts`.
 *
 * The token itself IS read from the environment — by the SHELL CLI only, never
 * by this server. A credential is not a weakening setting: possessing it *is*
 * the authentication, the same category as the governance password that already
 * sits in `.env.local`. Shipping this is what finally lets that master password
 * be removed from the file.
 *
 * "Signed" is satisfied without an HMAC: a 256-bit server-minted random secret
 * compared in constant time against a stored SHA-256 hash is unforgeable,
 * server-issued and revocable. A stateless HMAC would still need a store to
 * revoke, so it would add a key to protect and buy nothing.
 */

import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { loadGovernance, saveGovernance } from '@/lib/governance'

/** Every dev token starts with this. Owner-facing, so it is greppable in a .env file. */
export const DEV_TOKEN_PREFIX = 'am-'

/** The name the owner writes in `.env.local`. Exported so the UI and the CLI cannot drift. */
export const DEV_TOKEN_ENV_NAME = 'AI_MAESTRO_DEV_MODE_TOKEN'

/** 256 bits of entropy — the whole security of the scheme rests on this being random. */
const TOKEN_BYTES = 32

/** sha256 hex is always 64 chars, which is what makes timingSafeEqual's length precondition hold. */
const HASH_HEX_LEN = 64

export interface DevTokenStatus {
  /** The dashboard-owned switch. False ⇒ `verifyDevToken` refuses even a correct token. */
  enabled: boolean
  /** A token has been minted and not revoked. The plaintext is NOT recoverable. */
  issued: boolean
  createdAt: string | null
  lastUsedAt: string | null
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/**
 * Read the flag at CALL time, never at module load: a value captured at import
 * cannot be flipped by a test, and a guard no test can reach is a guard nothing
 * pins.
 */
export function getDevTokenStatus(): DevTokenStatus {
  const rec = loadGovernance().devModeLogin ?? null
  return {
    enabled: rec?.enabled === true,
    issued: typeof rec?.tokenHash === 'string' && rec.tokenHash.length === HASH_HEX_LEN,
    createdAt: rec?.createdAt ?? null,
    lastUsedAt: rec?.lastUsedAt ?? null,
  }
}

/**
 * Turn dev-mode login on or off WITHOUT destroying the token — the owner can
 * park it for a while and bring it back. Destroying it is `revokeDevToken()`.
 */
export async function setDevModeEnabled(enabled: boolean): Promise<void> {
  const config = loadGovernance()
  const rec = config.devModeLogin
  if (!rec) {
    // Nothing minted yet: record the intent so the toggle is sticky across a
    // later mint, but never fabricate a tokenHash — `issued` must stay false.
    config.devModeLogin = { enabled, tokenHash: null, createdAt: null, lastUsedAt: null }
  } else {
    config.devModeLogin = { ...rec, enabled }
  }
  saveGovernance(config)
}

/**
 * Mint the ONE dev token. The returned string is the only cleartext copy that
 * will ever exist — the caller shows it once and drops it.
 *
 * Minting ENABLES dev login, because requiring a second toggle after an
 * explicit password+passkey mint would be friction with no security value: the
 * person who just proved both factors is the person authorising it.
 *
 * There is exactly one active token. Re-minting replaces the previous one,
 * which is what makes "I lost it, generate a new one" also mean "the lost one
 * is now dead".
 */
export async function mintDevToken(): Promise<string> {
  const token = DEV_TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString('base64url')
  const config = loadGovernance()
  config.devModeLogin = {
    enabled: true,
    tokenHash: hashToken(token),
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
  }
  saveGovernance(config)
  return token
}

/**
 * Fail-closed at every step: disabled, never minted, malformed, or mismatched
 * all return false. On success it stamps `lastUsedAt` so the owner can see the
 * credential is live — a login is not a hot path, so the extra ledger write is
 * cheaper than the question "is anything still using this?" going unanswerable.
 */
export async function verifyDevToken(token: string): Promise<boolean> {
  if (typeof token !== 'string' || !token.startsWith(DEV_TOKEN_PREFIX)) return false

  const config = loadGovernance()
  const rec = config.devModeLogin
  if (!rec || rec.enabled !== true) return false
  if (typeof rec.tokenHash !== 'string' || rec.tokenHash.length !== HASH_HEX_LEN) return false

  // Both sides are fixed-length sha256 hex, so the length precondition of
  // timingSafeEqual (it THROWS on a mismatch) is satisfied by construction.
  const candidate = Buffer.from(hashToken(token), 'utf8')
  const stored = Buffer.from(rec.tokenHash, 'utf8')
  if (candidate.length !== stored.length) return false
  if (!timingSafeEqual(candidate, stored)) return false

  config.devModeLogin = { ...rec, lastUsedAt: new Date().toISOString() }
  saveGovernance(config)
  return true
}

/**
 * Destroy the credential. The record is removed entirely rather than flagged,
 * so no code path that checks only `tokenHash` can keep honouring something the
 * owner revoked — the same reasoning `invalidatePassword()` applies to the
 * password hash.
 */
export async function revokeDevToken(): Promise<void> {
  const config = loadGovernance()
  if (!config.devModeLogin) return
  delete config.devModeLogin
  saveGovernance(config)
}
