/**
 * The terminal-continuity POLL LEG (TRDD-Y8VPE3NS E3 box 5).
 *
 * Detection, classification and actuation all had passing tests and NO caller — so the automaton
 * was fully built and had never run once. These tests cover the tick that finally drives it, and
 * the properties that matter are all about the sweep, not the decision (which is tested in
 * continuity-registry / retry-wedge / fleet-recovery-actuator):
 *
 *   - one unreadable pane must not stop the rest of the fleet being checked
 *   - the episode memory must SURVIVE a non-firing poll, or a temporal event can never advance
 *   - the cooldown clock must move ONLY on a real fire
 *   - a healthy fleet must produce no log lines at all
 *
 * 0-IMPACT: every dep is a fake. No tmux, no registry, no agent.
 */
import { describe, it, expect } from 'vitest'
import { runContinuityTick, type ContinuityTickDeps, type ContinuityState } from '@/lib/fleet-continuity'
import type { ContinuityDecision } from '@/lib/fleet-recovery-actuator'

const agent = (id: string, name = id) => ({
  id,
  name,
  sessionName: name,
  workingDirectory: `/w/${name}`,
  program: 'claude',
})

const FIRED: ContinuityDecision = {
  fired: true,
  action: { agentId: 'a1', program: 'claude', eventId: 'retry-wedge', response: { kind: 'esc' } },
  result: { ok: true },
}

const NO_EVENT: ContinuityDecision = { fired: false, reason: 'no_event' }
const COOLDOWN: ContinuityDecision = { fired: false, reason: 'cooldown' }

type Target = Parameters<ContinuityTickDeps['actuate']>[0]

/** A recording stand-in for the actuator. A plain closure rather than `vi.fn`, because
 *  `vi.fn(async () => …)` infers a ZERO-ARG signature — which type-checks while making every
 *  `mock.calls[0][0]` assertion (the targets, the whole point) unwritable. */
function recorder(d: ContinuityDecision = NO_EVENT) {
  const targets: Target[] = []
  const actuate: ContinuityTickDeps['actuate'] = async (t) => {
    targets.push(t)
    return d
  }
  return { actuate, targets }
}

function deps(over: Partial<ContinuityTickDeps> = {}): ContinuityTickDeps {
  return {
    listAgents: () => [agent('a1')],
    captureFrame: async () => 'retrying in 3s ... attempt 12/300',
    getHookNotification: () => ({ status: 'online', notificationType: 'idle_prompt' }),
    actuate: async () => NO_EVENT,
    ...over,
  }
}

describe('continuity tick — it actually drives the automaton', () => {
  it('passes the captured frame and the agent program into the observation', async () => {
    const { actuate, targets } = recorder()
    await runContinuityTick(deps({ actuate }), new Map(), 1000)
    const target = targets[0]
    expect(target.observation.frame).toContain('attempt 12/300')
    expect(target.observation.program).toBe('claude')
    expect(target.agentId).toBe('a1')
  })

  it('reports a fire with the event id and the response KIND (never command text)', async () => {
    const r = await runContinuityTick(deps({ actuate: async () => FIRED }), new Map(), 1000)
    expect(r.fired).toEqual([{ agentId: 'a1', name: 'a1', eventId: 'retry-wedge', response: 'esc' }])
  })

  it('reads the hook notification as the structured shape the registry expects', async () => {
    const { actuate, targets } = recorder()
    await runContinuityTick(deps({ actuate }), new Map(), 1000)
    expect(targets[0].observation.notification).toEqual({
      status: 'online',
      notificationType: 'idle_prompt',
    })
  })
})

describe('continuity tick — the cooldown clock moves ONLY on a real fire', () => {
  it('stamps lastActuatedAtMs when the actuator fired', async () => {
    const store = new Map<string, ContinuityState>()
    await runContinuityTick(deps({ actuate: async () => FIRED }), store, 5_000)
    expect(store.get('a1')?.lastActuatedAtMs).toBe(5_000)
  })

  it('leaves it untouched when nothing fired — otherwise a quiet poll would start a cooldown', async () => {
    const store = new Map<string, ContinuityState>([['a1', { episodes: {}, lastActuatedAtMs: 42 }]])
    await runContinuityTick(deps(), store, 9_000)
    expect(store.get('a1')?.lastActuatedAtMs).toBe(42)
  })

  it('threads the PREVIOUS cooldown value into the actuator so it can gate', async () => {
    const { actuate, targets } = recorder()
    const store = new Map<string, ContinuityState>([['a1', { episodes: {}, lastActuatedAtMs: 77 }]])
    await runContinuityTick(deps({ actuate }), store, 9_000)
    expect(targets[0].lastActuatedAtMs).toBe(77)
  })
})

describe('continuity tick — episode memory survives a non-firing poll', () => {
  it('keeps the episodes the actuator recorded when the decision was no_event', async () => {
    // THE failure this guards: the retry-wedge fires on an attempt-number ADVANCE between polls.
    // Dropping the episode on a quiet poll means every poll looks like the first one, so the
    // advance is never measurable and the event can never fire — silently, forever.
    const store = new Map<string, ContinuityState>([['a1', { episodes: { 'retry-wedge': 11 }, lastActuatedAtMs: null }]])
    await runContinuityTick(deps(), store, 1_000)
    expect(store.get('a1')?.episodes).toEqual({ 'retry-wedge': 11 })
  })

  it('keeps them across a FIRING poll too', async () => {
    const store = new Map<string, ContinuityState>([['a1', { episodes: { 'retry-wedge': 12 }, lastActuatedAtMs: null }]])
    await runContinuityTick(deps({ actuate: async () => FIRED }), store, 1_000)
    expect(store.get('a1')?.episodes).toEqual({ 'retry-wedge': 12 })
  })
})

describe('continuity tick — an episode the actuator writes DURING the poll survives', () => {
  // The two tests above SEED the store and use a fake `actuate` that never writes, so they only
  // prove "a pre-existing value survives". The real bug was the opposite direction and they passed
  // straight through it: production hands the SAME Map to `defaultContinuityDeps(store)` and to
  // `runContinuityTick(deps, store)` (fleet-liveness-watchdog.ts:223), so the actuator's
  // `episodes.set` writes into the store MID-POLL — and the tick then wrote back the `prior` it had
  // captured BEFORE that call, erasing it every single pass.
  //
  // Consequence, which is why this is worth two tests: retry-wedge fires only on an attempt-number
  // ADVANCE between polls. With the marker erased every pass, `previous[eventId]` was permanently
  // empty, no advance was ever measurable, and the only shipped continuity event could never fire —
  // while the sweep logged exactly like a healthy one. These tests fail on that code.
  const writesEpisode = (store: Map<string, ContinuityState>, d: ContinuityDecision) => {
    const actuate: ContinuityTickDeps['actuate'] = async (t) => {
      // Mirrors the production `episodes.set` dep: same map, same shape, written during actuate.
      const cur = store.get(t.agentId)
      store.set(t.agentId, {
        episodes: { ...(cur?.episodes ?? {}), 'retry-wedge': 12 },
        lastActuatedAtMs: cur?.lastActuatedAtMs ?? null,
      })
      return d
    }
    return actuate
  }

  it('does not clobber it on a NON-firing poll (first sighting of a wedge)', async () => {
    // The first sighting is the one that matters most: it is what a later poll compares against.
    const store = new Map<string, ContinuityState>()
    await runContinuityTick(deps({ actuate: writesEpisode(store, NO_EVENT) }), store, 1_000)
    expect(store.get('a1')?.episodes).toEqual({ 'retry-wedge': 12 })
  })

  it('does not clobber it on a FIRING poll, and still stamps the cooldown', async () => {
    const store = new Map<string, ContinuityState>([['a1', { episodes: { 'retry-wedge': 11 }, lastActuatedAtMs: null }]])
    await runContinuityTick(deps({ actuate: writesEpisode(store, FIRED) }), store, 5_000)
    expect(store.get('a1')?.episodes).toEqual({ 'retry-wedge': 12 })
    expect(store.get('a1')?.lastActuatedAtMs).toBe(5_000)
  })
})

describe('continuity tick — one bad agent never stops the sweep', () => {
  it('a capture that throws is a skip, and the next agent is still polled', async () => {
    const { actuate, targets } = recorder()
    const r = await runContinuityTick(
      deps({
        listAgents: () => [agent('bad'), agent('good')],
        captureFrame: async (s) => {
          if (s === 'bad') throw new Error('tmux exploded')
          return 'attempt 5/300 retrying in 2s'
        },
        actuate,
      }),
      new Map(),
      1_000,
    )
    expect(r.scanned).toBe(2)
    expect(r.skipped.find((s) => s.agentId === 'bad')?.reason).toContain('tmux exploded')
    expect(targets).toHaveLength(1) // 'good' was still polled
  })

  it('an empty frame is skipped WITHOUT calling the actuator — fail-open, never a guess', async () => {
    const { actuate, targets } = recorder()
    const r = await runContinuityTick(deps({ captureFrame: async () => '   \n  ', actuate }), new Map(), 1_000)
    expect(targets).toHaveLength(0)
    expect(r.skipped[0].reason).toBe('empty-frame')
  })
})

describe('continuity tick — a healthy fleet is SILENT', () => {
  it('no_event produces neither a fire nor a skip, so the watchdog logs nothing', async () => {
    // A line per agent per tick, forever, is how a useful log becomes an ignored one.
    const r = await runContinuityTick(deps({ listAgents: () => [agent('a'), agent('b'), agent('c')] }), new Map(), 1)
    expect(r.scanned).toBe(3)
    expect(r.fired).toHaveLength(0)
    expect(r.skipped).toHaveLength(0)
  })

  it('but a REFUSAL is reported — a gate that blocked must be visible', async () => {
    const r = await runContinuityTick(deps({ actuate: async () => COOLDOWN }), new Map(), 1)
    expect(r.skipped).toEqual([{ agentId: 'a1', name: 'a1', reason: 'cooldown' }])
  })

  it('an empty fleet is a no-op', async () => {
    const r = await runContinuityTick(deps({ listAgents: () => [] }), new Map(), 1)
    expect(r).toEqual({ scanned: 0, fired: [], skipped: [] })
  })
})
