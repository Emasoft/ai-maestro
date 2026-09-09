import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  blobLocallyExpired,
  isNearLimit,
  isSafeAlternate,
  isAccountWindowSafe,
  selectDrainFirst,
  modelsInUse,
  scopedVetoPct,
  isScopedOnlyWall,
  autoRotate,
  keepaliveRefresh,
  runTick,
  type Candidate,
  type TickDeps,
  surveyAlternates,
} from '@/lib/oauth-rotator/tick'
import { setKeychainDenied, keychainDeniedLatched } from '@/lib/oauth-rotator/safe-storage'
import { loadState, saveState, writeSlot, readSlot, fingerprint, type RotatorState } from '@/lib/oauth-rotator/slots'
import { writeLiveBlob, readLiveBlob } from '@/lib/oauth-rotator/live'

// 0-IMPACT / R16 SAFETY: autoRotate/keepalive can call writeSlot + switchLiveTo→writeLiveBlob.
// Forced-off backend + HOME→temp (hard-guarded) route every credential write to the temp dir; the
// real keychain / `Claude Code-credentials` are never touched and `security` is never spawned. All
// network is a stub `fetch` keyed on the bearer token — no real OAuth endpoint is called.

// JANITOR_GLOBAL_STATE_DIR is CONTAINMENT, not decoration: `surveyAlternates` now reads the
// keychain denied-latch, whose file lives in the global state dir. Left unset, every tick in this
// file would read the DEVELOPER'S real latch (so the suite's verdict would depend on the machine's
// keychain history) and the one test that SETS the latch would write into it.
const ENV_KEYS = ['HOME', 'USER', 'CLAUDE_SAFE_STORAGE_BACKEND', 'CLAUDE_PLUGIN_DATA', 'JANITOR_GLOBAL_STATE_DIR'] as const
let saved: Record<string, string | undefined>
let tmpDir: string

beforeEach(() => {
  saved = {}
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-tick-'))
  process.env.HOME = tmpDir
  process.env.CLAUDE_SAFE_STORAGE_BACKEND = 'none'
  process.env.JANITOR_GLOBAL_STATE_DIR = tmpDir
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
function stubFetch(usageByToken: Record<string, { fh: number; sd: number; scoped?: number; scopedModel?: string } | number>): typeof fetch {
  return (async (url: unknown, init?: { headers?: Record<string, string> }) => {
    const u = String(url)
    const auth = init?.headers?.Authorization ?? init?.headers?.authorization ?? ''
    const tok = auth.replace('Bearer ', '')
    if (u.includes('/oauth/usage')) {
      const spec = usageByToken[tok]
      if (typeof spec === 'number') return new Response('{}', { status: spec }) // an HTTP status (e.g. 429)
      const body = spec
        ? {
            five_hour: { utilization: spec.fh },
            seven_day: { utilization: spec.sd },
            // A MODEL-SCOPED weekly window, in the exact shape `scopedLimits` parses: a `limits[]`
            // entry carrying `scope.model.display_name` + `percent`. Emitted ONLY when the case
            // asks for one, so every pre-existing expectation stays byte-identical.
            ...(spec.scoped === undefined
              ? {}
              : { limits: [{ scope: { model: { display_name: spec.scopedModel ?? 'Fable 5' } }, percent: spec.scoped }] }),
          }
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

  it('isSafeAlternate: SAFE_SCOPED=95 hysteresis — prefer a rotate with Fable headroom over none', () => {
    // A 2-point margin under the 97 rotate-away trip: an alternate must not be accepted only to
    // trip away on the very next tick. 94 has real headroom and is accepted; 95 and 96 are close
    // enough to the trip point to be rejected.
    expect(isSafeAlternate(10, 10, 94)).toBe(true)
    expect(isSafeAlternate(10, 10, 95)).toBe(false)
    expect(isSafeAlternate(10, 10, 96)).toBe(false)
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

/** The MODEL-SCOPED FALLBACK. Regression cover for a measured incident (2026-08-06): the rotator
 *  wrote `stuck: "all-maxed"` and refused to move while an account sat at 4% of its 5h window,
 *  because Fable's model-scoped window was spent on EVERY account and `isSafeAlternate` demands
 *  every window below SAFE. Eight sessions were pinned on a 99%-used account as a result. */
describe('tick — autoRotate: model-scoped fallback (all-maxed regression)', () => {
  it('rotates onto an account blocked ONLY by a spent MODEL window — a total outage beats a partial one', async () => {
    seedLive('live@x', blob('LIVE', H8()))
    addSlot('alt@x', blob('ALT', H8()))
    // ALT's ACCOUNT windows are wide open; only its Fable window is spent. Before the fix this
    // returned false and the tick reported all-maxed while ALT had ~90% of its 5h free.
    const deps: TickDeps = {
      fetchImpl: stubFetch({ LIVE: { fh: 98, sd: 50, scoped: 99 }, ALT: { fh: 10, sd: 10, scoped: 95 } }),
    }

    expect(await autoRotate(deps)).toBe(true)
    expect(loadState().live_email).toBe('alt@x')
  })

  it('still PREFERS a fully-safe account when one exists — the fallback is last-resort only', async () => {
    seedLive('live@x', blob('LIVE', H8()))
    addSlot('scopedbad@x', blob('SCOPEDBAD', H8()))
    addSlot('fullysafe@x', blob('FULLYSAFE', H8()))
    // SCOPEDBAD is the DRAIN-FIRST winner on account windows alone (80 > 10), so if the fallback
    // leaked into the preferred set it would be chosen. It must not be: it is held back entirely
    // while FULLYSAFE passes the full test.
    //
    // LIVE carries `scoped: 99` since TRDD-IZ6KU37Y: the veto is now MODEL-IDENTITY-aware and
    // fails OPEN when the live account shows no model in use (the janitor#222 rule), so this
    // test's claim — a same-model-spent target is deprioritized — needs the live evidence that
    // Fable IS the model in use. Without it, SCOPEDBAD legitimately stops being vetoed.
    const deps: TickDeps = {
      fetchImpl: stubFetch({
        LIVE: { fh: 98, sd: 50, scoped: 99 },
        SCOPEDBAD: { fh: 80, sd: 10, scoped: 95 },
        FULLYSAFE: { fh: 10, sd: 10, scoped: 10 },
      }),
    }

    expect(await autoRotate(deps)).toBe(true)
    expect(loadState().live_email).toBe('fullysafe@x')
  })

  it('does NOT rescue an account that is genuinely maxed on its ACCOUNT windows', async () => {
    seedLive('live@x', blob('LIVE', H8()))
    addSlot('alt@x', blob('ALT', H8()))
    // ALT fails BOTH tests: 5h spent AND Fable spent. The fallback must not touch it — it exists
    // to relax the model check, never the account check.
    const deps: TickDeps = {
      fetchImpl: stubFetch({ LIVE: { fh: 98, sd: 50 }, ALT: { fh: 99, sd: 10, scoped: 95 } }),
    }

    expect(await autoRotate(deps)).toBe(false)
    expect(loadState().live_email).toBe('live@x')
  })

  it('isAccountWindowSafe: the ACCOUNT half only — a spent model window is not its business', () => {
    expect(isAccountWindowSafe(10, 10)).toBe(true)
    expect(isAccountWindowSafe(89, 89)).toBe(true)
    expect(isAccountWindowSafe(90, 10)).toBe(false)
    expect(isAccountWindowSafe(10, 95)).toBe(false)
    // The whole point: identical inputs, opposite verdicts, because one consults the model window.
    expect(isSafeAlternate(10, 10, 95)).toBe(false)
    expect(isAccountWindowSafe(10, 10)).toBe(true)
  })
})

/** THE SCOPED-ONLY ROTATION POLICY (TRDD-IZ6KU37Y — the server-side mirror of the janitor's
 *  post-#222 rules, their v3.3.2 f185e521): a live account walled SOLELY on a model-scoped
 *  window rotates ONLY onto an alternate with headroom on that same model; when none exists it
 *  stays put (no scoped-spent push, no degraded rotation) and the all-maxed verdict hands the
 *  wall to the model-fallback lane. */
describe('tick — autoRotate: scoped-only wall (janitor#222 mirror)', () => {
  it('scoped wall at 97% (the equal-trip gate, TRDD-IZ6KU37Y 2026-09-06) + a scoped-clear alternate → rotates onto it', async () => {
    seedLive('live@x', blob('LIVE', H8()))
    addSlot('clear@x', blob('CLEAR', H8()))
    // Accounts healthy (40/50 ≤ 90 headroom), Fable at 97 ≥ the shared gate. The scoped-only
    // verdict fires at exactly the same number `isNearLimit`'s scoped disjunct would — the
    // equal-trip fix removed the old 90-vs-97 gap, but the rotation is still driven by
    // `scopedWall`, which is what routes this as scoped-only (not a generic near-limit rotate).
    const deps: TickDeps = {
      fetchImpl: stubFetch({ LIVE: { fh: 40, sd: 50, scoped: 97 }, CLEAR: { fh: 20, sd: 20, scoped: 10 } }),
    }
    expect(await autoRotate(deps)).toBe(true)
    expect(loadState().live_email).toBe('clear@x')
  })

  it('scoped at 92% (below the 97 gate) → NEITHER the wall nor a rotation trips (equal-trip invariant)', async () => {
    seedLive('live@x', blob('LIVE', H8()))
    addSlot('clear@x', blob('CLEAR', H8()))
    // Same fixture as above, scoped dropped from 97 to 92: at 92 the live account is not near
    // any limit at all (account windows healthy, scoped below the now-97 gate), so autoRotate
    // must decline entirely — no scoped-only push, no generic rotate. This is the other half of
    // the TRDD-IZ6KU37Y equal-trip fix: at 97 both `isScopedOnlyWall` and `planModelFallback`
    // trip; at 92 neither does.
    const deps: TickDeps = {
      fetchImpl: stubFetch({ LIVE: { fh: 40, sd: 50, scoped: 92 }, CLEAR: { fh: 20, sd: 20, scoped: 10 } }),
    }
    expect(await autoRotate(deps)).toBe(false)
    expect(loadState().live_email).toBe('live@x')
  })

  it('scoped wall + only same-model-spent alternates → NO rotation, verdict all-maxed', async () => {
    seedLive('live@x', blob('LIVE', H8()))
    addSlot('spent@x', blob('SPENT', H8()))
    // SPENT is account-healthy (10/10) but Fable-spent (95): before this card the scopedOnly
    // fallback would have rotated onto it — burning the dwell window and a healthy account for a
    // model that stays walled either way. LIVE at 97 hits the (now equal-trip) scoped gate.
    const deps: TickDeps = {
      fetchImpl: stubFetch({ LIVE: { fh: 40, sd: 50, scoped: 97 }, SPENT: { fh: 10, sd: 10, scoped: 95 } }),
    }
    const out: { stuck?: unknown } = {}
    expect(await autoRotate(deps, out as never)).toBe(false)
    expect(loadState().live_email).toBe('live@x')
    expect(out.stuck).toBe('all-maxed') // what hands the wall to the model-fallback lane
  })

  it('scoped wall + only a DEGRADED alternate → no degraded rotation either', async () => {
    seedLive('live@x', blob('LIVE', H8()))
    addSlot('deg@x', blob('DEG', H8()))
    // DEG's probe answers 503, the refresh mints NEW, and NEW's probe answers 503 again — the
    // exact path that lands a slot in the `degraded` bucket. An ACCOUNT wall rotates onto it
    // (the tier-2 fallback); a scoped-only wall must NOT — a blind rotation off a healthy
    // account recovers nothing the /model switch would not. LIVE at 97 hits the scoped gate.
    const deps: TickDeps = {
      fetchImpl: stubFetch({ LIVE: { fh: 40, sd: 50, scoped: 97 }, DEG: 503, NEW: 503 }),
    }
    expect(await autoRotate(deps)).toBe(false)
    expect(loadState().live_email).toBe('live@x')
  })

  it('veto is MODEL-scoped: a candidate spent on a DIFFERENT model stays a first-choice target', async () => {
    seedLive('live@x', blob('LIVE', H8()))
    addSlot('other@x', blob('OTHER', H8()))
    // The live account runs Fable (scoped-only wall); OTHER is spent only on Haiku. The blanket
    // worstScopedPercent veto would have rejected it (95 ≥ SAFE) — the exact shape that
    // sidelined the fleet's healthiest account for ~123h (janitor#222). The model-identity veto
    // lets it through as a FIRST-choice target. The scoped-only wall is what makes this fixture
    // discriminate: under the blanket veto OTHER lands in `scopedOnly`, the scoped wall blocks
    // the push, and NO rotation happens — so a regression here reds on the return value, not
    // merely on which tier rotated.
    const deps: TickDeps = {
      fetchImpl: stubFetch({
        LIVE: { fh: 40, sd: 50, scoped: 99 },
        OTHER: { fh: 10, sd: 10, scoped: 95, scopedModel: 'Haiku 4.5' },
      }),
    }
    expect(await autoRotate(deps)).toBe(true)
    expect(loadState().live_email).toBe('other@x')
  })

  it('modelsInUse: percent>0 is evidence; explicit isActive:false withdraws it; missing does not', () => {
    const usage = {
      limits: [
        { scope: { model: { display_name: 'Fable 5' } }, percent: 42 },
        { scope: { model: { display_name: 'Opus 5' } }, percent: 3, is_active: false },
        { scope: { model: { display_name: 'Haiku 4.5' } }, percent: 0 },
      ],
    }
    expect(modelsInUse(usage)).toEqual(new Set(['fable']))
    expect(modelsInUse(null)).toEqual(new Set()) // no payload → NO EVIDENCE, not "no models"
  })

  it('scopedVetoPct: fails OPEN on empty evidence and on cross-model spends; reports the in-use worst', () => {
    const cand = { limits: [{ scope: { model: { display_name: 'Fable 5' } }, percent: 95 }] }
    expect(scopedVetoPct(new Set(), cand)).toBeNull() // no live evidence → nothing can veto
    expect(scopedVetoPct(new Set(['opus']), cand)).toBeNull() // spent on a model nobody runs
    expect(scopedVetoPct(new Set(['fable']), cand)).toBe(95)
  })

  it('isScopedOnlyWall: 97 scoped gate / 90 account-headroom gate, both inclusive; headroom must be PROVEN', () => {
    expect(isScopedOnlyWall(40, 50, 97)).toBe(true)
    expect(isScopedOnlyWall(90, 90, 97)).toBe(true) // both gates inclusive, per the shared policy
    expect(isScopedOnlyWall(98, 50, 97)).toBe(false) // the ACCOUNT is (also) the constraint
    expect(isScopedOnlyWall(40, 50, 92)).toBe(false) // scoped below the (equal-trip) 97 gate
    expect(isScopedOnlyWall(40, 50, 96)).toBe(false) // one point under the gate — still false
    expect(isScopedOnlyWall(40, 50, null)).toBe(false) // no scoped window at all
    expect(isScopedOnlyWall(null, null, 97)).toBe(false) // headroom unproven → never claim it
    expect(isScopedOnlyWall(null, 50, 97)).toBe(true) // one proven window suffices
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

// TRDD-Y1ZWU998: only a verdict FROM THE ENDPOINT (invalid_grant → 400) may brand a credential
// dead. Measured live 2026-08-20: all three slots on this host carried the human-only retry ban
// over 775/567/219 consecutive NETWORK failures — credentials nothing had ever rejected.
describe('tick — keepaliveRefresh never brands a TRANSIENT failure as credential-dead', () => {
  function countingNetworkDownFetch(): { impl: typeof fetch; calls: () => number } {
    let n = 0
    const impl = (async (url: unknown) => {
      const u = String(url)
      if (u.includes('/oauth/token')) { n++; throw new Error('network down') }
      if (u.includes('/oauth/usage')) return new Response('{}', { status: 200 })
      return new Response('{}', { status: 404 })
    }) as unknown as typeof fetch
    return { impl, calls: () => n }
  }

  it('a network failure increments the counter and records the cause, but sets NO refresh_dead_fp and never arms the ban', async () => {
    seedLive('live@x', blob('LIVE', H8()))
    addSlot('flaky@x', blob('FLAKY', H1()))
    const f = countingNetworkDownFetch()

    for (let i = 0; i < 4; i++) await keepaliveRefresh({ fetchImpl: f.impl })

    // 4 beats → 4 attempts: past MAX the slot is STILL retried, because no ban armed.
    expect(f.calls()).toBe(4)
    const meta = loadState().slots?.['flaky@x'] as unknown as Record<string, unknown>
    expect(meta.refresh_failures).toBe(4)
    expect(meta.last_refresh_failure).toBe('network')
    expect(meta.refresh_dead_fp).toBeUndefined()
  })

  it('SELF-HEALS a pre-fix mis-brand: a refresh_dead_fp standing beside a retryable last-cause is cleared and the exchange retried', async () => {
    seedLive('live@x', blob('LIVE', H8()))
    addSlot('branded@x', blob('BRANDED', H1()))
    // Seed the defect state the pre-fix code left on every live slot: banned at MAX with the
    // janitor's own classifier calling the failures transport-level.
    const st = loadState()
    const meta0 = st.slots!['branded@x'] as unknown as Record<string, unknown>
    meta0.refresh_failures = 567
    meta0.refresh_dead_fp = fingerprint(blob('BRANDED', H1()))
    meta0.last_refresh_failure = 'network'
    saveState(st)
    const f = countingFailingTokenFetch() // 400 → the endpoint NOW judges it: an honest re-brand

    await keepaliveRefresh({ fetchImpl: f.impl })

    // The mis-brand was cleared, so the exchange was ATTEMPTED (pre-fix: 0 calls, banned forever).
    expect(f.calls()).toBe(1)
    const meta = loadState().slots?.['branded@x'] as unknown as Record<string, unknown>
    // ...and the 400 verdict re-branded it honestly, with the cause recorded.
    expect(meta.last_refresh_failure).toBe('credential-dead')
    expect(meta.refresh_dead_fp).toBeDefined()
  })

  it('heals a mis-brand even when the slot blob is UNREADABLE from this process', async () => {
    // Measured live 2026-08-20: the mis-branded slots were exactly the keychain-unreadable ones,
    // so a heal placed after readSlot's `if (!blob) continue` never reached them. The heal needs
    // only the meta — seed a slot entry in state with NO slot file behind it.
    seedLive('live@x', blob('LIVE', H8()))
    const st = loadState()
    st.slots!['ghost@x'] = {
      refresh_failures: 775,
      refresh_dead_fp: 'fp-of-a-blob-this-process-cannot-read',
      last_refresh_failure: 'network',
    } as never
    saveState(st)

    await keepaliveRefresh({ fetchImpl: countingFailingTokenFetch().impl })

    const meta = loadState().slots?.['ghost@x'] as unknown as Record<string, unknown>
    expect(meta.refresh_dead_fp).toBeUndefined() // un-bricked despite the unreadable blob
    expect(meta.refresh_failures).toBe(775) // nothing attempted, nothing re-counted — read still fails
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

  // TRDD-MFTDMSJY. The SAME registered-but-unreadable slot as the test above — the ONLY difference
  // is that the denied-latch is set, so `readSlot` returned null because nothing spawned rather
  // than because the keychain refused. Before this, both produced `reauth-needed: slot-unreadable`,
  // i.e. a call for a human re-login for a block entirely on the SERVER's side, ~7.6 times a day
  // for 46 days. Pairing the two tests is the point: they differ in one precondition and must
  // differ in the verdict.
  //
  // NEUTER (2026-08-28 — OBSERVED, restored + re-run green):
  //   s/if \(keychainDeniedLatched\(\)\) return \{ unreadable: \[\].../if (false) return {.../
  //     → 1 red / 59 green on the 2-file selection (this file + oauth-rotator-safe-storage.test.ts):
  //     this test, and only this test. NOT re-run against the full suite; the complement was.
  // The COMPLEMENT is in oauth-rotator-safe-storage.test.ts (TIMEOUT_LATCH_THRESHOLD 3 → 1,
  // 3 red / 57 green). Neither mutation reaches the other's tests, so each half of the fix is
  // pinned on its own — a single shared neuter would have certified one half it never touched.
  it('does NOT call for a re-login when the reads were SUPPRESSED by the keychain latch', async () => {
    seedLive('live@x', blob('LIVE', H8()))
    const st = loadState()
    st.slots = { ...(st.slots ?? {}), 'ghost@x': { captured_at: 'now', fp: 'deadbeef', expires_at: null, via: 'test' } }
    saveState(st)
    setKeychainDenied('test: pretend a prior op latched the machine')
    expect(keychainDeniedLatched()).toBe(true) // the premise, asserted — not assumed
    expect(fs.existsSync(path.join(tmpDir, 'keychain-denied.latch'))).toBe(true) // and CONTAINED

    const survey = surveyAlternates()
    expect(survey.probeSuppressed).toBe(true)
    expect(survey.unreadable).toEqual([]) // we declined to ask, so we claim nothing

    const res = await runTick({ fetchImpl: stubFetch({ LIVE: { fh: 20, sd: 20 } }) })
    expect(res.nextAction).toBe('stuck')
    expect(res.stuck).toBe('keychain-latched')
    expect(res.reason).toBeUndefined() // NOT slot-unreadable, NOT refresh-dead
    expect(res.decision).not.toContain('no action needed') // blind must not read as health
    expect(res.decision).not.toContain('reauth')
  })

  // TRDD-JDXTJXE7. The identity the survey computed is CARRIED on the result for the alert, and
  // the decision line — the 60 s append-only LOG — still names nobody. Both directions pinned
  // on the same run: `identities` has the email, `decision` (and the `decide` sink, which is
  // what reaches the log) has no '@' at all.
  it('carries the surveyed identities on the result while the decision line stays email-free', async () => {
    seedLive('live@x', blob('LIVE', H8()))
    addSlot('dead@x', blob('DEAD', Date.now() - 1000, ''))
    const logged: string[] = []
    const res = await runTick({ fetchImpl: stubFetch({ LIVE: { fh: 20, sd: 20 } }), decide: (m) => logged.push(m) })
    expect(res.reason).toBe('refresh-dead')
    expect(res.identities).toEqual({ unreadable: [], refreshDead: ['dead@x'] })
    expect(res.decision).not.toMatch(/@/)
    // The DECISION line reached the log sink and is the email-free one. Scoped to that line on
    // purpose: `autoRotate` already logs `auto: live <email> …` (the LIVE account, pre-existing,
    // rotate.ts) through the same sink — measured when this test first asserted over every line
    // and reddened on it. That is a separate, pre-existing fact recorded on TRDD-JDXTJXE7; the
    // counts-only rule this pins is the decision line's.
    expect(logged).toContain(res.decision)
  })

  it('attributes reauth-needed to refresh-dead when a readable alternate has no refresh and is expired', async () => {
    seedLive('live@x', blob('LIVE', H8()))
    // Empty refresh token = an unrefreshable setup-token slot (`Boolean('')` is false), expired.
    addSlot('dead@x', blob('DEAD', Date.now() - 1000, ''))
    const res = await runTick({ fetchImpl: stubFetch({ LIVE: { fh: 20, sd: 20 } }) })
    expect(res.nextAction).toBe('reauth-needed')
    expect(res.reason).toBe('refresh-dead')
    // Asserts the BRANCH, not the blame — `toContain('re-login')` welded this attribution test to
    // the claim that a human is required, which is false (rung 2 of the cascade mints from a live
    // cookie with no human, and this process cannot see that rung). TRDD-XV9BLQC5.
    expect(res.decision).toContain('dead refresh')
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

// The live account is refreshed by Claude Code itself, and the grant is single-use rotating: the
// slot keeps the PRE-rotation pair, which the endpoint rejects the moment the tick switches away
// and tries to renew it. Measured 2026-09-09: all three slots captured 08-26, all three branded
// credential-dead, 13h40m unrotated beside a healthy alternate — the janitor's cmd_capture mirrors
// live→slot, and this port had no such step (TRDD-RE9AVNJF).
// NOT pinned here: the fail-soft `SlotKeychainWriteError` branch. Backend `none` writes a file and
// cannot refuse, exactly like the same branch in `refreshAndHealSlot` — filed on the card.
describe('tick — reconcile mirrors a rotated live credential into its own slot (TRDD-RE9AVNJF)', () => {
  const rolesAs = (email: string, base: typeof fetch): typeof fetch =>
    (async (url: RequestInfo | URL, init?: RequestInit) =>
      String(url).includes('/roles')
        ? new Response(JSON.stringify({ organization_name: `${email}'s Organization` }), { status: 200 })
        : base(url, init)) as typeof fetch
  const slotToken = (email: string) => (readSlot(email) as { claudeAiOauth: { accessToken: string } }).claudeAiOauth.accessToken

  it('writes the live pair back to the slot and REPLACES the meta, lifting the dead-refresh ban', async () => {
    const old = blob('OLD', H8(), 'r-old')
    addSlot('live@x', old)
    const st = loadState()
    // The exact on-disk state measured 2026-09-09 on every slot: branded dead against the copy it holds.
    Object.assign(st.slots['live@x'], { refresh_failures: 11, refresh_dead_fp: fingerprint(old), last_refresh_failure: 'credential-dead' })
    st.live_email = 'live@x'
    st.live_fp = fingerprint(old)
    saveState(st)
    // Claude Code refreshed on its own: the live file carries a pair the slot never saw.
    const fresh = blob('LIVE', H8(), 'r-new')
    writeLiveBlob(fresh)
    // Premise, asserted: the slot holds OLD and carries the ban the tick must lift.
    expect(slotToken('live@x')).toBe('OLD')
    expect(loadState().slots['live@x']).toHaveProperty('refresh_dead_fp', fingerprint(old))

    await runTick({ fetchImpl: rolesAs('live@x', stubFetch({ LIVE: { fh: 20, sd: 20 } })) })

    expect(slotToken('live@x')).toBe('LIVE')
    const meta = loadState().slots['live@x']
    expect(meta.fp).toBe(fingerprint(fresh))
    expect(meta.via).toBe('live-mirror')
    expect(meta).not.toHaveProperty('refresh_dead_fp')
    expect(meta).not.toHaveProperty('refresh_failures')
    expect(loadState().live_fp).toBe(fingerprint(fresh))
  })

  it('skips the write when the slot already holds this credential and only state.json was behind', async () => {
    const fresh = blob('LIVE', H8())
    addSlot('live@x', fresh) // slot == live already; via 'test'
    const st = loadState()
    st.live_email = 'live@x'
    st.live_fp = 'stale-fp'
    saveState(st)
    writeLiveBlob(fresh)
    await runTick({ fetchImpl: rolesAs('live@x', stubFetch({ LIVE: { fh: 20, sd: 20 } })) })
    expect(loadState().live_fp).toBe(fingerprint(fresh)) // reconciled
    expect(loadState().slots['live@x'].via).toBe('test') // and NOT re-mirrored
  })

  it('never enrols an account that has no slot — a one-off /login is reconciled, not captured', async () => {
    seedLive('live@x', blob('LIVE', H8()))
    writeLiveBlob(blob('OTHER', H8())) // a human /login into an account the rotator never enrolled
    await runTick({ fetchImpl: rolesAs('other@x', stubFetch({ OTHER: { fh: 20, sd: 20 } })) })
    expect(loadState().live_email).toBe('other@x') // state follows the real live account (so reconcile RESOLVED — not an F5 early return)
    expect(loadState().slots).not.toHaveProperty('other@x') // but no slot is created for it — the first assertion, by order, that N3 reddens
  })
})
