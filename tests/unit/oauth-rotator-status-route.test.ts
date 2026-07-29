import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mockEnforceMaestro = vi.fn()
const mockLoadState = vi.fn()

vi.mock('@/lib/route-auth', () => ({
  enforceMaestro: (...a: unknown[]) => mockEnforceMaestro(...a),
}))
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
    expect(data).toEqual({ liveEmail: null, accounts: [] })
  })
})
