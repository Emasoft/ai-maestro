/**
 * R31 incomplete-team freeze wired into createNewTeam — TRDD-0KMDJVON, acceptance
 * item 3 (partial: this is the FIRST of four call sites — ChangeTeam, DeleteAgent,
 * ChangeTitle are separate units) and item 4 (a newly created team is frozen, its
 * COS active, no other agents present).
 *
 * Exercises the REAL `freezeIncompleteTeam`/`isTeamComplete` (lib/team-registry.ts)
 * and the REAL `createTeam`/`updateTeam`/`loadTeams`/`saveTeams` against a faked
 * ecosystem home (0-IMPACT — never the developer's real `~/.aimaestro/`). Only the
 * DATA SOURCES around them are mocked: agent-registry (a Map fixture), governance
 * (fixed MANAGER id), element-management-service (ChangeTitle/foreign-user gate),
 * agents-core-service (wakeAgent, for the freeze-undo compensation), and
 * child_process (tmux kill-session, so no real session is ever targeted). The one
 * exported function partially mocked is `getTeam` — wrapped so ONE test can force
 * ONE call to throw (simulating a downstream gate failing after the freeze),
 * while every other call — including everything freezeIncompleteTeam/createTeam do
 * internally — keeps running for real against the faked store.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { rmSync } from 'fs'
import type { Team } from '@/types/team'

const { FAKE_HOME, FAKE_STATE } = vi.hoisted(() => {
  const os = require('os') as typeof import('os')
  const fs = require('fs') as typeof import('fs')
  const path = require('path') as typeof import('path')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-create-team-freeze-'))
  return { FAKE_HOME: path.join(root, 'home'), FAKE_STATE: path.join(root, 'state') }
})

vi.mock('@/lib/ecosystem-constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ecosystem-constants')>()
  const { fakeEcosystemPaths } = await import('@/tests/helpers/fake-ecosystem-home')
  return fakeEcosystemPaths(actual, FAKE_HOME, FAKE_STATE)
})

// Real createTeam/updateTeam/freezeIncompleteTeam/isTeamComplete/loadTeams/saveTeams
// — only `getTeam` is wrapped in a vi.fn so a single test can force ONE call to
// throw (`mockImplementationOnce`) without disturbing the real implementation the
// rest of the pipeline (and the other tests) rely on.
vi.mock('@/lib/team-registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/team-registry')>()
  return {
    ...actual,
    getTeam: vi.fn((...args: Parameters<typeof actual.getTeam>) => actual.getTeam(...args)),
    // Wrapped so test (d) can force ONE call to throw, simulating the freeze
    // ITSELF failing (fail-fast, TRDD-0KMDJVON row40) — every other call keeps
    // running the real implementation.
    freezeIncompleteTeam: vi.fn((...args: Parameters<typeof actual.freezeIncompleteTeam>) =>
      actual.freezeIncompleteTeam(...args)
    ),
  }
})

type FixtureAgent = { id: string; name: string; governanceTitle?: string | null; deletedAt?: string }
const registry = new Map<string, FixtureAgent>()

vi.mock('@/lib/agent-registry', () => ({
  getAgent: (id: string, includeDeleted = false) => {
    const agent = registry.get(id) ?? null
    if (agent && agent.deletedAt && !includeDeleted) return null
    return agent
  },
  loadAgents: () => Array.from(registry.values()).filter(a => !a.deletedAt),
}))

vi.mock('@/lib/governance', () => ({
  getManagerId: vi.fn(() => 'manager-1'),
  isManager: vi.fn(() => false),
  isChiefOfStaffAnywhere: vi.fn(() => false),
  verifyPassword: vi.fn(() => true),
  loadGovernance: vi.fn(() => ({})),
}))

// ChangeTitle deliberately REFUSES to demote an already-specialised R12.1 title
// (architect/orchestrator/integrator) down to 'member' — simulating a role-plugin
// swap failure, which createNewTeam already tolerates (swallowed + console.warn).
// This is how the "roster already complete" fixture (test c) survives
// createNewTeam's own generic member-titling loop, which otherwise retitles
// EVERY non-COS/non-orchestrator agentId to 'member' unconditionally.
vi.mock('@/services/element-management-service', () => ({
  assertForeignUserMayCall: vi.fn(async () => null),
  ChangeTitle: vi.fn(async (id: string, title: string) => {
    const agent = registry.get(id)
    if (agent) {
      const current = agent.governanceTitle
      if (title === 'member' && current && current !== 'member' && current !== 'autonomous') {
        throw new Error(`simulated role-plugin refusal: cannot retitle ${id} (${current}) to member`)
      }
      agent.governanceTitle = title
    }
    return { success: true }
  }),
}))

// Row37 (R31 wake-refusal ordering): reads the REAL team store at call time — never the
// caller's claimed order. If createNewTeam's freeze-undo woke an agent BEFORE clearing
// `frozen`, `wakeFrozenChecks` would record `false` for that call, and the real wakeAgent
// would have refused the wake outright (R31: a frozen team's non-COS member cannot wake).
let wakeFrozenChecks: boolean[] = []
vi.mock('@/services/agents-core-service', () => ({
  wakeAgent: vi.fn(async (agentId: string) => {
    const { loadTeams: loadTeamsAtWakeTime } = await import('@/lib/team-registry')
    const team = loadTeamsAtWakeTime().find(t => t.agentIds.includes(agentId))
    if (team) wakeFrozenChecks.push(team.frozen !== true)
    return { data: { success: true, agentId }, status: 200 }
  }),
}))

let killedSessionNames: string[] = []
vi.mock('child_process', () => ({
  execFile: (
    _cmd: string,
    args: string[],
    _opts: unknown,
    callback: (err: Error | null, result?: { stdout: string; stderr: string }) => void
  ) => {
    if (args[1] === '-t') killedSessionNames.push(args[2])
    callback(null, { stdout: '', stderr: '' })
  },
}))

const COS_ID = 'agent-cos'
const ARCH_ID = 'agent-arch'
const ORCH_ID = 'agent-orch'
const INT_ID = 'agent-int'
const MEMBER_ID = 'agent-member'

function seedAgents(overrides: Partial<Record<string, Partial<FixtureAgent>>> = {}) {
  registry.clear()
  // COS candidates MUST be 'autonomous' (or titleless) at call time — createNewTeam's
  // cosId validation rejects anything else ("Only AUTONOMOUS agents can be assigned
  // as COS"). ChangeTitle promotes it to 'chief-of-staff' during the call.
  const base: FixtureAgent[] = [
    { id: COS_ID, name: 'cos-agent', governanceTitle: 'autonomous' },
    { id: ARCH_ID, name: 'arch-agent', governanceTitle: 'autonomous' },
    { id: ORCH_ID, name: 'orch-agent', governanceTitle: 'autonomous' },
    { id: INT_ID, name: 'int-agent', governanceTitle: 'autonomous' },
    { id: MEMBER_ID, name: 'member-agent', governanceTitle: 'autonomous' },
  ]
  for (const a of base) {
    registry.set(a.id, { ...a, ...(overrides[a.id] ?? {}) })
  }
}

beforeEach(async () => {
  killedSessionNames = []
  wakeFrozenChecks = []
  vi.clearAllMocks() // clears CALL history only — every mock's default implementation (set via
  // `vi.fn(impl)` above, never `.mockImplementation()`) survives, per the
  // clearAllMocks-vs-resetAllMocks distinction (resetAllMocks would strip it).
  const { saveTeams } = await import('@/lib/team-registry')
  saveTeams([])
})

afterAll(() => {
  rmSync(FAKE_STATE, { recursive: true, force: true })
  rmSync(FAKE_HOME, { recursive: true, force: true })
})

describe('createNewTeam wires the R31 freeze (TRDD-0KMDJVON)', () => {
  it('a newly created team with only a COS is frozen, the COS is active, and no other agent is hibernated', async () => {
    const { createNewTeam } = await import('@/services/teams-service')
    const { loadTeams } = await import('@/lib/team-registry')
    seedAgents()

    const result = await createNewTeam({ name: 'R31 New Team', agentIds: [], chiefOfStaffId: COS_ID })

    expect(result.status).toBe(201)
    const team = (result as { data: { team: Team } }).data.team
    expect(team.agentIds).toEqual([COS_ID])
    expect(team.frozen).toBe(true)
    expect(killedSessionNames).toEqual([]) // the only agent present IS the COS — never hibernated

    const onDisk = loadTeams().find(t => t.id === team.id) as Team
    expect(onDisk.frozen).toBe(true)
  })

  it('a downstream failure after the freeze wakes every hibernated agent and clears the frozen flag', async () => {
    const { createNewTeam } = await import('@/services/teams-service')
    const { getTeam, loadTeams } = await import('@/lib/team-registry')
    const { wakeAgent } = await import('@/services/agents-core-service')
    seedAgents()

    // createNewTeam's ONLY call to getTeam is the final "reload team" line, which
    // runs AFTER the freeze — this makes it throw exactly once, simulating a
    // later gate failing post-freeze without touching the freeze itself.
    vi.mocked(getTeam).mockImplementationOnce(() => {
      throw new Error('simulated downstream gate failure')
    })

    const result = await createNewTeam({
      name: 'R31 Compensation Team',
      agentIds: [ORCH_ID, INT_ID, MEMBER_ID],
      chiefOfStaffId: COS_ID,
      orchestratorId: ORCH_ID,
    })

    expect(result.status).toBe(500)

    // The freeze DID run for real (before the simulated throw) — every non-COS
    // agent's tmux session was killed.
    expect(killedSessionNames.slice().sort()).toEqual(['int-agent', 'member-agent', 'orch-agent'])

    // The compensation woke exactly the agents the freeze hibernated.
    const wokenIds = vi.mocked(wakeAgent).mock.calls.map(call => call[0])
    expect(new Set(wokenIds)).toEqual(new Set([ORCH_ID, INT_ID, MEMBER_ID]))

    // ...and cleared the frozen flag it set.
    const team = loadTeams().find(t => t.name === 'R31 Compensation Team') as Team
    expect(team.frozen).not.toBe(true)

    // Ordering guard (row37): `frozen` was cleared BEFORE any of these wakes ran, never after —
    // the non-vacuity floor (`length` > 0) proves the assertion actually ran for every wake.
    expect(wakeFrozenChecks.length).toBe(3)
    expect(wakeFrozenChecks.every(Boolean)).toBe(true)
  })

  it('a team whose roster already covers all 5 R12.1 titles is not frozen and nothing is hibernated', async () => {
    const { createNewTeam } = await import('@/services/teams-service')
    const { loadTeams } = await import('@/lib/team-registry')
    // ARCH/INT already hold their specialised title — ChangeTitle's simulated
    // refusal (see the mock above) means createNewTeam's generic member-titling
    // loop cannot demote them, so the roster is complete by the time freeze runs.
    seedAgents({
      [ARCH_ID]: { governanceTitle: 'architect' },
      [INT_ID]: { governanceTitle: 'integrator' },
      [MEMBER_ID]: { governanceTitle: 'member' },
    })

    const result = await createNewTeam({
      name: 'R31 Complete Roster Team',
      agentIds: [ARCH_ID, ORCH_ID, INT_ID, MEMBER_ID],
      chiefOfStaffId: COS_ID,
      orchestratorId: ORCH_ID,
    })

    expect(result.status).toBe(201)
    expect(killedSessionNames).toEqual([])

    const team = (result as { data: { team: Team } }).data.team
    expect(team.frozen).not.toBe(true)

    const onDisk = loadTeams().find(t => t.id === team.id) as Team
    expect(onDisk.frozen).not.toBe(true)
  })

  it('a throwing freeze fails team creation instead of being swallowed (fail-fast, row40)', async () => {
    const { createNewTeam } = await import('@/services/teams-service')
    const { freezeIncompleteTeam, loadTeams } = await import('@/lib/team-registry')
    const { wakeAgent } = await import('@/services/agents-core-service')
    seedAgents()

    // The freeze call itself throws — this used to be swallowed by an inner
    // try/catch (console.warn'd, team creation reported success). Fail-fast
    // now means the throw propagates through the outer catch.
    vi.mocked(freezeIncompleteTeam).mockImplementationOnce(() => {
      throw new Error('simulated freeze failure')
    })

    const result = await createNewTeam({ name: 'R31 Freeze-Throws Team', agentIds: [], chiefOfStaffId: COS_ID })

    // createNewTeam never lets an error escape as a rejection — its outer
    // catch always resolves to a ServiceResult — so the fail-fast contract is
    // observed as a 500, not as a rejected promise.
    expect(result.status).toBe(500)
    expect((result as { error: string }).error).toMatch(/simulated freeze failure/)

    // The freeze threw before returning {frozen: true}, so freezeUndo was
    // never armed: no wake-compensation runs, and nothing was hibernated —
    // the pre-existing compensation logic correctly stays inert here because
    // there is nothing for it to undo.
    expect(killedSessionNames).toEqual([])
    expect(wakeAgent).not.toHaveBeenCalled()

    // The team record persists (createTeam ran before the freeze), but must
    // NOT be left in a half-frozen state — the invalid state R51 forbids.
    const onDisk = loadTeams().find(t => t.name === 'R31 Freeze-Throws Team') as Team
    expect(onDisk.frozen).not.toBe(true)
  })
})
