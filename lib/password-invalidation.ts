/**
 * Brute-force throttling and the PIN challenge for password invalidation.
 *
 * TRDD-P7XKV3N9.
 *
 * Every other route takes a TOKEN. This one takes the SECRET ITSELF as its
 * input, and by design it is reachable from every device on the Tailscale VPN.
 * "Without the password they cannot do anything" is only true if they cannot
 * GUESS it at line rate — with no backoff, a caller on the VPN gets unlimited
 * free attempts against the master credential, and the endpoint built to protect
 * that credential becomes the thing that exposes it.
 *
 * State is in-memory ON PURPOSE. A restart clears the throttle, but a restart is
 * not something an unauthenticated remote caller can cause; and persisting a
 * lockout would hand that same caller a denial-of-service against the owner
 * (spam failures from a spoofed source, lock the owner out durably). Memory is
 * the right trade: it slows the attacker who is here now, and it cannot be used
 * to lock out the person who is.
 */
import { randomUUID, timingSafeEqual } from 'crypto'

/** Failures before the first delay. A typo should not cost the owner a wait. */
const FREE_ATTEMPTS = 3
/** Doubling from 1s; capped so a long-running attack cannot pin a huge timer. */
const BASE_DELAY_MS = 1_000
const MAX_DELAY_MS = 5 * 60_000
/** A quiet period resets the counter — an honest user comes back later. */
const RESET_AFTER_MS = 15 * 60_000

/** A PIN is only useful for as long as it takes to walk to the keyboard. */
const PIN_TTL_MS = 2 * 60_000

interface Attempts {
  failures: number
  lastFailureAt: number
}

interface Challenge {
  pin: string
  createdAt: number
  /** The peer that asked for it. A PIN issued to the console is not transferable. */
  peer: string
}

const attempts = new Map<string, Attempts>()
const challenges = new Map<string, Challenge>()

/** ms the caller must still wait, or 0 if they may try now. */
export function throttleDelayMs(key: string, now = Date.now()): number {
  const a = attempts.get(key)
  if (!a) return 0
  if (now - a.lastFailureAt > RESET_AFTER_MS) {
    attempts.delete(key)
    return 0
  }
  if (a.failures <= FREE_ATTEMPTS) return 0
  const backoff = Math.min(BASE_DELAY_MS * 2 ** (a.failures - FREE_ATTEMPTS - 1), MAX_DELAY_MS)
  const elapsed = now - a.lastFailureAt
  return Math.max(0, backoff - elapsed)
}

export function recordFailure(key: string, now = Date.now()): void {
  const a = attempts.get(key)
  if (!a || now - a.lastFailureAt > RESET_AFTER_MS) {
    attempts.set(key, { failures: 1, lastFailureAt: now })
    return
  }
  attempts.set(key, { failures: a.failures + 1, lastFailureAt: now })
}

export function recordSuccess(key: string): void {
  attempts.delete(key)
}

/** Issue a single-use PIN challenge bound to the peer that asked for it. */
export function createChallenge(pin: string, peer: string, now = Date.now()): string {
  const id = randomUUID()
  challenges.set(id, { pin, createdAt: now, peer })
  return id
}

export type PinResult = 'ok' | 'expired' | 'wrong' | 'unknown' | 'wrong-peer'

/**
 * Consume a challenge. SINGLE USE in every outcome except `unknown`/`expired`:
 * a wrong PIN destroys the challenge, so an attacker gets ONE guess at a
 * 6-digit code per password-verified request, not a million.
 */
export function consumeChallenge(id: string, pin: string, peer: string, now = Date.now()): PinResult {
  const c = challenges.get(id)
  if (!c) return 'unknown'
  if (now - c.createdAt > PIN_TTL_MS) {
    challenges.delete(id)
    return 'expired'
  }
  // A PIN issued to the console cannot be redeemed from elsewhere. Without this,
  // a PIN shoulder-surfed (or read off a screen-share) is usable remotely.
  if (c.peer !== peer) {
    challenges.delete(id)
    return 'wrong-peer'
  }
  challenges.delete(id) // consumed either way — see the doc comment above.
  const a = Buffer.from(c.pin)
  const b = Buffer.from(pin)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return 'wrong'
  return 'ok'
}

/** Test seam only. */
export function __resetInvalidationState(): void {
  attempts.clear()
  challenges.clear()
}
