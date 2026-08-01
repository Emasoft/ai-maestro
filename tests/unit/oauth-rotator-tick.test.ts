import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  blobLocallyExpired,
  isNearLimit,
  isSafeAlternate,
  selectDrainFirst,
  autoRotate,
  keepaliveRefresh,
  runTick,
  type Candidate,
  type TickDeps,
} from '@/lib/oauth-rotator/tick'
import { loadState, saveState, writeSlot, readSlot, fingerprint, type RotatorState } from '@/lib/oauth-rotator/slots'
import { writeLiveBlob, readLiveBlob } from '@/lib/oauth-rotator/live'

// 0-IMPACT / R16 SAFETY: autoRotate/keepalive can call writeSlot + switchLiveTo→writeLiveBlob.
// Forced-off backend + HOME→temp (hard-guarded) route every credential write to the temp dir; the
// real keychain / `Claude Code-credentials` are never touched and `security` is never spawned. All
// network is a stub `fetch` keyed on the bearer token — no real OAuth endpoint is called.

const ENV_KEYS = ['HOME', 'USER', 'CLAUDE_SAFE_STORAGE_BACKEND', 'CLAUDE_PLUGIN_DATA'] as const
let saved: Record<string, string | undefined>
let tmpDir: string

beforeEach(() => {
  saved = {}
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-tick-'))
  process.env.HOME = tmpDir
  process.env.CLAUDE_SAFE_STORAGE_BACKEND = 'none'
  delete process.env.CLAUDE_PLUGIN_DATA
  const credFile = path.join(os.homedir(), '.claude', '.credentials.json')
  if (!credFile.startsWith(tmpDir)) throw new Error(`refusing to run: credentials path ${credFile} escaped tmp ${tmpDir}`)
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* best-effort */ }
})

const H8 = () => Date.now() + 8 * 3600 * 1000 // 8h ahead — never locally expired
const H1 = () => Date.now() + 1 * 3600 * 1000 // 1h ahead — inside the 6h keepalive window
const blob = (accessToken: string, expiresAt: number, refreshToken = 'r') => ({
  claudeAiOauth: { accessToken, refreshToken, expiresAt },
})

/** A fetch stub keyed on the bearer accessToken, returning per-token usage. */
function stubFetch(usageByToken: Record<string, { fh: number; sd: number } | number>): typeof fetch {
  return (async (url: unknown, init?: { headers?: Record<string, string> }) => {
    const u = String(url)
    const auth = init?.headers?.Authorization ?? init?.headers?.authorization ?? ''
    const tok = auth.replace('Bearer ', '')
    if (u.includes('/oauth/usage')) {
      const spec = usageByToken[tok]
      if (typeof spec === 'number') return new Response('{}', { status: spec }) // an HTTP status (e.g. 429)
      const body = spec
        ? { five_hour: { utilization: spec.fh }, seven_day: { utilization: spec.sd } }
        : {}
      return new Response(JSON.stringify(body), { status: 200 })
    }
    if (u.includes('/oauth/token')) {
      return new Response(JSON.stringify({ access_token: 'NEW', refresh_token: 'nr', expires_in: 28800 }), { status: 200 })
    }
    if (u.includes('/roles')) {
      return new Response(JSON.stringify({ organization_name: "x@x's Organization" }), { status: 200 })
    }
    return new Response('{}', { status: 404 })
  }) as unknown as typeof fetch
}

/** Seed the live credential + state so autoRotate sees `liveEmail` as the current live account
 * with a fingerprint that matches (so reconcile is a no-op and needs no /roles). */
function seedLive(email: string, liveBlob: ReturnType<typeof blob>): void {
  writeLiveBlob(liveBlob)
  const st: RotatorState = loadState()
  st.live_email = email
  st.live_fp = fingerprint(liveBlob)
  st.slots = st.slots ?? {}
  saveState(st)
}

function addSlot(email: string, slotBlob: ReturnType<typeof blob>): void {
  writeSlot(email, slotBlob)
  const st = loadState()
  st.slots = st.slots ?? {}
  st.slots[email] = { captured_at: 'now', fp: fingerprint(slotBlob), expires_at: null, via: 'test' }
  saveState(st)
}

describe('tick — pure decision helpers', () => {
  it('blobLocallyExpired: true within the 0.5h grace / past expiry, false with runway or no expiry', () => {
    expect(blobLocallyExpired(blob('t', Date.now() + 8 * 3600 * 1000))).toBe(false)
    expect(blobLocallyExpired(blob('t', Date.now() - 1000))).toBe(true)
    expect(blobLocallyExpired(blob('t', Date.now() + 10 * 60 * 1000))).toBe(true) // 10min < 0.5h
    expect(blobLocallyExpired({ claudeAiOauth: { accessToken: 't' } })).toBe(false) // no expiresAt → never dead on missing data
  })

  it('isNearLimit: EITHER window >= 97 trips; unknown never trips', () => {
    expect(isNearLimit(98, 10, null)).toBe(true)
    expect(isNearLimit(10, 99, null)).toBe(true)
    expect(isNearLimit(96, 96, null)).toBe(false)
    expect(isNearLimit(null, null, null)).toBe(false)
    expect(isNearLimit(null, 99, null)).toBe(true)
  })

  it('isSafeAlternate: below 90 on BOTH windows', () => {
    expect(isSafeAlternate(10, 10, null)).toBe(true)
    expect(isSafeAlternate(89, 89, null)).toBe(true)
    expect(isSafeAlternate(90, 10, null)).toBe(false)
    expect(isSafeAlternate(10, 95, null)).toBe(false)
  })

  /**
   * TRDD-JI7F1236 — the MODEL-SCOPED window is a third axis, and it is the one the rotator was
   * blind to. Fable 5 carries its own weekly limit that appears in NEITHER top-level bucket, so
   * an account can be fully spent on it while 5h/7d read low.
   *
   * ⚠ NON-VACUITY: every case below holds 5h/7d at 10/10 — comfortably safe on both buckets — so
   * the ONLY thing that can change the verdict is the scoped argument. Reverting either predicate
   * to its two-bucket form must redden exactly these two tests. If a case let 5h or 7d carry the
   * decision, it would pass with the fix removed and pin nothing.
   */
  it('isNearLimit: a spent MODEL-SCOPED window trips it even when 5h/7d are low', () => {
    expect(isNearLimit(10, 10, 98)).toBe(true) // the whole point: buckets low, scoped maxed
    expect(isNearLimit(10, 10, 96)).toBe(false) // below the switch threshold → no rotation
    expect(isNearLimit(10, 10, null)).toBe(false) // no scoped window reported → nothing to act on
  })

  it('isSafeAlternate: a candidate with a spent MODEL-SCOPED window is NOT a safe target', () => {
    expect(isSafeAlternate(10, 10, 95)).toBe(false) // would fail every call on that model
    expect(isSafeAlternate(10, 10, 89)).toBe(true) // below SAFE on all three → fine
    // null is "no scoped window exists", NOT "unknown" — it must disqualify nothing. The caller
    // already rejects an alternate whose 5h/7d are unknown before reaching here.
    expect(isSafeAlternate(10, 10, null)).toBe(true)
  })

  it('selectDrainFirst: picks the highest max-of-windows (drain the fullest first); null when empty', () => {
    const a: Candidate = ['a', blob('a', 0), 20, 30]
    const b: Candidate = ['b', blob('b', 0), 80, 10]
    const c: Candidate = ['c', blob('c', 0), 50, 40]
    expect(selectDrainFirst([a, b, c])?.[0]).toBe('b') // max(80,10)=80 is highest
    expect(selectDrainFirst([])).toBeNull()
    expect(selectDrainFirst([a])?.[0]).toBe('a')
  })
})

describe('tick — autoRotate (ROTATE)', () => {
  it('live near a limit + a safe alternate → switches the live credential (drain-first)', async () => {
    const live = blob('LIVE', H8())
    const alt = blob('ALT', H8())
    seedLive('live@x', live)
    addSlot('alt@x', alt)
    const deps: TickDeps = { fetchImpl: stubFetch({ LIVE: { fh: 98, sd: 50 }, ALT: { fh: 10, sd: 10 } }) }

    const switched = await autoRotate(deps)
    expect(switched).toBe(true)
    expect(loadState().live_email).toBe('alt@x')
    // The live credential now carries the alternate's claudeAiOauth section.
    expect((readLiveBlob() as { claudeAiOauth: { accessToken: string } }).claudeAiOauth.accessToken).toBe('ALT')
  })

  it('live within limits → no switch', async () => {
    seedLive('live@x', blob('LIVE', H8()))
    addSlot('alt@x', blob('ALT', H8()))
    const deps: TickDeps = { fetchImpl: stubFetch({ LIVE: { fh: 40, sd: 40 }, ALT: { fh: 10, sd: 10 } }) }
    expect(await autoRotate(deps)).toBe(false)
    expect(loadState().live_email).toBe('live@x')
  })

  it('a single live 429 is debounced (deferred); the second 429 rotates away', async () => {
    seedLive('live@x', blob('LIVE', H8()))
    addSlot('alt@x', blob('ALT', H8()))
    const deps: TickDeps = { fetchImpl: stubFetch({ LIVE: 429, ALT: { fh: 10, sd: 10 } }) }

    expect(await autoRotate(deps)).toBe(false) // streak 1/2 → deferred
    expect(loadState().live_email).toBe('live@x')
    expect(loadState().live_429_streak).toBe(1)

    expect(await autoRotate(deps)).toBe(true) // streak 2/2 → rotate
    expect(loadState().live_email).toBe('alt@x')
  })

  it('no live credential → no-op false', async () => {
    // No seedLive → readLiveBlobWithSource returns [null,'none'].
    expect(await autoRotate({ fetchImpl: stubFetch({}) })).toBe(false)
  })
})

/** A fetch stub that FAILS every token exchange and counts the attempts — the shape of a slot
 *  whose refresh token is genuinely dead. `calls` is the assertion surface. */
function countingFailingTokenFetch(): { impl: typeof fetch; calls: () => number } {
  let n = 0
  const impl = (async (url: unknown) => {
    const u = String(url)
    if (u.includes('/oauth/token')) { n++; return new Response('{}', { status: 400 }) }
    if (u.includes('/oauth/usage')) return new Response('{}', { status: 200 })
    if (u.includes('/roles')) return new Response(JSON.stringify({ organization_name: "x@x's Organization" }), { status: 200 })
    return new Response('{}', { status: 404 })
  }) as unknown as typeof fetch
  return { impl, calls: () => n }
}

describe('tick — keepaliveRefresh retry ban on a token already classified DEAD', () => {
  // Observed live 2026-07-29: a slot with a genuinely dead refresh token was retried once per 60s
  // beat forever — its counter ran 1 -> 26 in 25 minutes. MAX_REFRESH_FAILURES classified it dead
  // but never stopped the asking, so the cascade had already said "a human must re-login" while
  // the beat kept interrogating a credential that could not answer.
  it('stops attempting the exchange once the SAME credential has failed MAX times', async () => {
    seedLive('live@x', blob('LIVE', H8()))
    const dead = blob('DEAD', H1()) // inside the keepalive window → a candidate every beat
    addSlot('dead@x', dead)
    const f = countingFailingTokenFetch()

    // Three beats: each fails, each increments. The 4th must NOT reach the endpoint.
    await keepaliveRefresh({ fetchImpl: f.impl })
    await keepaliveRefresh({ fetchImpl: f.impl })
    await keepaliveRefresh({ fetchImpl: f.impl })
    expect(f.calls()).toBe(3)
    expect((loadState().slots?.['dead@x'] as unknown as Record<string, unknown>).refresh_failures).toBe(3)

    await keepaliveRefresh({ fetchImpl: f.impl })
    await keepaliveRefresh({ fetchImpl: f.impl })
    expect(f.calls()).toBe(3) // banned — no further traffic against a known-dead credential
  })

  // The ban MUST un-gate itself: a human re-login is the one action that fixes this, and a gate
  // keyed on the count alone would silently ignore it forever.
  it('resumes the instant a DIFFERENT credential is captured for that slot', async () => {
    seedLive('live@x', blob('LIVE', H8()))
    addSlot('dead@x', blob('DEAD', H1()))
    const f = countingFailingTokenFetch()
    for (let i = 0; i < 4; i++) await keepaliveRefresh({ fetchImpl: f.impl })
    expect(f.calls()).toBe(3) // banned

    // A re-login writes a NEW blob → a different fingerprint → the ban must lift.
    writeSlot('dead@x', blob('RECAPTURED', H1()))
    await keepaliveRefresh({ fetchImpl: f.impl })
    expect(f.calls()).toBe(4)
  })
})

describe('tick — keepaliveRefresh (RENEW)', () => {
  it('refreshes an alternate slot within the keepalive window and writes the fresh token back', async () => {
    seedLive('live@x', blob('LIVE', H8()))
    addSlot('alt@x', blob('ALT', H1())) // 1h runway → inside the 6h window → refreshed
    const deps: TickDeps = { fetchImpl: stubFetch({}) }

    const refreshed = await keepaliveRefresh(deps)
    expect(refreshed).toEqual(['alt@x'])
    expect((readSlot('alt@x') as { claudeAiOauth: { accessToken: string } }).claudeAiOauth.accessToken).toBe('NEW')
  })

  it('leaves a slot with ample runway untouched, and never refreshes the live account', async () => {
    seedLive('live@x', blob('LIVE', H1())) // live is near expiry but MUST NOT be refreshed here
    addSlot('alt@x', blob('ALT', H8())) // 8h runway → outside the window → left alone
    const refreshed = await keepaliveRefresh({ fetchImpl: stubFetch({}) })
    expect(refreshed).toEqual([])
  })
})

describe('tick — runTick (compose)', () => {
  it('composes keepalive + rotate and reports next_action=rotating on a switch', async () => {
    seedLive('live@x', blob('LIVE', H8()))
    addSlot('alt@x', blob('ALT', H8()))
    const res = await runTick({ fetchImpl: stubFetch({ LIVE: { fh: 99, sd: 10 }, ALT: { fh: 5, sd: 5 } }) })
    expect(res.switched).toBe(true)
    expect(res.nextAction).toBe('rotating')
  })

  it('reports next_action=ok when the live account is healthy and alternates self-renew', async () => {
    seedLive('live@x', blob('LIVE', H8()))
    addSlot('alt@x', blob('ALT', H8())) // has refresh, ample runway → healthy
    const res = await runTick({ fetchImpl: stubFetch({ LIVE: { fh: 20, sd: 20 }, ALT: { fh: 5, sd: 5 } }) })
    expect(res.switched).toBe(false)
    expect(res.nextAction).toBe('ok')
    expect(res.reason).toBeUndefined() // a healthy tick attributes nothing
  })

  // A slot REGISTERED in state.json whose blob cannot be read back is the exact live failure
  // (2026-07-29): three healthy, refresh-capable accounts, yet every beat concluded
  // `reauth-needed`. `keepaliveRefresh` skips an unreadable slot SILENTLY (`if (!blob) continue`)
  // and the bare verdict named no cause, so six days of it produced no log line anyone could act
  // on — a human was told to re-login for a credential the SERVER could not open.
  it('attributes reauth-needed to slot-unreadable when a registered slot cannot be read back', async () => {
    seedLive('live@x', blob('LIVE', H8()))
    // Register the alternate WITHOUT writing its blob → readSlot() returns null.
    const st = loadState()
    st.slots = { ...(st.slots ?? {}), 'ghost@x': { captured_at: 'now', fp: 'deadbeef', expires_at: null, via: 'test' } }
    saveState(st)
    expect(readSlot('ghost@x')).toBeNull() // the premise, asserted — not assumed

    const res = await runTick({ fetchImpl: stubFetch({ LIVE: { fh: 20, sd: 20 } }) })
    expect(res.nextAction).toBe('reauth-needed')
    expect(res.reason).toBe('slot-unreadable')
    expect(res.decision).toContain('UNREADABLE')
    expect(res.decision).not.toContain('no action needed') // the line that read as health
  })

  it('attributes reauth-needed to refresh-dead when a readable alternate has no refresh and is expired', async () => {
    seedLive('live@x', blob('LIVE', H8()))
    // Empty refresh token = an unrefreshable setup-token slot (`Boolean('')` is false), expired.
    addSlot('dead@x', blob('DEAD', Date.now() - 1000, ''))
    const res = await runTick({ fetchImpl: stubFetch({ LIVE: { fh: 20, sd: 20 } }) })
    expect(res.nextAction).toBe('reauth-needed')
    expect(res.reason).toBe('refresh-dead')
    expect(res.decision).toContain('re-login')
  })

  // Precedence is the whole point: with BOTH faults present the verdict must name OURS. Reporting
  // "a human must re-login" while the server cannot open a slot sends the user to fix something
  // that is not broken, and hides the defect that is.
  it('prefers slot-unreadable over refresh-dead when both are present', async () => {
    seedLive('live@x', blob('LIVE', H8()))
    // Empty refresh token = an unrefreshable setup-token slot (`Boolean('')` is false), expired.
    addSlot('dead@x', blob('DEAD', Date.now() - 1000, ''))
    const st = loadState()
    st.slots = { ...(st.slots ?? {}), 'ghost@x': { captured_at: 'now', fp: 'deadbeef', expires_at: null, via: 'test' } }
    saveState(st)

    const res = await runTick({ fetchImpl: stubFetch({ LIVE: { fh: 20, sd: 20 } }) })
    expect(res.reason).toBe('slot-unreadable')
  })
})
