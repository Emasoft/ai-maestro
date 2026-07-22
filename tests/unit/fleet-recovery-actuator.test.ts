import { describe, it, expect, vi } from 'vitest'
import {
  actuateRecovery,
  diagnosisForClass,
  DEFAULT_COOLDOWN_MS,
  type ActuatorDeps,
  type RecoveryAction,
  type RecoveryTarget,
} from '@/lib/fleet-recovery-actuator'
import type { LivenessClass } from '@/lib/fleet-liveness'

// A recording fake injector + a deps builder with every gate open by default. Each test
// closes exactly the gate it exercises, so a failure names the gate.
function makeDeps(over: Partial<ActuatorDeps> = {}): { deps: ActuatorDeps; injected: RecoveryAction[] } {
  const injected: RecoveryAction[] = []
  const deps: ActuatorDeps = {
    fireEnabled: true,
    hardEnabled: false,
    actuationBlocked: () => ({ blocked: false, reason: null }),
    hidPresent: () => false,
    inject: async (a) => {
      injected.push(a)
      return { ok: true }
    },
    now: () => 1_000_000,
    ...over,
  }
  return { deps, injected }
}

function target(over: Partial<RecoveryTarget> = {}): RecoveryTarget {
  return { agentId: 'a1', name: 'agent-one', class: 'stalled', attempt: 0, lastActuatedAtMs: null, ...over }
}

describe('diagnosisForClass', () => {
  it('maps only stalled → frozen; every other class is not a target', () => {
    expect(diagnosisForClass('stalled')).toBe('frozen')
    const notTargets: LivenessClass[] = ['active', 'idle_waiting', 'permission_waiting', 'token_blocked', 'offline']
    for (const c of notTargets) expect(diagnosisForClass(c)).toBeNull()
  })
})

describe('actuateRecovery — the gentle ladder fires by attempt', () => {
  it('attempt 0 fires esc_nudge (ESC + /janitor-resume)', async () => {
    const { deps, injected } = makeDeps()
    const d = await actuateRecovery(target({ attempt: 0 }), deps)
    expect(d.fired).toBe(true)
    if (d.fired) {
      expect(d.action.rung).toBe('esc_nudge')
      expect(d.action.slash).toBe('/janitor-resume')
      expect(d.action.needsEsc).toBe(true)
      expect(d.result.ok).toBe(true)
    }
    expect(injected).toHaveLength(1)
    expect(injected[0].agentId).toBe('a1')
  })

  it('escalates one rung per attempt: rearm → reload → update', async () => {
    for (const [attempt, rung, slash] of [
      [1, 'rearm', '/janitor-arm'],
      [2, 'reload', '/reload-plugins'],
      [3, 'update', '/reload-plugins --force'],
    ] as const) {
      const { deps } = makeDeps()
      const d = await actuateRecovery(target({ attempt }), deps)
      expect(d.fired).toBe(true)
      if (d.fired) {
        expect(d.action.rung).toBe(rung)
        expect(d.action.slash).toBe(slash)
        expect(d.action.needsEsc).toBe(false)
      }
    }
  })
})

describe('actuateRecovery — the seven gates', () => {
  it('non-stalled class ⇒ not_a_target, inject never called', async () => {
    const classes: LivenessClass[] = ['active', 'idle_waiting', 'permission_waiting', 'token_blocked', 'offline']
    for (const c of classes) {
      const { deps, injected } = makeDeps()
      const d = await actuateRecovery(target({ class: c }), deps)
      expect(d).toMatchObject({ fired: false, reason: 'not_a_target', detail: c })
      expect(injected).toHaveLength(0)
    }
  })

  it('fire flag OFF ⇒ fire_flag_off, and no gate below it is even consulted', async () => {
    const actuationBlocked = vi.fn(() => ({ blocked: true, reason: 'kill-switch.flag' }))
    const hidPresent = vi.fn(() => true)
    const { deps, injected } = makeDeps({ fireEnabled: false, actuationBlocked, hidPresent })
    const d = await actuateRecovery(target(), deps)
    expect(d).toMatchObject({ fired: false, reason: 'fire_flag_off' })
    expect(injected).toHaveLength(0)
    // fire_flag_off is checked BEFORE any I/O — the STOP gate and HID probe are not read.
    expect(actuationBlocked).not.toHaveBeenCalled()
    expect(hidPresent).not.toHaveBeenCalled()
  })

  it('janitor machine-wide STOP ⇒ actuation_blocked, inject never called', async () => {
    const { deps, injected } = makeDeps({ actuationBlocked: () => ({ blocked: true, reason: 'global-pause.flag' }) })
    const d = await actuateRecovery(target(), deps)
    expect(d).toMatchObject({ fired: false, reason: 'actuation_blocked', detail: 'global-pause.flag' })
    expect(injected).toHaveLength(0)
  })

  it('HID present ⇒ hid_present, inject never called', async () => {
    const { deps, injected } = makeDeps({ hidPresent: () => true })
    const d = await actuateRecovery(target(), deps)
    expect(d).toMatchObject({ fired: false, reason: 'hid_present' })
    expect(injected).toHaveLength(0)
  })

  it('within cooldown ⇒ cooldown, inject never called', async () => {
    const now = 1_000_000
    const { deps, injected } = makeDeps({ now: () => now })
    // last actuated 1 minute ago, well within the 10-minute window
    const d = await actuateRecovery(target({ lastActuatedAtMs: now - 60_000 }), deps)
    expect(d.fired).toBe(false)
    if (!d.fired) expect(d.reason).toBe('cooldown')
    expect(injected).toHaveLength(0)
  })

  it('cooldown expired ⇒ fires', async () => {
    const now = 1_000_000
    const { deps, injected } = makeDeps({ now: () => now })
    const d = await actuateRecovery(target({ lastActuatedAtMs: now - (DEFAULT_COOLDOWN_MS + 1) }), deps)
    expect(d.fired).toBe(true)
    expect(injected).toHaveLength(1)
  })
})

describe('actuateRecovery — HARD rungs are refused by this gentle-only actuator', () => {
  it('attempt reaching a hard rung with hard DISABLED ⇒ hard_gated (human needed)', async () => {
    const { deps, injected } = makeDeps({ hardEnabled: false })
    // frozen: esc_nudge,rearm,reload,update,[relaunch=hard]. attempt 4 = relaunch.
    const d = await actuateRecovery(target({ attempt: 4 }), deps)
    expect(d).toMatchObject({ fired: false, reason: 'hard_gated' })
    expect(injected).toHaveLength(0)
  })

  it('attempt reaching a hard rung with hard ENABLED ⇒ hard_not_wired (Phase C owns it)', async () => {
    const { deps, injected } = makeDeps({ hardEnabled: true })
    const d = await actuateRecovery(target({ attempt: 4 }), deps)
    expect(d).toMatchObject({ fired: false, reason: 'hard_not_wired', detail: 'relaunch' })
    expect(injected).toHaveLength(0)
  })
})

describe('actuateRecovery — the injector result is reported honestly', () => {
  it('inject ok:false still counts as fired (we attempted it) and carries the detail', async () => {
    const { deps } = makeDeps({ inject: async () => ({ ok: false, detail: 'tmux pane gone' }) })
    const d = await actuateRecovery(target(), deps)
    expect(d.fired).toBe(true)
    if (d.fired) {
      expect(d.result.ok).toBe(false)
      expect(d.result.detail).toBe('tmux pane gone')
    }
  })
})
