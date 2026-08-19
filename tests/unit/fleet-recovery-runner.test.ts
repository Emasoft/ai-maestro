import { describe, it, expect } from 'vitest'
import { runRecoveryPass, type RecoveryState } from '@/lib/fleet-recovery-runner'
import type { ActuatorDeps, RecoveryAction } from '@/lib/fleet-recovery-actuator'
import type { FleetLivenessSnapshot, FleetAgentLiveness } from '@/lib/fleet-liveness'

// A mutable clock shared between the actuator deps (cooldown) and the pass (store stamps), so a
// test can advance time deterministically between ticks.
function clock(startMs = 1_000_000) {
  const c = { ms: startMs }
  return { now: () => c.ms, advance: (ms: number) => (c.ms += ms), set: (ms: number) => (c.ms = ms) }
}

function snapshot(targets: { agentId: string; name?: string }[], over: Partial<FleetLivenessSnapshot> = {}): FleetLivenessSnapshot {
  const agents: FleetAgentLiveness[] = targets.map((t) => ({
    agentId: t.agentId,
    name: t.name,
    origin: 'registry',
    class: 'stalled',
    recoveryRecommended: true,
    reason: 'idle past the stall window',
  }))
  return {
    scannedAt: 1_000_000,
    actuationBlocked: false,
    actuationBlockReason: null,
    agents,
    recoveryTargets: targets.map((t) => t.agentId),
    ...over,
  }
}

function fakeDeps(now: () => number, over: Partial<ActuatorDeps> = {}): { deps: ActuatorDeps; injected: RecoveryAction[] } {
  const injected: RecoveryAction[] = []
  const deps: ActuatorDeps = {
    fireEnabled: true,
    hardEnabled: false,
    hidPresent: () => false,
    inject: async (a) => {
      injected.push(a)
      return { ok: true }
    },
    cooldownMs: 1000,
    now,
    ...over,
  }
  return { deps, injected }
}

describe('runRecoveryPass — fires and threads per-agent state', () => {
  it('a fresh stalled target fires esc_nudge and records {attempt:1, lastActuatedAtMs:now}', async () => {
    const clk = clock()
    const { deps, injected } = fakeDeps(clk.now)
    const store = new Map<string, RecoveryState>()
    const r = await runRecoveryPass(snapshot([{ agentId: 'a1', name: 'one' }]), deps, store, clk.now)
    expect(r.fired).toHaveLength(1)
    expect(r.fired[0]).toMatchObject({ agentId: 'a1', rung: 'esc_nudge', ok: true })
    expect(injected).toHaveLength(1)
    expect(injected[0].commandKey).toBe('janitor-resume')
    expect(store.get('a1')).toEqual({ attempt: 1, lastActuatedAtMs: clk.now() })
  })

  it('escalates one rung per tick once the cooldown clears', async () => {
    const clk = clock()
    const { deps } = fakeDeps(clk.now, { cooldownMs: 1000 })
    const store = new Map<string, RecoveryState>()
    const snap = snapshot([{ agentId: 'a1' }])
    const rungs: string[] = []
    for (let i = 0; i < 4; i++) {
      const r = await runRecoveryPass(snap, deps, store, clk.now)
      rungs.push(r.fired[0]?.rung ?? 'NONE')
      clk.advance(1001) // past cooldown
    }
    expect(rungs).toEqual(['esc_nudge', 'rearm', 'reload', 'update'])
    expect(store.get('a1')?.attempt).toBe(4)
  })

  it('within cooldown, a still-stalled target does NOT re-fire (store unchanged)', async () => {
    const clk = clock()
    const { deps, injected } = fakeDeps(clk.now, { cooldownMs: 10_000 })
    const store = new Map<string, RecoveryState>()
    const snap = snapshot([{ agentId: 'a1' }])
    await runRecoveryPass(snap, deps, store, clk.now) // fires esc_nudge
    clk.advance(500) // still within the 10s cooldown
    const r2 = await runRecoveryPass(snap, deps, store, clk.now)
    expect(r2.fired).toHaveLength(0)
    expect(injected).toHaveLength(1) // only the first fired
    expect(store.get('a1')?.attempt).toBe(1) // unchanged
  })
})

describe('runRecoveryPass — recovery prunes the store', () => {
  it('an agent that recovered (drops out of recoveryTargets) is pruned so its next stall restarts at esc_nudge', async () => {
    const clk = clock()
    const { deps } = fakeDeps(clk.now, { cooldownMs: 1000 })
    const store = new Map<string, RecoveryState>()
    // tick 1: a1 stalled → fires, attempt becomes 1
    await runRecoveryPass(snapshot([{ agentId: 'a1' }]), deps, store, clk.now)
    expect(store.get('a1')?.attempt).toBe(1)
    // tick 2: a1 recovered (empty targets) → pruned
    clk.advance(2000)
    await runRecoveryPass(snapshot([]), deps, store, clk.now)
    expect(store.has('a1')).toBe(false)
    // tick 3: a1 stalls again → starts fresh at esc_nudge (attempt 0 → 1), NOT mid-escalation
    clk.advance(2000)
    const r3 = await runRecoveryPass(snapshot([{ agentId: 'a1' }]), deps, store, clk.now)
    expect(r3.fired[0].rung).toBe('esc_nudge')
  })
})

describe('runRecoveryPass — exhausted ladder reports escalation, never fires a hard rung', () => {
  it('a target already at attempt 4 (a hard rung) with hard disabled is escalationNeeded, not fired', async () => {
    const clk = clock()
    const { deps, injected } = fakeDeps(clk.now, { cooldownMs: 1000, hardEnabled: false })
    // pre-seed: 4 gentle attempts already spent, cooldown long past
    const store = new Map<string, RecoveryState>([['a1', { attempt: 4, lastActuatedAtMs: clk.now() - 10_000 }]])
    const r = await runRecoveryPass(snapshot([{ agentId: 'a1', name: 'stuck' }]), deps, store, clk.now)
    expect(r.fired).toHaveLength(0)
    expect(r.escalationNeeded).toEqual([{ agentId: 'a1', name: 'stuck', reason: 'hard_gated' }])
    expect(injected).toHaveLength(0)
  })
})

describe('runRecoveryPass — gates and edges', () => {
  it('no recovery targets ⇒ nothing fired, nothing injected', async () => {
    const clk = clock()
    const { deps, injected } = fakeDeps(clk.now)
    const store = new Map<string, RecoveryState>()
    const r = await runRecoveryPass(snapshot([]), deps, store, clk.now)
    expect(r.fired).toHaveLength(0)
    expect(r.escalationNeeded).toHaveLength(0)
    expect(injected).toHaveLength(0)
  })

  it('fire flag OFF ⇒ nothing fires, store untouched', async () => {
    const clk = clock()
    const { deps, injected } = fakeDeps(clk.now, { fireEnabled: false })
    const store = new Map<string, RecoveryState>()
    const r = await runRecoveryPass(snapshot([{ agentId: 'a1' }]), deps, store, clk.now)
    expect(r.fired).toHaveLength(0)
    expect(injected).toHaveLength(0)
    expect(store.size).toBe(0)
  })

  it('a failed enqueue still counts as fired (store advances) and reports ok:false', async () => {
    const clk = clock()
    const { deps } = fakeDeps(clk.now, { inject: async () => ({ ok: false, detail: 'pane gone' }) })
    const store = new Map<string, RecoveryState>()
    const r = await runRecoveryPass(snapshot([{ agentId: 'a1' }]), deps, store, clk.now)
    expect(r.fired[0]).toMatchObject({ ok: false, detail: 'pane gone' })
    expect(store.get('a1')?.attempt).toBe(1)
  })

  it('HID present ⇒ deferred, nothing fires', async () => {
    const clk = clock()
    const { deps, injected } = fakeDeps(clk.now, { hidPresent: () => true })
    const store = new Map<string, RecoveryState>()
    const r = await runRecoveryPass(snapshot([{ agentId: 'a1' }]), deps, store, clk.now)
    expect(r.fired).toHaveLength(0)
    expect(injected).toHaveLength(0)
  })
})
