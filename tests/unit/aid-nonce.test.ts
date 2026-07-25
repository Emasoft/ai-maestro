/**
 * Unit tests for the AID PoP challenge-nonce store (TRDD-15ff13ae).
 *
 * These prove the anti-replay contract of lib/aid-nonce.ts directly:
 * single-use (a replay is rejected), short-TTL expiry, subject binding
 * (authz-hole pattern 5), and fail-closed capacity.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  issueNonce,
  consumeNonce,
  nonceStoreSize,
  __resetNonceStoreForTests,
} from '@/lib/aid-nonce'

const FP = 'SHA256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const OTHER_FP = 'SHA256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

beforeEach(() => {
  __resetNonceStoreForTests()
})

describe('aid-nonce store — happy path', () => {
  it('issues a bound nonce and consumes it exactly once', () => {
    const issued = issueNonce(FP)
    expect(issued).not.toBeNull()
    expect(issued!.nonce).toMatch(/^[0-9a-f]{64}$/) // 32 random bytes as hex
    expect(issued!.expires_in).toBe(30)
    expect(nonceStoreSize()).toBe(1)

    const result = consumeNonce(issued!.nonce, FP)
    expect(result.ok).toBe(true)
    // consumed → removed from the store
    expect(nonceStoreSize()).toBe(0)
  })
})

describe('aid-nonce store — single-use / anti-replay (the core property)', () => {
  it('rejects a REPLAYED consume of the same nonce', () => {
    const issued = issueNonce(FP)!
    const first = consumeNonce(issued.nonce, FP)
    expect(first.ok).toBe(true)

    // Replay: the exact same nonce+fingerprint the second time.
    const replay = consumeNonce(issued.nonce, FP)
    expect(replay).toEqual({ ok: false, reason: 'unknown' })
  })

  it('rejects a nonce that was never issued', () => {
    const result = consumeNonce('deadbeef'.repeat(8), FP)
    expect(result).toEqual({ ok: false, reason: 'unknown' })
  })
})

describe('aid-nonce store — subject binding (authz-hole pattern 5)', () => {
  it('rejects a consume presenting a DIFFERENT fingerprint than the binding', () => {
    const issued = issueNonce(FP)!
    const result = consumeNonce(issued.nonce, OTHER_FP)
    expect(result).toEqual({ ok: false, reason: 'fingerprint_mismatch' })
  })

  it('consumes-on-find even on mismatch, so the nonce cannot then be reused by the right fingerprint', () => {
    const issued = issueNonce(FP)!
    // Wrong fingerprint burns the nonce (consume-on-find single-use).
    expect(consumeNonce(issued.nonce, OTHER_FP).ok).toBe(false)
    // The correct fingerprint now finds nothing — no second chance.
    expect(consumeNonce(issued.nonce, FP)).toEqual({ ok: false, reason: 'unknown' })
  })

  it('rejects an empty presented fingerprint against a bound nonce', () => {
    const issued = issueNonce(FP)!
    expect(consumeNonce(issued.nonce, '')).toEqual({ ok: false, reason: 'fingerprint_mismatch' })
  })
})

describe('aid-nonce store — TTL expiry', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('rejects a nonce consumed after its 30s TTL', () => {
    const issued = issueNonce(FP)!
    vi.advanceTimersByTime(30_001) // just past the 30s window
    const result = consumeNonce(issued.nonce, FP)
    expect(result).toEqual({ ok: false, reason: 'expired' })
  })

  it('still accepts a nonce consumed within the TTL', () => {
    const issued = issueNonce(FP)!
    vi.advanceTimersByTime(29_000)
    expect(consumeNonce(issued.nonce, FP).ok).toBe(true)
  })

  it('prunes expired nonces on the next issue (bounded memory)', () => {
    issueNonce(FP)
    issueNonce(FP)
    expect(nonceStoreSize()).toBe(2)
    vi.advanceTimersByTime(30_001)
    // A fresh issue prunes the two expired ones first, leaving only the new one.
    issueNonce(FP)
    expect(nonceStoreSize()).toBe(1)
  })
})

describe('aid-nonce store — fail-closed capacity', () => {
  it('refuses new issuance (returns null) once the hard cap is reached, without evicting live nonces', () => {
    // Cap is 10_000. Fill it; the next issue must fail closed (null), never
    // evict a legitimate just-issued nonce.
    // The per-iteration assertion was `expect(last).not.toBeNull()` INSIDE the loop — 10_000
    // expect() calls, each building a matcher context, which pushed the test past the 5s default
    // and made it fail under any concurrent load while passing on an idle machine. Same guarantee,
    // counted instead: a flaky gate is worse than no gate, because it trains people to re-run.
    let last: { nonce: string; expires_in: number } | null = null
    let refusedDuringFill = 0
    for (let i = 0; i < 10_000; i++) {
      last = issueNonce(FP)
      if (last === null) refusedDuringFill++
    }
    expect(refusedDuringFill).toBe(0)
    expect(nonceStoreSize()).toBe(10_000)
    const overflow = issueNonce(FP)
    expect(overflow).toBeNull()
    // The last legitimately-issued nonce is still consumable — not evicted.
    expect(consumeNonce(last!.nonce, FP).ok).toBe(true)
    // 30s, not the 5s default: filling the real 10_000 cap IS the test, so the cost is inherent.
    // It runs in ~2s alone and still lost the 5s budget when the full suite runs it in parallel —
    // an outcome that depends on machine load is not a gate. Do NOT "fix" this by shrinking the
    // cap: a fail-closed capacity test that never reaches capacity tests nothing.
  }, 30_000)
})
