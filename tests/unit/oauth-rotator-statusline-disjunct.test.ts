/**
 * TRDD-GY0LJV6S — the statusline may only ever ADD a reason to rotate.
 *
 * The card originally planned a SUBSTITUTION (statusline replaces the endpoint read). Reading the
 * call site refuted it: that one `usageRequest` supplies four things and the statusline can carry
 * two — the model-scoped weekly windows (TRDD-JI7F1236) and `liveStatus` (429 debounce, 401/403
 * token-rejected, networkUp) are endpoint-only. So the shape is asymmetric, and the asymmetry is
 * what these tests exist to pin: a positive at-threshold reading trips a rotation; ANY other
 * outcome — under threshold, inadmissible, unreadable, absent — must be indistinguishable from the
 * behaviour before this card.
 *
 * NEUTERS RECORDED — MEASURED, each reverted after. See the tail of this file.
 */
import { describe, expect, it } from 'vitest'
import { statuslineNear } from '@/lib/oauth-rotator/tick'
import type { RotatorState } from '@/lib/oauth-rotator/slots'
import type { UsageObservation } from '@/lib/statusline-admissible'

const LIVE = 'aaaa1111'
const SWITCH_S = 1_780_000_000
const SWITCH_MS = SWITCH_S * 1000
/** An hour after the switch, so the freshness window sits entirely after it (see the sibling
 *  suite: an age boundary placed before the switch is rejected by the WRONG guard). */
const NOW_MS = SWITCH_MS + 3_600_000
const NOW_S = NOW_MS / 1000

const state = (over: Partial<RotatorState> = {}): RotatorState =>
  ({ live_fp: LIVE, live_email: null, last_switch_at: SWITCH_S, slots: {}, ...over }) as RotatorState

const obs = (
  capturedAt: number,
  fiveHour: number | null,
  opts: { liveFp?: string | null; sevenDay?: number } = {},
): UsageObservation =>
  ({
    liveFp: opts.liveFp === undefined ? LIVE : opts.liveFp,
    capturedAt,
    rateLimits: {
      ...(fiveHour === null ? {} : { fiveHour: { usedPercentage: fiveHour } }),
      ...(opts.sevenDay == null ? {} : { sevenDay: { usedPercentage: opts.sevenDay } }),
    },
  }) as UsageObservation

/** `deps.now` is this module's clock and returns SECONDS — the conversion under test. */
const deps = (snapshots: UsageObservation[] | (() => Promise<never>)) => ({
  now: () => NOW_S,
  readSnapshots: typeof snapshots === 'function' ? snapshots : async () => snapshots,
  // Isolation for the SECOND source (TRDD-SLSSUIQ8): without this stub, statuslineNear falls back
  // to the real agentlenspro CLI on a host that has it installed — one subprocess spawn PER CALL
  // (this file measured 24.5s under full-suite load, tripping the 5s per-test timeout). This
  // suite is about the statusline-STORE source only; the agentlens source has its own suite.
  readAgentlensRows: async () => [],
})

describe('statuslineNear — a positive signal trips, everything else is silent', () => {
  it('trips on a five-hour reading at the threshold', async () => {
    const got = await statuslineNear(state(), deps([obs(NOW_MS - 30_000, 97)]))
    expect(got.near).toBe(true)
    expect(got.usage?.fiveHourPct).toBe(97)
  })

  it('trips on a seven-day reading at the threshold even when 5h is low', async () => {
    // The two windows are independent reasons; a card that only checked 5h would pass a test that
    // only fed 5h. This is the one that says the disjunct spans both.
    const got = await statuslineNear(state(), deps([obs(NOW_MS - 30_000, 4, { sevenDay: 99 })]))
    expect(got.near).toBe(true)
  })

  it('does NOT trip below the threshold — and still reports the usage it saw', async () => {
    // The load-bearing assertion is the PAIR. `near: false` alone is satisfied by a function that
    // read nothing; `usage` being present proves it read, understood, and declined to trip — which
    // is exactly the "may add a reason, may never remove one" contract. A caller must not be able
    // to mistake this for "the account is fine".
    const got = await statuslineNear(state(), deps([obs(NOW_MS - 30_000, 10, { sevenDay: 12 })]))
    expect(got.near).toBe(false)
    expect(got.usage).toEqual({ fiveHourPct: 10, sevenDayPct: 12, capturedAt: NOW_MS - 30_000 })
  })

  it('stays silent on an empty store — byte-identical to the pre-card behaviour', async () => {
    expect(await statuslineNear(state(), deps([]))).toEqual({ near: false, usage: null })
  })

  it('stays silent when the store THROWS — an unreadable statusline never breaks a tick', async () => {
    // Fail-soft is the whole safety argument for landing this in one step: if this path can only
    // ever add a disjunct, and it yields `false` on every fault, it cannot regress a working tick.
    const boom = async (): Promise<never> => {
      throw new Error('EACCES')
    }
    expect(await statuslineNear(state(), deps(boom))).toEqual({ near: false, usage: null })
  })

  it('ignores a maxed reading stamped with an account that is no longer live', async () => {
    // The SIV45HOG loop, seen from this side: a 99% report from the OLD credential must not trip a
    // rotation off the fresh account we just switched to. Delegated to `admitSnapshot`, pinned here
    // because THIS is the caller whose behaviour would burn the accounts.
    const got = await statuslineNear(state(), deps([obs(NOW_MS - 30_000, 99, { liveFp: 'OLDOLD' })]))
    expect(got).toEqual({ near: false, usage: null })
  })

  it('ignores a maxed reading older than the freshness window', async () => {
    const stale = obs(NOW_MS - 16 * 60_000, 99) // STATUSLINE_FRESH_MS is 15 min
    expect(await statuslineNear(state(), deps([stale]))).toEqual({ near: false, usage: null })
  })

  it('converts the SECONDS clock to MILLISECONDS — observable ONLY through the age check', async () => {
    // ⚠ THIS TEST WAS VACUOUS IN ITS FIRST FORM, and the neuter said so rather than my reasoning.
    // It asserted that a fresh maxed sample trips — which is true with OR without the conversion,
    // so neuter #2 left it GREEN and reddened the staleness test instead.
    //
    // WHY: unconverted, `now` is ~1.78e9 while `capturedAt` is ~1.78e12, so `now - capturedAt` is
    // hugely NEGATIVE and EVERY sample passes the age check — the bug makes things look infinitely
    // FRESH, never stale. So the only observable difference is a sample that OUGHT to be rejected
    // for age and is not. The pair below is the discriminating fixture: same clock, same account,
    // same maxed reading, differing only in age.
    const fresh = await statuslineNear(state(), deps([obs(NOW_MS - 60_000, 100)]))
    const old = await statuslineNear(state(), deps([obs(NOW_MS - 16 * 60_000, 100)]))
    expect(fresh.near).toBe(true) // 1 min old — inside STATUSLINE_FRESH_MS
    expect(old.near).toBe(false) // 16 min old — outside it, and ONLY a correct clock can tell
  })
})

/**
 * NEUTERS — MEASURED 2026-08-02, each reverted after. Counts are what the runs printed.
 *
 *   1. drop the disjunct's guard, returning `near: true` whenever a usage exists
 *      (`return { near: true, usage }`)
 *      → REDS 1 of 8: "does NOT trip below the threshold — and still reports the usage it saw"
 *   2. remove the seconds→ms conversion (`const nowMs = deps?.now ? deps.now() : Date.now()`)
 *      → REDS 2 of 8: "ignores a maxed reading older than the freshness window"
 *                     "converts the SECONDS clock to MILLISECONDS — observable ONLY through the
 *                      age check"
 *      → ⚠ ON THE FIRST MEASUREMENT IT REDDENED ONLY THE FIRST OF THOSE, and the test *named* for
 *        the conversion stayed GREEN — a neuter reddening a different test than predicted is a
 *        finding about the TEST. That test asserted "a fresh maxed sample trips", which holds with
 *        OR without the conversion: unconverted, `now`(~1.78e9) − `capturedAt`(~1.78e12) is hugely
 *        NEGATIVE, so the bug makes every sample look infinitely FRESH rather than stale. It was
 *        rewritten as a fresh/stale PAIR — same clock, same account, same maxed reading, differing
 *        only in age — which is the only shape that can observe the conversion at all.
 *   3. delete the try/catch fail-soft (let the store's error propagate)
 *      → REDS 1 of 8: "stays silent when the store THROWS — an unreadable statusline never breaks
 *        a tick"
 *
 * NOT YET COVERED, and named rather than left implied: the two BRANCH wirings in `autoRotate` (the
 * disjunct into the `liveStatus === 200` verdict, and the new endpoint-unreachable branch) have no
 * integration test — `statuslineNear` is pinned, its two call sites are not. The 22-file / 302-test
 * rotator suite passes unchanged, which shows no regression but does not exercise either branch.
 */
