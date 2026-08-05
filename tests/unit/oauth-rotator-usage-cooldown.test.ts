// 429 back-off + TTL cache for the /usage probe — TRDD-W4T70Y3R.
//
// 0-IMPACT by construction: every test injects BOTH a stub `fetchImpl` (no real HTTP) AND an
// in-memory `cooldownStore` (no real state dir). Without the second injection a test that drives
// a 429 would write the DEVELOPER'S machine-wide rotator state — the probe's default store is
// file-backed and deliberately so.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { usageProbe, usageRequest } from '@/lib/oauth-rotator/network'
import {
  backoffMs,
  classify429,
  parseResetHeader,
  parseRetryAfter,
  serverRetryAtMs,
  BACKOFF_BASE_MS,
  BACKOFF_CAP_MS,
  USAGE_TTL_MS,
  type CooldownEntry,
} from '@/lib/oauth-rotator/usage-cooldown'

const withTok = () => ({ claudeAiOauth: { accessToken: 'tok' } })

/** In-memory replacement for the file-backed cooldown store. */
function memStore(initial: Record<string, CooldownEntry> = {}) {
  let data = structuredClone(initial)
  return {
    read: () => structuredClone(data),
    write: (d: Record<string, CooldownEntry>) => {
      data = structuredClone(d)
    },
    peek: () => data,
  }
}

/** A fetch stub that counts calls, so "did NOT hit the network" is assertable rather than assumed. */
function countingFetch(status: number, jsonData: unknown = {}, headers: Record<string, string> = {}) {
  const calls: string[] = []
  const impl = (async (url: unknown) => {
    calls.push(String(url))
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(headers),
      json: async () => jsonData,
    }
  }) as unknown as typeof fetch
  return { impl, calls }
}

/** A pass-through lock — a unit test has no second process to contend with. */
const passThroughLock = async <T,>(fn: () => Promise<T>): Promise<T | null> => fn()

const NOW = 1_800_000_000_000 // fixed epoch ms so back-off arithmetic is exact

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('header parsing — both encodings, because servers emit both', () => {
  it('parseRetryAfter reads delta-seconds', () => {
    expect(parseRetryAfter('120', NOW)).toBe(NOW + 120_000)
  })

  it('parseRetryAfter reads an HTTP-date', () => {
    const when = 'Wed, 21 Oct 2026 07:28:00 GMT'
    expect(parseRetryAfter(when, NOW)).toBe(Date.parse(when))
  })

  it('parseRetryAfter does NOT read a bare number as a year', () => {
    // `Date.parse('120')` yields the year 120 — a negative epoch. The all-digits branch exists
    // precisely so a 2-minute wait is never parsed as a date 1900 years in the past.
    const got = parseRetryAfter('120', NOW)
    expect(got).toBeGreaterThan(NOW)
  })

  it('parseRetryAfter returns null for absent or unparseable values', () => {
    expect(parseRetryAfter(undefined, NOW)).toBeNull()
    expect(parseRetryAfter('', NOW)).toBeNull()
    expect(parseRetryAfter('not-a-date', NOW)).toBeNull()
  })

  it('parseResetHeader reads epoch SECONDS, not milliseconds', () => {
    const secs = Math.floor(NOW / 1000) + 300
    expect(parseResetHeader(String(secs), NOW)).toBe(secs * 1000)
  })

  it('parseResetHeader reads ISO 8601', () => {
    const iso = new Date(NOW + 600_000).toISOString()
    expect(parseResetHeader(iso, NOW)).toBe(NOW + 600_000)
  })

  it('parseResetHeader rejects a millisecond value pasted into a seconds field', () => {
    // Read as seconds this lands ~50 000 years out. The sanity bound is what stops a
    // typo becoming a permanent cooldown.
    expect(parseResetHeader(String(NOW), NOW)).toBeNull()
  })
})

describe('serverRetryAtMs — precedence', () => {
  it('Retry-After wins over the reset headers', () => {
    const got = serverRetryAtMs(
      {
        'retry-after': '60',
        'anthropic-ratelimit-unified-reset': String(Math.floor(NOW / 1000) + 9999),
      },
      NOW,
    )
    expect(got).toBe(NOW + 60_000)
  })

  it('falls through the reset headers in their stated order', () => {
    const got = serverRetryAtMs(
      { 'anthropic-ratelimit-requests-reset': String(Math.floor(NOW / 1000) + 30) },
      NOW,
    )
    expect(got).toBe((Math.floor(NOW / 1000) + 30) * 1000)
  })

  it('returns null when the response named no instant', () => {
    expect(serverRetryAtMs({}, NOW)).toBeNull()
    expect(serverRetryAtMs(undefined, NOW)).toBeNull()
  })
})

describe('backoffMs — doubles per consecutive 429, capped', () => {
  it('starts at the base and doubles', () => {
    expect(backoffMs(1)).toBe(BACKOFF_BASE_MS)
    expect(backoffMs(2)).toBe(BACKOFF_BASE_MS * 2)
    expect(backoffMs(3)).toBe(BACKOFF_BASE_MS * 4)
  })

  it('caps rather than growing without bound', () => {
    expect(backoffMs(50)).toBe(BACKOFF_CAP_MS)
    // A corrupted counter must not produce Infinity and a permanent cooldown.
    expect(Number.isFinite(backoffMs(10_000))).toBe(true)
  })
})

describe('classify429 — the split the card exists for', () => {
  it('a named retry instant means THROTTLE', () => {
    expect(classify429({ 'retry-after': '60' }, undefined)).toBe('throttle_429')
  })

  it('a first, header-less 429 keeps todays meaning: QUOTA', () => {
    expect(classify429({}, undefined)).toBe('quota_429')
  })

  it('a BARE REPEAT after a quota 429 is still QUOTA, not an escalation', () => {
    // A maxed account stays maxed; its second header-less 429 is the same fact reported twice.
    // Reading that as a throttle would make a genuinely exhausted account report "unknown".
    expect(classify429({}, { lastKind: 'quota_429' })).toBe('quota_429')
  })

  it('a 429 that follows a THROTTLE is still a throttle', () => {
    expect(classify429({}, { lastKind: 'throttle_429' })).toBe('throttle_429')
  })
})

describe('usageProbe — quota and throttle produce DIFFERENT rotator-visible outcomes', () => {
  it('a quota 429 surfaces as 429 — the rotator still learns the account is maxed', async () => {
    const store = memStore()
    const { impl } = countingFetch(429)
    const r = await usageProbe(withTok(), { fetchImpl: impl, cooldownStore: store, probeLock: passThroughLock }, { accountKey: 'a@x' })
    expect(r.status).toBe(429)
    expect(r.reason).toBe('quota_429')
  })

  it('a throttle 429 NEVER surfaces as 429 — it serves the cached reading, staleness surfaced', async () => {
    const store = memStore({
      'a@x': { consecutive429: 0, cooldownUntilMs: 0, cachedAtMs: NOW - 60_000, cachedData: { five_hour: { utilization: 42 } } },
    })
    const { impl } = countingFetch(429, {}, { 'retry-after': '300' })
    const r = await usageProbe(withTok(), { fetchImpl: impl, cooldownStore: store, probeLock: passThroughLock }, { accountKey: 'a@x' })
    expect(r.status).toBe(200)
    expect(r.reason).toBe('throttle_429')
    expect(r.data).toEqual({ five_hour: { utilization: 42 } })
    expect(r.ageMs).toBe(60_000) // the staleness is REPORTED, not rendered as live
    expect(r.retryAtMs).toBe(NOW + 300_000) // the server's instant, not the exponential
  })

  it('a throttle 429 with NO usable cache is unknown (0), never 429', async () => {
    const store = memStore()
    const { impl } = countingFetch(429, {}, { 'retry-after': '300' })
    const r = await usageProbe(withTok(), { fetchImpl: impl, cooldownStore: store, probeLock: passThroughLock }, { accountKey: 'a@x' })
    expect(r.status).toBe(0)
    expect(r.reason).toBe('throttle_429')
  })

  it('a cached reading OLDER than the TTL is not served', async () => {
    const store = memStore({
      'a@x': { consecutive429: 0, cooldownUntilMs: 0, cachedAtMs: NOW - USAGE_TTL_MS - 1, cachedData: { stale: true } },
    })
    const { impl } = countingFetch(429, {}, { 'retry-after': '300' })
    const r = await usageProbe(withTok(), { fetchImpl: impl, cooldownStore: store, probeLock: passThroughLock }, { accountKey: 'a@x' })
    expect(r.status).toBe(0)
    expect(r.data).toBeNull()
  })
})

describe('usageProbe — the back-off actually stops the knocking', () => {
  it('during a QUOTA cooldown it answers 429 WITHOUT hitting the network', async () => {
    // This is the property that keeps `autoRotate`'s two-strike rule working while the
    // 60-knocks-an-hour stop: suppressing the probe must not suppress the answer.
    const store = memStore({
      'a@x': { consecutive429: 1, cooldownUntilMs: NOW + 60_000, lastKind: 'quota_429' },
    })
    const { impl, calls } = countingFetch(200, { fresh: true })
    const r = await usageProbe(withTok(), { fetchImpl: impl, cooldownStore: store, probeLock: passThroughLock }, { accountKey: 'a@x' })
    expect(r.status).toBe(429)
    expect(r.reason).toBe('quota_429')
    expect(calls).toHaveLength(0)
  })

  it('during a THROTTLE cooldown it does not hit the network either', async () => {
    const store = memStore({
      'a@x': { consecutive429: 2, cooldownUntilMs: NOW + 60_000, lastKind: 'throttle_429' },
    })
    const { impl, calls } = countingFetch(200, { fresh: true })
    const r = await usageProbe(withTok(), { fetchImpl: impl, cooldownStore: store, probeLock: passThroughLock }, { accountKey: 'a@x' })
    expect(r.reason).toBe('cooldown')
    expect(calls).toHaveLength(0)
  })

  it('the exponential is used only when the server named no instant', async () => {
    const store = memStore({ 'a@x': { consecutive429: 1, cooldownUntilMs: 0, lastKind: 'throttle_429' } })
    const { impl } = countingFetch(429) // no headers
    await usageProbe(withTok(), { fetchImpl: impl, cooldownStore: store, probeLock: passThroughLock }, { accountKey: 'a@x' })
    // second consecutive 429 ⇒ one doubling
    expect(store.peek()['a@x'].cooldownUntilMs).toBe(NOW + BACKOFF_BASE_MS * 2)
    expect(store.peek()['a@x'].consecutive429).toBe(2)
  })

  it('a 200 clears the cooldown, resets the streak, and refreshes the cache', async () => {
    const store = memStore({
      'a@x': { consecutive429: 3, cooldownUntilMs: NOW - 1, lastKind: 'throttle_429' },
    })
    const { impl } = countingFetch(200, { five_hour: { utilization: 7 } })
    const r = await usageProbe(withTok(), { fetchImpl: impl, cooldownStore: store, probeLock: passThroughLock }, { accountKey: 'a@x' })
    expect(r.status).toBe(200)
    expect(r.reason).toBe('fresh')
    const e = store.peek()['a@x']
    expect(e.consecutive429).toBe(0)
    expect(e.cooldownUntilMs).toBe(0)
    expect(e.cachedAtMs).toBe(NOW)
  })
})

describe('usageProbe — the cross-process lock', () => {
  it('a contended lock does NOT fetch; it serves the cache', async () => {
    const store = memStore({
      'a@x': { consecutive429: 0, cooldownUntilMs: 0, cachedAtMs: NOW - 1000, cachedData: { cached: true } },
    })
    const { impl, calls } = countingFetch(200, { fresh: true })
    const r = await usageProbe(
      withTok(),
      { fetchImpl: impl, cooldownStore: store, probeLock: async () => null }, // what a real contended acquire returns
      { accountKey: 'a@x' },
    )
    expect(calls).toHaveLength(0)
    expect(r.reason).toBe('lock_contended')
    expect(r.data).toEqual({ cached: true })
  })

  it('RE-CHECKS the cooldown AFTER acquiring, so two racers cannot both fire', async () => {
    // The subtle clause #94 flags: both callers pass the pre-lock check before either fires.
    // Here the store gains a cooldown *between* the pre-check and the lock body — exactly what
    // the other racer would have written — and the winner must notice and NOT fetch.
    const store = memStore()
    const { impl, calls } = countingFetch(200, { fresh: true })
    const lockThatLetsTheOtherRacerWin = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
      store.write({ 'a@x': { consecutive429: 1, cooldownUntilMs: NOW + 60_000, lastKind: 'quota_429' } })
      return fn()
    }
    const r = await usageProbe(
      withTok(),
      { fetchImpl: impl, cooldownStore: store, probeLock: lockThatLetsTheOtherRacerWin },
      { accountKey: 'a@x' },
    )
    expect(calls).toHaveLength(0) // the re-check caught it; without it this would be a double-hit
    expect(r.status).toBe(429)
  })
})

describe('usageProbe — no account key means unchanged, zero-state behaviour', () => {
  it('never touches the store, and reports the raw status', async () => {
    let touched = false
    const store = {
      read: () => {
        touched = true
        return {}
      },
      write: () => {
        touched = true
      },
    }
    const { impl, calls } = countingFetch(429)
    const [status] = await usageRequest(withTok(), { fetchImpl: impl, cooldownStore: store, probeLock: passThroughLock })
    expect(status).toBe(429)
    expect(calls).toHaveLength(1)
    expect(touched).toBe(false)
  })
})
