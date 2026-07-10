/**
 * TRDD-QC8R79G5 — the AgentRegistry does not evict.
 *
 * It never should have. Exactly one call site constructs an in-memory Agent
 * (`initializeAllAgents()` at boot); nothing anywhere re-loads one on demand. So
 * the old LRU could only ever destroy: it shut down the last N-10 agents that
 * `readdir` returned, permanently, and the fleet's subconscious set was whatever
 * survived. On the machine that found this, 8 of 18 agents lost their
 * subconscious at every boot.
 *
 * These tests assert the PROPERTY, not the number: every agent handed to
 * `getAgent()` is still resident afterwards, and nothing stopped a live
 * cerebellum to make room for it. Against the pre-TRDD code the first two fail
 * outright (10 resident of 25; 15 spurious `cerebellum.stop()` calls).
 *
 * The cerebellum trio is mocked because the real one starts a 30s timer,
 * subscribes to host hints, and mkdirs `~/.aimaestro/agents/<id>/` to write
 * `status.json`. `cerebellum.stop()` is the honest observable for "an Agent was
 * torn down" — it is the single thing `Agent.shutdown()` does.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({ stopSpy: vi.fn(), startSpy: vi.fn() }))

vi.mock('@/lib/cerebellum/cerebellum', () => ({
  Cerebellum: class {
    constructor(private readonly agentId: string) {}
    registerSubsystem(): void {}
    start(): void { h.startSpy(this.agentId) }
    stop(): void { h.stopSpy(this.agentId) }
    setActivityState(): void {}
    getStatus() { return { running: true, subsystems: [] } }
  },
}))

vi.mock('@/lib/cerebellum/subconscious-subsystem', () => ({
  SubconsciousSubsystem: class {
    readonly name = 'subconscious'
    // The real one lazily builds an AgentSubconscious from this factory. Never
    // call it: constructing one touches the filesystem.
    constructor(_factory: unknown) {}
    getSubconscious() { return { getStatus: () => ({ isRunning: true }) } }
  },
}))

vi.mock('@/lib/cerebellum/voice-subsystem', () => ({
  VoiceSubsystem: class { readonly name = 'voice' },
}))

import { AgentRegistry } from '@/lib/agent'

const ids = (n: number) => Array.from({ length: n }, (_, i) => `agent-${i}`)

/** Well past the cap the registry used to enforce (10). */
const N = 25

describe('the registry keeps every agent it loads', () => {
  beforeEach(() => {
    h.stopSpy.mockReset()
    h.startSpy.mockReset()
  })

  it('loading N agents sequentially leaves all N resident', async () => {
    const registry = new AgentRegistry()

    for (const id of ids(N)) await registry.getAgent(id)

    expect(registry.getStatus().activeAgents).toBe(N)
    for (const id of ids(N)) {
      expect(registry.getExistingAgent(id), `${id} was evicted`).toBeDefined()
      expect(registry.getExistingAgent(id)!.getStatus().initialized).toBe(true)
    }
    // Nothing was torn down to make room for anything.
    expect(h.stopSpy).not.toHaveBeenCalled()
  })

  it('loading N agents concurrently leaves all N resident', async () => {
    // Startup loads in batches of 5. The old `evictIfNeeded()` awaited
    // `agent.shutdown()` BEFORE deleting from the map, so every caller in a
    // batch read the same stale `agents.size` and each shifted a different
    // victim — five evictions decided against one observation.
    const registry = new AgentRegistry()

    await Promise.all(ids(N).map(id => registry.getAgent(id)))

    expect(registry.getStatus().activeAgents).toBe(N)
    expect(h.stopSpy).not.toHaveBeenCalled()
  })

  it('a concurrent double-load of one id yields one Agent, started once', async () => {
    const registry = new AgentRegistry()

    const [a, b] = await Promise.all([registry.getAgent('dup'), registry.getAgent('dup')])

    expect(a).toBe(b)
    expect(registry.getStatus().activeAgents).toBe(1)
    expect(h.startSpy).toHaveBeenCalledTimes(1)
  })
})

describe('a dying agent is never handed to a caller', () => {
  beforeEach(() => {
    h.stopSpy.mockReset()
    h.startSpy.mockReset()
  })

  it('shutdownAgent unindexes before it tears down', async () => {
    const registry = new AgentRegistry()
    await registry.getAgent('doomed')

    // `cerebellum.stop()` runs inside `agent.shutdown()`. Whatever the registry
    // hands out at that instant is what a concurrent reader would have got.
    let visibleMidTeardown: unknown = 'not-observed'
    h.stopSpy.mockImplementationOnce(() => {
      visibleMidTeardown = registry.getExistingAgent('doomed')
    })

    await registry.shutdownAgent('doomed')

    expect(h.stopSpy).toHaveBeenCalledTimes(1)
    expect(visibleMidTeardown, 'a shut-down Agent was reachable mid-teardown').toBeUndefined()
    expect(registry.getExistingAgent('doomed')).toBeUndefined()
    expect(registry.getStatus().activeAgents).toBe(0)
  })

  it('shutdownAll unindexes before it tears down, and stops every agent exactly once', async () => {
    const registry = new AgentRegistry()
    for (const id of ids(3)) await registry.getAgent(id)

    let visibleMidTeardown: unknown = 'not-observed'
    h.stopSpy.mockImplementationOnce(() => {
      visibleMidTeardown = registry.getExistingAgent('agent-0')
    })

    await registry.shutdownAll()

    expect(visibleMidTeardown, 'a shut-down Agent was reachable mid-teardown').toBeUndefined()
    expect(h.stopSpy).toHaveBeenCalledTimes(3)
    expect(registry.getStatus().activeAgents).toBe(0)
  })

  it('shutting down an unknown id is a no-op, not a throw', async () => {
    const registry = new AgentRegistry()
    await expect(registry.shutdownAgent('never-loaded')).resolves.toBeUndefined()
    expect(h.stopSpy).not.toHaveBeenCalled()
  })
})
