/**
 * R17.18a — the server MUST NOT auto-register tmux sessions it discovers during
 * polling. An unknown session is surfaced ONLY as a read-only
 * `unregisteredSessions` entry: "no agent record is created, no plugin is
 * installed, no AMP identity is provisioned, no tmux environment is mutated —
 * until the user explicitly clicks Revive or Import".
 *
 * THIS RULE IS ENFORCED BY AN ABSENCE, which is what makes it easy to lose and
 * awkward to pin. There is no `if` to delete: the discovery loop collects into
 * an array and simply never calls the registry writer. So the assertions are
 * post-conditions of NON-ACTION — the registry, the agent-workdir root and the
 * AMP home are all unchanged after a poll that saw a stranger — and the neuter
 * has to ADD the forbidden behaviour rather than remove a guard.
 *
 * The poll must also be shown to have DONE something, or every absence
 * assertion passes vacuously against a discovery that found nothing: the known
 * session is matched to its agent and the stranger is surfaced, in the same
 * call the absences are measured from.
 *
 * WHAT IS MOCKED, AND WHY IT IS NOT THE GUARD
 * -------------------------------------------
 * `@/lib/agent-runtime`'s `getRuntime` is the tmux DATA SOURCE the discovery
 * reads ("what sessions exist?"), and `child_process` keeps `getPaneCommand`
 * from reaching the developer's real tmux (0-IMPACT). The registry is REAL,
 * seeded on disk in a temp state dir — it has to be, because "the registry
 * gained no row" is the entire rule and a mocked registry would assert nothing.
 *
 * Neuter record (2026-07-30): insert a `saveAgents([...loadAgents(), {…}])`
 * for the stranger into the unregistered-collection loop — i.e. do exactly what
 * the rule forbids — and the "registry gained no row" test fails while the
 * surfacing test stays green. That pair is the point: the rule is not "hide
 * strangers", it is "show them WITHOUT adopting them", and a neuter that broke
 * both would not have told them apart.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'

const { FAKE_HOME, FAKE_STATE, SESSIONS } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fsSync = require('fs')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const osSync = require('os')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pathSync = require('path')
  const home = fsSync.mkdtempSync(pathSync.join(osSync.tmpdir(), 'r17aa-home-'))
  const state = fsSync.mkdtempSync(pathSync.join(osSync.tmpdir(), 'r17aa-state-'))
  fsSync.mkdirSync(pathSync.join(state, 'agents'), { recursive: true })
  fsSync.mkdirSync(pathSync.join(home, 'agents'), { recursive: true })
  return {
    FAKE_HOME: home,
    FAKE_STATE: state,
    // What "tmux" reports this poll. Mutable so a test can change the fleet.
    SESSIONS: {
      list: [] as Array<{ name: string; workingDirectory: string; createdAt: string; windows: number }>,
    },
  }
})

vi.mock('os', async importOriginal => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, default: { ...actual, homedir: () => FAKE_HOME }, homedir: () => FAKE_HOME }
})

vi.mock('@/lib/ecosystem-constants', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ecosystem-constants')>()
  const { fakeEcosystemPaths } = await import('@/tests/helpers/fake-ecosystem-home')
  return fakeEcosystemPaths(actual, FAKE_HOME, FAKE_STATE)
})

// DATA SOURCE, not guard: "what tmux sessions exist right now?"
vi.mock('@/lib/agent-runtime', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/agent-runtime')>()
  return { ...actual, getRuntime: () => ({ listSessions: async () => SESSIONS.list }) }
})

// 0-IMPACT: `getPaneCommand` shells out to the real tmux. It already treats a
// failure as "no pane info", so a silent stub is behaviour-preserving here.
vi.mock('child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('child_process')>()
  return { ...actual, execFileSync: () => '' }
})

const REGISTRY_FILE = path.join(FAKE_STATE, 'agents', 'registry.json')
const KNOWN = 'r17-known'
const STRANGER = 'r17-stranger'

/** One registered agent, so a poll has something legitimate to match against. */
function seedRegistry() {
  writeFileSync(
    REGISTRY_FILE,
    JSON.stringify([
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: KNOWN,
        label: KNOWN,
        status: 'offline',
        sessions: [],
        workingDirectory: path.join(FAKE_HOME, 'agents', KNOWN),
        createdAt: new Date(0).toISOString(),
        lastActive: new Date(0).toISOString(),
      },
    ]),
    'utf-8',
  )
}

function registryNames(): string[] {
  if (!existsSync(REGISTRY_FILE)) return []
  return (JSON.parse(readFileSync(REGISTRY_FILE, 'utf-8')) as Array<{ name: string }>).map(a => a.name)
}

beforeEach(() => {
  vi.resetModules()
  seedRegistry()
  const createdAt = new Date(0).toISOString()
  SESSIONS.list = [
    { name: KNOWN, workingDirectory: path.join(FAKE_HOME, 'agents', KNOWN), createdAt, windows: 1 },
    { name: STRANGER, workingDirectory: '/tmp', createdAt, windows: 1 },
  ]
})

describe('R17.18a — a discovered tmux session is SURFACED, never ADOPTED', () => {
  it('surfaces the unknown session read-only, and matches the known one', async () => {
    const { listAgents } = await import('@/services/agents-core-service')
    const res = await listAgents()

    // Non-vacuity: the poll really ran and really discriminated. Without this,
    // every absence assertion below would pass against a discovery that
    // returned nothing at all.
    expect(res.data?.unregisteredSessions.map(s => s.tmuxSessionName)).toEqual([STRANGER])
    expect(res.data?.agents.map(a => a.name)).toContain(KNOWN)
  })

  it('creates NO agent record for the discovered stranger', async () => {
    const { listAgents } = await import('@/services/agents-core-service')
    await listAgents()

    // The rule, stated as a post-condition: polling is read-only.
    expect(registryNames()).toEqual([KNOWN])
    expect(registryNames()).not.toContain(STRANGER)
  })

  it('provisions NO working directory and NO AMP identity for the stranger', async () => {
    const { listAgents } = await import('@/services/agents-core-service')
    await listAgents()

    // "no plugin is installed, no AMP identity is provisioned" — both would
    // begin with a directory appearing under the agent roots.
    expect(existsSync(path.join(FAKE_HOME, 'agents', STRANGER))).toBe(false)
    expect(existsSync(path.join(FAKE_STATE, 'agents', STRANGER))).toBe(false)
  })

  it('stays read-only across repeated polls — adoption is not merely deferred', async () => {
    const { listAgents } = await import('@/services/agents-core-service')
    await listAgents()
    await listAgents()
    await listAgents()

    // A "register it on the second sighting" heuristic is the shape this rule
    // most plausibly regresses into, and one poll cannot see it.
    expect(registryNames()).toEqual([KNOWN])
  })
})
