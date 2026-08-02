/**
 * TRDD-GY0LJV6S box 5 — THE DRAIN-GUARD: no expiry-only rotation off a low-usage account onto the
 * last healthy slot.
 *
 * THE INCIDENT (2026-08-01, from the card): the rotator twice moved off `fmuaddib` — at 39%/24%,
 * then 9%/38% — purely because its stored token was expiring. When the target maxed out there was
 * no way back: `fmuaddib`'s slot copy was by then 10.9 days expired with 69 consecutive refresh
 * failures. The ACCOUNT had headroom the whole time; the rotator's copy of the key was dead. The
 * rotator drained its own escape hatch.
 *
 * ── WHAT THIS FILE HAS TO PROVE, and why each half is useless without the other ─────────────────
 * A guard that never fires is invisible, and a guard that fires too often is a stall. So the tests
 * come in PAIRS around every boundary: fires at 1 target / does NOT at 2; fires on a 9% account /
 * does NOT on a 95% one; fires on a 200 / does NOT on a 401. A file that only proved the firing
 * half would pass with `return true` substituted for the whole predicate.
 *
 * ── THE ONE THAT DISCRIMINATES THE DESIGN ───────────────────────────────────────────────────────
 * `viableTargets` counts USAGE-CONFIRMED candidates ONLY, never the `degraded` bucket. That single
 * choice is what separates this guard from a version that still reproduces the incident, and only
 * ONE fixture can see it: 0 confirmed candidates + 2 degraded ones. Under `candidates + degraded`
 * that fixture rotates a working 9%-usage account onto a target whose usage is unknown; under
 * `candidates` alone it holds. Every other fixture in this file agrees under both counts. It is
 * marked ⚠ Q2 below — do not delete it as redundant.
 *
 * ── THE SAFETY ARGUMENT THE WHOLE GUARD RESTS ON ────────────────────────────────────────────────
 * The guard is only ever reached after `usageRequest` returned 200 USING THE LIVE TOKEN, so the
 * token demonstrably works and `liveExpired` is a PREDICTION of failure. When the prediction comes
 * true the endpoint answers 401 — a branch where `expiryOnly` is false — and the rotation happens.
 * "THE ESCAPE HATCH" test is that claim, executed. Without it the guard would be indistinguishable
 * from a stall.
 *
 * 0-IMPACT / R16 SAFETY — identical to `oauth-rotator-tick.test.ts`: forced-off keychain backend +
 * HOME→temp (hard-guarded before any write) route every credential write into the temp dir, so the
 * real `Claude Code-credentials` is never touched and `security` is never spawned. Every network
 * call is a stub keyed on the bearer token. `autoRotate` DOES actuate `switchLiveTo` in the tests
 * that rotate — that is the point of an integration test — and those guards are what make it safe.
 *
 * NEUTERS — MEASURED, each reverted after. See the tail; counts and names are what the runs printed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { autoRotate, runTick, drainsLastEscapeHatch, type StuckReason, type TickDeps } from '@/lib/oauth-rotator/tick'
import { alertableTick } from '@/lib/oauth-rotator/server-tick'
import { loadState, saveState, writeSlot, fingerprint, type RotatorState } from '@/lib/oauth-rotator/slots'
import { writeLiveBlob, readLiveBlob } from '@/lib/oauth-rotator/live'

const ENV_KEYS = ['HOME', 'USER', 'CLAUDE_SAFE_STORAGE_BACKEND', 'CLAUDE_PLUGIN_DATA'] as const
let saved: Record<string, string | undefined>
let tmpDir: string

beforeEach(() => {
  saved = {}
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-drain-'))
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

/** 8h of runway — comfortably outside both EXPIRY_GRACE_H (0.5) and KEEPALIVE_AHEAD_H (6), so an
 *  alternate holding this is neither "locally expired" nor a keepalive candidate. */
const H8 = () => Date.now() + 8 * 3600 * 1000
/** 10 minutes — INSIDE EXPIRY_GRACE_H (0.5h), so `blobLocallyExpired` is true. This is the whole
 *  precondition of the guard: the live account's stored token is dying. */
const EXPIRING = () => Date.now() + 10 * 60 * 1000

const blob = (accessToken: string, expiresAt: number, refreshToken = 'r') => ({
  claudeAiOauth: { accessToken, refreshToken, expiresAt },
})

type UsageSpec = { fh: number; sd: number; scoped?: number } | number

/**
 * A fetch stub keyed on the bearer accessToken. `scoped` emits the MODEL-SCOPED `limits[]` shape
 * (`scope.model.display_name` + `percent`) that `worstScopedPercent` reads — the third axis, which
 * appears in NEITHER top-level bucket (TRDD-JI7F1236).
 *
 * `tokenExchangeStatus` is what makes the ⚠ Q2 fixture reachable: a non-200 there fails every
 * refresh, which is how a probe-failing alternate lands in `degraded` instead of being healed back
 * into `candidates`.
 */
function stubFetch(usageByToken: Record<string, UsageSpec>, tokenExchangeStatus = 200): typeof fetch {
  return (async (url: unknown, init?: { headers?: Record<string, string> }) => {
    const u = String(url)
    const auth = init?.headers?.Authorization ?? init?.headers?.authorization ?? ''
    const tok = auth.replace('Bearer ', '')
    if (u.includes('/oauth/usage')) {
      const spec = usageByToken[tok]
      if (typeof spec === 'number') return new Response('{}', { status: spec })
      if (!spec) return new Response('{}', { status: 200 }) // 200 with no windows ⇒ unknown usage
      const body: Record<string, unknown> = {
        five_hour: { utilization: spec.fh },
        seven_day: { utilization: spec.sd },
      }
      if (spec.scoped !== undefined) {
        body.limits = [{ scope: { model: { display_name: 'Fable 5' } }, percent: spec.scoped }]
      }
      return new Response(JSON.stringify(body), { status: 200 })
    }
    if (u.includes('/oauth/token')) {
      if (tokenExchangeStatus !== 200) return new Response('{}', { status: tokenExchangeStatus })
      return new Response(JSON.stringify({ access_token: 'NEW', refresh_token: 'nr', expires_in: 28800 }), { status: 200 })
    }
    if (u.includes('/roles')) {
      return new Response(JSON.stringify({ organization_name: "x@x's Organization" }), { status: 200 })
    }
    return new Response('{}', { status: 404 })
  }) as unknown as typeof fetch
}

/** Seed the live credential + state so `reconcileLiveEmail` is a no-op (the fp already matches, so
 *  no /roles round-trip). `last_switch_at` is deliberately left unset: the dwell guard sits between
 *  `near` and the rotation, and a stray value there would suppress a rotation for a reason that has
 *  nothing to do with the guard under test. */
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

function makeDeps(fetchImpl: typeof fetch): TickDeps & { lines: string[] } {
  const lines: string[] = []
  return {
    fetchImpl,
    decide: (m: string) => { lines.push(m) },
    // The statusline is not this card's box. An empty store makes `statuslineNear` return
    // `{near:false, usage:null}` deterministically, so nothing here depends on the disjunct's state.
    readSnapshots: async () => [],
    lines,
  }
}

const liveToken = () => (readLiveBlob() as { claudeAiOauth: { accessToken: string } }).claudeAiOauth.accessToken

// ── The pure predicate ───────────────────────────────────────────────────────────────────────────

describe('drainsLastEscapeHatch — the pure predicate', () => {
  const LOW = { fh: 9, sd: 38, scoped: null } // the incident's second reading

  it('holds ONLY when the rotation would spend the last healthy alternate (0 or 1), not at 2', () => {
    // The boundary, both sides. `<= 1` is "spares after the rotation would be zero": at 1 the
    // target IS the last one; at 0 there is nothing to rotate onto and this hold is a more honest
    // report than `all-maxed`, which would claim exhaustion on an account reading 9%.
    expect(drainsLastEscapeHatch({ expiryOnly: true, ...LOW, viableTargets: 0 })).toBe(true)
    expect(drainsLastEscapeHatch({ expiryOnly: true, ...LOW, viableTargets: 1 })).toBe(true)
    expect(drainsLastEscapeHatch({ expiryOnly: true, ...LOW, viableTargets: 2 })).toBe(false)
    expect(drainsLastEscapeHatch({ expiryOnly: true, ...LOW, viableTargets: 7 })).toBe(false)
  })

  it('never fires when expiry was NOT the sole reason — that is the 401 escape hatch', () => {
    // `expiryOnly` is assigned in exactly one branch of `autoRotate` (the 200 arm). Every other
    // branch leaves it false, which is what guarantees a genuinely dead token still rotates.
    expect(drainsLastEscapeHatch({ expiryOnly: false, ...LOW, viableTargets: 1 })).toBe(false)
    expect(drainsLastEscapeHatch({ expiryOnly: false, ...LOW, viableTargets: 0 })).toBe(false)
  })

  it('unknown usage never SUPPRESSES a rotation — unmeasurable is not low-usage', () => {
    // The mirror of `isNearLimit`'s null discipline. There, unknown never TRIPS a rotation; here it
    // must never UNTRIP one. An account we cannot measure is not an account we can call safe to
    // stay on, so the guard declines to protect it and the rotation proceeds.
    expect(drainsLastEscapeHatch({ expiryOnly: true, fh: null, sd: 38, scoped: null, viableTargets: 1 })).toBe(false)
    expect(drainsLastEscapeHatch({ expiryOnly: true, fh: 9, sd: null, scoped: null, viableTargets: 1 })).toBe(false)
    expect(drainsLastEscapeHatch({ expiryOnly: true, fh: null, sd: null, scoped: null, viableTargets: 1 })).toBe(false)
  })

  it('protects only real headroom — the 90-97 band is deliberately NOT protected', () => {
    // "Low usage" is `isSafeAlternate` (below SAFE=90 on every window), i.e. the rotator's own
    // "would I rotate ONTO this?" test — so no new threshold is invented. An account at 95% is
    // below the 97 SWITCH threshold, so `expiryOnly` is true there, and it still has no headroom
    // worth spending a guard on.
    expect(drainsLastEscapeHatch({ expiryOnly: true, fh: 89, sd: 89, scoped: null, viableTargets: 1 })).toBe(true)
    expect(drainsLastEscapeHatch({ expiryOnly: true, fh: 95, sd: 10, scoped: null, viableTargets: 1 })).toBe(false)
    expect(drainsLastEscapeHatch({ expiryOnly: true, fh: 10, sd: 95, scoped: null, viableTargets: 1 })).toBe(false)
  })

  it('a spent MODEL-SCOPED window means no headroom either, though 5h/7d read low', () => {
    // ⚠ NON-VACUITY: both cases hold 5h/7d at 9/38 — comfortably safe on both buckets — so the ONLY
    // thing that can change the verdict is the scoped argument. An account fully spent on Fable 5
    // is not an escape hatch worth keeping (TRDD-JI7F1236).
    expect(drainsLastEscapeHatch({ expiryOnly: true, fh: 9, sd: 38, scoped: 95, viableTargets: 1 })).toBe(false)
    expect(drainsLastEscapeHatch({ expiryOnly: true, fh: 9, sd: 38, scoped: 12, viableTargets: 1 })).toBe(true)
  })
})

// ── The call site ────────────────────────────────────────────────────────────────────────────────

describe('autoRotate — the drain-guard at its call site', () => {
  it('THE INCIDENT — a 9%/38% account with a dying token does NOT spend the last alternate', async () => {
    // 2026-08-01, reproduced: live has real headroom, its stored token is inside the 0.5h grace, and
    // exactly one healthy alternate exists. Pre-guard this rotated, stranding the headroom behind a
    // slot copy that went on to fail 69 refreshes.
    seedLive('live@x', blob('LIVE', EXPIRING()))
    addSlot('alt@x', blob('ALT', H8()))
    const deps = makeDeps(stubFetch({ LIVE: { fh: 9, sd: 38 }, ALT: { fh: 5, sd: 5 } }))
    const out: { stuck?: StuckReason } = {}

    expect(await autoRotate(deps, out)).toBe(false)
    expect(loadState().live_email).toBe('live@x') // did not move
    expect(liveToken()).toBe('LIVE') // and neither did the credential
    expect(out.stuck).toBe('drain-guard-hold')
    const log = deps.lines.join('\n')
    expect(log).toContain('DRAIN-GUARD')
    expect(log).toContain('+LOCALLY-EXPIRING') // proves expiry really was the reason it wanted to go
    expect(log).toContain('(1 usage-confirmed)')
  })

  it('BOUNDARY — the same account rotates when a SECOND healthy alternate exists', async () => {
    // The guard is scoped to "the LAST healthy slot", not to "any expiry-only rotation". Without
    // this pair, `return true` for the whole predicate would pass the test above.
    seedLive('live@x', blob('LIVE', EXPIRING()))
    addSlot('alt1@x', blob('ALT1', H8()))
    addSlot('alt2@x', blob('ALT2', H8()))
    const deps = makeDeps(stubFetch({ LIVE: { fh: 9, sd: 38 }, ALT1: { fh: 5, sd: 5 }, ALT2: { fh: 40, sd: 40 } }))

    expect(await autoRotate(deps)).toBe(true)
    // DRAIN-FIRST still picks the fullest safe candidate, so the guard has not perturbed selection.
    expect(loadState().live_email).toBe('alt2@x')
    expect(deps.lines.join('\n')).not.toContain('DRAIN-GUARD')
  })

  it('⚠ Q2 — DEGRADED slots are NOT spares: 0 confirmed + 2 degraded still holds', async () => {
    // ⚠ THE SOLE DISCRIMINATOR of the counting rule. Do not delete as redundant — every other
    // fixture in this file behaves identically under `candidates` and `candidates + degraded`.
    //
    // Both alternates fail their usage probe (500) and then fail the refresh, so they land in
    // `degraded` — "not provably dead", which is NOT "healthy". A paper spare that was dead in fact
    // IS the incident. Counting them would send a working 9%-usage account onto a target whose
    // usage is unknown, via the degraded fallback, for an expiry that has not yet happened — which
    // is a worse trade than the one the guard was written to stop.
    //
    // Under `viableTargets: candidates.length + degraded.length` this reads 2, the guard stands
    // down, and the rotation goes through: this test reds. Under `candidates.length` it reads 0.
    seedLive('live@x', blob('LIVE', EXPIRING()))
    addSlot('alt1@x', blob('ALT1', H8()))
    addSlot('alt2@x', blob('ALT2', H8()))
    const deps = makeDeps(stubFetch({ LIVE: { fh: 9, sd: 38 }, ALT1: 500, ALT2: 500 }, 400))
    const out: { stuck?: StuckReason } = {}

    expect(await autoRotate(deps, out)).toBe(false)
    expect(loadState().live_email).toBe('live@x')
    expect(liveToken()).toBe('LIVE')
    expect(out.stuck).toBe('drain-guard-hold')
    // `(0 usage-confirmed)` is the assertion that proves the degraded pair was SEEN and excluded,
    // rather than the fixture having quietly produced no alternates at all.
    expect(deps.lines.join('\n')).toContain('(0 usage-confirmed)')
  })

  it('THE ESCAPE HATCH — a token that has actually DIED (401) rotates, guard or no guard', async () => {
    // The claim the whole design rests on, executed. The guard only ever suppresses while the
    // endpoint accepts the live token; a real failure answers 401, which lands in the token-REJECTED
    // branch where `expiryOnly` is never assigned. So the cost of holding is bounded at one tick.
    seedLive('live@x', blob('LIVE', EXPIRING()))
    addSlot('alt@x', blob('ALT', H8()))
    const deps = makeDeps(stubFetch({ LIVE: 401, ALT: { fh: 5, sd: 5 } }))

    expect(await autoRotate(deps)).toBe(true)
    expect(loadState().live_email).toBe('alt@x')
    expect(liveToken()).toBe('ALT')
    const log = deps.lines.join('\n')
    expect(log).toContain('token REJECTED')
    expect(log).not.toContain('DRAIN-GUARD')
  })

  it('an account NEAR a limit rotates even when it is also expiring — expiry was not the sole reason', async () => {
    // `expiryOnly = liveExpired && !usageNear`. Drop the `&& !usageNear` and a maxed account with a
    // dying token would be held onto, which inverts the rotator's entire purpose.
    seedLive('live@x', blob('LIVE', EXPIRING()))
    addSlot('alt@x', blob('ALT', H8()))
    const deps = makeDeps(stubFetch({ LIVE: { fh: 98, sd: 38 }, ALT: { fh: 5, sd: 5 } }))

    expect(await autoRotate(deps)).toBe(true)
    expect(loadState().live_email).toBe('alt@x')
    expect(deps.lines.join('\n')).not.toContain('DRAIN-GUARD')
  })

  it('an account with no headroom worth saving (95%) rotates on expiry alone', async () => {
    // 95 is below the 97 SWITCH threshold, so this IS an expiry-only rotation — the guard is
    // reached and declines, because 95 >= SAFE (90). The pure test pins the arithmetic; this pins
    // that the call site actually feeds it the live account's real numbers.
    seedLive('live@x', blob('LIVE', EXPIRING()))
    addSlot('alt@x', blob('ALT', H8()))
    const deps = makeDeps(stubFetch({ LIVE: { fh: 95, sd: 10 }, ALT: { fh: 5, sd: 5 } }))

    expect(await autoRotate(deps)).toBe(true)
    expect(loadState().live_email).toBe('alt@x')
    expect(deps.lines.join('\n')).not.toContain('DRAIN-GUARD')
  })

  it('WIRING — the model-scoped window reaches the guard, not just the two top-level buckets', async () => {
    // ⚠ The pure predicate could be perfectly tested and handed `scoped: null` at the call site, and
    // every other test in this file would still pass. This is the only one that observes `sc` being
    // threaded through: 5h/7d read 9/38 (protected), Fable 5 reads 95 (not), so the ONLY thing that
    // can produce a rotation here is the scoped value arriving.
    seedLive('live@x', blob('LIVE', EXPIRING()))
    addSlot('alt@x', blob('ALT', H8()))
    const deps = makeDeps(stubFetch({ LIVE: { fh: 9, sd: 38, scoped: 95 }, ALT: { fh: 5, sd: 5 } }))

    expect(await autoRotate(deps)).toBe(true)
    expect(loadState().live_email).toBe('alt@x')
    const log = deps.lines.join('\n')
    expect(log).toContain('Fable 5=95%') // the fixture really did carry a scoped window
    expect(log).not.toContain('DRAIN-GUARD')
  })

  it('a healthy, non-expiring account is untouched — the guard adds no new rotation reason', async () => {
    // Non-vacuity for the whole file: the harness can produce "nothing happened for the ORDINARY
    // reason", so a hold is a real observation rather than the only thing this fixture can report.
    seedLive('live@x', blob('LIVE', H8()))
    addSlot('alt@x', blob('ALT', H8()))
    const deps = makeDeps(stubFetch({ LIVE: { fh: 9, sd: 38 }, ALT: { fh: 5, sd: 5 } }))
    const out: { stuck?: StuckReason } = {}

    expect(await autoRotate(deps, out)).toBe(false)
    expect(out.stuck).toBeUndefined() // "did not need to rotate" is not "could not rotate"
    expect(deps.lines.join('\n')).toContain('within limits')
  })
})

// ── The hold must REACH a human ──────────────────────────────────────────────────────────────────

describe('runTick — the hold is REPORTED, never swallowed', () => {
  it('surfaces the hold as a stuck reason and an alertable code, not as "no action needed"', async () => {
    // TRDD-RFQFCCU4, one branch further along. `surveyAlternates` skips the LIVE account, and
    // `keepaliveRefresh` never refreshes it by design — so the drain-guard's own fact (the live
    // credential is the one dying, and there is at most one spare) is invisible to every other part
    // of the beat. Reported only through `decide()`, this state would render as
    // `nextAction: 'ok'` + `'no action needed'`: a fleet one credential away from the 2026-08-02
    // lockout, describing itself as healthy. That is the exact defect `StuckReason` exists to close.
    seedLive('live@x', blob('LIVE', EXPIRING()))
    addSlot('alt@x', blob('ALT', H8()))
    const deps = makeDeps(stubFetch({ LIVE: { fh: 9, sd: 38 }, ALT: { fh: 5, sd: 5 } }))

    const result = await runTick(deps)
    expect(result.switched).toBe(false)
    expect(result.stuck).toBe('drain-guard-hold')
    expect(result.decision).toContain('HOLDING')
    expect(result.decision).not.toContain('no action needed')
    // `all-maxed` would be a LIE here — the live account reads 9%/38%. Separate codes, separate
    // backoff, separate resolve-detection (server-tick.ts:185).
    expect(result.decision).not.toContain('all paid accounts maxed')

    // The delivery wiring, not just the field: `alertableTick` is what decides whether a human ever
    // hears about this, and it admits any defined `stuck` regardless of `nextAction`.
    const alertable = alertableTick(result)
    expect(alertable).not.toBeNull()
    expect(alertable?.stuck).toBe('drain-guard-hold')
  })

  it('CONTROL — a healthy tick stays alertable-null, so the new code cannot become background noise', async () => {
    // Pairs with the test above. Without it, a build that made `alertableTick` return non-null
    // unconditionally would pass, and every 60s beat would page the owner.
    seedLive('live@x', blob('LIVE', H8()))
    addSlot('alt@x', blob('ALT', H8()))
    const deps = makeDeps(stubFetch({ LIVE: { fh: 9, sd: 38 }, ALT: { fh: 5, sd: 5 } }))

    const result = await runTick(deps)
    expect(result.stuck).toBeUndefined()
    expect(alertableTick(result)).toBeNull()
  })
})

/**
 * NEUTERS — MEASURED, each reverted after. Counts and names are what the runs PRINTED.
 * (Filled in below after measurement.)
 */
