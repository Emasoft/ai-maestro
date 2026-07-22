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

describe('startFleetLivenessWatchdog', () => {
  it('returns a stop function for a positive interval and null when disabled', () => {
    const stop = startFleetLivenessWatchdog({ intervalMs: 60_000, scan: async () => snap() })
    expect(typeof stop).toBe('function')
    stop?.()
    expect(startFleetLivenessWatchdog({ intervalMs: 0 })).toBeNull()
    expect(startFleetLivenessWatchdog({ intervalMs: -1 })).toBeNull()
  })
})
