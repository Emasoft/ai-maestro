import { describe, it, expect } from 'vitest'
import { computeNextAction, getContinuityStatus } from '@/lib/continuity-status'
import type { AgentlensStatusMetadata } from '@/lib/agentlens-status'

function meta(over: Partial<AgentlensStatusMetadata>): AgentlensStatusMetadata {
  return {
    accountHealthy: true,
    window5hPct: 10,
    window7dPct: 10,
    cacheTtlMinutes: 60,
    windowSource: 'cc-rate-limits',
    available: true,
    ...over,
  }
}

describe('computeNextAction', () => {
  it('unknown when observability is unavailable', () => {
    expect(computeNextAction(meta({ available: false }))).toBe('unknown')
  })

  it('ok when healthy and low pressure', () => {
    expect(computeNextAction(meta({}))).toBe('ok')
  })

  it('switch-recommended when the account is rate-limited (not reauth)', () => {
    // A windowed account still has a valid token — switching, not reauth, is the remedy.
    expect(computeNextAction(meta({ accountHealthy: false }))).toBe('switch-recommended')
  })

  it('monitor when pressure is high but not exhausted', () => {
    expect(computeNextAction(meta({ window5hPct: 95, window7dPct: 20 }))).toBe('monitor')
    expect(computeNextAction(meta({ window5hPct: 20, window7dPct: 90 }))).toBe('monitor')
  })

  it('uses the max of the two windows for pressure', () => {
    expect(computeNextAction(meta({ window5hPct: 89.9, window7dPct: 89.9 }))).toBe('ok')
    expect(computeNextAction(meta({ window5hPct: 89.9, window7dPct: 90 }))).toBe('monitor')
  })

  it('treats null windows as zero pressure (unknown is not pressure)', () => {
    expect(computeNextAction(meta({ window5hPct: null, window7dPct: null }))).toBe('ok')
  })

  it('a calibrated overage never escalates past monitor (lower-bound estimate)', () => {
    // accountHealthy stays true on a calibrated overage (agentlens-status rule); pressure high
    // → monitor, never switch-recommended.
    expect(
      computeNextAction(meta({ accountHealthy: true, windowSource: 'calibrated', window5hPct: 150, window7dPct: 166 })),
    ).toBe('monitor')
  })
})

describe('getContinuityStatus — OAuth cascade supersedes the interim heuristic (TRDD-1GGQ4HWY)', () => {
  // Injected deps keep this 0-IMPACT: no AgentlensPro CLI, no network, no credential, no stamp file.
  const healthy = () => Promise.resolve(meta({})) // observable heuristic would compute 'ok'

  it('surfaces the persisted cascade next_action when a fresh one exists (supersede)', async () => {
    const s = await getContinuityStatus({ readMetadata: healthy, readTickAction: () => 'rotating' })
    expect(s.nextAction).toBe('rotating')
  })

  it('surfaces reauth-needed from the cascade even when the observables look healthy', async () => {
    const s = await getContinuityStatus({ readMetadata: healthy, readTickAction: () => 'reauth-needed' })
    expect(s.nextAction).toBe('reauth-needed')
  })

  it('falls back to the interim heuristic when no cascade state is stamped (absent/stale → null)', async () => {
    const pressured = () => Promise.resolve(meta({ window5hPct: 95 })) // heuristic → 'monitor'
    const s = await getContinuityStatus({
      readMetadata: pressured,
      readTickAction: () => null,
      // Injected, not defaulted: with the cascade returning null this is the one path that would
      // otherwise fall through to the REAL stamp file on the developer machine, and a genuine
      // boot restore running during a test run would flip this assertion to 'restoring'.
      readBootRestoring: () => false,
    })
    expect(s.nextAction).toBe('monitor')
  })

  it('never errors and passes the four observable fields through unchanged', async () => {
    const s = await getContinuityStatus({
      readMetadata: () => Promise.resolve(meta({ window5hPct: 12, window7dPct: 34, cacheTtlMinutes: 60 })),
      readTickAction: () => null,
      readBootRestoring: () => false,
    })
    expect(s).toMatchObject({
      accountHealthy: true,
      window5hPct: 12,
      window7dPct: 34,
      cacheTtlMinutes: 60,
      nextAction: 'ok',
    })
  })
})

/**
 * THE 5-FIELD CEILING — the safety property `status` exists to have, and the one thing
 * `toMatchObject` above cannot check.
 *
 * TRDD-DXJZM3BW promised it twice ("a schema test fails CI if a 6th (token-adjacent) field is ever
 * added"; "schema test red on a 6th field") and it was never written. Every other test here asserts
 * what `nextAction` COMPUTES — none asserts what the object CONTAINS, and `toMatchObject` passes
 * happily on a superset, so a 6th field would have slipped through the whole suite.
 *
 * The ceiling is the card's stated Constraint 1 (TRDD-H24DF6ZC): `status` is the ONE verb an agent
 * can call, so no token may leak through it. That is enforced by the response being a CLOSED set,
 * not by anyone remembering not to widen it. The route returns this object verbatim
 * (`NextResponse.json(status)`), so these keys ARE the wire contract.
 */
describe('the 5-field ceiling (TRDD-DXJZM3BW Constraint 1) — a CLOSED set, not a superset', () => {
  const CONTRACT = [
    'accountHealthy',
    'cacheTtlMinutes',
    'nextAction',
    'window5hPct',
    'window7dPct',
  ] as const

  it('the response carries EXACTLY these five keys — a 6th reddens this test', async () => {
    const s = await getContinuityStatus({
      readMetadata: () => Promise.resolve(meta({})),
      readTickAction: () => null,
      readBootRestoring: () => false,
    })
    // `toEqual` on the sorted key list, not `toMatchObject` / `toContain`: both of those pass on a
    // superset, which is precisely the direction a token-adjacent field would arrive from.
    expect(Object.keys(s).sort()).toEqual([...CONTRACT])
  })

  it('holds on the cascade path too — the stamp supersedes a value, it never adds a field', async () => {
    // The one code path that reads an EXTERNAL file (the rotator's tick-status stamp). If a future
    // edit passed that stamp's payload through instead of just its verdict, this is where a 6th
    // field would enter.
    const s = await getContinuityStatus({
      readMetadata: () => Promise.resolve(meta({})),
      readTickAction: () => 'reauth-needed',
    })
    expect(Object.keys(s).sort()).toEqual([...CONTRACT])
    expect(s.nextAction).toBe('reauth-needed') // non-vacuity: the cascade path really was taken
  })

  it('holds on the boot-restore path too — `restoring` is an ENUM value, not a 6th field', async () => {
    // TRDD-JAU1ES1C's stated trap: the obvious way to surface "the fleet is coming back up" is a
    // `restoring: true` field, and that would breach the five-field ceiling the whole verb is
    // built around. The state goes in the vocabulary instead; this is what keeps that honest.
    const s = await getContinuityStatus({
      readMetadata: () => Promise.resolve(meta({})),
      readTickAction: () => null,
      readBootRestoring: () => true,
    })
    expect(Object.keys(s).sort()).toEqual([...CONTRACT])
    expect(s.nextAction).toBe('restoring') // non-vacuity: the restoring path really was taken
  })
})

/**
 * PRECEDENCE — cascade > restoring > heuristic (TRDD-JAU1ES1C).
 *
 * Three sources can each name a `next_action`, and the ranking is by WHAT EACH ONE KNOWS. These
 * tests pin the two orderings that are decisions rather than mechanics: that a credential verdict
 * is never masked by a transient one, and that a transient one does displace a guess.
 */
describe('getContinuityStatus — restoring sits between the cascade and the heuristic', () => {
  const healthy = () => Promise.resolve(meta({})) // heuristic → 'ok'

  it('the cascade OUTRANKS restoring — a dead credential is never reported as merely busy', async () => {
    // `reauth-needed` means a human must log in, and that stays true while a restore runs. If
    // `restoring` won here, the single most actionable state on the host would be hidden behind a
    // transient one for as long as the walk lasted — and the walk is exactly when an operator is
    // watching. The cascade also read the actual token; the restore flag knows nothing about it.
    const s = await getContinuityStatus({
      readMetadata: healthy,
      readTickAction: () => 'reauth-needed',
      readBootRestoring: () => true,
    })
    expect(s.nextAction).toBe('reauth-needed')
  })

  it('restoring OUTRANKS the heuristic — and this is the misfire it prevents', async () => {
    // The concrete harm, not a cosmetic distinction. Mid-restore, AgentlensPro metadata is missing
    // or half-formed, so `accountHealthy: false` is routine — and the heuristic turns that into
    // `switch-recommended`, which invites an account switch the host never needed. Note the
    // metadata here would compute exactly that, so this test fails if the ordering is reversed.
    const midRestore = () => Promise.resolve(meta({ accountHealthy: false }))
    expect(computeNextAction(await midRestore())).toBe('switch-recommended') // the value being displaced
    const s = await getContinuityStatus({
      readMetadata: midRestore,
      readTickAction: () => null,
      readBootRestoring: () => true,
    })
    expect(s.nextAction).toBe('restoring')
  })

  it('not restoring → the heuristic is unchanged (the state is additive, not a takeover)', async () => {
    const s = await getContinuityStatus({
      readMetadata: () => Promise.resolve(meta({ accountHealthy: false })),
      readTickAction: () => null,
      readBootRestoring: () => false,
    })
    expect(s.nextAction).toBe('switch-recommended')
  })
})
