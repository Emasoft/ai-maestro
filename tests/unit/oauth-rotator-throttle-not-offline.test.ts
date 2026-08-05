/**
 * TRDD-WFIMES6U — A SELF-IMPOSED BACK-OFF IS NOT EVIDENCE ABOUT THE NETWORK OR THE TOKEN.
 *
 * THE REGRESSION THIS PINS. `usageRequest` used to return status 0 for exactly one family of
 * things: network error, abort, timeout, unparseable 2xx. So `tick.ts`'s `const networkUp =
 * liveStatus !== 0` was a fair reading. TRDD-W4T70Y3R then added the 429 back-off, and with it two
 * NEW ways to get 0 that say nothing whatever about the network:
 *
 *   - `cooldown`       — WE are throttling ourselves, on purpose, with no usable cache
 *   - `lock_contended` — another process holds the probe lock this instant
 *
 * Both then read as "the API is unreachable". `networkUp` gates five things: candidates are not
 * probed at all, a lapsed-but-rescuable alternate is not renewed, `selectDrainFirst` is skipped,
 * and the decision log says `no usage; API unreachable` — pointing whoever debugs it at the one
 * place nothing is wrong. Rotation degrades to choosing on token-expiry alone at precisely the
 * moment a throttle means it is needed most: the same failure W4T70Y3R fixed, arriving by the
 * route W4T70Y3R opened.
 *
 * WHY NO EXISTING TEST COULD SEE IT. `network.ts` declares `cooldownStore` and `probeLock` as test
 * seams and explains why they must exist (without them a 429 test writes the DEVELOPER'S real
 * machine-wide rotator state). But `netDeps` forwarded only `fetchImpl`, so those seams were
 * unreachable from the tick and no tick test had ever driven a cooldown. The seam existed; nothing
 * could reach it. Forwarding them is part of this card.
 *
 * THE FALSIFICATION PAIR — the first test alone is worthless. "A throttle is not offline" is
 * satisfied by hard-wiring `networkUp = true`, which would delete the offline handling entirely.
 * So test 2 drives a REAL network failure and asserts the tick still concludes offline. Neither
 * assertion means anything without the other; together they pin the DISCRIMINATION, not the value.
 *
 * NEUTER RUNS (2026-08-05 — OBSERVED via scripts/dev/neuter, each restore verified by blob hash).
 * Three mutations, three DISTINCT reds: every behavioural test here falls to exactly one, so none
 * of them passes for a reason nobody has named.
 *
 *   s/networkUp = liveStatus !== 0 || liveOutcome.reason !== 'error'/networkUp = liveStatus !== 0/
 *     → 1 red: "a THROTTLED live probe is NOT offline"          (the regression itself)
 *   s/if (st2 !== 200 && st2 !== 429 && !unread)/if (st2 !== 200 && st2 !== 429)/
 *     → 1 red: "a THROTTLED candidate does not burn a token refresh"
 *   s/networkUp = liveStatus !== 0 || liveOutcome.reason !== 'error'/networkUp = true/
 *     → 1 red: "FALSIFICATION PAIR: a REAL network failure IS still read as offline"
 *
 * TWO OF THOSE THREE FIRST REDDENED NOTHING, and each zero was a defect in THIS file, not a clean
 * bill for the code — recorded because the fixture bug is the interesting part both times:
 *   - the refresh test ran at 50% usage, where the tick logs "within limits" and RETURNS before
 *     the candidate loop, so it counted refreshes on a path that never executed;
 *   - the offline test's stub threw BEFORE incrementing its counter, so an ATTEMPTED probe was
 *     indistinguishable from a skipped one and `networkUp = true` passed unnoticed.
 * A neuter that reddens nothing is a measurement of the test. It was worth two rounds here.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { runTick, type TickDeps } from '@/lib/oauth-rotator/tick'
import { loadState, saveState, writeSlot, fingerprint, type RotatorState } from '@/lib/oauth-rotator/slots'
import { writeLiveBlob } from '@/lib/oauth-rotator/live'
import type { CooldownEntry } from '@/lib/oauth-rotator/usage-cooldown'

const ENV_KEYS = ['HOME', 'USER', 'CLAUDE_SAFE_STORAGE_BACKEND', 'CLAUDE_PLUGIN_DATA'] as const
let saved: Record<string, string | undefined>
let tmpDir: string

beforeEach(() => {
  saved = {}
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-throttle-'))
  process.env.HOME = tmpDir
  process.env.CLAUDE_SAFE_STORAGE_BACKEND = 'none'
  delete process.env.CLAUDE_PLUGIN_DATA
  // Containment, asserted rather than assumed: if HOME did not take, this path is the developer's
  // real credentials file and the run must not proceed.
  const credFile = path.join(os.homedir(), '.claude', '.credentials.json')
  if (!credFile.startsWith(tmpDir)) throw new Error(`refusing to run: ${credFile} escaped ${tmpDir}`)
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* best-effort */ }
})

/** 8h of runway — outside EXPIRY_GRACE_H and KEEPALIVE_AHEAD_H, so an alternate holding this is
 *  neither locally expired nor a keepalive candidate. That keeps RENEW-before-rotate out of the
 *  picture, so the only refresh a test can observe is the one REFRESH-ON-ERR would burn. */
const H8 = () => Date.now() + 8 * 3600 * 1000
/**
 * 10 minutes — INSIDE EXPIRY_GRACE_H, so `blobLocallyExpired` is true.
 *
 * THIS IS THE FIXTURE THAT MAKES `networkUp` OBSERVABLE AT ALL, and it took a failed run to find.
 * With a live token that is still VALID, an unreadable probe hits an earlier branch that logs
 * "usage unreachable … staying put" and RETURNS — no candidate is ever probed, with or without the
 * bug, so that scenario cannot discriminate. Only `liveExpired` sets `near = true` and carries the
 * tick past that return into the rotation path, which is where `networkUp` gates candidate
 * probing. It is also the case that matters most: a locally-expired live token is precisely when
 * rotation is needed, so a throttle blinding it there is the expensive version of the bug.
 */
const EXPIRING = () => Date.now() + 10 * 60 * 1000
const blob = (accessToken: string, expiresAt: number, refreshToken = 'r') => ({
  claudeAiOauth: { accessToken, refreshToken, expiresAt },
})

interface Counts { usageByToken: Record<string, number>; tokenExchanges: number }

/**
 * Counts every call so a test can assert on what was NOT asked, which is the whole subject here.
 *
 * ⚠ THE COUNTER MUST INCREMENT *BEFORE* `throwAll` THROWS. A neuter caught the other order: with
 * the throw first, an ATTEMPTED probe was never counted, so "the candidate was not probed" read
 * identically to "the candidate was probed and the network failed". The offline test then passed
 * with `networkUp` hard-wired to `true` — the exact mutation it exists to catch. Counting the
 * attempt is what makes the two distinguishable.
 */
function stubFetch(usage: Record<string, { fh: number; sd: number }>, counts: Counts, throwAll = false): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    const u = String(url)
    const auth = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? '')
    const tok = auth.replace('Bearer ', '')
    if (u.includes('/oauth/usage')) counts.usageByToken[tok] = (counts.usageByToken[tok] ?? 0) + 1
    if (u.includes('/oauth/token')) counts.tokenExchanges += 1
    if (throwAll) throw new Error('ECONNREFUSED')
    if (u.includes('/oauth/usage')) {
      const spec = usage[tok]
      if (!spec) return new Response('{}', { status: 200 })
      return new Response(
        JSON.stringify({ five_hour: { utilization: spec.fh }, seven_day: { utilization: spec.sd } }),
        { status: 200 },
      )
    }
    if (u.includes('/oauth/token')) {
      return new Response(JSON.stringify({ access_token: 'NEW', refresh_token: 'nr', expires_in: 28800 }), { status: 200 })
    }
    if (u.includes('/roles')) return new Response(JSON.stringify({ organization_name: "x@x's Organization" }), { status: 200 })
    return new Response('{}', { status: 404 })
  }) as unknown as typeof fetch
}

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

/** An in-memory cooldown store. Without injecting one, driving a cooldown here would write the
 *  developer's real machine-wide rotator state — which is exactly what `NetworkDeps` says. */
function memStore(initial: Record<string, CooldownEntry> = {}) {
  let data = { ...initial }
  return { read: () => ({ ...data }), write: (d: Record<string, CooldownEntry>) => { data = { ...d } } }
}

/** A THROTTLE cooldown with NO cached reading — the shape that resolves to `{status: 0,
 *  reason: 'cooldown'}`, i.e. "we declined to ask", which is the case under test. */
const throttled = (): CooldownEntry => ({
  consecutive429: 1,
  cooldownUntilMs: Date.now() + 10 * 60_000,
  lastKind: 'throttle_429',
})

function makeDeps(fetchImpl: typeof fetch, extra: Partial<TickDeps> = {}): TickDeps & { lines: string[] } {
  const lines: string[] = []
  return {
    fetchImpl,
    decide: (m: string) => { lines.push(m) },
    readSnapshots: async () => [],
    lines,
    ...extra,
  }
}

describe('TRDD-WFIMES6U — a throttle must not be read as an offline API', () => {
  // The two tests below share ONE fixture and differ ONLY in why the live probe came back
  // unreadable. That is deliberate: the claim is not "candidates get probed" nor "they do not",
  // it is that the tick DISCRIMINATES the two causes. The ALT probe count is the discriminator —
  // a log assertion cannot be, because `liveDesc` says "LOCALLY EXPIRED + API unreachable" in this
  // branch whatever `networkUp` decides (found by asserting it and being wrong).
  it('a THROTTLED live probe is NOT offline — candidates are still probed', async () => {
    seedLive('live@x', blob('LIVE', EXPIRING()))
    addSlot('alt@x', blob('ALT', H8()))
    const counts: Counts = { usageByToken: {}, tokenExchanges: 0 }
    const deps = makeDeps(stubFetch({ ALT: { fh: 5, sd: 5 } }, counts), {
      cooldownStore: memStore({ 'live@x': throttled() }),
    })

    await runTick(deps)

    // Precondition, not the subject: our own back-off suppressed the live probe, so no HTTP for it.
    expect(counts.usageByToken.LIVE ?? 0).toBe(0)
    // THE SUBJECT. Under the regression `networkUp` was false and this was 0 — every alternate
    // skipped, rotation choosing on token-expiry alone at the moment it most needed usage.
    expect(counts.usageByToken.ALT ?? 0).toBeGreaterThan(0)
  })

  it('FALSIFICATION PAIR: a REAL network failure IS still read as offline', async () => {
    seedLive('live@x', blob('LIVE', EXPIRING()))
    addSlot('alt@x', blob('ALT', H8()))
    const counts: Counts = { usageByToken: {}, tokenExchanges: 0 }
    // Every fetch throws → httpJson returns 0 with reason 'error', the one value that genuinely
    // reports a failed call. Without this test, `networkUp = true` would satisfy the one above.
    const deps = makeDeps(stubFetch({}, counts, true), { cooldownStore: memStore() })

    await runTick(deps)

    expect(counts.usageByToken.ALT ?? 0).toBe(0)
  })

  it('a THROTTLED candidate does not burn a token refresh (REFRESH-ON-ERR is for a REJECTED token)', async () => {
    seedLive('live@x', blob('LIVE', H8()))
    addSlot('alt@x', blob('ALT', H8()))
    const counts: Counts = { usageByToken: {}, tokenExchanges: 0 }
    // THE LIVE ACCOUNT MUST BE NEAR ITS LIMIT (98 ≥ SWITCH), AND ITS TOKEN MUST *NOT* BE EXPIRING.
    // Both halves were learned from a neuter that reddened nothing:
    //   - at 50% the tick logs "within limits" and RETURNS before the candidate loop, so the
    //     assertion below was vacuously true — it counted refreshes on a path that never ran;
    //   - a locally-expiring live token would refresh ITSELF, adding an exchange that has nothing
    //     to do with the candidate and making the count unable to discriminate.
    // Near-limit + healthy token is the one fixture where every token exchange observed can only
    // have come from REFRESH-ON-ERR answering the throttled candidate.
    const deps = makeDeps(stubFetch({ LIVE: { fh: 98, sd: 50 } }, counts), {
      cooldownStore: memStore({ 'alt@x': throttled() }),
    })

    await runTick(deps)

    expect(counts.usageByToken.LIVE ?? 0).toBeGreaterThan(0) // the live path really did run
    expect(counts.usageByToken.ALT ?? 0).toBe(0) // and the candidate's probe was suppressed by ITS cooldown
    expect(counts.tokenExchanges).toBe(0)
  })
})
