/**
 * Session Secrets — Server-Issued AID Session Tokens for Local Agents
 *
 * The AI Maestro server spawns each agent's tmux session, making it the
 * sole authority on agent identity for local (same-host) processes.
 * Instead of requiring agents to prove identity via Ed25519 ceremonies,
 * the server generates a secret at session launch and sets it as a tmux
 * env var ($AID_AUTH). The agent reads it and sends it with API requests.
 *
 * Token format: mst_<64 hex chars>  (kept for backwards compatibility)
 * Env var: AID_AUTH (was MAESTRO_AUTH — renamed to clarify this is
 *          Agent Identity auth, not dashboard user auth)
 * Storage: SHA-256 hash in agent registry metadata.sessionSecretHash
 * Scope: per-session, dies when session is killed/restarted
 *
 * For remote agents (cross-host via Tailscale): AID proof-of-possession
 * is still required since the server doesn't control the remote process.
 */

import { createHash, randomBytes, timingSafeEqual } from 'crypto'

// ============================================================================
// Constants
// ============================================================================

const TOKEN_PREFIX = 'mst_'
const TOKEN_RANDOM_BYTES = 32 // 64 hex chars

// ============================================================================
// Generation
// ============================================================================

/**
 * Generate a new session secret for an agent.
 * Returns { secret, secretHash } — secret goes to the agent via env var,
 * hash goes to the agent registry for validation.
 */
export function generateSessionSecret(): { secret: string; secretHash: string } {
  const secret = TOKEN_PREFIX + randomBytes(TOKEN_RANDOM_BYTES).toString('hex')
  const secretHash = hashSecret(secret)
  return { secret, secretHash }
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate a session secret against the stored hash.
 * Uses constant-time comparison to prevent timing attacks.
 */
export function validateSessionSecret(secret: string, storedHash: string): boolean {
  if (!secret || !storedHash) return false
  if (!secret.startsWith(TOKEN_PREFIX)) return false

  const computedHash = hashSecret(secret)
  const a = Buffer.from(computedHash)
  const b = Buffer.from(storedHash)
  if (a.length !== b.length) return false

  return timingSafeEqual(a, b)
}

/**
 * Check if a token string is a session secret (mst_ prefix).
 */
export function isSessionSecret(token: string): boolean {
  return token.startsWith(TOKEN_PREFIX)
}

// ============================================================================
// Hashing
// ============================================================================

function hashSecret(secret: string): string {
  return 'sha256:' + createHash('sha256').update(secret).digest('hex')
}
