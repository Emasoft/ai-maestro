/**
 * Parity/wiring tests for the OAuth-rotator SUPERVISOR beat (TRDD-7DRSIKVZ, D1 part 3) — the server
 * timer that drives supervisor.ts's alert-only governance loop.
 *
 * 0-IMPACT: runOneSupervisorBeat is fully dependency-injected, so every case stubs optInCheck /
 * tickArmedCheck / gatherFactsImpl / log — no real keychain, no real rotator state, no timers. The
 * tests prove the opt-in gate (no gather when opted-out), the daemonAlive→tick-armed plumbing, that
 * findings are surfaced, and that a throwing gather never crashes the beat.
 *
 * The beat's own `stampChoreRun('oauth-rotator-supervisor')` call is unconditional (unchanged) —
 * it always runs; the ORH R3 fix is the CENTRAL guard that call now goes through
 * (janitor-chore-stamp.ts::stampChoreRun, gated on the real `isChoreClaimed`, which for this
 * chore reads the SAME `oauth-rotator-tick.enabled` flag file `server-tick.ts::oauthTickEnabled`
 * reads — the server claims BOTH oauth chores off ONE flag, per
 * `lib/server-liveness.ts::currentCapabilities`). $HOME is redirected file-wide below (every test
 * in this file drives the real, unconditional stamp call) so that real flag read never touches
 * the developer's actual `~/.aimaestro`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { statePath } from '@/lib/ecosystem-constants'
import { runOneSupervisorBeat, SUPERVISOR_INTERVAL_MS } from '@/lib/oauth-rotator/server-supervisor'
import { readChoreStamp, choreStampPath } from '@/lib/janitor-chore-stamp'
import type { Facts } from '@/lib/oauth-rotator/supervisor'
// Side-effect only: registers the REAL chore-claim predicate `stampChoreRun` gates on. Without
// this import in THIS file's own module graph the predicate stays unregistered and the central
// guard fails OPEN — see the last describe block, which needs it registered to exercise the real
// gate rather than pass vacuously.
import '@/lib/server-liveness'

const ENV_KEYS = ['HOME', 'XDG_STATE_HOME'] as const
let saved: Record<string, string | undefined>
let tmpDir: string

beforeEach(() => {
  saved = {}
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-srvsuper-'))
  process.env.HOME = tmpDir
  delete process.env.XDG_STATE_HOME
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* best-effort */ }
})

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

/** Create the opt-in flag file under the temp statedir (mirrors the human's deliberate opt-in). */
function createFlag(): void {
  const flag = statePath('oauth-rotator-tick.enabled')
  fs.mkdirSync(path.dirname(flag), { recursive: true })
  fs.writeFileSync(flag, '')
}

/**
 * The real chore stamp (ORH-4/M3). File-wide $HOME containment above; here we additionally clear
 * the stamp itself, since $JANITOR_CONTROL_DIR is a process-wide temp dir
 * (tests/setup/janitor-control-containment.ts), not reset per test — so "absent" means THIS
 * test, not a leftover from an earlier one (including the describe block above, which also drives
 * the real, unconditional stamp call).
 */
describe('server-supervisor — the real chore stamp tracks OUR flag, never the beat alone (ORH-4/M3)', () => {
  beforeEach(() => { fs.rmSync(choreStampPath('oauth-rotator-supervisor'), { force: true }) })

  it('flag OFF: no stamp — even with the janitor opt-in present and the beat producing real alerts', () => {
    const log = vi.fn()
    const out = runOneSupervisorBeat({
      optInCheck: () => true, // the janitor-side opt-in, deliberately ON here
      gatherFactsImpl: () => facts({ pinningEnv: ['ANTHROPIC_API_KEY'] }),
      log,
    })
    // The supervisor beat itself gets NO new gate on our flag — it keeps producing the
    // dashboard's alerts while the janitor owns rotation. Only the STAMP is suppressed.
    expect(out).toEqual(['pinning-env'])
    expect(readChoreStamp('oauth-rotator-supervisor')).toBeNull()
  })

  it('flag ON: the real oauth-rotator-supervisor stamp is written', () => {
    createFlag()
    runOneSupervisorBeat({ optInCheck: () => true, gatherFactsImpl: () => facts(), log: () => {} })
    expect(readChoreStamp('oauth-rotator-supervisor')).not.toBeNull()
  })
})
