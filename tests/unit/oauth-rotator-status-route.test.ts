import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mockEnforceMaestro = vi.fn()
const mockLoadState = vi.fn()
const mockReadTickStatus = vi.fn()

vi.mock('@/lib/route-auth', () => ({
  enforceMaestro: (...a: unknown[]) => mockEnforceMaestro(...a),
}))
vi.mock('@/lib/oauth-rotator/tick-status', async () => {
  const actual = await vi.importActual<typeof import('@/lib/oauth-rotator/tick-status')>(
    '@/lib/oauth-rotator/tick-status',
  )
  // Only the READ is stubbed. Routed through an arrow so `vi.clearAllMocks()` cannot strip the
  // implementation the way an inline `vi.fn(() => …)` in the factory would.
  return { ...actual, readTickStatus: (...a: unknown[]) => mockReadTickStatus(...a) }
})
vi.mock('@/lib/oauth-rotator/slots', async () => {
  const actual = await vi.importActual<typeof import('@/lib/oauth-rotator/slots')>(
    '@/lib/oauth-rotator/slots',
  )
  // expiresInH stays REAL — the route's runway is only trustworthy if the shipped ms-vs-seconds
  // heuristic is the one under test. Only the store read is stubbed, so no keychain is touched.
  return { ...actual, loadState: () => mockLoadState() }
})

import { GET } from '@/app/api/oauth-rotator/status/route'

const HOUR_MS = 3_600_000

beforeEach(() => {
  vi.clearAllMocks()
  mockEnforceMaestro.mockImplementation(() => null)
  mockReadTickStatus.mockImplementation(() => 'ok')
  mockLoadState.mockImplementation(() => ({
    live_email: 'live@example.com',
    live_fp: 'livefingerprint0',
    slots: {
      'live@example.com': {
        captured_at: '2026-07-29T09:00:00+0200',
        fp: 'aaaaaaaaaaaaaaaa',
        expires_at: Date.now() + 2 * HOUR_MS,
        via: 'server-tick',
        refresh_failures: 0,
      },
      'dead@example.com': {
        captured_at: '2026-07-22T09:00:00+0200',
        fp: 'bbbbbbbbbbbbbbbb',
        expires_at: Date.now() - 5 * HOUR_MS,
        via: 'slot_capture_browser(full-oauth)',
        refresh_failures: 26,
        refresh_dead_fp: 'bbbbbbbbbbbbbbbb',
      },
    },
  }))
})

const req = () => new NextRequest('http://localhost:23000/api/oauth-rotator/status')

describe('GET /api/oauth-rotator/status (TRDD-OX5TT5OT)', () => {
  it('never emits a token fingerprint — the index carries them and a careless spread would leak', async () => {
    // The index legitimately stores `fp` (sha256 of the access token) and `live_fp`. They identify
    // a credential and the UI has no use for them, so their absence is the assertion — a spread of
    // the entry would pass every other test in this file while publishing them.
    const body = await (await GET(req())).text()
    expect(body).not.toContain('aaaaaaaaaaaaaaaa')
    expect(body).not.toContain('bbbbbbbbbbbbbbbb')
    expect(body).not.toContain('livefingerprint0')
    expect(body).not.toContain('fp')
    // Non-vacuity: the payload really did carry those entries through.
    expect(body).toContain('dead@example.com')
  })

  it('flags the dead account on the SAME threshold the tick uses, and reports runway', async () => {
    const data = (await (await GET(req())).json()) as {
      liveEmail: string
      accounts: { email: string; isLive: boolean; refreshDead: boolean; expiresInH: number }[]
    }
    expect(data.liveEmail).toBe('live@example.com')

    const live = data.accounts.find((a) => a.email === 'live@example.com')!
    expect(live.isLive).toBe(true)
    expect(live.refreshDead).toBe(false)
    expect(live.expiresInH).toBeGreaterThan(1.9)
    expect(live.expiresInH).toBeLessThan(2.1)

    const dead = data.accounts.find((a) => a.email === 'dead@example.com')!
    expect(dead.isLive).toBe(false)
    expect(dead.refreshDead).toBe(true)
    expect(dead.expiresInH).toBeLessThan(0) // already expired
  })

  it('is MAESTRO-only — an agent never reads the account inventory', async () => {
    const forbidden = NextResponse.json({ error: 'Forbidden — system owner only' }, { status: 403 })
    mockEnforceMaestro.mockImplementation(() => forbidden)
    expect(await GET(req())).toBe(forbidden)
    expect(mockLoadState).not.toHaveBeenCalled()
  })

  it('reports an empty fleet as empty rather than throwing', async () => {
    mockLoadState.mockImplementation(() => ({ live_email: null, live_fp: null, slots: {} }))
    const data = (await (await GET(req())).json()) as { liveEmail: null; accounts: unknown[] }
    // Deliberately an EXACT shape, not a subset: this is the assertion that noticed
    // `tickNextAction` being added (TRDD-CVQJNW3A) rather than letting the contract widen
    // unremarked. Keep it exact — a `toMatchObject` here would stop doing that job.
    expect(data).toEqual({ liveEmail: null, accounts: [], tickNextAction: 'ok' })
  })
})

/**
 * TRDD-CVQJNW3A box 3 — the tick's HOST-WIDE verdict, not just per-slot flags.
 *
 * The `refreshDead` flags above say which SLOT is dead. `reauth-needed` is the different claim
 * that no automatic path is left for the host, and until this landed it lived only in a file on
 * disk — so it reached the owner only when a human read it out to them. Measured live on
 * 2026-08-22 the host sat at `reauth-needed` while every UI surface stayed silent.
 *
 * NEUTER RUNS (2026-08-22 — OBSERVED via scripts/dev/neuter, restores blob-verified):
 *
 *   drop `tickNextAction` from the response body        → 3 red / 8 green
 *       all three below — the field simply is not served
 *
 *   `readTickStatus() ?? 'ok'`                          → 1 red / 10 green
 *       ONLY "an absent verdict is UNKNOWN" reds, which is the point: collapsing null into a
 *       healthy-looking value leaves the reauth-needed and ok cases passing, so that one test is
 *       the sole thing standing between a dead rotator and a green-looking dashboard.
 */
describe('GET /api/oauth-rotator/status — the tick verdict (TRDD-CVQJNW3A)', () => {
  it('surfaces reauth-needed, so a host with no automatic path left is visible', async () => {
    mockReadTickStatus.mockImplementation(() => 'reauth-needed')
    const body = await (await GET(req())).json()
    expect(body.tickNextAction).toBe('reauth-needed')
  })

  it('an ABSENT verdict is surfaced as null — never collapsed into a healthy-looking value', async () => {
    // `readTickStatus` returns null when the stamp is missing OR older than 300 s, i.e. when the
    // beat is NOT RUNNING. That is the state most easily mistaken for health, and a route that
    // defaulted it to 'ok' would report a dead rotator as a well one — the lenient-reader
    // failure, pointed at the one signal that says a human is needed.
    mockReadTickStatus.mockImplementation(() => null)
    const body = await (await GET(req())).json()
    expect(body.tickNextAction).toBeNull()
    expect(body).toHaveProperty('tickNextAction')
  })

  it('passes a healthy verdict through unchanged — the field is read, not hardcoded', async () => {
    // Positive control. Without it the two assertions above are satisfied by a route that always
    // emits whatever the mock last returned, or by one wired to a constant.
    mockReadTickStatus.mockImplementation(() => 'rotating')
    const body = await (await GET(req())).json()
    expect(body.tickNextAction).toBe('rotating')
    // The verdict must not disturb what the route already promised.
    expect(body.accounts).toHaveLength(2)
    expect(body.liveEmail).toBe('live@example.com')
  })
})
