/**
 * Tests for the per-client continuity event registry + the actuator's `conversation-continuity`
 * path (TRDD-X8801GT4 — Flock-E E2).
 *
 * The two load-bearing properties:
 *  1. ADDING A CLIENT IS DATA. The engine classifies a rendered frame against a table keyed on
 *     the agent's `program`; a client the table does not know is a NO-OP, never a guess. The
 *     tests drive the engine entirely with FAKE registries, which is the proof that no client
 *     knowledge is baked into the engine.
 *  2. THE INJECTION BOUNDARY HOLDS. A response is the fixed ESC byte or a CURATED command key;
 *     a key the allowlist does not carry refuses to fire rather than sending anything.
 *
 * 0-IMPACT: pure functions and injected fakes — no filesystem, no tmux, no clock.
 */
import { describe, it, expect } from 'vitest'
import {
  classifyContinuity,
  findClientEntry,
  normalizeProgram,
  continuityCommandKeys,
  CONTINUITY_REGISTRY,
  ESC_KEYSTROKE,
  type ContinuityClientEntry,
  type ContinuityObservation,
} from '@/lib/continuity-registry'
import {
  actuateContinuity,
  type ContinuityAction,
  type ContinuityActuatorDeps,
} from '@/lib/fleet-recovery-actuator'
import { getAgentCommand } from '@/lib/agent-commands'

/** A rendered frame the way the frame reader hands it over. */
function obs(over: Partial<ContinuityObservation> = {}): ContinuityObservation {
  return {
    program: 'claude',
    frame: '',
    bufferType: 'alternate',
    notification: null,
    ...over,
  }
}

/** A fake client table — the engine must know nothing about these names. */
const FAKE: readonly ContinuityClientEntry[] = [
  {
    program: 'faux-cli',
    aliases: ['faux'],
    events: [
      {
        id: 'wedge',
        match: (o) => /attempt\s+\d+\s*\/\s*\d+/i.test(o.frame),
        response: { kind: 'esc' },
      },
      {
        id: 'idle-inbox',
        match: (o) => o.notification?.notificationType === 'idle_prompt',
        response: { kind: 'command', commandKey: 'janitor-resume' },
      },
    ],
  },
]

describe('continuity-registry — classification', () => {
  it('a frame → an event → a response (the E2 acceptance path)', () => {
    const hit = classifyContinuity(obs({ program: 'faux-cli', frame: 'Retrying in 8s (attempt 12/300)' }), FAKE)
    expect(hit).not.toBeNull()
    expect(hit!.eventId).toBe('wedge')
    expect(hit!.program).toBe('faux-cli')
    expect(hit!.response).toEqual({ kind: 'esc' })
  })

  it('an UNKNOWN program is a no-op — never a guess from another client\'s patterns', () => {
    // The exact frame that wedges 'faux-cli' must classify to nothing under an unregistered client.
    expect(classifyContinuity(obs({ program: 'some-other-cli', frame: 'attempt 12/300' }), FAKE)).toBeNull()
    expect(classifyContinuity(obs({ program: null, frame: 'attempt 12/300' }), FAKE)).toBeNull()
    expect(classifyContinuity(obs({ program: undefined, frame: 'attempt 12/300' }), FAKE)).toBeNull()
  })

  it('a registered client with nothing matching classifies to null', () => {
    expect(classifyContinuity(obs({ program: 'faux-cli', frame: 'all good, building…' }), FAKE)).toBeNull()
  })

  it('matches through an alias and through a PATH-form program', () => {
    // An agent's stored program may be a bare name or an absolute path; both key one entry,
    // otherwise a correctly-registered client silently receives no events.
    expect(findClientEntry('faux', FAKE)?.program).toBe('faux-cli')
    expect(findClientEntry('/usr/local/bin/faux-cli', FAKE)?.program).toBe('faux-cli')
    expect(findClientEntry('  FAUX-CLI  ', FAKE)?.program).toBe('faux-cli')
    expect(findClientEntry('unknown-thing', FAKE)).toBeNull()
  })

  it('normalizeProgram reduces to the registry key, or null when there is none', () => {
    expect(normalizeProgram('/opt/homebrew/bin/Claude')).toBe('claude')
    expect(normalizeProgram('')).toBeNull()
    expect(normalizeProgram(null)).toBeNull()
    expect(normalizeProgram(undefined)).toBeNull()
  })

  it('an event can match on HOOK STATE rather than screen text', () => {
    const hit = classifyContinuity(
      obs({ program: 'faux-cli', notification: { status: 'online', notificationType: 'idle_prompt' } }),
      FAKE,
    )
    expect(hit!.eventId).toBe('idle-inbox')
    expect(hit!.response).toEqual({ kind: 'command', commandKey: 'janitor-resume' })
  })

  it('the FIRST matching event wins — declaration order is priority', () => {
    const ordered: readonly ContinuityClientEntry[] = [
      {
        program: 'faux-cli',
        events: [
          { id: 'first', match: () => true, response: { kind: 'esc' } },
          { id: 'second', match: () => true, response: { kind: 'esc' } },
        ],
      },
    ]
    expect(classifyContinuity(obs({ program: 'faux-cli' }), ordered)!.eventId).toBe('first')
  })

  it('a THROWING matcher fails open — no detection, and later events still run', () => {
    const boom: readonly ContinuityClientEntry[] = [
      {
        program: 'faux-cli',
        events: [
          {
            id: 'broken',
            match: () => {
              throw new Error('bad regex')
            },
            response: { kind: 'esc' },
          },
          { id: 'healthy', match: () => true, response: { kind: 'esc' } },
        ],
      },
    ]
    // A broken matcher is never read as a positive (that would inject into a healthy agent),
    // and it must not take down the rest of the client's table.
    expect(classifyContinuity(obs({ program: 'faux-cli' }), boom)!.eventId).toBe('healthy')
  })
})

describe('continuity-registry — the shipped table', () => {
  it('every command key the REAL registry names exists in the curated allowlist', () => {
    // Pins the injection boundary at build time: a typo would otherwise first surface as an
    // agent silently receiving nothing, the first time the event ever fires in production.
    for (const key of continuityCommandKeys()) {
      expect(getAgentCommand(key), `registry names non-allowlisted command key: ${key}`).toBeDefined()
    }
  })

  it('claude is registered and carries the E3 retry-wedge event', () => {
    const claude = findClientEntry('claude')
    expect(claude).not.toBeNull()
    expect(claude!.events.map((e) => e.id)).toContain('retry-wedge')
  })

  it('the STATELESS entry point never fires a temporal event, even on a wedge frame', () => {
    // Safe by default: with no episode memory nothing can be observed to ADVANCE, so a caller
    // that forgets the store under-detects rather than injecting into a healthy agent.
    // (E3's own suite covers the stateful path.)
    expect(
      classifyContinuity(obs({ frame: 'Retrying in 8s (attempt 12/300)' }), CONTINUITY_REGISTRY),
    ).toBeNull()
  })

  it('ESC_KEYSTROKE is the single fixed control byte', () => {
    expect(ESC_KEYSTROKE).toBe('\x1b')
    expect(ESC_KEYSTROKE).toHaveLength(1)
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
    registry: FAKE,
    now: () => 1_000_000,
    inject: async (action) => {
      injected.push(action)
      return { ok: true }
    },
    ...over,
  }
  return { deps, injected }
}

const WEDGED = obs({ program: 'faux-cli', frame: 'Retrying in 8s (attempt 12/300)' })

describe('actuateContinuity — dispatch through the ONE injector', () => {
  it('fires the classified response and reports the injector result honestly', async () => {
    const { deps, injected } = makeDeps()
    const d = await actuateContinuity({ agentId: 'a1', name: 'alice', observation: WEDGED, lastActuatedAtMs: null }, deps)
    expect(d.fired).toBe(true)
    if (!d.fired) return
    expect(d.action.eventId).toBe('wedge')
    expect(d.action.program).toBe('faux-cli')
    expect(d.action.response).toEqual({ kind: 'esc' })
    expect(d.result.ok).toBe(true)
    expect(injected).toHaveLength(1)
    expect(injected[0].agentId).toBe('a1')
  })

  it('an unknown program is a no-op — nothing is injected', async () => {
    const { deps, injected } = makeDeps()
    const d = await actuateContinuity(
      { agentId: 'a2', observation: obs({ program: 'some-other-cli', frame: 'attempt 12/300' }), lastActuatedAtMs: null },
      deps,
    )
    expect(d).toEqual({ fired: false, reason: 'no_event' })
    expect(injected).toHaveLength(0)
  })

  it('an ESC response never consults the command allowlist', async () => {
    let consulted = false
    const { deps } = makeDeps({
      commandExists: () => {
        consulted = true
        return true
      },
    })
    await actuateContinuity({ agentId: 'a3', observation: WEDGED, lastActuatedAtMs: null }, deps)
    expect(consulted).toBe(false)
  })

  it('a response naming a NON-allowlisted key refuses to fire (the injection boundary)', async () => {
    const bogus: readonly ContinuityClientEntry[] = [
      {
        program: 'faux-cli',
        events: [{ id: 'typo', match: () => true, response: { kind: 'command', commandKey: 'not-a-real-key' } }],
      },
    ]
    const { deps, injected } = makeDeps({ registry: bogus })
    const d = await actuateContinuity({ agentId: 'a4', observation: obs({ program: 'faux-cli' }), lastActuatedAtMs: null }, deps)
    expect(d).toEqual({ fired: false, reason: 'unknown_command_key', detail: 'not-a-real-key' })
    expect(injected).toHaveLength(0)
  })

  it('a real curated key passes the boundary and fires', async () => {
    const { deps, injected } = makeDeps()
    const d = await actuateContinuity(
      {
        agentId: 'a5',
        observation: obs({ program: 'faux-cli', notification: { status: 'online', notificationType: 'idle_prompt' } }),
        lastActuatedAtMs: null,
      },
      deps,
    )
    expect(d.fired).toBe(true)
    expect(injected[0].response).toEqual({ kind: 'command', commandKey: 'janitor-resume' })
  })
})

describe('actuateContinuity — the SHARED gates (identical to the recovery ladder)', () => {
  it('fire_flag_off — the master switch, default OFF, blocks before any injection', async () => {
    const { deps, injected } = makeDeps({ fireEnabled: false })
    const d = await actuateContinuity({ agentId: 'g1', observation: WEDGED, lastActuatedAtMs: null }, deps)
    expect(d).toEqual({ fired: false, reason: 'fire_flag_off' })
    expect(injected).toHaveLength(0)
  })

  it('actuation_blocked — a machine-wide STOP is never recovered against', async () => {
    const { deps, injected } = makeDeps({ actuationBlocked: () => ({ blocked: true, reason: 'kill-switch' }) })
    const d = await actuateContinuity({ agentId: 'g2', observation: WEDGED, lastActuatedAtMs: null }, deps)
    expect(d).toEqual({ fired: false, reason: 'actuation_blocked', detail: 'kill-switch' })
    expect(injected).toHaveLength(0)
  })

  it('hid_present — do not race the human at the keyboard', async () => {
    const { deps, injected } = makeDeps({ hidPresent: () => true })
    const d = await actuateContinuity({ agentId: 'g3', observation: WEDGED, lastActuatedAtMs: null }, deps)
    expect(d).toEqual({ fired: false, reason: 'hid_present' })
    expect(injected).toHaveLength(0)
  })

  it('cooldown — one nudge per window, shared per AGENT across both diagnoses', async () => {
    const { deps, injected } = makeDeps({ now: () => 1_000_000, cooldownMs: 60_000 })
    const d = await actuateContinuity({ agentId: 'g4', observation: WEDGED, lastActuatedAtMs: 1_000_000 - 20_000 }, deps)
    expect(d.fired).toBe(false)
    if (d.fired) return
    expect(d.reason).toBe('cooldown')
    expect(d.detail).toBe('40s left')
    expect(injected).toHaveLength(0)
  })

  it('past the cooldown window it fires again', async () => {
    const { deps, injected } = makeDeps({ now: () => 1_000_000, cooldownMs: 60_000 })
    const d = await actuateContinuity({ agentId: 'g5', observation: WEDGED, lastActuatedAtMs: 1_000_000 - 61_000 }, deps)
    expect(d.fired).toBe(true)
    expect(injected).toHaveLength(1)
  })
})
