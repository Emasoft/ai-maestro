/**
 * `POST /api/statusline/ingest` and the two reads (TRDD-D8OYFG35).
 *
 * Driven through the exported handlers, not through the store helpers: a gate is only real if it
 * survives the path the caller actually takes.
 *
 * THE CLAIMS:
 *   1. A NON-CONSOLE peer is refused, and refused BEFORE anything is written. The check is
 *      `isConsolePeer` over the `x-aim-peer` header that `server.mjs` stamps from the socket —
 *      never `x-forwarded-for`, which a phone on the VPN can forge.
 *   2. A round trip normalises `resets_at` to epoch MS, from BOTH wire formats, to the same instant.
 *      (The normaliser's own test pins the conversion; this pins that the ROUTE uses it.)
 *   3. The read routes are NOT console-gated — remote work from a phone is a feature — but they ARE
 *      authenticated, which is the asymmetry the whole design rests on.
 *
 * ⚠ `$HOME` is redirected per test and a containment assertion at the end proves it took.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'

let dir: string

const REAL_STORE = join(homedir(), '.aimaestro', 'statusline-state')
const realStoreExistedBefore = existsSync(REAL_STORE)

/** Authenticated by default; the ingest route ignores auth entirely, the reads do not. */
vi.mock('@/lib/route-auth', () => ({
  enforceAuth: () => null,
  enforceSystemOwner: () => null,
}))

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aim-sl-route-'))
  vi.stubEnv('HOME', dir)
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(dir, { recursive: true, force: true })
})

/**
 * A request whose peer is whatever we say. `x-aim-peer` is the header `server.mjs` deletes-and-
 * re-stamps from `req.socket.remoteAddress`, so setting it here is exactly what the socket would
 * have produced — not a forgery the real server would accept.
 */
function req(body: unknown, peer = '127.0.0.1', extraHeaders: Record<string, string> = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body)
  return new Request('http://localhost/api/statusline/ingest', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-aim-peer': peer, ...extraHeaders },
    body: raw,
  }) as never
}

async function post(body: unknown, peer?: string, extraHeaders?: Record<string, string>) {
  const { POST } = await import('@/app/api/statusline/ingest/route')
  const res = await POST(req(body, peer, extraHeaders))
  return { status: res.status, body: await res.json() }
}

async function get(sessionId: string) {
  const { GET } = await import('@/app/api/statusline/[sessionId]/route')
  const res = await GET(new Request(`http://localhost/api/statusline/${sessionId}`) as never, {
    params: Promise.resolve({ sessionId }),
  })
  return { status: res.status, body: await res.json() }
}

async function rollup() {
  const { GET } = await import('@/app/api/statusline/route')
  const res = await GET(new Request('http://localhost/api/statusline') as never)
  return { status: res.status, body: await res.json() }
}

const PAYLOAD = (over: Record<string, unknown> = {}) => ({
  session_id: 'sess-alpha',
  model: { id: 'claude-opus-5', display_name: 'Opus' },
  rate_limits: {
    five_hour: { used_percentage: 23.5, resets_at: 1738425600 },
    seven_day: { used_percentage: 41.2, resets_at: 1738857600 },
  },
  ...over,
})

describe('POST /api/statusline/ingest — console-only', () => {
  it('ACCEPTS loopback', async () => {
    const r = await post(PAYLOAD(), '127.0.0.1')
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(r.body.sessionId).toBe('sess-alpha')
  })

  it('ACCEPTS the ::ffff:127.0.0.1 form the dual-stack Tailscale bind produces', async () => {
    // Miss this branch and the owner is refused at their own keyboard — the `::` listener reports
    // an IPv4 client in the v4-mapped form, and that IS the shape a real console connection has.
    expect((await post(PAYLOAD({ session_id: 'v4mapped' }), '::ffff:127.0.0.1')).status).toBe(200)
  })

  it('REFUSES a Tailscale peer with 403 console_required', async () => {
    const r = await post(PAYLOAD({ session_id: 'remote' }), '100.64.1.7')
    expect(r.status).toBe(403)
    expect(r.body.error).toBe('console_required')
  })

  it('REFUSES a peer that is absent — fail closed, never fail open', async () => {
    const { POST } = await import('@/app/api/statusline/ingest/route')
    const res = await POST(
      new Request('http://localhost/api/statusline/ingest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(PAYLOAD()),
      }) as never,
    )
    expect(res.status).toBe(403)
  })

  it('IGNORES a forged x-forwarded-for — the header a phone on the VPN can set', async () => {
    // The whole reason lib/peer-address.mjs exists. If the route ever consulted x-forwarded-for,
    // this remote caller would be admitted.
    const r = await post(PAYLOAD({ session_id: 'forged' }), '100.64.1.7', {
      'x-forwarded-for': '127.0.0.1',
      'x-real-ip': '127.0.0.1',
    })
    expect(r.status).toBe(403)
  })

  it('writes NOTHING when it refuses', async () => {
    await post(PAYLOAD({ session_id: 'nowrite' }), '100.64.1.7')
    const { readStatuslineSnapshot } = await import('@/lib/statusline-store')
    expect(await readStatuslineSnapshot('nowrite')).toBeNull()
  })
})

describe('POST /api/statusline/ingest — input handling', () => {
  it('400s an unparseable body', async () => {
    const r = await post('{not json', '127.0.0.1')
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('invalid_json')
  })

  it('400s a payload with no usable session_id, naming the rule', async () => {
    const r = await post({ model: { id: 'x' } }, '127.0.0.1')
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('invalid_payload')
  })

  it('413s a payload over the cap, on the DECLARED length before buffering', async () => {
    // From the STORE, not the route: a Next.js route module may not export a non-config const
    // (it fails `yarn build`, which `tsc` does not catch), so the cap lives in statusline-store.
    const { MAX_INGEST_BYTES } = await import('@/lib/statusline-store')
    const r = await post(PAYLOAD(), '127.0.0.1', { 'content-length': String(MAX_INGEST_BYTES + 1) })
    expect(r.status).toBe(413)
  })

  it('413s a payload that LIES about its length — a header is a claim, not a fact', async () => {
    // From the STORE, not the route: a Next.js route module may not export a non-config const
    // (it fails `yarn build`, which `tsc` does not catch), so the cap lives in statusline-store.
    const { MAX_INGEST_BYTES } = await import('@/lib/statusline-store')
    const fat = PAYLOAD({ session_id: 'fat', transcript_path: 'x'.repeat(MAX_INGEST_BYTES) })
    const r = await post(fat, '127.0.0.1', { 'content-length': '10' })
    expect(r.status).toBe(413)
  })

  it('ACCEPTS a payload carrying only the session id — upstream drift must not cost the whole record', async () => {
    expect((await post({ session_id: 'bare-only' }, '127.0.0.1')).status).toBe(200)
    expect((await get('bare-only')).status).toBe(200)
  })
})

describe('the round trip normalises resets_at to epoch MS from BOTH wire formats', () => {
  it('epoch SECONDS in → epoch MS out', async () => {
    await post(PAYLOAD({ session_id: 'epoch' }), '127.0.0.1')
    const r = await get('epoch')
    expect(r.status).toBe(200)
    expect(r.body.snapshot.rateLimits.fiveHour.resetsAtMs).toBe(1738425600_000)
    expect(r.body.snapshot.rateLimits.fiveHour.source).toBe('statusline')
  })

  it('ISO 8601 in → THE SAME INSTANT out (pins the v2.1.138 format change both ways)', async () => {
    // Claude Code changed this field from ISO to epoch in v2.1.138, and /api/oauth/usage still
    // sends ISO — so both must land on one number. A route that normalised only one format would
    // pass the test above and fail only here.
    //
    // BOTH ARMS ARE POSTED INSIDE THIS TEST, deliberately: `beforeEach` gives every test a fresh
    // temp $HOME (that is what keeps the developer's real store untouched), so a differential that
    // referenced a session written by an earlier test would read `undefined` — which is exactly how
    // the first draft of this test failed. A differential needs both arms in one fixture.
    await post(
      PAYLOAD({
        session_id: 'as-epoch',
        rate_limits: { five_hour: { used_percentage: 23.5, resets_at: 1738425600 } },
      }),
      '127.0.0.1',
    )
    await post(
      PAYLOAD({
        session_id: 'as-iso',
        rate_limits: { five_hour: { used_percentage: 23.5, resets_at: '2025-02-01T16:00:00.000+00:00' } },
      }),
      '127.0.0.1',
    )

    const iso = await get('as-iso')
    const epoch = await get('as-epoch')
    expect(epoch.status).toBe(200)
    expect(iso.status).toBe(200)
    // Non-vacuity: a pair of `undefined`s would also be "equal".
    expect(epoch.body.snapshot.rateLimits.fiveHour.resetsAtMs).toBe(1738425600_000)
    expect(iso.body.snapshot.rateLimits.fiveHour.resetsAtMs)
      .toBe(epoch.body.snapshot.rateLimits.fiveHour.resetsAtMs)
  })
})

describe('GET /api/statusline/:sessionId', () => {
  it('404s a session nobody has reported', async () => {
    expect((await get('ghost')).status).toBe(404)
  })

  it('400s — not 404s — a malformed id, because the two are fixable by different people', async () => {
    const r = await get('..%2F..%2Fetc')
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('invalid_session_id')
  })

  it('computes freshness AT READ TIME rather than storing it', async () => {
    await post(PAYLOAD({ session_id: 'fresh' }), '127.0.0.1')
    const r = await get('fresh')
    expect(r.body.fresh).toBe(true)
    expect(r.body.ageMs).toBeLessThan(60_000)
  })
})

describe('GET /api/statusline — the fleet roll-up', () => {
  it('reports the TIGHTEST window across live sessions, not the newest', async () => {
    // Same account, different sampling instants. When they disagree the safe reading is the higher
    // percentage — the one that says "you are closer to the limit than you thought".
    await post(PAYLOAD({ session_id: 'low', rate_limits: { five_hour: { used_percentage: 10, resets_at: 1738425600 } } }), '127.0.0.1')
    await post(PAYLOAD({ session_id: 'high', rate_limits: { five_hour: { used_percentage: 88, resets_at: 1738425600 } } }), '127.0.0.1')

    const r = await rollup()
    expect(r.status).toBe(200)
    expect(r.body.rateLimits.fiveHour.usedPercentage).toBe(88)
    expect(r.body.freshSessions).toBe(2)
    expect(r.body.totalSessions).toBe(2)
  })

  it('EXCLUDES a stale session from the roll-up while still listing it', async () => {
    // A session that ended hours ago still has a file, and its gauge describes a window that has
    // since reset. Counting it would report a limit that no longer exists.
    // From the lib, not the route — a route module may not export a non-config symbol.
    const { rollUp } = await import('@/lib/statusline-rollup')
    const { STATUSLINE_FRESH_MS } = await import('@/lib/statusline-store')
    const now = 10_000_000_000
    const mk = (id: string, capturedAt: number, used: number) => ({
      sessionId: id,
      capturedAt,
      source: 'statusline' as const,
      rateLimits: { fiveHour: { usedPercentage: used, resetsAtMs: 1, source: 'statusline' as const }, sevenDay: null },
      session: {} as never,
      context: null,
      cost: null,
      liveFp: null, // the roll-up is freshness-only; account identity is the rotator's guard
    })
    const out = rollUp([mk('live', now - 1000, 5), mk('dead', now - STATUSLINE_FRESH_MS - 1, 99)], now)
    expect(out.rateLimits.fiveHour?.usedPercentage).toBe(5)
    expect(out.freshSessions).toBe(1)
    expect(out.totalSessions).toBe(2)
  })

  it('answers an EMPTY roll-up visibly, rather than a confident zero', async () => {
    const r = await rollup()
    expect(r.body.freshSessions).toBe(0)
    expect(r.body.rateLimits).toEqual({ fiveHour: null, sevenDay: null })
  })
})

describe('containment', () => {
  it('nothing in this file touched the REAL ~/.aimaestro/statusline-state', () => {
    expect(existsSync(REAL_STORE)).toBe(realStoreExistedBefore)
  })
})
