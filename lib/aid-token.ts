/**
 * AID Governance Token — Ed25519 Proof-of-Possession
 *
 * Implements the AID token exchange protocol for AI Maestro governance.
 * Agents prove identity via Ed25519 signature, server issues short-lived
 * opaque tokens with embedded governance context (title + team).
 *
 * Two auth systems coexist:
 * - AMP API keys (amp_live_sk_*) → message routing (/api/v1/route, /api/v1/messages/pending)
 * - AID governance tokens (aim_tk_*) → governance operations (/api/agents/*, /api/teams/*)
 */

import { createHash, randomBytes, verify, createPublicKey, timingSafeEqual } from 'crypto'
import fs from 'fs'
import path from 'path'
import { withLock } from '@/lib/file-lock'
import { statePath } from '@/lib/ecosystem-constants'

// ============================================================================
// Types
// ============================================================================

export interface AIDTokenRecord {
  token_hash: string
  agent_id: string
  agent_name: string
  governance_title: string
  team_id: string | null
  scope: string
  issued_at: string
  expires_at: string
  /**
   * R36/R37 — the subject this token authenticates. Default 'agent' (every
   * pre-existing agent token; the field is omitted on disk for those and
   * normalized to 'agent' at validation). 'user' marks a human-user AID token:
   * for those, `agent_id` carries the USER id and `user_title` the user's
   * authority title; there is NO agent behind a user token.
   */
  subject_type?: 'agent' | 'user'
  /** R36/R37 — the user's authority title; present only when subject_type==='user'. */
  user_title?: import('@/types/user').UserTitle
}

export interface TokenExchangeResult {
  access_token: string
  token_type: 'bearer'
  expires_in: number
  agent_id: string
  governance_title: string
  team_id: string | null
  scope: string
}

export interface ProofVerificationResult {
  valid: boolean
  timestamp?: number
  error?: string
}

/**
 * Result of verifying a NONCE-bound proof (TRDD-15ff13ae). `nonce` is the
 * server-issued nonce the client signed — returned ONLY when the Ed25519
 * signature is valid, so the caller never consumes a nonce for an unverified
 * proof (authenticate-before-consume).
 */
export interface NonceProofResult {
  valid: boolean
  nonce?: string
  error?: string
}

// ============================================================================
// Constants
// ============================================================================

const TOKEN_PREFIX = 'aim_tk_'
const TOKEN_RANDOM_BYTES = 32 // 64 hex chars
const TOKEN_LIFETIME_SECONDS = 3600 // 1 hour
const PROOF_TIMESTAMP_WINDOW_SECONDS = 300 // 5 minutes anti-replay
const TOKENS_DIR = statePath('governance-tokens')

// In-memory token cache (avoids disk reads on every auth request).
// AUTH-MIN-01 fix: TTL reduced from 30s to 5s. The previous 30-second window
// meant a revoked token (agent deleted, key rotated) remained usable in-cache
// for up to 30 seconds after revocation. 5s is a much smaller blind window
// while keeping the per-request disk-read amortisation.
const TOKEN_CACHE_TTL_MS = 5_000
let _tokenCache: AIDTokenRecord[] | null = null
let _tokenCacheTimestamp = 0
// LIB2-MAJ-13: Map index keyed by token hash for O(1) validation lookup.
// Without this, every auth request walked every cached token doing
// timing-safe equality — CPU-amplification under load. The hash is a SHA256
// of the input token, so map lookup is itself constant-time relative to the
// other hashes in the map (the hash being looked up is fully determined by
// the input). The timing-safe equality is preserved AT INSERT and AT LOOKUP
// for the SINGLE record that matched (not all of them) — which keeps the
// "constant-time per request" invariant intact while removing the linear
// scan that scaled with token count.
let _tokenIndex: Map<string, AIDTokenRecord> | null = null

// ============================================================================
// Storage
// ============================================================================

function ensureTokensDir(): void {
  if (!fs.existsSync(TOKENS_DIR)) {
    fs.mkdirSync(TOKENS_DIR, { recursive: true, mode: 0o700 })
  }
}

function tokensFilePath(): string {
  return path.join(TOKENS_DIR, 'active-tokens.json')
}

function rebuildTokenIndex(tokens: AIDTokenRecord[]): Map<string, AIDTokenRecord> {
  const idx = new Map<string, AIDTokenRecord>()
  for (const record of tokens) {
    idx.set(record.token_hash, record)
  }
  return idx
}

function loadTokens(): AIDTokenRecord[] {
  const now = Date.now()
  if (_tokenCache && (now - _tokenCacheTimestamp) < TOKEN_CACHE_TTL_MS) {
    return _tokenCache
  }

  ensureTokensDir()
  const filePath = tokensFilePath()
  if (!fs.existsSync(filePath)) {
    _tokenCache = []
    _tokenIndex = new Map()
    _tokenCacheTimestamp = now
    return []
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    const tokens = Array.isArray(data) ? data as AIDTokenRecord[] : []
    // Prune expired tokens on load
    const validTokens = tokens.filter(t => new Date(t.expires_at).getTime() > now)
    _tokenCache = validTokens
    _tokenIndex = rebuildTokenIndex(validTokens)
    _tokenCacheTimestamp = now
    return validTokens
  } catch (err) {
    // LIB2-MIN-08: don't swallow parse errors silently. A corrupt
    // active-tokens.json file (partial write, disk pressure, manual
    // tampering) makes EVERY token validation silently fail because
    // we return an empty list. Logging gives operators a chance to
    // diagnose. The behaviour (return []) is preserved — there is
    // no recoverable action this function can take, but the failure
    // is no longer invisible.
    console.error(
      '[aid-token] Failed to parse active-tokens.json — all token validations will fail until the file is repaired or removed:',
      err instanceof Error ? err.message : err
    )
    _tokenCache = []
    _tokenIndex = new Map()
    _tokenCacheTimestamp = now
    return []
  }
}

function saveTokens(tokens: AIDTokenRecord[]): void {
  ensureTokensDir()
  const filePath = tokensFilePath()
  const tmpPath = filePath + '.tmp'
  fs.writeFileSync(tmpPath, JSON.stringify(tokens, null, 2), { mode: 0o600 })
  fs.renameSync(tmpPath, filePath)
  _tokenCache = tokens
  _tokenIndex = rebuildTokenIndex(tokens)
  _tokenCacheTimestamp = Date.now()
}

function hashToken(token: string): string {
  return 'sha256:' + createHash('sha256').update(token).digest('hex')
}

// ============================================================================
// Ed25519 Proof-of-Possession Verification
// ============================================================================

/**
 * Verify an Ed25519 proof-of-possession.
 *
 * The proof is base64url-encoded: [Ed25519 signature bytes (64)][timestamp string]
 * Signing input: "aid-token-exchange\n{timestamp}\n{server_url}"
 *
 * @param proofB64url - base64url-encoded proof (signature + timestamp)
 * @param publicKeyPem - PEM-encoded Ed25519 public key
 * @param serverUrl - AI Maestro server URL for anti-replay binding
 */
export function verifyProofOfPossession(
  proofB64url: string,
  publicKeyPem: string,
  serverUrl: string
): ProofVerificationResult {
  try {
    // Decode base64url → bytes
    const proofBytes = Buffer.from(proofB64url, 'base64url')
    if (proofBytes.length <= 64) {
      return { valid: false, error: 'Proof too short — must contain 64-byte signature + timestamp' }
    }

    // Split: first 64 bytes = Ed25519 signature, rest = timestamp string
    const signatureBytes = proofBytes.subarray(0, 64)
    const timestampStr = proofBytes.subarray(64).toString('utf-8')
    const timestamp = parseInt(timestampStr, 10)

    if (isNaN(timestamp)) {
      return { valid: false, error: 'Invalid timestamp in proof' }
    }

    // Anti-replay: timestamp must be within window
    const now = Math.floor(Date.now() / 1000)
    const drift = Math.abs(now - timestamp)
    if (drift > PROOF_TIMESTAMP_WINDOW_SECONDS) {
      return { valid: false, error: `Proof timestamp expired (drift: ${drift}s, max: ${PROOF_TIMESTAMP_WINDOW_SECONDS}s)` }
    }

    // Reconstruct signing input (must match agent-side construction)
    const signingInput = `aid-token-exchange\n${timestampStr}\n${serverUrl}`

    // Verify Ed25519 signature
    const pubKey = createPublicKey(publicKeyPem)
    const valid = verify(null, Buffer.from(signingInput), pubKey, signatureBytes)

    return valid
      ? { valid: true, timestamp }
      : { valid: false, error: 'Ed25519 signature verification failed' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { valid: false, error: `Proof verification error: ${msg}` }
  }
}

/**
 * Verify Ed25519 proof using raw public key hex (from amp-keys storage).
 * Reconstructs PEM from the 32-byte public key hex.
 */
export function verifyProofWithPublicKeyHex(
  proofB64url: string,
  publicKeyHex: string,
  serverUrl: string
): ProofVerificationResult {
  try {
    // Reconstruct SPKI DER from raw Ed25519 public key bytes
    // Ed25519 SPKI header (12 bytes) + public key (32 bytes)
    const header = Buffer.from([
      0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00
    ])
    const publicKeyBytes = Buffer.from(publicKeyHex, 'hex')
    const spkiDer = Buffer.concat([header, publicKeyBytes])

    const pubKey = createPublicKey({ key: spkiDer, format: 'der', type: 'spki' })
    const publicKeyPem = pubKey.export({ type: 'spki', format: 'pem' }) as string

    return verifyProofOfPossession(proofB64url, publicKeyPem, serverUrl)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { valid: false, error: `Public key reconstruction error: ${msg}` }
  }
}

// ============================================================================
// Ed25519 NONCE-bound Proof-of-Possession (TRDD-15ff13ae)
// ============================================================================
//
// This is the challenge/response replacement for the timestamp-windowed
// verifyProofOfPossession above. The proof carries a SERVER-ISSUED nonce
// instead of a client timestamp; freshness + single-use are enforced by the
// nonce store (lib/aid-nonce.ts) at consume time, NOT by a drift window here.
//
// The two verifiers coexist deliberately: /api/v1/auth/token uses the nonce
// path below; /api/v1/auth/ibct still uses the timestamp path above (its
// client was not part of this change). IBCT carries the identical replay gap
// and should migrate to the nonce path in a follow-up.

/**
 * Verify a NONCE-bound Ed25519 proof-of-possession.
 *
 * The proof is base64url-encoded: [Ed25519 signature bytes (64)][nonce string]
 * Signing input: "aid-token-exchange\n{nonce}\n{server_url}"
 *
 * On success the caller MUST consume the returned nonce via
 * consumeNonce(nonce, fingerprint) to enforce single-use. This function does
 * NOT touch the nonce store — it only proves the signature is valid over the
 * nonce, so proof verification and nonce consumption stay cleanly separated
 * (authenticate-before-consume).
 *
 * @param proofB64url - base64url-encoded proof (signature + nonce)
 * @param publicKeyPem - PEM-encoded Ed25519 public key (agent's registered key)
 * @param serverUrl - AI Maestro server URL bound into the signing input
 */
export function verifyNonceProof(
  proofB64url: string,
  publicKeyPem: string,
  serverUrl: string
): NonceProofResult {
  try {
    const proofBytes = Buffer.from(proofB64url, 'base64url')
    if (proofBytes.length <= 64) {
      return { valid: false, error: 'Proof too short — must contain 64-byte signature + nonce' }
    }

    // Split: first 64 bytes = Ed25519 signature, rest = nonce string
    const signatureBytes = proofBytes.subarray(0, 64)
    const nonceStr = proofBytes.subarray(64).toString('utf-8')
    if (!nonceStr) {
      return { valid: false, error: 'Empty nonce in proof' }
    }

    // Reconstruct signing input (must match agent-side construction).
    const signingInput = `aid-token-exchange\n${nonceStr}\n${serverUrl}`

    const pubKey = createPublicKey(publicKeyPem)
    const valid = verify(null, Buffer.from(signingInput), pubKey, signatureBytes)

    // Only surface the nonce when the signature verifies — the route must not
    // consume a nonce for a proof it could not authenticate.
    return valid
      ? { valid: true, nonce: nonceStr }
      : { valid: false, error: 'Ed25519 signature verification failed' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { valid: false, error: `Proof verification error: ${msg}` }
  }
}

/**
 * Verify a NONCE-bound Ed25519 proof using raw public key hex (from amp-keys
 * storage). Reconstructs PEM from the 32-byte public key hex, then delegates
 * to verifyNonceProof.
 */
export function verifyNonceProofWithPublicKeyHex(
  proofB64url: string,
  publicKeyHex: string,
  serverUrl: string
): NonceProofResult {
  try {
    // Ed25519 SPKI header (12 bytes) + raw public key (32 bytes)
    const header = Buffer.from([
      0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00
    ])
    const publicKeyBytes = Buffer.from(publicKeyHex, 'hex')
    const spkiDer = Buffer.concat([header, publicKeyBytes])

    const pubKey = createPublicKey({ key: spkiDer, format: 'der', type: 'spki' })
    const publicKeyPem = pubKey.export({ type: 'spki', format: 'pem' }) as string

    return verifyNonceProof(proofB64url, publicKeyPem, serverUrl)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { valid: false, error: `Public key reconstruction error: ${msg}` }
  }
}

// ============================================================================
// Token Issuance
// ============================================================================

/**
 * Issue a short-lived governance token after successful proof verification.
 * The token is opaque (aim_tk_<random>) — server-side validated, not JWT.
 */
export async function issueGovernanceToken(
  agentId: string,
  agentName: string,
  governanceTitle: string,
  teamId: string | null,
  scope: string = 'governance'
): Promise<TokenExchangeResult> {
  const rawToken = TOKEN_PREFIX + randomBytes(TOKEN_RANDOM_BYTES).toString('hex')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + TOKEN_LIFETIME_SECONDS * 1000)

  const record: AIDTokenRecord = {
    token_hash: hashToken(rawToken),
    agent_id: agentId,
    agent_name: agentName,
    governance_title: governanceTitle,
    team_id: teamId,
    scope,
    issued_at: now.toISOString(),
    expires_at: expiresAt.toISOString()
  }

  // Save to store (atomic under file lock) — MUST await, withLock is async
  await withLock('governance-tokens', () => {
    const tokens = loadTokens()
    // Prune expired + limit to 200 active tokens max
    const validTokens = tokens
      .filter(t => new Date(t.expires_at).getTime() > Date.now())
      .slice(-199)
    validTokens.push(record)
    saveTokens(validTokens)
  })

  return {
    access_token: rawToken,
    token_type: 'bearer',
    expires_in: TOKEN_LIFETIME_SECONDS,
    agent_id: agentId,
    governance_title: governanceTitle,
    team_id: teamId,
    scope
  }
}

/**
 * R36/R37 — issue a short-lived governance token for a human USER (users have
 * AIDs too, R36.1). Stored in the same active-tokens store but flagged
 * subject_type='user' with the user's authority title. `agent_id` carries the
 * USER id (there is no agent behind a user token); `team_id` is always null for
 * a user. Validation goes through the same validateGovernanceToken path, which
 * returns the record verbatim (callers branch on subject_type).
 */
export async function issueUserGovernanceToken(
  userId: string,
  userName: string,
  userTitle: import('@/types/user').UserTitle,
  scope: string = 'governance'
): Promise<TokenExchangeResult & { subject_type: 'user'; user_title: import('@/types/user').UserTitle }> {
  const rawToken = TOKEN_PREFIX + randomBytes(TOKEN_RANDOM_BYTES).toString('hex')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + TOKEN_LIFETIME_SECONDS * 1000)

  const record: AIDTokenRecord = {
    token_hash: hashToken(rawToken),
    agent_id: userId,
    agent_name: userName,
    governance_title: userTitle, // mirrors the title for any title-keyed consumer
    team_id: null,
    scope,
    issued_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    subject_type: 'user',
    user_title: userTitle,
  }

  await withLock('governance-tokens', () => {
    const tokens = loadTokens()
    const validTokens = tokens
      .filter(t => new Date(t.expires_at).getTime() > Date.now())
      .slice(-199)
    validTokens.push(record)
    saveTokens(validTokens)
  })

  return {
    access_token: rawToken,
    token_type: 'bearer',
    expires_in: TOKEN_LIFETIME_SECONDS,
    agent_id: userId,
    governance_title: userTitle,
    team_id: null,
    scope,
    subject_type: 'user',
    user_title: userTitle,
  }
}

// ============================================================================
// Token Validation
// ============================================================================

/**
 * Validate a governance token from an Authorization header.
 * Returns the token record if valid, null if invalid or expired.
 *
 * Uses constant-time comparison on hashes to prevent timing attacks.
 */
export function validateGovernanceToken(token: string): AIDTokenRecord | null {
  if (!token.startsWith(TOKEN_PREFIX)) return null

  const tokenHash = hashToken(token)
  // Force load + index rebuild if cache stale (also populates _tokenIndex).
  loadTokens()
  const index = _tokenIndex
  if (!index) return null
  const now = Date.now()

  // LIB2-MAJ-13: O(1) lookup by token hash. The hash is a SHA256 of the
  // input token, so map.get(tokenHash) reveals only whether that exact hash
  // exists — no information leaks about other tokens via timing. We then
  // run timingSafeEqual on the SINGLE candidate to preserve the
  // constant-time-per-request behaviour that the previous linear-scan
  // approach was simulating. (Map.get on a String hash IS constant-time
  // relative to map size in V8 / SpiderMonkey: hash bucket lookup +
  // string compare on collision; the input-derived hash means the bucket
  // accessed is fully determined by the input, leaking no information
  // about other entries.)
  const candidate = index.get(tokenHash)
  if (!candidate) return null

  // Timing-safe verification on the candidate that the index returned.
  const hashBuffer = Buffer.from(tokenHash)
  const recordHashBuffer = Buffer.from(candidate.token_hash)
  if (hashBuffer.length !== recordHashBuffer.length) return null
  try {
    if (!timingSafeEqual(hashBuffer, recordHashBuffer)) return null
  } catch {
    return null
  }

  // Expiry check
  if (new Date(candidate.expires_at).getTime() <= now) return null
  return candidate
}

/**
 * The compensation half of a bulk revocation (R51 / TRDD-DQ6XN2VP).
 *
 * `restore` is a CLOSURE over the records this call actually removed, so a pipeline can undo the
 * revocation without holding token records in its own ctx. Unlike the AMP key store this mutation
 * REMOVES rows rather than flipping a field, so the undo needs the rows themselves — which is
 * exactly why the two stores cannot share one compensation.
 */
export interface AIDTokenRevocation {
  /** How many token records this call removed. */
  count: number
  /**
   * Re-insert exactly the records this call removed. A token that EXPIRED between the revoke and
   * the restore is deliberately NOT re-inserted: `loadTokens` prunes expired rows on every load, so
   * putting it back would write a row that the next read drops — a rollback that only appears to
   * have worked. Idempotent, so it is safe to call after a partial run. Returns how many it restored.
   */
  restore: () => Promise<number>
}

/**
 * Revoke all governance tokens for a specific agent, returning a handle that can undo it.
 * Used when an agent is deleted or its title changes.
 *
 * The compensation lives HERE rather than in the caller because `loadTokens`/`saveTokens` are
 * module-private and every mutation runs under `withLock('governance-tokens')`. Exporting the
 * writers so a pipeline could snapshot-and-restore from outside would bypass that serialization —
 * a concurrency regression, not a convenience (TRDD-DQ6XN2VP).
 */
export async function revokeTokensForAgentCompensable(agentId: string): Promise<AIDTokenRevocation> {
  const removed: AIDTokenRecord[] = []
  await withLock('governance-tokens', () => {
    const tokens = loadTokens()
    const remaining = tokens.filter(t => {
      if (t.agent_id === agentId) {
        removed.push(t)
        return false
      }
      return true
    })
    // Saved unconditionally, as before: loadTokens already pruned expired rows, so this write is
    // what persists that pruning even when this agent had no tokens.
    saveTokens(remaining)
  })
  return { count: removed.length, restore: () => restoreTokens(removed) }
}

/** Re-insert the named records. Module-private: the records never leave this file. */
async function restoreTokens(records: AIDTokenRecord[]): Promise<number> {
  if (records.length === 0) return 0

  let restored = 0
  await withLock('governance-tokens', () => {
    const tokens = loadTokens()
    const present = new Set(tokens.map(t => t.token_hash))
    const now = Date.now()
    const next = [...tokens]

    for (const record of records) {
      if (present.has(record.token_hash)) continue          // already back — undo ran twice
      if (new Date(record.expires_at).getTime() <= now) continue  // expired meanwhile; see restore's doc
      next.push(record)
      restored++
    }

    if (restored > 0) saveTokens(next)
  })
  return restored
}

/**
 * Revoke all governance tokens for a specific agent.
 * Delegates to the compensable form so there is ONE implementation of the removal.
 */
export async function revokeTokensForAgent(agentId: string): Promise<number> {
  return (await revokeTokensForAgentCompensable(agentId)).count
}

/**
 * How many governance tokens this store still holds for an agent.
 *
 * Exists so a teardown POST-CONDITION can ask "does this store still claim the agent?" without
 * reaching around the module to its JSON file. `revokeTokensForAgent` returns what it removed,
 * which answers a different question — a revoke that silently did nothing returns 0 exactly like a
 * store that was already clean (TRDD-KERM18NX).
 */
export function countTokensForAgent(agentId: string): number {
  return loadTokens().filter(t => t.agent_id === agentId).length
}

/**
 * Clean up expired tokens from storage.
 */
export async function cleanupExpiredTokens(): Promise<number> {
  let cleaned = 0
  await withLock('governance-tokens', () => {
    const tokens = loadTokens()
    const now = Date.now()
    const valid = tokens.filter(t => {
      if (new Date(t.expires_at).getTime() <= now) {
        cleaned++
        return false
      }
      return true
    })
    saveTokens(valid)
  })
  return cleaned
}
