/**
 * User Session Authentication
 *
 * Browser-based session management for the web UI user.
 * User logs in with governance password → gets httpOnly session cookie.
 * Closes SF-058: "no auth headers = system-owner" bypass.
 *
 * Sessions are in-memory (Map). Server restart invalidates all sessions.
 * This is acceptable for Phase 1 — the user simply re-enters the password.
 *
 * Cookie: aim_session=<token>, HttpOnly, SameSite=Strict, Path=/
 */

import { createHash, randomBytes } from 'crypto'

// ============================================================================
// Types
// ============================================================================

interface SessionRecord {
  token_hash: string
  created_at: number   // unix ms
  expires_at: number   // unix ms
  ip?: string          // optional: source IP for audit
}

// ============================================================================
// Constants
// ============================================================================

export const SESSION_COOKIE_NAME = 'aim_session'
const SESSION_TOKEN_BYTES = 32
const SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000 // 24 hours
const MAX_SESSIONS = 50 // Prevent memory leak — oldest evicted

// ============================================================================
// In-Memory Store
// ============================================================================

const sessions = new Map<string, SessionRecord>()

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// ============================================================================
// Session Operations
// ============================================================================

/**
 * Create a new user session. Returns the raw token for the cookie.
 */
export function createSession(ip?: string): string {
  // Evict oldest if at capacity
  if (sessions.size >= MAX_SESSIONS) {
    let oldest: string | null = null
    let oldestTime = Infinity
    for (const [hash, record] of sessions) {
      if (record.created_at < oldestTime) {
        oldestTime = record.created_at
        oldest = hash
      }
    }
    if (oldest) sessions.delete(oldest)
  }

  const token = randomBytes(SESSION_TOKEN_BYTES).toString('hex')
  const now = Date.now()

  sessions.set(hashToken(token), {
    token_hash: hashToken(token),
    created_at: now,
    expires_at: now + SESSION_LIFETIME_MS,
    ip,
  })

  return token
}

/**
 * Validate a session token from the cookie.
 * Returns true if valid and not expired.
 */
export function validateSession(token: string): boolean {
  if (!token) return false

  const hash = hashToken(token)
  const record = sessions.get(hash)
  if (!record) return false

  if (Date.now() > record.expires_at) {
    sessions.delete(hash)
    return false
  }

  return true
}

/**
 * Invalidate a session (logout).
 */
export function invalidateSession(token: string): boolean {
  if (!token) return false
  const hash = hashToken(token)
  return sessions.delete(hash)
}

/**
 * Invalidate all sessions (e.g., when governance password changes).
 */
export function invalidateAllSessions(): void {
  sessions.clear()
}

/**
 * Count active (non-expired) sessions.
 */
export function activeSessionCount(): number {
  const now = Date.now()
  let count = 0
  for (const [hash, record] of sessions) {
    if (record.expires_at > now) {
      count++
    } else {
      sessions.delete(hash)
    }
  }
  return count
}

/**
 * Build Set-Cookie header value for a session token.
 */
export function buildSessionCookie(token: string, secure: boolean = false): string {
  const maxAge = Math.floor(SESSION_LIFETIME_MS / 1000)
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${maxAge}`,
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

/**
 * Build Set-Cookie header value to clear the session cookie.
 */
export function buildClearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`
}

/**
 * Extract session token from a cookie header string.
 */
export function extractSessionFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null
  const prefix = `${SESSION_COOKIE_NAME}=`
  const cookies = cookieHeader.split(';').map(c => c.trim())
  for (const cookie of cookies) {
    if (cookie.startsWith(prefix)) {
      return cookie.substring(prefix.length) || null
    }
  }
  return null
}
