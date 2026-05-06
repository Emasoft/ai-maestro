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
  } catch {
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
 * Revoke all governance tokens for a specific agent.
 * Used when agent is deleted or title changes.
 */
export async function revokeTokensForAgent(agentId: string): Promise<number> {
  let revoked = 0
  await withLock('governance-tokens', () => {
    const tokens = loadTokens()
    const remaining = tokens.filter(t => {
      if (t.agent_id === agentId) {
        revoked++
        return false
      }
      return true
    })
    saveTokens(remaining)
  })
  return revoked
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
