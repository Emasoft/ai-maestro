/**
 * Tests for the retry-wedge event — the ai-maestro#90 contract (TRDD-Y8VPE3NS — Flock-E E3).
 *
 * These drive the REAL `claude` registry entry (not a fake table): the thing under test is the
 * shipped contract, and the whole safety of it is the attempt-ADVANCE false-positive gate. The
 * four acceptance properties, in order: an advancing counter yields EXACTLY one ESC per cooldown
 * window; a STATIC string naming the same pattern yields NONE, forever; a progressing agent
 * yields none; and the usage percentage plays no part in either direction.
 *
 * 0-IMPACT: pure functions + an in-memory episode store + a fake injector. No PTY, no clock.
 */
import { describe, it, expect } from 'vitest'
import {
  RETRY_WEDGE_RE,
  parseRetryAttempt,
  CLAUDE_CONTINUITY_EVENTS,
} from '@/lib/continuity-events-claude'
import {
  classifyContinuityWithEpisodes,
  classifyContinuity,
  CONTINUITY_REGISTRY,
  type ContinuityEpisodes,
  type ContinuityObservation,
} from '@/lib/continuity-registry'
import {
  actuateContinuity,
  type ContinuityAction,
  type ContinuityActuatorDeps,
} from '@/lib/fleet-recovery-actuator'

const WEDGE = (n: number) => `✳ Vibing… (esc to interrupt)\n  Retrying in 8s (attempt ${n}/300)`

/** The dangerous case this event must never fire on: a DOCUMENT that quotes a real wedge line —
 *  this TRDD, the #90 issue body, a log tail — sitting on the agent's screen. */
const STATIC_DOC =
  'Spec: detect `Retrying in 8s (attempt 12/300)` on the rendered frame and inject one raw ESC.'

function obs(frame: string, program = 'claude'): ContinuityObservation {
  return { program, frame, bufferType: 'alternate', notification: null }
}

function makeStore() {
  const m = new Map<string, ContinuityEpisodes>()
  return {
    get: (id: string) => m.get(id),
    set: (id: string, e: ContinuityEpisodes) => {
      m.set(id, e)
    },
    peek: (id: string) => m.get(id),
  }
}

describe('retry-wedge — the byte-identical #90 pattern', () => {
  it('is byte-identical to the janitor is_retry_wedge pattern', () => {
    // Two independent processes must agree on what a wedge IS. Pinned as a literal so an
    // "improvement" to the regex fails here rather than silently desynchronising the pair.
    expect(RETRY_WEDGE_RE.source).toBe('retrying\\s+in\\b.*\\battempt\\s+(\\d+)\\s*\\/\\s*\\d+')
    expect(RETRY_WEDGE_RE.flags).toBe('i')
  })

  it('extracts the attempt number, and returns null when there is no retry on screen', () => {
    expect(parseRetryAttempt('Retrying in 8s (attempt 12/300)')).toBe(12)
    expect(parseRetryAttempt('retrying in 30 seconds — attempt 7 / 300')).toBe(7)
    expect(parseRetryAttempt('✳ Vibing… (esc to interrupt)')).toBeNull()
    expect(parseRetryAttempt('')).toBeNull()
  })

  it('does NOT match across a newline — the two halves must be on one rendered line', () => {
    // The pattern carries no `s` flag, so `.*` stops at the line end. That is the janitor's
    // behaviour and therefore ours; a frame that merely mentions both words in different places
    // is not a wedge.
    expect(parseRetryAttempt('Retrying in 8s\nsomething else (attempt 12/300)')).toBeNull()
  })
})

describe('retry-wedge — the attempt-ADVANCE false-positive gate', () => {
  it('a FIRST sighting never fires — there is nothing to have advanced from', () => {
    const { hit, episodes } = classifyContinuityWithEpisodes(obs(WEDGE(12)), {})
    expect(hit).toBeNull()
    expect(episodes['retry-wedge']).toBe(12) // …but it IS remembered, so the next poll can advance
  })

  it('an ADVANCE fires', () => {
    const { hit } = classifyContinuityWithEpisodes(obs(WEDGE(13)), { 'retry-wedge': 12 })
    expect(hit).not.toBeNull()
    expect(hit!.eventId).toBe('retry-wedge')
    expect(hit!.response).toEqual({ kind: 'esc' })
  })

  it('a TIE never fires — the screen is not moving', () => {
    const { hit, episodes } = classifyContinuityWithEpisodes(obs(WEDGE(12)), { 'retry-wedge': 12 })
    expect(hit).toBeNull()
    expect(episodes['retry-wedge']).toBe(12)
  })

  it('a VANISHED retry clears the episode, so a later first sighting cannot fire', () => {
    const { hit, episodes } = classifyContinuityWithEpisodes(obs('✳ Vibing… building the thing'), {
      'retry-wedge': 12,
    })
    expect(hit).toBeNull()
    expect(episodes['retry-wedge']).toBeUndefined() // cleared — absence IS the tombstone
  })

  it('the STATELESS entry point can never fire a temporal event (safe by default)', () => {
    // A caller that forgets the episode store under-detects; it never over-detects.
    expect(classifyContinuity(obs(WEDGE(99)), CONTINUITY_REGISTRY)).toBeNull()
  })

  it('the claude entry ships exactly this event, and it declares the gate', () => {
    const ev = CLAUDE_CONTINUITY_EVENTS.find((e) => e.id === 'retry-wedge')
    expect(ev).toBeDefined()
    expect(ev!.progressMarker, 'the FP gate is the whole safety of this event').toBeDefined()
    expect(ev!.response).toEqual({ kind: 'esc' })
  })
})

function makeDeps(
  over: Partial<ContinuityActuatorDeps> = {},
): { deps: ContinuityActuatorDeps; injected: ContinuityAction[] } {
  const injected: ContinuityAction[] = []
  const deps: ContinuityActuatorDeps = {
    fireEnabled: true,
    actuationBlocked: () => ({ blocked: false, reason: null }),
    hidPresent: () => false,
    episodes: makeStore(),
    cooldownMs: 600_000,
    now: () => 1_000_000,
    inject: async (action) => {
      injected.push(action)
      return { ok: true }
    },
    ...over,
  }
  return { deps, injected }
}

describe('retry-wedge — ACCEPTANCE', () => {
  it('attempt-advancing frames → EXACTLY one ESC per window', async () => {
    const { deps, injected } = makeDeps()
    let lastActuatedAtMs: number | null = null

    // Poll the wedge as its counter climbs. Only ONE injection may occur inside the window.
    for (const n of [11, 12, 13, 14, 15]) {
      const d = await actuateContinuity(
        { agentId: 'w1', observation: obs(WEDGE(n)), lastActuatedAtMs },
        deps,
      )
      if (d.fired) lastActuatedAtMs = 1_000_000 // the caller's store records the actuation
    }

    expect(injected).toHaveLength(1)
    expect(injected[0].eventId).toBe('retry-wedge')
    expect(injected[0].response).toEqual({ kind: 'esc' })
    // The FIRST advance (11 → 12) is what fired; 11 alone could not.
    expect(injected[0].agentId).toBe('w1')
  })

  it('past the cooldown window a still-advancing wedge earns a second ESC — and only then', async () => {
    const store = makeStore()
    const { deps, injected } = makeDeps({ episodes: store, now: () => 2_000_000, cooldownMs: 600_000 })
    // Seed a prior sighting so the very next poll is an advance.
    store.set('w2', { 'retry-wedge': 20 })

    const stillInside = await actuateContinuity(
      { agentId: 'w2', observation: obs(WEDGE(21)), lastActuatedAtMs: 2_000_000 - 60_000 },
      deps,
    )
    expect(stillInside.fired).toBe(false)
    if (!stillInside.fired) expect(stillInside.reason).toBe('cooldown')
    expect(injected).toHaveLength(0)

    const pastWindow = await actuateContinuity(
      { agentId: 'w2', observation: obs(WEDGE(22)), lastActuatedAtMs: 2_000_000 - 700_000 },
      deps,
    )
    expect(pastWindow.fired).toBe(true)
    expect(injected).toHaveLength(1)
  })

  it('the STATIC-STRING case → NO ESC, no matter how many polls it survives', async () => {
    const { deps, injected } = makeDeps()
    // A document quoting a real wedge line sits on screen. It never changes, so it never advances.
    for (let i = 0; i < 10; i++) {
      const d = await actuateContinuity(
        { agentId: 's1', observation: obs(STATIC_DOC), lastActuatedAtMs: null },
        deps,
      )
      expect(d.fired).toBe(false)
    }
    expect(injected).toHaveLength(0)
  })

  it('a PROGRESSING agent → NO ESC', async () => {
    const { deps, injected } = makeDeps()
    const frames = [
      '✳ Vibing… (esc to interrupt)\n  Reading lib/continuity-registry.ts',
      '✳ Herding… (esc to interrupt)\n  Editing 3 files',
      '✳ Vibing…\n  Running tests — 51 passed',
    ]
    for (const f of frames) {
      const d = await actuateContinuity({ agentId: 'p1', observation: obs(f), lastActuatedAtMs: null }, deps)
      expect(d).toEqual({ fired: false, reason: 'no_event' })
    }
    expect(injected).toHaveLength(0)
  })

  it('the usage PERCENTAGE is ignored in both directions', async () => {
    const { deps, injected } = makeDeps()

    // A high usage % on a healthy screen is NOT a wedge — the % is never a trigger.
    const healthyButHot = '✳ Vibing…\n  Context left until auto-compact: 4%  ·  weekly limit 92% used'
    const a = await actuateContinuity(
      { agentId: 'u1', observation: obs(healthyButHot), lastActuatedAtMs: null },
      deps,
    )
    expect(a).toEqual({ fired: false, reason: 'no_event' })

    // And a genuine advancing wedge fires regardless of the % on screen — the % is never a gate.
    await actuateContinuity(
      { agentId: 'u2', observation: obs(`${WEDGE(3)}\n  weekly limit 4% used`), lastActuatedAtMs: null },
      deps,
    )
    const d = await actuateContinuity(
      { agentId: 'u2', observation: obs(`${WEDGE(4)}\n  weekly limit 4% used`), lastActuatedAtMs: null },
      deps,
    )
    expect(d.fired).toBe(true)
    expect(injected).toHaveLength(1)
    expect(injected[0].agentId).toBe('u2')
  })

  it('the response is ONE raw ESC — never a command, an Enter, or a Ctrl-C', async () => {
    const store = makeStore()
    const { deps, injected } = makeDeps({ episodes: store })
    store.set('r1', { 'retry-wedge': 5 })
    await actuateContinuity({ agentId: 'r1', observation: obs(WEDGE(6)), lastActuatedAtMs: null }, deps)
    expect(injected).toHaveLength(1)
    // The closed union makes anything else unrepresentable; assert the shipped value explicitly.
    expect(injected[0].response).toEqual({ kind: 'esc' })
    expect(JSON.stringify(injected[0].response)).not.toContain('command')
  })

  it('the episode store is kept current even on a poll a GATE refused', async () => {
    // Otherwise the next advance would be measured against a stale value and the wedge would
    // become undetectable for as long as the gate held.
    const store = makeStore()
    const { deps, injected } = makeDeps({ episodes: store, hidPresent: () => true })
    await actuateContinuity({ agentId: 'h1', observation: obs(WEDGE(41)), lastActuatedAtMs: null }, deps)
    const d = await actuateContinuity({ agentId: 'h1', observation: obs(WEDGE(42)), lastActuatedAtMs: null }, deps)
    expect(d.fired).toBe(false)
    if (!d.fired) expect(d.reason).toBe('hid_present') // classified as a wedge, then gated
    expect(store.peek('h1')).toEqual({ 'retry-wedge': 42 })
    expect(injected).toHaveLength(0)
  })
})
