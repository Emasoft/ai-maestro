/**
 * The hibernation derivation (TRDD-14HI8ZPR) — is an agent deliberately ASLEEP, or BROKEN?
 *
 * WHY THIS NEEDS PINNING. Nothing in the registry answers the question: `Agent['status']` is
 * `active | idle | offline | deleted` (types/agent.ts:465) — four values, NONE of them `hibernated`;
 * this said three until ai-maestro#114 caught it. So a hibernated agent, a crashed one and one never woken all read
 * `offline`. Measured on the live host the day this was written: 9 non-deleted agents, EVERY one
 * `offline`, of which 6 were cleanly hibernated and 3 had crashed. The whole value of this module is
 * the split those three states collapse into one field, so a test that does not exercise all four
 * states proves nothing — a fixture missing a state cannot detect a classifier that never emits it.
 *
 * The classifier is pure and the roster builder takes its facts injected, deliberately: it means the
 * exhaustive cases below run with no registry, no tmux server and no repointed `$HOME`. That last
 * one is not hypothetical — `lib/session-persistence.ts` resolves its state dir at MODULE LOAD, so a
 * test that repointed `$HOME` after import would read the developer's real `~/.aimaestro`.
 *
 * NEUTER RUNS (recorded 2026-08-05, via scripts/dev/neuter):
 *   · `if (input.isPersisted)` → `if (false)` in lib/agent-hibernation.ts reddens exactly the three
 *     `crashed` closures here plus the three pre-existing `dead` closures in fleet-liveness.test.ts
 *     — which is also the proof that the extraction from classifyLiveness is load-bearing rather
 *     than a copy nobody reaches.
 */

import { describe, it, expect } from 'vitest'
import {
  classifyHibernation,
  buildHibernationRoster,
  isHealthyHibernationState,
  type RosterInput,
} from '@/lib/agent-hibernation'
import { gatherHibernationRoster, agentScopedView } from '@/services/agent-hibernation-service'

describe('classifyHibernation (pure) — all four states', () => {
  it('no session record ⇒ never_woken', () => {
    expect(classifyHibernation({ hasSession: false, exists: false })).toMatchObject({ state: 'never_woken' })
    // Even with a live tmux session: no registry record means it was never started BY US.
    expect(classifyHibernation({ hasSession: false, exists: true })).toMatchObject({ state: 'never_woken' })
  })

  it('a live tmux session ⇒ running', () => {
    expect(classifyHibernation({ hasSession: true, exists: true })).toMatchObject({ state: 'running' })
    // `running` wins over the persistence flag either way — a live session is a live session.
    expect(classifyHibernation({ hasSession: true, exists: true, isPersisted: true })).toMatchObject({ state: 'running' })
  })

  it('no tmux + still persisted ⇒ crashed', () => {
    expect(classifyHibernation({ hasSession: true, exists: false, isPersisted: true })).toMatchObject({
      state: 'crashed',
    })
  })

  it('no tmux + not persisted ⇒ hibernated', () => {
    expect(classifyHibernation({ hasSession: true, exists: false, isPersisted: false })).toMatchObject({
      state: 'hibernated',
    })
  })

  it('an UNKNOWN persistence reading is never reported as a crash', () => {
    // `isPersisted` absent means we could not tell. Reporting that as `crashed` would invent an
    // outage out of missing information — the exact false-alarm direction this module exists to
    // remove. It must read as the benign state.
    expect(classifyHibernation({ hasSession: true, exists: false })).toMatchObject({ state: 'hibernated' })
  })

  it('crashed is the ONLY unhealthy state — hibernated is not a fault', () => {
    expect(isHealthyHibernationState('hibernated')).toBe(true)
    expect(isHealthyHibernationState('running')).toBe(true)
    expect(isHealthyHibernationState('never_woken')).toBe(true)
    expect(isHealthyHibernationState('crashed')).toBe(false)
  })
})

/** A fixture that contains ONE agent of each of the four states — see the header. */
function fourStateFixture(): RosterInput {
  return {
    agents: [
      { id: 'a-run', name: 'runner', sessionName: 'runner', hasSession: true },
      { id: 'a-hib', name: 'sleeper', sessionName: 'sleeper', hasSession: true },
      { id: 'a-crash', name: 'broken', sessionName: 'broken', hasSession: true },
      { id: 'a-new', name: 'freshly-made', sessionName: 'freshly-made', hasSession: false },
    ],
    persisted: [
      { id: 'broken', agentId: 'a-crash', name: 'broken' },
      { id: 'runner', agentId: 'a-run', name: 'runner' },
      { id: 'ghost', agentId: 'a-gone', name: 'ghost' }, // references no live agent ⇒ orphan
    ],
    liveTmuxSessions: new Set(['runner']),
  }
}

describe('buildHibernationRoster (pure)', () => {
  it('emits all four states from one fixture', () => {
    const r = buildHibernationRoster(fourStateFixture())
    const byId = Object.fromEntries(r.agents.map((a) => [a.agentId, a.state]))
    expect(byId).toEqual({ 'a-run': 'running', 'a-hib': 'hibernated', 'a-crash': 'crashed', 'a-new': 'never_woken' })
  })

  it('counts every state and the orphans', () => {
    expect(buildHibernationRoster(fourStateFixture()).counts).toEqual({
      running: 1,
      hibernated: 1,
      crashed: 1,
      never_woken: 1,
      orphaned: 1,
    })
  })

  it('a persistence row referencing no live agent is an ORPHAN, reported separately', () => {
    // Separately, because it is not a state any agent is in — it is a row that outlived its agent.
    // This is the class behind the 2026-07-25 incident where hard-deleted agents kept regrowing
    // because a stale PersistedSession outlived them.
    const r = buildHibernationRoster(fourStateFixture())
    expect(r.orphanedPersistedSessions).toHaveLength(1)
    expect(r.orphanedPersistedSessions[0]).toMatchObject({ sessionId: 'ghost', agentId: 'a-gone' })
    // and it must NOT have been counted as an agent
    expect(r.agents.map((a) => a.agentId)).not.toContain('a-gone')
  })

  it('a legacy row with NO agentId is not an orphan — an unknown is not a fault', () => {
    // `agentId` is documented "optional for backward compatibility". A row that predates the link
    // field cannot be matched to any agent, so calling it orphaned would report missing information
    // as a defect.
    const input = fourStateFixture()
    input.persisted.push({ id: 'ancient', name: 'ancient' })
    const r = buildHibernationRoster(input)
    expect(r.orphanedPersistedSessions.map((o) => o.sessionId)).toEqual(['ghost'])
  })

  it('a deleted agent is simply absent — the caller filters, the builder does not resurrect', () => {
    const r = buildHibernationRoster({ ...fourStateFixture(), agents: [] })
    expect(r.agents).toHaveLength(0)
    // every persisted row now references no live agent, so all three are orphans
    expect(r.counts.orphaned).toBe(3)
  })
})

describe('gatherHibernationRoster (I/O layer, injected)', () => {
  const deps = {
    listAgents: (() => [
      { id: 'a-run', name: 'runner', sessions: [{ index: 0 }] },
      { id: 'a-hib', name: 'sleeper', sessions: [{ index: 0 }] },
      { id: 'a-new', name: 'freshly-made', sessions: [] },
    ]) as never,
    loadPersistedSessions: (() => [{ id: 'runner', agentId: 'a-run', name: 'runner' }]) as never,
    listTmuxSessionNames: async () => ['runner', 'aim-kc-watchdog'],
  }

  it('classifies from the three injected facts', async () => {
    const r = await gatherHibernationRoster(deps)
    expect(Object.fromEntries(r.agents.map((a) => [a.agentId, a.state]))).toEqual({
      'a-run': 'running',
      'a-hib': 'hibernated',
      'a-new': 'never_woken',
    })
  })

  it('derives the session name for index 0 (computeSessionName), not the agent id', async () => {
    // If this ever computed a name tmux cannot match, EVERY agent would read as asleep — a
    // fleet-wide false negative that looks exactly like a quiet host.
    const r = await gatherHibernationRoster(deps)
    expect(r.agents.find((a) => a.agentId === 'a-run')?.sessionName).toBe('runner')
  })

  it('a tmux session belonging to no agent is ignored, never invented as one', async () => {
    const r = await gatherHibernationRoster(deps)
    expect(r.agents.map((a) => a.agentId)).not.toContain('aim-kc-watchdog')
  })
})

describe('agentScopedView — least privilege', () => {
  const roster = buildHibernationRoster(fourStateFixture())

  it('returns the agent OWN record plus fleet counts', () => {
    const v = agentScopedView(roster, 'a-hib')
    expect(v?.agent).toMatchObject({ agentId: 'a-hib', state: 'hibernated' })
    expect(v?.counts).toEqual(roster.counts)
  })

  it('leaks no OTHER agent — the whole reason the view exists', () => {
    // Publishing the full roster into every agent workdir would put a complete map of the fleet
    // (every uuid, name and tmux session name) inside every agent's own directory, so compromising
    // any one agent would yield the fleet. This assertion is what stops that regressing.
    const v = agentScopedView(roster, 'a-hib')
    const serialized = JSON.stringify(v)
    for (const other of ['a-run', 'a-crash', 'a-new', 'runner', 'broken', 'freshly-made', 'ghost']) {
      expect(serialized).not.toContain(other)
    }
    // ...and the orphan list, which names agents too, is absent entirely.
    expect(serialized).not.toContain('orphanedPersistedSessions')
  })

  it('returns null for an unknown agent rather than an empty-but-plausible view', () => {
    // An empty view would be published as a real file for an agent that does not exist.
    expect(agentScopedView(roster, 'nope')).toBeNull()
  })
})
