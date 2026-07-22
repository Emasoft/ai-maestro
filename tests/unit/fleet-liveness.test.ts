import { describe, it, expect } from 'vitest'
import {
  classifyLiveness,
  scanFleetLiveness,
  DEFAULT_STALL_THRESHOLD_MS,
  type FleetScanDeps,
} from '@/lib/fleet-liveness'

const online = { hasSession: true, exists: true }

describe('classifyLiveness (pure)', () => {
  it('no session ⇒ offline, no recovery', () => {
    expect(classifyLiveness({ hasSession: false, exists: false })).toMatchObject({ class: 'offline', recoveryRecommended: false })
    // absent isPersisted defaults to not-persisted ⇒ offline (never dead)
    expect(classifyLiveness({ hasSession: true, exists: false })).toMatchObject({ class: 'offline', recoveryRecommended: false })
  })

  it('persisted session but tmux gone ⇒ dead (crashed), detection-only (no recovery yet)', () => {
    expect(classifyLiveness({ hasSession: true, exists: false, isPersisted: true }))
      .toMatchObject({ class: 'dead', recoveryRecommended: false })
  })

  it('NOT persisted + tmux gone ⇒ offline (clean hibernate), never dead', () => {
    expect(classifyLiveness({ hasSession: true, exists: false, isPersisted: false }))
      .toMatchObject({ class: 'offline', recoveryRecommended: false })
  })

  it('dead is decided on absence: a persisted+absent agent is dead regardless of a stale idle reading', () => {
    expect(
      classifyLiveness({ hasSession: true, exists: false, isPersisted: true, notificationType: 'idle_prompt', timeSinceActivityMs: DEFAULT_STALL_THRESHOLD_MS + 1 }),
    ).toMatchObject({ class: 'dead' })
  })

  it('unhealthy account ⇒ token_blocked, no recovery (defer to the cascade)', () => {
    expect(classifyLiveness({ ...online, accountHealthy: false, notificationType: 'idle_prompt', timeSinceActivityMs: 10 * 3_600_000 }))
      .toMatchObject({ class: 'token_blocked', recoveryRecommended: false })
  })

  it('permission prompt ⇒ permission_waiting, never a stall even when long-idle', () => {
    expect(classifyLiveness({ ...online, notificationType: 'permission_prompt', timeSinceActivityMs: 10 * 3_600_000 }))
      .toMatchObject({ class: 'permission_waiting', recoveryRecommended: false })
  })

  it('active ⇒ active, no recovery', () => {
    expect(classifyLiveness({ ...online, activityStatus: 'active' })).toMatchObject({ class: 'active', recoveryRecommended: false })
  })

  it('idle within the stall window ⇒ idle_waiting, no recovery', () => {
    expect(classifyLiveness({ ...online, notificationType: 'idle_prompt', timeSinceActivityMs: 60_000 }))
      .toMatchObject({ class: 'idle_waiting', recoveryRecommended: false })
  })

  it('idle PAST the stall window ⇒ stalled, recovery recommended', () => {
    const v = classifyLiveness({ ...online, notificationType: 'idle_prompt', timeSinceActivityMs: DEFAULT_STALL_THRESHOLD_MS + 1 })
    expect(v.class).toBe('stalled')
    expect(v.recoveryRecommended).toBe(true)
  })

  it('idle with UNKNOWN activity time ⇒ idle_waiting (cannot prove a stall)', () => {
    expect(classifyLiveness({ ...online, notificationType: 'idle_prompt', timeSinceActivityMs: null }))
      .toMatchObject({ class: 'idle_waiting', recoveryRecommended: false })
  })

  it('online but indeterminate ⇒ idle_waiting, no recovery', () => {
    expect(classifyLiveness({ ...online })).toMatchObject({ class: 'idle_waiting', recoveryRecommended: false })
  })

  it('token-block precedence: an unhealthy account beats a permission/idle reading', () => {
    expect(classifyLiveness({ ...online, accountHealthy: false, notificationType: 'permission_prompt' }))
      .toMatchObject({ class: 'token_blocked' })
  })
})

function fakeDeps(over: Partial<FleetScanDeps> = {}): FleetScanDeps {
  return {
    listAgents: () => [
      { id: 'a1', name: 'alpha', workingDirectory: '/w/alpha' },
      { id: 'a2', name: 'beta', workingDirectory: '/w/beta' },
      { id: 'a3', name: 'gamma', workingDirectory: '/w/gamma' },
    ],
    getStatus: async (id) => {
      if (id === 'a1') return { hasSession: true, exists: true, timeSinceActivityMs: DEFAULT_STALL_THRESHOLD_MS + 60_000 } // stalled
      if (id === 'a2') return { hasSession: true, exists: true, timeSinceActivityMs: 5_000 } // active-ish
      return { hasSession: false, exists: false, timeSinceActivityMs: null } // offline
    },
    getHookNotification: (wd) => {
      if (wd === '/w/alpha') return { status: 'waiting', notificationType: 'idle_prompt' }
      if (wd === '/w/beta') return { status: 'active', notificationType: null }
      return null
    },
    actuationBlocked: () => ({ blocked: false, reason: null }),
    ...over,
  }
}

describe('scanFleetLiveness', () => {
  it('classifies each agent and lists only stalled ones as recovery targets', async () => {
    const snap = await scanFleetLiveness(fakeDeps(), 1_000)
    expect(snap.scannedAt).toBe(1_000)
    const byId = Object.fromEntries(snap.agents.map((a) => [a.agentId, a.class]))
    expect(byId).toEqual({ a1: 'stalled', a2: 'active', a3: 'offline' })
    expect(snap.recoveryTargets).toEqual(['a1'])
  })

  it('a machine-wide STOP reports classes but empties recoveryTargets', async () => {
    const snap = await scanFleetLiveness(
      fakeDeps({ actuationBlocked: () => ({ blocked: true, reason: 'kill-switch.flag' }) }),
      2_000,
    )
    expect(snap.actuationBlocked).toBe(true)
    expect(snap.actuationBlockReason).toBe('kill-switch.flag')
    expect(snap.agents.find((a) => a.agentId === 'a1')?.class).toBe('stalled') // still visible
    expect(snap.recoveryTargets).toEqual([]) // but never actuated under a deliberate halt
  })

  it('a failed status read records offline, never a recovery target', async () => {
    const snap = await scanFleetLiveness(
      fakeDeps({ getStatus: async () => { throw new Error('runtime down') } }),
      3_000,
    )
    expect(snap.agents.every((a) => a.class === 'offline')).toBe(true)
    expect(snap.recoveryTargets).toEqual([])
  })

  it('an unhealthy account overrides a stalled-looking agent into token_blocked (no recovery)', async () => {
    const snap = await scanFleetLiveness(
      fakeDeps({ getAccountHealthy: async (id) => (id === 'a1' ? false : null) }),
      4_000,
    )
    expect(snap.agents.find((a) => a.agentId === 'a1')?.class).toBe('token_blocked')
    expect(snap.recoveryTargets).toEqual([]) // a1 no longer a target; a2/a3 aren't stalled
  })

  it('a persisted-but-absent agent classifies as dead (crashed), never a recovery target', async () => {
    const snap = await scanFleetLiveness(
      fakeDeps({
        getStatus: async (id) =>
          id === 'a3'
            ? { hasSession: true, exists: false, timeSinceActivityMs: null } // crashed: record present, tmux gone
            : id === 'a1'
              ? { hasSession: true, exists: true, timeSinceActivityMs: DEFAULT_STALL_THRESHOLD_MS + 60_000 }
              : { hasSession: true, exists: true, timeSinceActivityMs: 5_000 },
        isPersisted: (id) => id === 'a3', // a3 is still persisted ⇒ dead, not hibernated
      }),
      5_000,
    )
    expect(snap.agents.find((a) => a.agentId === 'a3')?.class).toBe('dead')
    expect(snap.recoveryTargets).toEqual(['a1']) // dead is NOT a recovery target (Phase C gated)
  })

  it('without an isPersisted dep, a persisted-looking absent agent falls through to offline (never dead)', async () => {
    const snap = await scanFleetLiveness(
      fakeDeps({ getStatus: async () => ({ hasSession: true, exists: false, timeSinceActivityMs: null }) }),
      6_000,
    )
    expect(snap.agents.every((a) => a.class === 'offline')).toBe(true)
  })
})
