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

function loadTokens(): AIDTokenRecord[] {
  const now = Date.now()
  if (_tokenCache && (now - _tokenCacheTimestamp) < TOKEN_CACHE_TTL_MS) {
    return _tokenCache
  }

  ensureTokensDir()
  const filePath = tokensFilePath()
  if (!fs.existsSync(filePath)) {
    _tokenCache = []
    _tokenCacheTimestamp = now
    return []
  }

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    const tokens = Array.isArray(data) ? data as AIDTokenRecord[] : []
    // Prune expired tokens on load
    const validTokens = tokens.filter(t => new Date(t.expires_at).getTime() > now)
    _tokenCache = validTokens
    _tokenCacheTimestamp = now
    return validTokens
  } catch {
    _tokenCache = []
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
  const tokens = loadTokens()
  const now = Date.now()

  // Iterate all tokens (constant-time pattern — don't short-circuit on hash match
  // to prevent timing side-channel, same pattern as amp-auth.ts)
  let matched: AIDTokenRecord | null = null
  const hashBuffer = Buffer.from(tokenHash)

  for (const record of tokens) {
    const recordHashBuffer = Buffer.from(record.token_hash)
    if (hashBuffer.length === recordHashBuffer.length) {
      try {
        const isMatch = timingSafeEqual(hashBuffer, recordHashBuffer)
        if (isMatch && new Date(record.expires_at).getTime() > now) {
          matched = record
        }
      } catch {
        // Length mismatch — not a match
      }
    }
  }

  return matched
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
