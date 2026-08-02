/**
 * Parity/wiring tests for the OAuth-rotator SUPERVISOR beat (TRDD-7DRSIKVZ, D1 part 3) — the server
 * timer that drives supervisor.ts's alert-only governance loop.
 *
 * 0-IMPACT: runOneSupervisorBeat is fully dependency-injected, so every case stubs optInCheck /
 * tickArmedCheck / gatherFactsImpl / log — no real keychain, no real rotator state, no timers. The
 * tests prove the opt-in gate (no gather when opted-out), the daemonAlive→tick-armed plumbing, that
 * findings are surfaced, and that a throwing gather never crashes the beat.
 */
import { describe, it, expect, vi } from 'vitest'
import { runOneSupervisorBeat, SUPERVISOR_INTERVAL_MS } from '@/lib/oauth-rotator/server-supervisor'
import type { Facts } from '@/lib/oauth-rotator/supervisor'

function facts(over: Partial<Facts> = {}): Facts {
  return { root: '/tmp/aim-test-rotator-root', optIn: true, onMacos: true, pinningEnv: [], slots: [], tickCompletedAgeS: 0, daemonAlive: true, ...over }
}

describe('server-supervisor — runOneSupervisorBeat', () => {
  it('opted OUT → returns [], and never gathers facts or logs (no keychain access)', () => {
    const gatherFactsImpl = vi.fn(() => facts())
    const log = vi.fn()
    const out = runOneSupervisorBeat({ optInCheck: () => false, gatherFactsImpl, log })
    expect(out).toEqual([])
    expect(gatherFactsImpl).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })

  it('opted IN + clean facts → returns [] and logs nothing', () => {
    const log = vi.fn()
    const out = runOneSupervisorBeat({ optInCheck: () => true, gatherFactsImpl: () => facts(), log })
    expect(out).toEqual([])
    expect(log).not.toHaveBeenCalled()
  })

  it('surfaces the diagnosed alert codes and logs each once', () => {
    const log = vi.fn()
    const out = runOneSupervisorBeat({
      optInCheck: () => true,
      gatherFactsImpl: () => facts({ pinningEnv: ['ANTHROPIC_API_KEY'] }),
      log,
    })
    expect(out).toEqual(['pinning-env'])
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][0]).toContain('pinning-env')
  })

  it('plumbs the tick-armed state through as the beat-owner liveness (daemonAlive)', () => {
    // tick armed → the gather closure sees daemonAlive() === true; a stale tick then alarms.
    let seenDaemonAlive: boolean | undefined
    const out = runOneSupervisorBeat({
      optInCheck: () => true,
      tickArmedCheck: () => true,
      gatherFactsImpl: (daemonAlive) => {
        seenDaemonAlive = daemonAlive()
        return facts({ daemonAlive: daemonAlive(), tickCompletedAgeS: null })
      },
      log: () => {},
    })
    expect(seenDaemonAlive).toBe(true)
    expect(out).toContain('tick-stalled')
  })

  it('tick NOT armed → daemonAlive false → a stale stamp does NOT alarm', () => {
    const out = runOneSupervisorBeat({
      optInCheck: () => true,
      tickArmedCheck: () => false,
      gatherFactsImpl: (daemonAlive) => facts({ daemonAlive: daemonAlive(), tickCompletedAgeS: null }),
      log: () => {},
    })
    expect(out).not.toContain('tick-stalled')
  })

  it('a throwing gather never crashes the beat — returns []', () => {
    const out = runOneSupervisorBeat({
      optInCheck: () => true,
      gatherFactsImpl: () => { throw new Error('boom') },
      log: () => {},
    })
    expect(out).toEqual([])
  })

  it('the governance cadence is the 10-minute daemon interval', () => {
    expect(SUPERVISOR_INTERVAL_MS).toBe(600_000)
  })
})
