/**
 * User Session Authentication
 *
 * Browser-based session management for the web UI user.
 * User logs in with governance password → gets httpOnly session cookie.
 * Closes SF-058: "no auth headers = system-owner" bypass.
 *
 * Sessions are in-memory (Map). `pm2 restart` invalidates all sessions (security measure).
 * `pm2 start` after `pm2 stop` also starts fresh — this is by design.
 * Sessions expire on explicit logout or after 7 days (safety measure).
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
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000 // 7 days — expires on logout or after this
const MAX_SESSIONS = 50 // Prevent memory leak — oldest evicted

// ============================================================================
// In-Memory Store (cleared on server restart — security measure)
// ============================================================================
//
// HMR note: Next.js dev-mode hot module replacement re-evaluates this file
// on every save, which would reset `sessions` to an empty Map and force the
// user to log in again after every file edit. To survive HMR we attach the
// Map to `globalThis` — the global is preserved across module re-evaluations
// in the same Node process. On actual server restart (pm2 restart), the
// Node process is killed and `globalThis` is wiped, so the original
// "sessions cleared on restart" security posture is preserved.

interface SessionGlobals {
  __aiMaestroSessionsMap?: Map<string, SessionRecord>
  __aiMaestroSessionMutex?: Promise<void>
}
const g = globalThis as unknown as SessionGlobals

const sessions: Map<string, SessionRecord> =
  g.__aiMaestroSessionsMap ?? new Map<string, SessionRecord>()
if (!g.__aiMaestroSessionsMap) g.__aiMaestroSessionsMap = sessions

// In-memory mutex: serializes createSession to prevent concurrent calls from
// exceeding MAX_SESSIONS. Works as a Promise chain — each call awaits the
// previous one before proceeding. This is necessary because eviction check +
// insert is a non-atomic read-then-write on the shared Map.
let sessionMutex: Promise<void> = g.__aiMaestroSessionMutex ?? Promise.resolve()
// Keep the mutex global-linked so HMR doesn't create a fresh chain
// underneath an in-flight createSession.
Object.defineProperty(g, '__aiMaestroSessionMutex', {
  get: () => sessionMutex,
  set: (v: Promise<void>) => { sessionMutex = v },
  configurable: true,
})

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// ============================================================================
// Session Operations
// ============================================================================

/**
 * Create a new user session. Returns the raw token for the cookie.
 *
 * Serialized via in-memory mutex to prevent race conditions where concurrent
 * calls both pass the MAX_SESSIONS check and both insert, exceeding the limit.
 */
export async function createSession(ip?: string): Promise<string> {
  // Chain onto the mutex so only one createSession runs at a time
  const result = new Promise<string>((resolve, reject) => {
    sessionMutex = sessionMutex.then(() => {
      try {
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

        resolve(token)
      } catch (err) {
        reject(err)
      }
    })
  })

  return result
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
