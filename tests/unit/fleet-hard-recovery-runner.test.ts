// CHN16JXZ Phase C step (c) — the hard runner's state threading and page-once contract.
//
// What each closure discriminates:
//  - attempt/cooldown threading: a fired attempt advances the store even when the wake
//    FAILED (that is what makes a failing relaunch escalate to the teardown rungs instead
//    of machine-gunning the same wake).
//  - the debounce partition is honored per agent within one pass: the tracker-confirmed
//    agent fires while the still-debouncing one is refused — one pass, both branches live.
//  - prune-on-leave: an agent that leaves the dead set loses its store entry, so a
//    later re-death restarts the ladder at relaunch with a fresh page budget.
//  - page-once: crash_loop is reported on the TRANSITION into it and never again while the
//    agent stays dead — the second pass must report NOTHING for the same agent (the neuter
//    that drops the pagedCrashLoop flag reds exactly this test).

import { describe, it, expect } from 'vitest'
import { runHardRecoveryPass, type HardRecoveryState } from '@/lib/fleet-hard-recovery-runner'
import { DEFAULT_MAX_HARD_ATTEMPTS, type HardRecoveryDeps } from '@/lib/fleet-hard-recovery'

function makeDeps(over: Partial<HardRecoveryDeps> = {}): { deps: HardRecoveryDeps; relaunched: string[] } {
  const relaunched: string[] = []
  const deps: HardRecoveryDeps = {
    fireEnabled: true,
    actuationBlocked: () => ({ blocked: false, reason: null }),
    bootRestoreInFlight: () => false,
    hidPresent: () => false,
    now: () => 50_000_000,
    relaunch: async (id) => {
      relaunched.push(id)
      return { ok: true }
    },
    ...over,
  }
  return { deps, relaunched }
}

const dead = (id: string) => ({ agentId: id, name: `n-${id}`, class: 'dead' as const })

describe('runHardRecoveryPass', () => {
  it('fires the confirmed agent and refuses the still-debouncing one in the same pass', async () => {
    const { deps, relaunched } = makeDeps()
    const store = new Map<string, HardRecoveryState>()
    const r = await runHardRecoveryPass([dead('a'), dead('b')], new Set(['a']), deps, store, () => 50_000_000)
    expect(r.fired).toHaveLength(1)
    expect(r.fired[0]).toMatchObject({ agentId: 'a', rung: 'relaunch', ok: true })
    expect(relaunched).toEqual(['a'])
    expect(store.get('a')).toMatchObject({ attempt: 1, lastActuatedAtMs: 50_000_000 })
    expect(store.has('b')).toBe(false) // a refusal advances nothing
  })

  it('advances the attempt even on a FAILED wake, so the next fire escalates', async () => {
    const { deps } = makeDeps({ relaunch: async () => ({ ok: false, detail: 'wake refused' }) })
    const store = new Map<string, HardRecoveryState>()
    const r1 = await runHardRecoveryPass([dead('a')], new Set(['a']), deps, store, () => 1_000)
    expect(r1.fired[0]).toMatchObject({ rung: 'relaunch', ok: false })
    expect(store.get('a')?.attempt).toBe(1)

    // Next pass, past the cooldown: attempt 1 ⇒ force_restart.
    const { deps: deps2 } = makeDeps({ cooldownMs: 1, now: () => 10_000 })
    const r2 = await runHardRecoveryPass([dead('a')], new Set(['a']), deps2, store, () => 10_000)
    expect(r2.fired[0]).toMatchObject({ rung: 'force_restart' })
  })

  it('prunes the store when an agent leaves the dead set (recovered ⇒ fresh ladder later)', async () => {
    const { deps } = makeDeps()
    const store = new Map<string, HardRecoveryState>([['gone', { attempt: 2, lastActuatedAtMs: 1 }]])
    await runHardRecoveryPass([dead('a')], new Set(['a']), deps, store, () => 50_000_000)
    expect(store.has('gone')).toBe(false)
  })

  it('pages crash_loop ONCE: reported on the transition, silent on the next pass', async () => {
    const { deps, relaunched } = makeDeps()
    const store = new Map<string, HardRecoveryState>([
      ['a', { attempt: DEFAULT_MAX_HARD_ATTEMPTS, lastActuatedAtMs: 1 }],
    ])
    const r1 = await runHardRecoveryPass([dead('a')], new Set(['a']), deps, store, () => 50_000_000)
    expect(r1.crashLooping).toHaveLength(1)
    expect(r1.crashLooping[0].agentId).toBe('a')
    expect(relaunched).toHaveLength(0)

    const r2 = await runHardRecoveryPass([dead('a')], new Set(['a']), deps, store, () => 50_000_001)
    expect(r2.crashLooping).toHaveLength(0) // paged already — silent while it stays dead
  })
})
