import { describe, it, expect } from 'vitest'
import { runFleetLivenessTick, startFleetLivenessWatchdog, resetContinuityStore } from '@/lib/fleet-liveness-watchdog'
import type { FleetLivenessSnapshot } from '@/lib/fleet-liveness'

/**
 * A DETERMINISTIC continuity leg. Without it these tests read the DEVELOPER'S REAL MACHINE:
 * `runFleetLivenessTick`'s continuity pass defaults to `runContinuityTick(defaultContinuityDeps(…))`,
 * which enumerates the real agent registry — not the `scan` fixture each test supplies. So a
 * host that happens to own an agent in the right state contributes an extra log line and every
 * exact-count assertion in this file fails.
 *
 * Measured 2026-08-15: three tests failed IN ISOLATION with a single unexplained line —
 * `[FleetContinuity] testbot: not actuated (empty-frame)` — where `testbot` appears in no
 * fixture in this file. It is a real agent in `~/.aimaestro/agents/registry.json`. The failure
 * had been carried for weeks as a "full-suite load flake"; it was never load-dependent, it was
 * MACHINE-dependent, and it looked like a flake only because whether it fires depends on what
 * the host's own fleet is doing at that moment.
 *
 * Applied to EVERY call in this file, not only the three that were red: the other seven assert
 * on returned snapshots today and would acquire the same dependency the moment anyone adds a
 * log assertion to them.
 */
const NO_CONTINUITY = {
  runContinuity: async () => ({ scanned: 0, fired: [], skipped: [] }),
}

function snap(over: Partial<FleetLivenessSnapshot> = {}): FleetLivenessSnapshot {
  return {
    scannedAt: 1_000,
    actuationBlocked: false,
    actuationBlockReason: null,
    agents: [],
    recoveryTargets: [],
    ...over,
  }
}

describe('runFleetLivenessTick (read-only)', () => {
  it('logs stalled + token-blocked agents with the detect-only note', async () => {
    const logs: string[] = []
    await runFleetLivenessTick({
      ...NO_CONTINUITY,
      now: () => 1_000,
      log: (m) => logs.push(m),
      scan: async () =>
        snap({
          agents: [
            { agentId: 'a1', name: 'alpha', origin: 'registry', class: 'stalled', recoveryRecommended: true, reason: 'x' },
            { agentId: 'a2', name: 'beta', origin: 'registry', class: 'token_blocked', recoveryRecommended: false, reason: 'y' },
            { agentId: 'a3', name: 'gamma', origin: 'registry', class: 'active', recoveryRecommended: false, reason: 'z' },
          ],
          recoveryTargets: ['a1'],
        }),
    })
    expect(logs).toHaveLength(1)
    expect(logs[0]).toContain('1 stalled: alpha')
    expect(logs[0]).toContain('1 token-blocked: beta')
    expect(logs[0]).toContain('recovery targets: 1')
    expect(logs[0]).toContain('detect-only')
  })

  // TRDD-99LV0U4I: the second population is DETECT-ONLY — one log line when any session is
  // stale, silence otherwise, and it never enters the recovery pass (the pass is keyed on
  // recoveryTargets, which the scan builds from the registry population alone).
  it('logs stale janitor-armed non-agent sessions as detect-only, names no recovery target, and is silent when none are stale', async () => {
    const logs: string[] = []
    let passCalls = 0
    await runFleetLivenessTick({
      ...NO_CONTINUITY,
      now: () => 1,
      log: (m) => logs.push(m),
      fireEnabled: true,
      runPass: async () => {
        passCalls++
        return { fired: [], escalationNeeded: [] }
      },
      scan: async () =>
        snap({
          agents: [],
          recoveryTargets: [],
          sessions: [
            { origin: 'janitor-session', pid: 74422, tty: 'ttys017', tmuxPane: null, projectRoot: '/Code/ANIME2SVG', transcriptAgeS: 272_062, class: 'stale' },
            { origin: 'janitor-session', pid: 92150, tty: 'ttys002', tmuxPane: '%3', projectRoot: '/Code/hub', transcriptAgeS: 9, class: 'active' },
          ],
        }),
    })
    expect(logs).toHaveLength(1)
    expect(logs[0]).toContain('1 janitor-armed non-agent session(s) stale')
    expect(logs[0]).toContain('/Code/ANIME2SVG pid=74422')
    expect(logs[0]).not.toContain('/Code/hub')
    expect(logs[0]).toContain('detect-only, no actuation lane')
    expect(passCalls).toBe(0)

    const quiet: string[] = []
    await runFleetLivenessTick({
      ...NO_CONTINUITY,
      now: () => 1,
      log: (m) => quiet.push(m),
      scan: async () =>
        snap({
          agents: [],
          recoveryTargets: [],
          sessions: [{ origin: 'janitor-session', pid: 1, tty: '', tmuxPane: null, projectRoot: '/Code/x', transcriptAgeS: 10, class: 'alive' }],
        }),
    })
    expect(quiet).toEqual([])
  })

  it('reports the actuation-block reason instead of recovery targets under a STOP', async () => {
    const logs: string[] = []
    await runFleetLivenessTick({
      ...NO_CONTINUITY,
      now: () => 1,
      log: (m) => logs.push(m),
      scan: async () =>
        snap({
          actuationBlocked: true,
          actuationBlockReason: 'kill-switch.flag',
          agents: [{ agentId: 'a1', name: 'alpha', origin: 'registry', class: 'stalled', recoveryRecommended: true, reason: 'x' }],
          recoveryTargets: [],
        }),
    })
    expect(logs[0]).toContain('actuation BLOCKED: kill-switch.flag')
  })

  it('boot-debounces dead agents: past-window → crashed, within-window → debouncing (D2)', async () => {
    const logs: string[] = []
    await runFleetLivenessTick({
      ...NO_CONTINUITY,
      now: () => 1,
      log: (m) => logs.push(m),
      // Inject the partition (0-IMPACT: no real sidecar) — zombie past the boot window, newborn within.
      trackDead: (ids) => ({
        hardRecoverable: ids.filter((id) => id === 'a1'),
        debouncing: ids.filter((id) => id === 'a2'),
        nextFirstSeen: {},
      }),
      scan: async () =>
        snap({
          agents: [
            { agentId: 'a1', name: 'zombie', origin: 'registry', class: 'dead', recoveryRecommended: false, reason: 'crashed' },
            { agentId: 'a2', name: 'newborn', origin: 'registry', class: 'dead', recoveryRecommended: false, reason: 'crashed' },
          ],
          recoveryTargets: [],
        }),
    })
    expect(logs).toHaveLength(1)
    // the genuinely-crashed one is a hard-recovery candidate (flag dark by default) …
    expect(logs[0]).toContain(
      '1 dead (crashed past boot window, hard recovery OFF: AIM_FLEET_HARD_RECOVERY not set): zombie',
    )
    // … the just-relaunched one is suppressed — NOT a recovery target while it may still be booting.
    expect(logs[0]).toContain('1 dead (within boot window — debouncing, NOT a recovery target): newborn')
  })

  it('stays silent when the fleet is healthy', async () => {
    const logs: string[] = []
    await runFleetLivenessTick({
      ...NO_CONTINUITY,
      now: () => 1,
      log: (m) => logs.push(m),
      scan: async () => snap({ agents: [{ agentId: 'a1', name: 'alpha', origin: 'registry', class: 'active', recoveryRecommended: false, reason: 'ok' }] }),
    })
    expect(logs).toHaveLength(0)
  })

  it('a throwing scan is non-fatal — logs and returns null, never throws', async () => {
    const logs: string[] = []
    const r = await runFleetLivenessTick({
      ...NO_CONTINUITY,
      now: () => 1,
      log: (m) => logs.push(m),
      scan: async () => {
        throw new Error('registry down')
      },
    })
    expect(r).toBeNull()
    expect(logs[0]).toContain('scan failed (non-fatal): registry down')
  })
})

describe('runFleetLivenessTick — recovery actuation (D-full, behind the default-OFF fire flag)', () => {
  const stalledSnap = () =>
    snap({
      agents: [{ agentId: 'a1', name: 'alpha', origin: 'registry', class: 'stalled', recoveryRecommended: true, reason: 'x' }],
      recoveryTargets: ['a1'],
    })

  it('runs the pass and logs FIRED lines when fireEnabled + targets present', async () => {
    const logs: string[] = []
    const calls: FleetLivenessSnapshot[] = []
    const r = await runFleetLivenessTick({
      ...NO_CONTINUITY,
      now: () => 1,
      log: (m) => logs.push(m),
      fireEnabled: true,
      scan: async () => stalledSnap(),
      runPass: async (s) => {
        calls.push(s)
        return { fired: [{ agentId: 'a1', name: 'alpha', rung: 'esc_nudge', ok: true }], escalationNeeded: [] }
      },
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].recoveryTargets).toEqual(['a1'])
    expect(logs.some((l) => l.includes('recovery FIRED alpha: esc_nudge'))).toBe(true)
    expect(r).not.toBeNull()
  })

  it('logs ESCALATION NEEDED lines from the pass', async () => {
    const logs: string[] = []
    await runFleetLivenessTick({
      ...NO_CONTINUITY,
      now: () => 1,
      log: (m) => logs.push(m),
      fireEnabled: true,
      scan: async () => stalledSnap(),
      runPass: async () => ({ fired: [], escalationNeeded: [{ agentId: 'a1', name: 'alpha', reason: 'hard_gated' }] }),
    })
    expect(logs.some((l) => l.includes('recovery ESCALATION NEEDED alpha: hard_gated'))).toBe(true)
  })

  it('does NOT run the pass when fireEnabled is false, even with targets', async () => {
    let called = false
    await runFleetLivenessTick({
      ...NO_CONTINUITY,
      now: () => 1,
      log: () => {},
      fireEnabled: false,
      scan: async () => stalledSnap(),
      runPass: async () => {
        called = true
        return { fired: [], escalationNeeded: [] }
      },
    })
    expect(called).toBe(false)
  })

  it('does NOT run the pass when there are no recovery targets', async () => {
    let called = false
    await runFleetLivenessTick({
      ...NO_CONTINUITY,
      now: () => 1,
      log: () => {},
      fireEnabled: true,
      scan: async () =>
        snap({
          agents: [{ agentId: 'a1', name: 'alpha', origin: 'registry', class: 'idle_waiting', recoveryRecommended: false, reason: 'ok' }],
          recoveryTargets: [],
        }),
      runPass: async () => {
        called = true
        return { fired: [], escalationNeeded: [] }
      },
    })
    expect(called).toBe(false)
  })

  it('a throwing pass is non-fatal — logs and still returns the snapshot', async () => {
    const logs: string[] = []
    const r = await runFleetLivenessTick({
      ...NO_CONTINUITY,
      now: () => 1,
      log: (m) => logs.push(m),
      fireEnabled: true,
      scan: async () => stalledSnap(),
      runPass: async () => {
        throw new Error('queue offline')
      },
    })
    expect(r).not.toBeNull()
    expect(logs.some((l) => l.includes('recovery pass failed (non-fatal): queue offline'))).toBe(true)
  })
})

describe('runFleetLivenessTick — HARD recovery leg (Phase C, behind AIM_FLEET_HARD_RECOVERY)', () => {
  const deadSnap = () =>
    snap({
      agents: [
        { agentId: 'a1', name: 'zombie', origin: 'registry', class: 'dead', recoveryRecommended: false, reason: 'crashed' },
        { agentId: 'a2', name: 'newborn', origin: 'registry', class: 'dead', recoveryRecommended: false, reason: 'crashed' },
      ],
      recoveryTargets: [],
    })
  const partition = (ids: string[]) => ({
    hardRecoverable: ids.filter((id) => id === 'a1'),
    debouncing: ids.filter((id) => id === 'a2'),
    nextFirstSeen: {},
  })

  it('does NOT run the hard pass by default, even with a confirmed-dead agent', async () => {
    let called = 0
    await runFleetLivenessTick({
      ...NO_CONTINUITY,
      now: () => 1,
      log: () => {},
      trackDead: partition,
      scan: async () => deadSnap(),
      runHardPass: async () => {
        called++
        return { fired: [], crashLooping: [] }
      },
    })
    expect(called).toBe(0)
  })

  it('armed: runs the hard pass with the FULL dead set + the tracker-confirmed subset, logs FIRED', async () => {
    const logs: string[] = []
    let gotDead: string[] = []
    let gotConfirmed: string[] = []
    await runFleetLivenessTick({
      ...NO_CONTINUITY,
      now: () => 1,
      log: (m) => logs.push(m),
      trackDead: partition,
      hardRecoveryEnabled: true,
      scan: async () => deadSnap(),
      runHardPass: async (dead, confirmed) => {
        gotDead = dead.map((d) => d.agentId)
        gotConfirmed = [...confirmed]
        return {
          fired: [{ agentId: 'a1', name: 'zombie', rung: 'relaunch', ok: true }],
          crashLooping: [{ agentId: 'a2', name: 'newborn', detail: 'attempt 3' }],
        }
      },
    })
    // Every dead agent is driven (the debounce gate stays a live decision surface)…
    expect(gotDead).toEqual(['a1', 'a2'])
    // …but only the tracker-confirmed subset can fire.
    expect(gotConfirmed).toEqual(['a1'])
    expect(logs.some((l) => l.includes('HARD recovery FIRED zombie: relaunch'))).toBe(true)
    expect(logs.some((l) => l.includes('HARD recovery CRASH LOOP newborn'))).toBe(true)
  })

  it('a throwing hard pass is non-fatal — logs and still returns the snapshot', async () => {
    const logs: string[] = []
    const r = await runFleetLivenessTick({
      ...NO_CONTINUITY,
      now: () => 1,
      log: (m) => logs.push(m),
      trackDead: partition,
      hardRecoveryEnabled: true,
      scan: async () => deadSnap(),
      runHardPass: async () => {
        throw new Error('wake service down')
      },
    })
    expect(r).not.toBeNull()
    expect(logs.some((l) => l.includes('hard-recovery pass failed (non-fatal): wake service down'))).toBe(true)
  })
})

describe('startFleetLivenessWatchdog', () => {
  it('returns a stop function for a positive interval and null when disabled', () => {
    const stop = startFleetLivenessWatchdog({ intervalMs: 60_000, scan: async () => snap() })
    expect(typeof stop).toBe('function')
    stop?.()
    expect(startFleetLivenessWatchdog({ intervalMs: 0 })).toBeNull()
    expect(startFleetLivenessWatchdog({ intervalMs: -1 })).toBeNull()
  })
})

/**
 * TRDD-7UWQ92WK — the continuity heartbeat.
 *
 * The leg logs only `fired` and non-`no_event` skips, so a HEALTHY pass used to print NOTHING.
 * That made "classifying fine" and "never ran at all" byte-identical observations, and the
 * automaton sat dark from 2026-08-06 to 2026-08-20 (556 consecutive `empty-frame` skips) with no
 * signal anyone could have read. These pin the missing "I ran and I was fine".
 *
 * NEUTER RUNS (2026-08-21 — OBSERVED via scripts/dev/neuter, restore verified by blob hash).
 * A COMPLEMENTARY PAIR, because one mutation cannot reach both halves: the heartbeat's existence
 * and its `scanned > 0` gate fail in opposite directions, and each neuter leaves the other half's
 * tests green.
 *
 *   s/^        cr\.scanned > 0 &&$/        false && true &&/     (heartbeat made inert)
 *   → 3 red / 16 green:
 *       logs a pass-ok line when the leg scanned agents and found nothing to do
 *       prints immediately when the outcome CHANGES, without waiting for the throttle window
 *       throttles an unchanged outcome so a steady fleet does not print every tick
 *
 *   s/cr\.scanned > 0 &&/cr.scanned >= 0 &&/                     (gate made always-true)
 *   → 2 red / 17 green:
 *       stays silent when the leg scanned nothing — an empty host must not print about nothing
 *       logs stalled + token-blocked agents with the detect-only note
 *
 * The second run's OTHER casualty is the point of the gate: every pre-existing test in this file
 * injects a `scanned: 0` continuity stub, so without the gate the heartbeat prints into all of
 * them and their exact-count assertions break. The gate is load-bearing for the existing suite,
 * not only for the new silence test.
 */
describe('continuity heartbeat', () => {
  it('logs a pass-ok line when the leg scanned agents and found nothing to do', async () => {
    resetContinuityStore()
    const logs: string[] = []
    await runFleetLivenessTick({
      now: () => 1_000,
      log: (m) => logs.push(m),
      scan: async () => snap(),
      runContinuity: async () => ({ scanned: 3, fired: [], skipped: [] }),
    })
    // The whole point: a pass with nothing to report is no longer silent.
    expect(logs.some((l) => l === '[FleetContinuity] pass ok: scanned 3, fired 0, skipped 0')).toBe(true)
  })

  it('throttles an unchanged outcome so a steady fleet does not print every tick', async () => {
    resetContinuityStore()
    const logs: string[] = []
    const opts = {
      now: () => 1_000,
      log: (m: string) => logs.push(m),
      scan: async () => snap(),
      runContinuity: async () => ({ scanned: 3, fired: [], skipped: [] }),
    }
    await runFleetLivenessTick(opts)
    await runFleetLivenessTick(opts)
    await runFleetLivenessTick(opts)
    // First tick prints (signature changed from nothing); the identical two do not.
    expect(logs.filter((l) => l.startsWith('[FleetContinuity] pass ok:'))).toHaveLength(1)
  })

  it('prints immediately when the outcome CHANGES, without waiting for the throttle window', async () => {
    resetContinuityStore()
    const logs: string[] = []
    const base = { now: () => 1_000, log: (m: string) => logs.push(m), scan: async () => snap() }
    await runFleetLivenessTick({ ...base, runContinuity: async () => ({ scanned: 3, fired: [], skipped: [] }) })
    await runFleetLivenessTick({
      ...base,
      runContinuity: async () => ({ scanned: 3, fired: [], skipped: [{ agentId: 'a1', name: 'alpha', reason: 'empty-frame' }] }),
    })
    expect(logs.some((l) => l === '[FleetContinuity] pass ok: scanned 3, fired 0, skipped 1')).toBe(true)
  })

  it('stays silent when the leg scanned nothing — an empty host must not print about nothing', async () => {
    resetContinuityStore()
    const logs: string[] = []
    await runFleetLivenessTick({
      now: () => 1_000,
      log: (m) => logs.push(m),
      scan: async () => snap(),
      runContinuity: async () => ({ scanned: 0, fired: [], skipped: [] }),
    })
    expect(logs.some((l) => l.startsWith('[FleetContinuity] pass ok:'))).toBe(false)
  })
})
