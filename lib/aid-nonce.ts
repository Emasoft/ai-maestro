/**
 * AID Proof-of-Possession Challenge Nonces (TRDD-15ff13ae)
 *
 * Server-issued, single-use nonces that replace the old replayable
 * timestamp-window as the anti-replay mechanism for AID token exchange
 * (POST /api/v1/auth/token).
 *
 * WHY this exists — the previous proof signed
 *   "aid-token-exchange\n{client-chosen timestamp}\n{server_url}"
 * and the ONLY anti-replay was a ±300s drift window. A passively-captured
 * proof could be POSTed to /api/v1/auth/token repeatedly for up to 300s,
 * each call minting a fresh 1h governance token for that agent
 * (replay-amplification). Binding the proof to a server-issued single-use
 * nonce closes that window: once the first exchange consumes the nonce, any
 * replay of the same proof references an already-consumed nonce and is
 * rejected.
 *
 * SECURITY properties (all fail-closed):
 * - Single-use: consumeNonce() DELETES the nonce on first lookup (even on the
 *   failure branches), so a nonce can never be honoured twice. Node.js runs JS
 *   single-threaded, so the get()+delete() pair is atomic against any other
 *   in-flight request — this is what prevents a concurrent double-spend of the
 *   same valid proof.
 * - Subject-bound (authz-hole pattern 5 — "one-shot token bound to
 *   operation+subject"): each nonce is bound at issue time to the CLAIMED AID
 *   fingerprint. consumeNonce() requires the presented fingerprint to match
 *   (constant-time). The nonce is bound to the operation via the signing-input
 *   prefix "aid-token-exchange" enforced by the verifier. A nonce issued for
 *   agent A therefore cannot be consumed while presenting identity B.
 * - Short TTL: a nonce expires NONCE_TTL_MS after issue; an expired nonce is
 *   rejected at consume time and pruned.
 * - Bounded memory: issuance is capped at NONCE_STORE_CAP live nonces and
 *   refuses (returns null → the route fails closed) rather than evicting a
 *   legitimate just-issued nonce. Expired entries are pruned on every issue.
 *
 * PHASE-1 limitation (identical posture to lib/rate-limit.ts): this store is
 * PROCESS-LOCAL and in-memory. Under a PM2 cluster (multiple worker
 * processes) a nonce issued by worker A is invisible to worker B, so a token
 * exchange that lands on a different worker than its challenge would fail and
 * the client must retry. The AI Maestro dashboard runs as a single process
 * (`pm2 restart ai-maestro`), so this is not a concern today. A Phase-2
 * multi-process deployment must migrate this store (and lib/rate-limit.ts)
 * to a shared backend (Redis SETEX/GETDEL, etc.); the issue/consume interface
 * here is designed to survive that migration unchanged.
 */

import { randomBytes, timingSafeEqual } from 'crypto'

// 30s freshness window — long enough for a client to sign+POST across a slow
// link, short enough that a leaked-but-unused nonce self-expires quickly.
const NONCE_TTL_MS = 30_000
// 256-bit random → 64 lowercase-hex chars. Hex keeps the value safe to embed
// verbatim in the proof payload and in shell (no base64url +/-_ ambiguity).
const NONCE_RANDOM_BYTES = 32
// Hard ceiling on simultaneously-live nonces. With the 30s TTL and the
// challenge-route rate limits, this is practically unreachable; it exists so a
// bug or a rate-limit gap can never exhaust process memory.
const NONCE_STORE_CAP = 10_000

interface NonceRecord {
  /** authz-hole pattern 5: the AID fingerprint this nonce is bound to. */
  fingerprint: string
  /** ms epoch at which this nonce is no longer valid. */
  expiresAt: number
}

// Process-local store. Key = the nonce value itself.
const store = new Map<string, NonceRecord>()

/** Drop every expired entry. Called opportunistically on each issue. */
function pruneExpired(now: number): void {
  for (const [nonce, rec] of store) {
    if (rec.expiresAt <= now) store.delete(nonce)
  }
}

/**
 * Issue a fresh single-use nonce bound to `fingerprint`.
 *
 * Returns null when the store is at capacity (fail-closed: the caller must
 * surface an error rather than proceed without a nonce). We refuse rather than
 * evict so a flood cannot displace a legitimate agent's just-issued nonce.
 */
export function issueNonce(fingerprint: string): { nonce: string; expires_in: number } | null {
  const now = Date.now()
  pruneExpired(now)
  if (store.size >= NONCE_STORE_CAP) return null
  const nonce = randomBytes(NONCE_RANDOM_BYTES).toString('hex')
  store.set(nonce, { fingerprint, expiresAt: now + NONCE_TTL_MS })
  return { nonce, expires_in: Math.floor(NONCE_TTL_MS / 1000) }
}

export type NonceConsumeResult =
  | { ok: true }
  | { ok: false; reason: 'unknown' | 'expired' | 'fingerprint_mismatch' }

/**
 * Atomically consume a nonce for a token exchange.
 *
 * Single-use is guaranteed by deleting the record the moment it is found —
 * BEFORE the expiry/binding checks — so no code path can honour the same nonce
 * twice, and a concurrent second request for the same nonce sees `unknown`.
 * Because JS is single-threaded, the get()+delete() below is an atomic
 * critical section against every other in-flight request.
 *
 * The caller MUST have already cryptographically verified the proof (Ed25519
 * over this nonce) before calling this — authenticate-before-consume — so a
 * caller who cannot produce a valid proof never reaches this and cannot burn
 * nonces.
 */
export function consumeNonce(nonce: string, fingerprint: string): NonceConsumeResult {
  const now = Date.now()
  const rec = store.get(nonce)
  if (!rec) return { ok: false, reason: 'unknown' }
  // Consume-on-find: delete immediately so the nonce is single-use even on the
  // rejection branches below. A replayed request for the same nonce will find
  // nothing and get 'unknown'.
  store.delete(nonce)
  if (rec.expiresAt <= now) return { ok: false, reason: 'expired' }
  // Constant-time fingerprint comparison (subject binding). Length-guard first
  // because timingSafeEqual throws on unequal-length buffers.
  const bound = Buffer.from(rec.fingerprint, 'utf-8')
  const presented = Buffer.from(fingerprint, 'utf-8')
  if (bound.length !== presented.length) return { ok: false, reason: 'fingerprint_mismatch' }
  if (!timingSafeEqual(bound, presented)) return { ok: false, reason: 'fingerprint_mismatch' }
  return { ok: true }
}

/** Number of live (issued-and-not-yet-consumed) nonces. Test/observability only. */
export function nonceStoreSize(): number {
  return store.size
}

/** Clear the store. TEST-ONLY — used by unit tests to isolate cases. */
export function __resetNonceStoreForTests(): void {
  store.clear()
}
