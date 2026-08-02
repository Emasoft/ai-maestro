/**
 * TRDD-GY0LJV6S — the statusline disjunct AT ITS TWO CALL SITES inside `autoRotate`.
 *
 * The sibling suite (`oauth-rotator-statusline-disjunct.test.ts`) pins `statuslineNear` itself: 8
 * tests, 3 measured neuters. Its own tail names what it could NOT reach, verbatim:
 *
 *   "NOT YET COVERED […]: the two BRANCH wirings in `autoRotate` (the disjunct into the
 *    `liveStatus === 200` verdict, and the new endpoint-unreachable branch) have no integration
 *    test — `statuslineNear` is pinned, its two call sites are not."
 *
 * This file is that integration layer. A predicate can be perfectly tested and wired to nothing;
 * both branches here are one boolean away from being inert, and an inert disjunct is INVISIBLE —
 * the rotator goes on behaving exactly as it did before the card, and every existing test stays
 * green (measured: the 22-file rotator suite passed unchanged when the wiring landed).
 *
 * ── THE THREE CLAIMS, and why the third is the one that matters ──────────────────────────────────
 *  1. `liveStatus === 200`: a positive statusline reading ALONE trips a rotation the endpoint would
 *     not have made (`near = isNearLimit(...) || liveExpired || sl.near`).
 *  2. `else if (sl.near)`: with the usage endpoint UNREACHABLE — a branch that previously always
 *     stayed put — a positive statusline reading rotates.
 *  3. **THE ASYMMETRY.** A statusline reading BELOW threshold must NEVER turn a rotation OFF. This
 *     is the claim that separates the shipped design from the one the card originally planned (a
 *     SUBSTITUTION, where the statusline replaces the endpoint read) — and the two look identical
 *     on every fixture where both sources agree. Only a DISAGREEING fixture can tell them apart, so
 *     that is what the asymmetry tests feed: endpoint says 99%, statusline says 10%, rotate anyway.
 *
 * Why the asymmetry is not paranoia: the one `usageRequest` supplies FOUR things and the statusline
 * can carry two. The model-scoped weekly windows (Fable 5 has one appearing in NEITHER top-level
 * bucket — TRDD-JI7F1236) and `liveStatus` (the 429 debounce, the 401/403 token-REJECTED branch,
 * `networkUp`) are ENDPOINT-ONLY. So "statusline 5h=10%" cannot license "not near": the account may
 * be fully spent on one model, or its token already rejected.
 *
 * 0-IMPACT / R16 SAFETY — identical to `oauth-rotator-tick.test.ts`: forced-off keychain backend +
 * HOME→temp (hard-guarded before any write) route every credential write into the temp dir, so the
 * real `Claude Code-credentials` is never touched and `security` is never spawned. Every network
 * call is a stub keyed on the bearer token. `autoRotate` DOES actuate `switchLiveTo` here — that is
 * the point of an integration test — and the guards are what make actuating it safe.
 *
 * NEUTERS — MEASURED, each reverted after. Counts are what the runs printed. See the tail.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { autoRotate, type TickDeps } from '@/lib/oauth-rotator/tick'
import { loadState, saveState, writeSlot, fingerprint, type RotatorState } from '@/lib/oauth-rotator/slots'
import { writeLiveBlob, readLiveBlob } from '@/lib/oauth-rotator/live'
import type { UsageObservation } from '@/lib/statusline-admissible'

const ENV_KEYS = ['HOME', 'USER', 'CLAUDE_SAFE_STORAGE_BACKEND', 'CLAUDE_PLUGIN_DATA'] as const
let saved: Record<string, string | undefined>
let tmpDir: string

beforeEach(() => {
  saved = {}
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-slbranch-'))
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

// ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────

/** 8h of runway — never locally expired, so `liveExpired` can never be the reason a test rotates.
 *  Load-bearing on the unreachable branch: an expired live blob is caught by the EARLIER
 *  `else if (liveExpired)` arm, and the branch under test would never be reached at all. */
const H8 = () => Date.now() + 8 * 3600 * 1000
const blob = (accessToken: string, expiresAt: number, refreshToken = 'r') => ({
  claudeAiOauth: { accessToken, refreshToken, expiresAt },
})

/** A fetch stub keyed on the bearer accessToken, returning per-token usage (or a bare status). */
function stubFetch(usageByToken: Record<string, { fh: number; sd: number } | number>): typeof fetch {
  return (async (url: unknown, init?: { headers?: Record<string, string> }) => {
    const u = String(url)
    const auth = init?.headers?.Authorization ?? init?.headers?.authorization ?? ''
    const tok = auth.replace('Bearer ', '')
    if (u.includes('/oauth/usage')) {
      const spec = usageByToken[tok]
      if (typeof spec === 'number') return new Response('{}', { status: spec })
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

/** A total outage. `httpJson` catches the throw and returns status 0, so `networkUp` is false and
 *  the live read lands in the `else if (sl.near)` arm — the branch this file exists to reach. */
const deadNetwork: typeof fetch = (async () => {
  throw new Error('ENETDOWN')
}) as unknown as typeof fetch

/** Seed the live credential + state so `reconcileLiveEmail` is a no-op (fp already matches, so no
 *  /roles round-trip) and `state.live_fp` is the value a snapshot must be stamped with to be
 *  admissible. `last_switch_at` is deliberately left unset: the dwell guard sits BETWEEN `near` and
 *  the rotation, so a stray value there would suppress a rotation for a reason unrelated to the
 *  branch under test. */
function seedLive(email: string, liveBlob: ReturnType<typeof blob>): string {
  writeLiveBlob(liveBlob)
  const st: RotatorState = loadState()
  st.live_email = email
  st.live_fp = fingerprint(liveBlob)
  st.slots = st.slots ?? {}
  saveState(st)
  return st.live_fp as string
}

function addSlot(email: string, slotBlob: ReturnType<typeof blob>): void {
  writeSlot(email, slotBlob)
  const st = loadState()
  st.slots = st.slots ?? {}
  st.slots[email] = { captured_at: 'now', fp: fingerprint(slotBlob), expires_at: null, via: 'test' }
  saveState(st)
}

/**
 * One statusline observation. `liveFp` MUST equal the live account's fingerprint or `admitSnapshot`
 * rejects it as `stale-account` — which would make every "the statusline tripped it" test pass or
 * fail for the wrong reason. The tests below assert the rendered `[statusline …]` fragment
 * precisely so an accidentally-inadmissible fixture cannot masquerade as a working one.
 */
const obs = (
  liveFp: string | null,
  capturedAt: number,
  fiveHour: number,
  sevenDay?: number,
): UsageObservation =>
  ({
    liveFp,
    capturedAt,
    rateLimits: {
      fiveHour: { usedPercentage: fiveHour },
      ...(sevenDay == null ? {} : { sevenDay: { usedPercentage: sevenDay } }),
    },
  }) as UsageObservation

/** A deps bundle on a FROZEN clock. `deps.now` returns SECONDS (this module's convention);
 *  `statuslineNear` converts to ms internally, and snapshot ages are built off the same instant so
 *  the 15-minute freshness window is deterministic. */
function makeDeps(
  fetchImpl: typeof fetch,
  snapshots: UsageObservation[] | undefined,
  nowMs: number,
): TickDeps & { lines: string[] } {
  const lines: string[] = []
  return {
    fetchImpl,
    now: () => nowMs / 1000,
    decide: (m: string) => { lines.push(m) },
    ...(snapshots === undefined ? {} : { readSnapshots: async () => snapshots }),
    lines,
  }
}

const liveToken = () => (readLiveBlob() as { claudeAiOauth: { accessToken: string } }).claudeAiOauth.accessToken

// ── BRANCH 1 — `liveStatus === 200`: near = isNearLimit(...) || liveExpired || sl.near ───────────

describe('autoRotate — the statusline disjunct inside the liveStatus===200 verdict', () => {
  it('does NOT rotate on a statusline-only signal — the 200 endpoint is ground truth here', async () => {
    // ⚠ THIS TEST WAS INVERTED ON 2026-08-02, and the inversion is the point. It was written to
    // pin `near = … || sl.near` (shipped in `d17fffbd`); adversarial review then established that
    // the disjunct RE-OPENS the burn loop this whole line of work exists to close, and it was
    // reverted. The test is kept, inverted, because it now guards the revert: re-adding the
    // disjunct turns this red.
    //
    // WHY the disjunct is unsound HERE specifically (it is not merely risky): the endpoint has
    // just returned 200 using the LIVE token, so it is ground truth for the exact two windows the
    // statusline carries. When they disagree the statusline is wrong by construction — so it can
    // never add a TRUE reason in this branch, only a false one.
    //
    // And the false one is near-deterministic. The stamp is who was live at ARRIVAL, not who
    // produced the report; sessions running through an A→B switch keep A's token in memory and go
    // on reporting A's ~98%, which ingest stamps with B's fp, post-switch — passing BOTH guards.
    // The fixture below is exactly that state: endpoint says the live account is at 10%, a
    // "98%" observation is admissible against it, and rotating on that is how the fleet burns.
    const nowMs = Date.now()
    const live = blob('LIVE', H8())
    const fp = seedLive('live@x', live)
    addSlot('alt@x', blob('ALT', H8()))
    const deps = makeDeps(
      stubFetch({ LIVE: { fh: 10, sd: 10 }, ALT: { fh: 5, sd: 5 } }),
      [obs(fp, nowMs - 30_000, 98, 40)],
      nowMs,
    )

    expect(await autoRotate(deps)).toBe(false)
    expect(loadState().live_email).toBe('live@x') // did not move
    expect(liveToken()).toBe('LIVE') // and neither did the credential
    // OBSERVABILITY SURVIVED THE REVERT, deliberately: the reading is still logged, it just does
    // not actuate. That is what makes the misattribution measurable in production before anyone
    // re-lands a debounced version — "endpoint 10%, statusline 98%" in one line IS the evidence.
    expect(deps.lines.join('\n')).toContain('5h=10% 7d=10% [statusline 5h=98% 7d=40% OVER-THRESHOLD]')
  })

  it('ASYMMETRY — a BELOW-threshold statusline does NOT cancel an endpoint-driven rotation', async () => {
    // THE test this file exists for. The two designs — disjunct (shipped) and substitution (the
    // card's original plan, refuted at the call site) — agree on every fixture where both sources
    // agree. Only a DISAGREEING one separates them: endpoint 99%, statusline 10%.
    //
    // ⚠ DO NOT DELETE THIS AS REDUNDANT — that it is the SOLE discriminator is MEASURED, not
    // asserted. Neutering the 200 branch to `near = sl.near` (i.e. implementing the substitution)
    // reddened ONLY this test and left every other one in the file GREEN, including the
    // positive-signal test that reads like the obvious guard against it. So the entire difference
    // between "the statusline may add a reason" and "the statusline replaces the endpoint" — the
    // distinction the whole card turns on — rests on this one assertion.
    //
    // It survives the 2026-08-02 revert with its discriminating power intact: with no disjunct at
    // all the endpoint's 99% still rotates (this test passes), while the substitution would compute
    // `near = false` from the statusline's 10% and refuse to rotate a maxed account (this test
    // reds). It therefore guards the CURRENT design as well as it guarded the reverted one.
    //
    // The assertion is a PAIR, deliberately. `switched === true` alone is satisfied by a build that
    // never read the statusline at all; the rendered `[statusline 5h=10% 7d=12%]` proves it READ,
    // UNDERSTOOD, and DECLINED to trip — and the absent OVER-THRESHOLD proves the declining was
    // real rather than a fixture that quietly failed admissibility.
    const nowMs = Date.now()
    const live = blob('LIVE', H8())
    const fp = seedLive('live@x', live)
    addSlot('alt@x', blob('ALT', H8()))
    const deps = makeDeps(
      stubFetch({ LIVE: { fh: 99, sd: 10 }, ALT: { fh: 5, sd: 5 } }),
      [obs(fp, nowMs - 30_000, 10, 12)],
      nowMs,
    )

    expect(await autoRotate(deps)).toBe(true)
    expect(loadState().live_email).toBe('alt@x')
    const log = deps.lines.join('\n')
    expect(log).toContain('[statusline 5h=10% 7d=12%]')
    expect(log).not.toContain('OVER-THRESHOLD')
  })

  it('CONTROL — neither source is near: no rotation, and the statusline was still read', async () => {
    // Non-vacuity for the two above: this fixture proves the harness can produce the NEGATIVE
    // outcome, so "it rotated" is a real observation rather than the only thing it can report. The
    // second assertion proves the quiet was a DECISION (an admissible 10% reading declined) and not
    // a silently-inadmissible snapshot.
    const nowMs = Date.now()
    const fp = seedLive('live@x', blob('LIVE', H8()))
    addSlot('alt@x', blob('ALT', H8()))
    const deps = makeDeps(
      stubFetch({ LIVE: { fh: 10, sd: 10 }, ALT: { fh: 5, sd: 5 } }),
      [obs(fp, nowMs - 30_000, 10, 12)],
      nowMs,
    )

    expect(await autoRotate(deps)).toBe(false)
    expect(loadState().live_email).toBe('live@x')
    expect(deps.lines.join('\n')).toContain('[statusline 5h=10% 7d=12%] — within limits')
  })
})

// ── BRANCH 2 — `else if (sl.near)`: the usage endpoint is UNREACHABLE ────────────────────────────

describe('autoRotate — the endpoint-unreachable branch (previously an unconditional stay-put)', () => {
  it('stays put when the usage API is down — pending the debounce this branch still lacks', async () => {
    // ⚠ ALSO INVERTED ON 2026-08-02, and for a DIFFERENT reason than its sibling above — worth
    // keeping straight, because the two reverts are not the same judgement.
    //
    // Here the disjunct was genuinely ADDITIVE: the endpoint said nothing, so the statusline was
    // the only signal, and "we cannot reach the usage API" really is not a reason to keep billing a
    // maxed account. This branch is worth re-landing. It was reverted anyway because it inherits
    // the SAME misattribution — an old session's report about the PREVIOUS account fires the
    // trigger just as readily — and the consequence is worse here than above: with the usage API
    // down every CANDIDATE is unevaluable too, so the rotation goes out blind on the `degraded`
    // path (most-runway-first) and can walk the whole fleet one dwell window at a time rather than
    // stalling on one account.
    //
    // `MIN_DWELL_S` does not bound that: `last_switch_at` is written only inside `switchLiveTo`
    // (rotate.ts:44), so a rotation that finds no candidate leaves the dwell untouched and the next
    // tick retries immediately.
    //
    // RE-LAND IT WITH: `sl.near` sustained across ≥2 consecutive ticks (mirroring
    // `LIVE_429_DEBOUNCE`, which exists for exactly this "one bad sample must not rotate" reason)
    // plus a statusline-specific dwell well above `MIN_DWELL_S`. When that lands, THIS test is the
    // one to invert back — and it should then assert the debounce, not just the rotation.
    const nowMs = Date.now()
    const fp = seedLive('live@x', blob('LIVE', H8()))
    addSlot('alt@x', blob('ALT', H8()))
    const deps = makeDeps(deadNetwork, [obs(fp, nowMs - 30_000, 99, 40)], nowMs)

    expect(await autoRotate(deps)).toBe(false)
    expect(loadState().live_email).toBe('live@x')
    expect(liveToken()).toBe('LIVE')
    expect(deps.lines.join('\n')).toContain('staying put')
  })

  it('GUARD — the same outage with a BELOW-threshold statusline still stays put', async () => {
    // Proves the new branch is gated on `sl.near` rather than on "the endpoint failed". Without
    // this, a build that rotates on ANY unreachable endpoint passes the test above — and that build
    // rotates the fleet away on every transient network blip, which is the fail-safe this branch
    // spent its whole life protecting.
    const nowMs = Date.now()
    const fp = seedLive('live@x', blob('LIVE', H8()))
    addSlot('alt@x', blob('ALT', H8()))
    const deps = makeDeps(deadNetwork, [obs(fp, nowMs - 30_000, 12, 8)], nowMs)

    expect(await autoRotate(deps)).toBe(false)
    expect(loadState().live_email).toBe('live@x')
    expect(liveToken()).toBe('LIVE')
    expect(deps.lines.join('\n')).toContain('usage unreachable (status 0) but token still valid locally; staying put')
  })

  it('GUARD — the same outage with NO statusline signal at all stays put (pre-card behaviour)', async () => {
    // An empty store must be byte-indistinguishable from the world before this card. Distinct from
    // the test above: that one pins "a reading that declines"; this one pins "no reading at all",
    // which is a different route to `sl.near === false` (`freshestAdmissibleUsage` returns null
    // before any threshold is consulted).
    const nowMs = Date.now()
    seedLive('live@x', blob('LIVE', H8()))
    addSlot('alt@x', blob('ALT', H8()))
    const deps = makeDeps(deadNetwork, [], nowMs)

    expect(await autoRotate(deps)).toBe(false)
    expect(loadState().live_email).toBe('live@x')
    const log = deps.lines.join('\n')
    expect(log).toContain('usage unreachable (status 0) but token still valid locally; staying put')
    expect(log).not.toContain('statusline') // nothing to render — the line is the old one, verbatim
  })

  it('GUARD — a MAXED reading stamped with an account that is no longer live never rotates', async () => {
    // The SIV45HOG loop at the site where it would actually burn the fleet. This branch fires when
    // the endpoint is down, i.e. exactly when there is no second opinion to catch a wrong-account
    // reading: a 99% report from the OLD credential would rotate off the fresh account, and the
    // next tick would do it again, at 60 s per iteration, unattended, while the log reads like
    // healthy rotation. `admitSnapshot` is what stops it; this asserts the guard is REACHED here.
    const nowMs = Date.now()
    seedLive('live@x', blob('LIVE', H8()))
    addSlot('alt@x', blob('ALT', H8()))
    const deps = makeDeps(deadNetwork, [obs('OLDOLDFP', nowMs - 30_000, 99, 95)], nowMs)

    expect(await autoRotate(deps)).toBe(false)
    expect(loadState().live_email).toBe('live@x')
    expect(deps.lines.join('\n')).toContain('staying put')
  })
})

// ── The default path: the wiring must not change a tick that supplies no statusline dep ─────────

describe('autoRotate — the disjunct is inert without an injected statusline seam', () => {
  it('reads the REAL (empty, temp-HOME) store and behaves exactly as before the card', async () => {
    // Every test above injects `readSnapshots`. This one does NOT — it exercises the production
    // default (`listStatuslineSnapshots()`), which under the temp HOME resolves to a directory that
    // does not exist. The fail-soft try/catch must swallow that, leave `sl.near` false, and produce
    // the pre-card verdict. A wiring that threw here would break every real tick on a host that has
    // never run a statusline hook — i.e. the common case.
    const nowMs = Date.now()
    seedLive('live@x', blob('LIVE', H8()))
    addSlot('alt@x', blob('ALT', H8()))
    const deps = makeDeps(stubFetch({ LIVE: { fh: 10, sd: 10 }, ALT: { fh: 5, sd: 5 } }), undefined, nowMs)

    expect(await autoRotate(deps)).toBe(false)
    expect(deps.lines.join('\n')).toContain('5h=10% 7d=10% — within limits') // no [statusline …] fragment
  })
})

/**
 * NEUTERS — MEASURED, each reverted after. Counts and names are what the runs PRINTED.
 * (Filled in below after measurement.)
 */
