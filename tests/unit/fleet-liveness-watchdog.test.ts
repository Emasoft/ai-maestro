import { describe, it, expect } from 'vitest'
import { runFleetLivenessTick, startFleetLivenessWatchdog } from '@/lib/fleet-liveness-watchdog'
import type { FleetLivenessSnapshot } from '@/lib/fleet-liveness'

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
      now: () => 1_000,
      log: (m) => logs.push(m),
      scan: async () =>
        snap({
          agents: [
            { agentId: 'a1', name: 'alpha', class: 'stalled', recoveryRecommended: true, reason: 'x' },
            { agentId: 'a2', name: 'beta', class: 'token_blocked', recoveryRecommended: false, reason: 'y' },
            { agentId: 'a3', name: 'gamma', class: 'active', recoveryRecommended: false, reason: 'z' },
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

  it('reports the actuation-block reason instead of recovery targets under a STOP', async () => {
    const logs: string[] = []
    await runFleetLivenessTick({
      now: () => 1,
      log: (m) => logs.push(m),
      scan: async () =>
        snap({
          actuationBlocked: true,
          actuationBlockReason: 'kill-switch.flag',
          agents: [{ agentId: 'a1', name: 'alpha', class: 'stalled', recoveryRecommended: true, reason: 'x' }],
          recoveryTargets: [],
        }),
    })
    expect(logs[0]).toContain('actuation BLOCKED: kill-switch.flag')
  })

  it('boot-debounces dead agents: past-window → crashed, within-window → debouncing (D2)', async () => {
    const logs: string[] = []
    await runFleetLivenessTick({
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
            { agentId: 'a1', name: 'zombie', class: 'dead', recoveryRecommended: false, reason: 'crashed' },
            { agentId: 'a2', name: 'newborn', class: 'dead', recoveryRecommended: false, reason: 'crashed' },
          ],
          recoveryTargets: [],
        }),
    })
    expect(logs).toHaveLength(1)
    // the genuinely-crashed one is a hard-recovery candidate (still Phase C gated) …
    expect(logs[0]).toContain('1 dead (crashed past boot window, Phase C hard-recovery gated): zombie')
    // … the just-relaunched one is suppressed — NOT a recovery target while it may still be booting.
    expect(logs[0]).toContain('1 dead (within boot window — debouncing, NOT a recovery target): newborn')
  })

  it('stays silent when the fleet is healthy', async () => {
    const logs: string[] = []
    await runFleetLivenessTick({
      now: () => 1,
      log: (m) => logs.push(m),
      scan: async () => snap({ agents: [{ agentId: 'a1', name: 'alpha', class: 'active', recoveryRecommended: false, reason: 'ok' }] }),
    })
    expect(logs).toHaveLength(0)
  })

  it('a throwing scan is non-fatal — logs and returns null, never throws', async () => {
    const logs: string[] = []
    const r = await runFleetLivenessTick({
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
      agents: [{ agentId: 'a1', name: 'alpha', class: 'stalled', recoveryRecommended: true, reason: 'x' }],
      recoveryTargets: ['a1'],
    })

  it('runs the pass and logs FIRED lines when fireEnabled + targets present', async () => {
    const logs: string[] = []
    const calls: FleetLivenessSnapshot[] = []
    const r = await runFleetLivenessTick({
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
      now: () => 1,
      log: () => {},
      fireEnabled: true,
      scan: async () =>
        snap({
          agents: [{ agentId: 'a1', name: 'alpha', class: 'idle_waiting', recoveryRecommended: false, reason: 'ok' }],
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

describe('startFleetLivenessWatchdog', () => {
  it('returns a stop function for a positive interval and null when disabled', () => {
    const stop = startFleetLivenessWatchdog({ intervalMs: 60_000, scan: async () => snap() })
    expect(typeof stop).toBe('function')
    stop?.()
    expect(startFleetLivenessWatchdog({ intervalMs: 0 })).toBeNull()
    expect(startFleetLivenessWatchdog({ intervalMs: -1 })).toBeNull()
  })
})
