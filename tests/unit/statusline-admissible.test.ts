/**
 * TRDD-SIV45HOG — the guard that stops the rotator burning every account.
 *
 * The failure under test is not "a stale number": it is an actuating loop. Reports produced while
 * the OLD account was live get attributed to the NEW one, the rotator reads ~98% on a fresh
 * account, rotates straight back out, and repeats at 60 s per iteration, unattended, while the log
 * reads like healthy rotation.
 *
 * NEUTERS RECORDED — MEASURED 2026-08-02, each reverted after. The counts below are what the runs
 * actually printed, not what they were expected to print: the first neuter was predicted to red 2
 * and red 3, because the payload test's LAST assertion also exercises the identity guard. Left
 * corrected rather than tidied away, since a neuter record is read as evidence by whoever comes
 * next, and an unmeasured one is worth less than none.
 *
 *   1. delete the identity check (`if (snapshot.liveFp !== rotator.live_fp) return 'stale-account'`)
 *      → REDS 3 of 13: "discards a report stamped with an account that is no longer live"
 *                      "rejects a null stamp while a rotator IS configured"
 *                      "a payload CLAIMING an identity cannot influence the stamp"
 *      → both AGE tests stay GREEN. That is the load-bearing observation: it is what proves the
 *        two guards are INDEPENDENT rather than one guard checked twice.
 *   2. drop the `* 1000` in the age check (`const switchAtMs = raw`)
 *      → REDS 2 of 13: "rejects a report that arrived BEFORE the switch"
 *                      "is INDEPENDENT of the identity guard — a matching stamp is still rejected"
 *      → the straddle partner ("admits a report that arrived AFTER the switch") stays GREEN, which
 *        is what proves this test is not passing against a guard that rejects everything.
 *   3. `stampLiveAccount` made inert (`return snapshot` with no assignment)
 *      → REDS 2 of 13: "stamps the live fingerprint server-side"
 *                      "a payload CLAIMING an identity cannot influence the stamp" (positive half)
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const loadState = vi.fn()
vi.mock('@/lib/oauth-rotator/slots', () => ({ loadState: (...a: unknown[]) => loadState(...a) }))

import {
  admitSnapshot,
  freshestAdmissibleUsage,
  resolveLiveAccountFp,
  stampLiveAccount,
  type UsageObservation,
} from '@/lib/statusline-admissible'
import { normalizeStatuslinePayload } from '@/lib/statusline-normalize'
import type { StatuslineSnapshot } from '@/types/statusline'

/** Epoch SECONDS, as `rotate.ts:44` writes it. Chosen so its ms form is unmistakably different. */
const SWITCH_S = 1_780_000_000
const SWITCH_MS = SWITCH_S * 1000

const snap = (liveFp: string | null, capturedAt: number) => ({ liveFp, capturedAt })

beforeEach(() => {
  loadState.mockReset()
  loadState.mockReturnValue({ live_email: null, live_fp: 'aaaa111122223333', slots: {} })
})
afterEach(() => vi.restoreAllMocks())

describe('admitSnapshot — identity', () => {
  it('admits a report stamped with the account that is still live', () => {
    expect(admitSnapshot(snap('aaaa1111', SWITCH_MS + 1000), { live_fp: 'aaaa1111' })).toBeNull()
  })

  it('discards a report stamped with an account that is no longer live', () => {
    // The primary case: the report arrived before the switch, so it carries the OLD fingerprint.
    // Acting on it is what attributes an exhausted account's usage to the fresh one.
    expect(admitSnapshot(snap('OLDOLDOLD', SWITCH_MS + 1000), { live_fp: 'aaaa1111' })).toBe('stale-account')
  })

  it('rejects a null stamp while a rotator IS configured', () => {
    // A null stamp means the rotator state was unreadable at ingest — i.e. NO identity. The rotator
    // already fails safe on absent data ("do not rotate"), so inadmissible is the correct verdict.
    expect(admitSnapshot(snap(null, SWITCH_MS + 1000), { live_fp: 'aaaa1111' })).toBe('stale-account')
  })

  it('admits a null stamp when NO rotator is configured', () => {
    // With no rotator there is no switch to be confused by, so a null-vs-null match must pass —
    // otherwise installing the guard silently blinds every host that does not rotate at all.
    expect(admitSnapshot(snap(null, SWITCH_MS + 1000), { live_fp: null })).toBeNull()
  })
})

describe('admitSnapshot — age, and the SECONDS-vs-MILLISECONDS trap', () => {
  // These two straddle the switch instant in BOTH directions. The pair is the point: asserting
  // only the reject case would pass against a guard that rejects everything, and asserting only
  // the admit case would pass against the naive ms-vs-s compare that never rejects at all.
  const view = { live_fp: 'aaaa1111', last_switch_at: SWITCH_S }

  it('rejects a report that arrived BEFORE the switch', () => {
    expect(admitSnapshot(snap('aaaa1111', SWITCH_MS - 1000), view)).toBe('pre-switch')
  })

  it('admits a report that arrived AFTER the switch', () => {
    expect(admitSnapshot(snap('aaaa1111', SWITCH_MS + 1000), view)).toBeNull()
  })

  it('is INDEPENDENT of the identity guard — a matching stamp is still rejected on age', () => {
    // Constructible after a switch away and back (A→B→A), or a state.json that was reset: the
    // stamp equals the currently-live account while the report predates the latest switch.
    // Identity cannot see this; only the age guard can. If this ever starts failing under neuter
    // #1, the two guards have collapsed into one.
    const r = admitSnapshot(snap('aaaa1111', SWITCH_MS - 1), view)
    expect(r).toBe('pre-switch')
    expect(r).not.toBe('stale-account')
  })

  it('admits when last_switch_at is absent or non-numeric rather than guessing', () => {
    expect(admitSnapshot(snap('aaaa1111', 1), { live_fp: 'aaaa1111' })).toBeNull()
    expect(admitSnapshot(snap('aaaa1111', 1), { live_fp: 'aaaa1111', last_switch_at: 'soon' })).toBeNull()
    expect(admitSnapshot(snap('aaaa1111', 1), { live_fp: 'aaaa1111', last_switch_at: NaN })).toBeNull()
  })
})

describe('resolveLiveAccountFp', () => {
  it('reads the rotator’s own live_fp', () => {
    expect(resolveLiveAccountFp()).toBe('aaaa111122223333')
  })

  it('normalises the empty fingerprint to null — ONE spelling of "no identity"', () => {
    // `fingerprint()` returns '' for a blob with no accessToken. Left as '', the identity check
    // would reject on `'' !== null`, a difference that means nothing.
    loadState.mockReturnValue({ live_email: null, live_fp: '', slots: {} })
    expect(resolveLiveAccountFp()).toBeNull()
  })

  it('fails SOFT when the rotator state cannot be read', () => {
    // An observation must never be lost because rotator state was unreadable — it is free data
    // arriving every few seconds, and a null stamp is already handled as inadmissible downstream.
    loadState.mockImplementation(() => {
      throw new Error('state.json unreadable')
    })
    expect(resolveLiveAccountFp()).toBeNull()
  })
})

describe('stampLiveAccount — the payload cannot choose its own identity', () => {
  it('stamps the live fingerprint server-side', () => {
    const s = { liveFp: null, capturedAt: 1 } as StatuslineSnapshot
    expect(stampLiveAccount(s).liveFp).toBe('aaaa111122223333')
  })

  it('a payload CLAIMING an identity cannot influence the stamp', () => {
    // The one that matters if the ingest is ever reachable beyond the console. Every plausible
    // spelling an attacker might try, through the REAL normaliser — the assertion is that none of
    // them reaches `liveFp`, and that the server's own value wins.
    const hostile = normalizeStatuslinePayload({
      session_id: 'sess-1',
      liveFp: 'ATTACKER',
      live_fp: 'ATTACKER',
      account_fp: 'ATTACKER',
      fingerprint: 'ATTACKER',
      account: { fp: 'ATTACKER' },
    })
    expect(hostile).not.toBeNull()
    expect(hostile!.liveFp).toBeNull() // normaliser is structurally unable to carry it

    stampLiveAccount(hostile!)
    expect(hostile!.liveFp).toBe('aaaa111122223333') // the SERVER's value, not the payload's

    // And the guard agrees: the attacker's claimed value would not have matched anyway.
    expect(admitSnapshot(hostile!, { live_fp: 'aaaa111122223333' })).toBeNull()
    expect(admitSnapshot({ liveFp: 'ATTACKER', capturedAt: 1 }, { live_fp: 'aaaa111122223333' })).toBe('stale-account')
  })
})

describe('freshestAdmissibleUsage — the selection the rotator will call', () => {
  const LIVE = 'aaaa1111'
  const MAX_AGE = 900_000 // 15 min, matching STATUSLINE_FRESH_MS at the caller
  // An hour after the switch, so the freshness window sits ENTIRELY after it and an age-boundary
  // fixture is rejected by AGE rather than by the pre-switch guard. The first version of this
  // block used `SWITCH_MS + 600_000`, which put `NOW - MAX_AGE` five minutes BEFORE the switch —
  // the age test then failed for the wrong reason, and had it been written the other way round it
  // would have PASSED for the wrong reason.
  const NOW = SWITCH_MS + 3_600_000
  const rot = { live_fp: LIVE, last_switch_at: SWITCH_S }

  /** Only the three fields the selection reads — see `UsageObservation`. */
  const obs = (
    capturedAt: number,
    fiveHour: number | null,
    opts: { liveFp?: string | null; sevenDay?: number | null } = {},
  ): UsageObservation => ({
    liveFp: opts.liveFp === undefined ? LIVE : opts.liveFp,
    capturedAt,
    rateLimits: {
      ...(fiveHour === null ? {} : { fiveHour: { usedPercentage: fiveHour } }),
      ...(opts.sevenDay == null ? {} : { sevenDay: { usedPercentage: opts.sevenDay } }),
    },
  } as UsageObservation)

  it('returns null for an empty list — the fail-safe the caller falls back to the endpoint on', () => {
    expect(freshestAdmissibleUsage([], rot, { now: NOW, maxAgeMs: MAX_AGE })).toBeNull()
  })

  it('takes the NEWEST admissible sample, not the highest', () => {
    // Deliberately ordered so the newest is NOT last in the array and NOT the largest reading: a
    // max-by-usage rule (the roll-up's rule, which is right for ITS question and wrong here) and a
    // last-one-wins rule both pick 91 and both would be wrong. Only newest-wins picks 12.
    const got = freshestAdmissibleUsage(
      [obs(NOW - 400_000, 40), obs(NOW - 60_000, 12), obs(NOW - 300_000, 91)],
      rot,
      { now: NOW, maxAgeMs: MAX_AGE },
    )
    expect(got).toEqual({ fiveHourPct: 12, sevenDayPct: null, capturedAt: NOW - 60_000 })
  })

  it('skips a sample older than maxAgeMs even when it is otherwise admissible', () => {
    // Straddles the boundary in BOTH directions in one call. Asserting only the reject half would
    // pass equally against a selection that rejects everything and returns null.
    const kept = obs(NOW - MAX_AGE, 33) // exactly at the edge — kept, the compare is `>`
    const dropped = obs(NOW - MAX_AGE - 1, 99)
    const got = freshestAdmissibleUsage([dropped, kept], rot, { now: NOW, maxAgeMs: MAX_AGE })
    expect(got?.fiveHourPct).toBe(33)
  })

  it('skips a sample the identity guard rejects, and one the pre-switch guard rejects', () => {
    // Both rejections come from `admitSnapshot`, so this pins that the selection DELEGATES rather
    // than re-implementing the predicate — a second copy is exactly how the units trap returns.
    //
    // ⚠ A DIFFERENT `now`, and the reason is a property worth stating: age is checked FIRST, so a
    // pre-switch sample is ALSO stale-by-age once the switch is more than `maxAgeMs` ago, and the
    // pre-switch branch becomes unreachable. It bites only within the freshness window of a
    // rotation — which is exactly the window it exists for (the minutes right after a switch, when
    // reports produced under the old credential are still arriving and still fresh). Testing it at
    // `NOW` would have exercised the age guard while claiming to test this one.
    const justAfter = SWITCH_MS + 60_000
    const stale = obs(justAfter - 10_000, 98, { liveFp: 'OLDOLDOLD' })
    const preSwitch = obs(SWITCH_MS - 1, 97) // stamped LIVE, fresh by age, but arrived pre-switch
    const good = obs(justAfter - 20_000, 5)
    const at = { now: justAfter, maxAgeMs: MAX_AGE }
    expect(freshestAdmissibleUsage([stale, preSwitch, good], rot, at))
      .toEqual({ fiveHourPct: 5, sevenDayPct: null, capturedAt: justAfter - 20_000 })
    // …and with ONLY the inadmissible ones present the answer is null, never a default.
    expect(freshestAdmissibleUsage([stale, preSwitch], rot, at)).toBeNull()
    // Positive control for the pre-switch half specifically: the SAME sample one ms after the
    // switch is admitted, so the reject above is not a selection that rejects everything.
    expect(freshestAdmissibleUsage([obs(SWITCH_MS + 1, 97)], rot, at)?.fiveHourPct).toBe(97)
  })

  it('skips a sample with no five-hour gauge rather than reading it as 0%', () => {
    // The dangerous default. A missing gauge silently read as 0 reports a MAXED account as empty,
    // which is the same actuating failure as a stale one — the rotator would switch INTO it.
    const gaugeless = obs(NOW - 1_000, null) // newest, so newest-wins would pick it if admitted
    const good = obs(NOW - 90_000, 77)
    const got = freshestAdmissibleUsage([gaugeless, good], rot, { now: NOW, maxAgeMs: MAX_AGE })
    expect(got).toEqual({ fiveHourPct: 77, sevenDayPct: null, capturedAt: NOW - 90_000 })
    expect(freshestAdmissibleUsage([gaugeless], rot, { now: NOW, maxAgeMs: MAX_AGE })).toBeNull()
  })

  it('carries the seven-day window when present and null when absent', () => {
    const withSd = freshestAdmissibleUsage([obs(NOW - 5_000, 42, { sevenDay: 8 })], rot, {
      now: NOW,
      maxAgeMs: MAX_AGE,
    })
    expect(withSd).toEqual({ fiveHourPct: 42, sevenDayPct: 8, capturedAt: NOW - 5_000 })
    // Absent 7d must NOT suppress a usable 5h reading — the rotator decides on the 5h window.
    expect(freshestAdmissibleUsage([obs(NOW - 5_000, 42)], rot, { now: NOW, maxAgeMs: MAX_AGE }))
      .toEqual({ fiveHourPct: 42, sevenDayPct: null, capturedAt: NOW - 5_000 })
  })

  it('rejects a non-finite gauge, which JSON.parse admits and arithmetic does not', () => {
    expect(freshestAdmissibleUsage([obs(NOW - 5_000, NaN)], rot, { now: NOW, maxAgeMs: MAX_AGE })).toBeNull()
  })
})
