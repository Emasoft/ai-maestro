/**
 * Simple in-memory rate limiter for governance password operations.
 * Tracks failed attempts per key with a fixed time window.
 * Phase 1 only — no distributed state needed for localhost.
 *
 * LIB2-MIN-06: PROCESS-LOCAL ONLY. The `limits` Map lives in this module's
 * scope, so each Node.js process has its own counter. If AI Maestro is
 * deployed in PM2 cluster mode (multiple worker processes), an attacker
 * who rotates connections between workers gets `N * limit` total
 * attempts where N = worker count. PM2 sticky-session balancing reduces
 * this in practice (a given IP usually hits the same worker), but is
 * not a security guarantee.
 *
 * For Phase 2 (multi-process deployments): migrate to a shared store
 * (Redis SETEX/INCR pattern, Postgres counter table, or PM2's IPC
 * pubsub). This module's interface (checkRateLimit, recordAttempt,
 * resetRateLimit, checkAndRecordAttempt) should be preserved so callers
 * don't change.
 *
 * `lib/file-lock.ts` documents the same Phase-1 limitation; both
 * subsystems would need to migrate together.
 */

const limits = new Map<string, { count: number; resetAt: number }>()

const DEFAULT_MAX_ATTEMPTS = 5
const DEFAULT_WINDOW_MS = 60_000 // 1 minute

/** Check if the rate limit allows another attempt */
export function checkRateLimit(
  key: string,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
  windowMs: number = DEFAULT_WINDOW_MS
): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now()
  const entry = limits.get(key)

  // Window expired -- reset
  if (entry && now >= entry.resetAt) {
    limits.delete(key)
    return { allowed: true, retryAfterMs: 0 }
  }

  // Check if over limit
  if (entry && entry.count >= maxAttempts) {
    return { allowed: false, retryAfterMs: entry.resetAt - now }
  }

  return { allowed: true, retryAfterMs: 0 }
}

/**
 * Record an attempt against the rate limiter.
 * Called on every attempt (not just failures) when used with checkAndRecordAttempt.
 * Callers using the separate check/record pattern may call this only on failure.
 * Renamed from recordFailure to recordAttempt (MF-023) to clarify that
 * checkAndRecordAttempt records ALL attempts, and callers reset on success.
 */
export function recordAttempt(key: string, windowMs: number = DEFAULT_WINDOW_MS): void {
  let entry = limits.get(key)
  const now = Date.now()
  // Reset expired windows so stale counts are not reused
  if (entry && now >= entry.resetAt) { entry = undefined; limits.delete(key) }
  const fresh = entry || { count: 0, resetAt: now + windowMs }
  limits.set(key, { count: fresh.count + 1, resetAt: fresh.resetAt })
  checkCap()
}

/**
 * NT-006 / MF-023: Atomic check-and-record for rate limiting.
 * Checks limit AND records the attempt in one synchronous call,
 * eliminating the window between separate check/record calls.
 *
 * Records on EVERY allowed attempt (not just failures). Callers MUST call
 * resetRateLimit(key) on success to avoid exhausting the allowance.
 * This is the standard "count attempts, reset on success" pattern for auth.
 */
export function checkAndRecordAttempt(
  key: string,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
  windowMs: number = DEFAULT_WINDOW_MS
): { allowed: boolean; retryAfterMs: number } {
  const result = checkRateLimit(key, maxAttempts, windowMs)
  if (result.allowed) {
    // Record every allowed attempt; callers reset on success via resetRateLimit()
    recordAttempt(key, windowMs)
  }
  return result
}

// SF-058: Deprecated recordFailure alias removed -- all callers now use recordAttempt directly

/** Reset rate limit on successful attempt */
export function resetRateLimit(key: string): void {
  limits.delete(key)
}

// Hard cap: if Map exceeds this size, evict oldest entries immediately.
// Prevents DoS via unique keys (e.g., per-IP rate limit keys from a botnet).
const MAX_RATE_LIMIT_ENTRIES = 10_000

function sweepAndCap(): void {
  const now = Date.now()
  for (const [key, entry] of limits) {
    if (now >= entry.resetAt) limits.delete(key)
  }
  // If still over cap after sweeping expired, evict oldest
  if (limits.size > MAX_RATE_LIMIT_ENTRIES) {
    const sorted = [...limits.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt)
    const toEvict = sorted.slice(0, limits.size - MAX_RATE_LIMIT_ENTRIES)
    for (const [key] of toEvict) limits.delete(key)
  }
}

// Periodic cleanup — 5 min interval
// Guard: skip in test to avoid vitest "open handles" warnings
if (typeof setInterval !== 'undefined' && process.env.NODE_ENV !== 'test') {
  setInterval(sweepAndCap, 5 * 60_000).unref()
}

// Inline cap check called on every record to prevent unbounded growth between sweeps
function checkCap(): void {
  if (limits.size > MAX_RATE_LIMIT_ENTRIES) sweepAndCap()
}
