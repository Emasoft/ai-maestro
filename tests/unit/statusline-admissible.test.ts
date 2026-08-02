/**
 * TRDD-SIV45HOG — the guard that stops the rotator burning every account.
 *
 * The failure under test is not "a stale number": it is an actuating loop. Reports produced while
 * the OLD account was live get attributed to the NEW one, the rotator reads ~98% on a fresh
 * account, rotates straight back out, and repeats at 60 s per iteration, unattended, while the log
 * reads like healthy rotation.
 *
 * NEUTERS RECORDED (run 2026-08-02, each reverted after):
 *   1. delete the identity check (`if (snapshot.liveFp !== rotator.live_fp) return 'stale-account'`)
 *      → REDS: "discards a report stamped with an account that is no longer live"
 *              "rejects a null stamp while a rotator IS configured"
 *      → the age tests stay GREEN, which is what proves the two guards are independent.
 *   2. drop the `* 1000` in the age check (`const switchAtMs = raw`)
 *      → REDS: "rejects a report that arrived BEFORE the switch"
 *      → and the straddle partner stays GREEN, which is what proves the test is not a guard that
 *        rejects everything.
 *   3. `stampLiveAccount` made inert (`return snapshot` with no assignment)
 *      → REDS: "stamps the live fingerprint server-side"
 *              "a payload CLAIMING an identity cannot influence the stamp" (its positive half)
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const loadState = vi.fn()
vi.mock('@/lib/oauth-rotator/slots', () => ({ loadState: (...a: unknown[]) => loadState(...a) }))

import { admitSnapshot, resolveLiveAccountFp, stampLiveAccount } from '@/lib/statusline-admissible'
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
