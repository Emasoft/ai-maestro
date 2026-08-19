// CHN16JXZ Phase C step (b) — the HARD actuator's gates and ladder.
//
// What each closure discriminates:
//  - the not_a_target sweep drives EVERY non-dead class, with `stalled` the load-bearing one:
//    the card's safety prerequisite is that a live frozen agent is NEVER hard-recovered, and
//    a spy on relaunch proves refusal happened before any effect.
//  - flag-off asserts ZERO I/O (neither actuationBlocked nor relaunch consulted) — the
//    shared-entry-gate order is what makes an OFF module truly inert.
//  - boot_grace and debounce each pass at their exact boundary (>=), because the whole point
//    of both is WHERE the line sits, not that a line exists.
//  - crash_loop must dominate hid/cooldown (reported even while both would also refuse) —
//    otherwise a terminal "human needed" is masked forever by the routine cooldown.
//  - the fire tests pin the rung→effect mapping at the injected boundary: attempt 0 =
//    relaunch WITHOUT killRemnant; attempts 1..2 = teardown BEFORE wake; a throwing
//    killRemnant must not block the wake (best-effort contract); a failing relaunch is
//    still fired:true with an honest ok:false (the runner advances attempt on any fire).

import { describe, it, expect, vi } from 'vitest'
import {
  actuateHardRecovery,
  DEFAULT_HARD_COOLDOWN_MS,
  DEFAULT_MIN_DEAD_SCANS,
  DEFAULT_BOOT_GRACE_MS,
  DEFAULT_MAX_HARD_ATTEMPTS,
  type HardRecoveryDeps,
  type HardRecoveryTarget,
} from '@/lib/fleet-hard-recovery'
import type { LivenessClass } from '@/lib/fleet-liveness'

function makeDeps(over: Partial<HardRecoveryDeps> = {}): {
  deps: HardRecoveryDeps
  relaunched: string[]
  killed: string[]
} {
  const relaunched: string[] = []
  const killed: string[] = []
  const deps: HardRecoveryDeps = {
    fireEnabled: true,
    actuationBlocked: () => ({ blocked: false, reason: null }),
    hidPresent: () => false,
    msSinceBoot: () => DEFAULT_BOOT_GRACE_MS, // exactly at the boundary = past grace
    now: () => 10_000_000,
    relaunch: async (id) => {
      relaunched.push(id)
      return { ok: true }
    },
    killRemnant: async (id) => {
      killed.push(id)
      return { ok: true }
    },
    ...over,
  }
  return { deps, relaunched, killed }
}

function target(over: Partial<HardRecoveryTarget> = {}): HardRecoveryTarget {
  return {
    agentId: 'd1',
    name: 'dead-one',
    class: 'dead',
    attempt: 0,
    lastActuatedAtMs: null,
    consecutiveDeadScans: DEFAULT_MIN_DEAD_SCANS,
    ...over,
  }
}

describe('gate 1 — only `dead` is a target (the Phase C safety invariant)', () => {
  it('refuses every non-dead class before any effect — stalled especially', async () => {
    const classes: LivenessClass[] = ['stalled', 'active', 'idle_waiting', 'permission_waiting', 'token_blocked', 'offline']
    for (const cls of classes) {
      const { deps, relaunched, killed } = makeDeps()
      const d = await actuateHardRecovery(target({ class: cls }), deps)
      expect(d).toEqual({ fired: false, reason: 'not_a_target', detail: cls })
      expect(relaunched).toHaveLength(0)
      expect(killed).toHaveLength(0)
    }
  })
})

describe('gates 2-3 — shared entry gates on the HARD flag', () => {
  it('flag off ⇒ fire_flag_off with ZERO I/O (STOP gate not even consulted)', async () => {
    const blockedSpy = vi.fn(() => ({ blocked: false, reason: null }))
    const { deps, relaunched } = makeDeps({ fireEnabled: false, actuationBlocked: blockedSpy })
    const d = await actuateHardRecovery(target(), deps)
    expect(d).toEqual({ fired: false, reason: 'fire_flag_off' })
    expect(blockedSpy).not.toHaveBeenCalled()
    expect(relaunched).toHaveLength(0)
  })

  it('machine-wide STOP ⇒ actuation_blocked with the janitor reason', async () => {
    const { deps, relaunched } = makeDeps({
      actuationBlocked: () => ({ blocked: true, reason: 'kill-switch' }),
    })
    const d = await actuateHardRecovery(target(), deps)
    expect(d).toEqual({ fired: false, reason: 'actuation_blocked', detail: 'kill-switch' })
    expect(relaunched).toHaveLength(0)
  })
})

describe('gate 4 — boot grace (the boot-overcomplete window)', () => {
  it('refuses while the server is younger than the grace window', async () => {
    const { deps, relaunched } = makeDeps({ msSinceBoot: () => DEFAULT_BOOT_GRACE_MS - 1 })
    const d = await actuateHardRecovery(target(), deps)
    expect(d.fired).toBe(false)
    if (!d.fired) expect(d.reason).toBe('boot_grace')
    expect(relaunched).toHaveLength(0)
  })

  it('fires exactly AT the grace boundary (>= semantics)', async () => {
    const { deps, relaunched } = makeDeps({ msSinceBoot: () => DEFAULT_BOOT_GRACE_MS })
    const d = await actuateHardRecovery(target(), deps)
    expect(d.fired).toBe(true)
    expect(relaunched).toEqual(['d1'])
  })
})

describe('gate 5 — consecutive-dead-scan debounce', () => {
  it('refuses below the floor, naming the count', async () => {
    const { deps, relaunched } = makeDeps()
    const d = await actuateHardRecovery(target({ consecutiveDeadScans: DEFAULT_MIN_DEAD_SCANS - 1 }), deps)
    expect(d).toEqual({
      fired: false,
      reason: 'debounce',
      detail: `${DEFAULT_MIN_DEAD_SCANS - 1}/${DEFAULT_MIN_DEAD_SCANS} scans`,
    })
    expect(relaunched).toHaveLength(0)
  })

  it('fires exactly AT the floor (>= semantics)', async () => {
    const { deps, relaunched } = makeDeps()
    const d = await actuateHardRecovery(target({ consecutiveDeadScans: DEFAULT_MIN_DEAD_SCANS }), deps)
    expect(d.fired).toBe(true)
    expect(relaunched).toEqual(['d1'])
  })
})

describe('gate 6 — crash loop dominates the routine gates', () => {
  it('ladder exhausted ⇒ crash_loop, reported even while HID and cooldown would also refuse', async () => {
    const { deps, relaunched } = makeDeps({
      hidPresent: () => true, // would refuse as hid_present…
      now: () => 10_000_000,
    })
    const d = await actuateHardRecovery(
      target({ attempt: DEFAULT_MAX_HARD_ATTEMPTS, lastActuatedAtMs: 10_000_000 - 1 }), // …and as cooldown
      deps,
    )
    expect(d).toEqual({ fired: false, reason: 'crash_loop', detail: `attempt ${DEFAULT_MAX_HARD_ATTEMPTS}` })
    expect(relaunched).toHaveLength(0)
  })
})

describe('gates 7-8 — shared injection gates', () => {
  it('user at the keyboard ⇒ hid_present', async () => {
    const { deps, relaunched } = makeDeps({ hidPresent: () => true })
    const d = await actuateHardRecovery(target(), deps)
    expect(d).toEqual({ fired: false, reason: 'hid_present' })
    expect(relaunched).toHaveLength(0)
  })

  it('within the hard cooldown ⇒ cooldown; past it ⇒ fires', async () => {
    const now = 100_000_000
    const { deps } = makeDeps({ now: () => now, cooldownMs: DEFAULT_HARD_COOLDOWN_MS })
    const within = await actuateHardRecovery(
      target({ lastActuatedAtMs: now - DEFAULT_HARD_COOLDOWN_MS + 1 }),
      deps,
    )
    expect(within.fired).toBe(false)
    if (!within.fired) expect(within.reason).toBe('cooldown')

    const { deps: deps2, relaunched } = makeDeps({ now: () => now, cooldownMs: DEFAULT_HARD_COOLDOWN_MS })
    const past = await actuateHardRecovery(
      target({ lastActuatedAtMs: now - DEFAULT_HARD_COOLDOWN_MS }),
      deps2,
    )
    expect(past.fired).toBe(true)
    expect(relaunched).toEqual(['d1'])
  })
})

describe('gate 9 — FIRE: the rung→effect mapping at the injected boundary', () => {
  it('attempt 0 = relaunch alone: transcript-preserving wake, NO teardown', async () => {
    const { deps, relaunched, killed } = makeDeps()
    const d = await actuateHardRecovery(target({ attempt: 0 }), deps)
    expect(d.fired).toBe(true)
    if (d.fired) expect(d.action.rung).toBe('relaunch')
    expect(relaunched).toEqual(['d1'])
    expect(killed).toHaveLength(0)
  })

  it('attempt 1 = force_restart: remnant teardown BEFORE the wake', async () => {
    const order: string[] = []
    const { deps } = makeDeps({
      killRemnant: async (id) => {
        order.push(`kill:${id}`)
        return { ok: true }
      },
      relaunch: async (id) => {
        order.push(`wake:${id}`)
        return { ok: true }
      },
    })
    const d = await actuateHardRecovery(target({ attempt: 1 }), deps)
    expect(d.fired).toBe(true)
    if (d.fired) expect(d.action.rung).toBe('force_restart')
    expect(order).toEqual(['kill:d1', 'wake:d1'])
  })

  it('attempt 2 = resurrect, same kill+wake shape (the server IS the external supervisor)', async () => {
    const { deps, relaunched, killed } = makeDeps()
    const d = await actuateHardRecovery(target({ attempt: 2 }), deps)
    expect(d.fired).toBe(true)
    if (d.fired) expect(d.action.rung).toBe('resurrect')
    expect(killed).toEqual(['d1'])
    expect(relaunched).toEqual(['d1'])
  })

  it('a THROWING killRemnant never blocks the wake (best-effort contract)', async () => {
    const { deps, relaunched } = makeDeps({
      killRemnant: async () => {
        throw new Error('no such session')
      },
    })
    const d = await actuateHardRecovery(target({ attempt: 1 }), deps)
    expect(d.fired).toBe(true)
    if (d.fired) expect(d.result.ok).toBe(true)
    expect(relaunched).toEqual(['d1'])
  })

  it('a failing relaunch is still fired:true with an honest ok:false', async () => {
    const { deps } = makeDeps({ relaunch: async () => ({ ok: false, detail: 'wake refused' }) })
    const d = await actuateHardRecovery(target(), deps)
    expect(d.fired).toBe(true)
    if (d.fired) {
      expect(d.result.ok).toBe(false)
      expect(d.result.detail).toBe('wake refused')
    }
  })
})
