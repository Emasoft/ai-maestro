import { describe, it, expect } from 'vitest'
import { isoLocal } from '@/lib/trdd-store'

/**
 * `isoLocal` is the ONE local-offset stamp for the TRDD corpus (TRDD-S13L6R9R).
 *
 * These tests are written to be TIMEZONE-INDEPENDENT: they must pass on the developer's
 * machine and in CI, which do not agree on `TZ`. So nothing here asserts a literal offset
 * — the sign/padding cases inject a fake `getTimezoneOffset` instead, which is the only
 * seam that makes those branches reachable without mutating process state.
 */
describe('isoLocal', () => {
  it('emits the mandated shape and NOT the toISOString shape', () => {
    const { iso } = isoLocal(new Date())
    // %Y-%m-%dT%H:%M:%S±HHMM — the form 502 cards already carry.
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{4}$/)
    // The two properties of `toISOString()` that made it wrong here:
    expect(iso).not.toMatch(/Z$/) // wrong zone form
    expect(iso).not.toMatch(/\.\d+/) // a sub-second field the format has no slot for
  })

  it('PRESERVES the instant it is given — it does not read the clock', () => {
    // This is the property the backfill depends on. A format repair that stamped `now`
    // instead of converting would silently reorder the board, which is the damage
    // trdd-doctor.ts:1399-1421 records having already been caused once.
    const d = new Date('2026-08-22T16:16:25.886Z')
    const { iso } = isoLocal(d)
    const roundTrip = Date.parse(iso)
    expect(Number.isNaN(roundTrip)).toBe(false)
    // Equal to the source instant, truncated to the second (the format carries no ms).
    expect(roundTrip).toBe(Math.floor(d.getTime() / 1000) * 1000)
  })

  it('is stable across calls for the same instant', () => {
    const d = new Date('2026-01-02T03:04:05.678Z')
    expect(isoLocal(d).iso).toBe(isoLocal(d).iso)
    expect(isoLocal(d).stamp).toBe(isoLocal(d).stamp)
  })

  it('renders both signs and pads a half-hour offset', () => {
    // getTimezoneOffset is INVERTED (UTC − local), so +330 minutes of offset (India,
    // UTC+5:30) is reported as -330. Getting that sign backwards is the likeliest bug in
    // this function, and no assertion on the local machine's own zone would catch it.
    const at = (offsetMinutesReportedByJs: number) => {
      // Must be a REAL Date with an OWN property shadowing the method — `Object.create(d)`
      // inherits Date's methods but not its internal [[DateValue]] slot, so every other
      // getter throws "this is not a Date object". (My first version did exactly that;
      // the test caught it, which is the only reason this comment exists.)
      const d = new Date('2026-08-22T12:00:00Z')
      ;(d as unknown as { getTimezoneOffset: () => number }).getTimezoneOffset = () =>
        offsetMinutesReportedByJs
      return isoLocal(d)
    }
    // NOTE: only getTimezoneOffset is faked, so the date/time digits still come from the
    // runner's real zone. These assertions therefore pin the OFFSET SUFFIX only — which is
    // the branch under test, and the one no single-machine test could otherwise reach.
    expect(at(-120).iso).toMatch(/\+0200$/) // UTC+2
    expect(at(300).iso).toMatch(/-0500$/) // UTC-5
    expect(at(-330).iso).toMatch(/\+0530$/) // UTC+5:30 — the padding case
    expect(at(0).iso).toMatch(/\+0000$/) // UTC itself still renders as an offset, not Z
  })

  it('the filename stamp uses the same offset, compactly', () => {
    const { iso, stamp } = isoLocal(new Date())
    expect(stamp).toMatch(/^\d{8}_\d{6}[+-]\d{4}$/)
    // Same offset in both forms — one definition, so they cannot disagree.
    expect(stamp.slice(-5)).toBe(iso.slice(-5))
  })
})
