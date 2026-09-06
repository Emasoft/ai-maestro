/**
 * R31 unfreeze-on-repair — TRDD-0KMDJVON "Proposed change #4".
 *
 * The one load-bearing fact this suite pins: `unfreezeTeamIfComplete()` clears the
 * `frozen` flag ONLY when the team is currently frozen AND its roster has been
 * repaired back to `isTeamComplete() === true`. It mirrors `unblockAllTeams()`'s
 * documented behaviour — clearing the flag wakes NOTHING; hibernated agents stay
 * hibernated until woken through the normal wake path.
 *
 * 0-IMPACT: `@/lib/ecosystem-constants` is faked to a temp dir (per the
 * `store-revocation-compensation.test.ts` idiom) so `teams.json` never touches
 * the developer's real `~/.aimaestro/`. `child_process.execFile` is mocked so no
 * real tmux session is ever targeted (and so a test can assert none was called).
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { rmSync } from 'fs'
import type { Team } from '@/types/team'

const { FAKE_HOME, FAKE_STATE } = vi.hoisted(() => {
  const os = require('os') as typeof import('os')
  const fs = require('fs') as typeof import('fs')
  const path = require('path') as typeof import('path')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-unfreeze-team-'))
  return { FAKE_HOME: path.join(root, 'home'), FAKE_STATE: path.join(root, 'state') }
})

vi.mock('@/lib/ecosystem-constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ecosystem-constants')>()
  const { fakeEcosystemPaths } = await import('@/tests/helpers/fake-ecosystem-home')
  return fakeEcosystemPaths(actual, FAKE_HOME, FAKE_STATE)
})

// Fixture agents keyed by id — governanceTitle drives isTeamComplete.
type FixtureAgent = { id: string; name: string; governanceTitle?: string | null; deletedAt?: string }
const registry = new Map<string, FixtureAgent>()

vi.mock('@/lib/agent-registry', () => ({
  getAgent: (id: string, includeDeleted = false) => {
    const agent = registry.get(id) ?? null
    if (agent && agent.deletedAt && !includeDeleted) return null
    return agent
  },
}))

// Killed-session ledger — unfreezeTeamIfComplete must NEVER call this (it wakes
// nothing), so a non-empty ledger after the call under test is itself a failure.
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
  const base: FixtureAgent[] = [
    { id: COS_ID, name: 'cos-agent', governanceTitle: 'chief-of-staff' },
    { id: ARCH_ID, name: 'arch-agent', governanceTitle: 'architect' },
    { id: ORCH_ID, name: 'orch-agent', governanceTitle: 'orchestrator' },
    { id: INT_ID, name: 'int-agent', governanceTitle: 'integrator' },
    { id: MEMBER_ID, name: 'member-agent', governanceTitle: 'member' },
  ]
  for (const a of base) {
    registry.set(a.id, { ...a, ...(overrides[a.id] ?? {}) })
  }
}

beforeEach(async () => {
  killedSessionNames = []
  const { saveTeams } = await import('@/lib/team-registry')
  saveTeams([])
})

afterAll(() => {
  rmSync(FAKE_STATE, { recursive: true, force: true })
  rmSync(FAKE_HOME, { recursive: true, force: true })
})

describe('unfreezeTeamIfComplete (TRDD-0KMDJVON Proposed change #4)', () => {
  it('a frozen team whose roster has been repaired to complete unfreezes and wakes nobody', async () => {
    const { freezeIncompleteTeam, unfreezeTeamIfComplete, createTeam, loadTeams } = await import('@/lib/team-registry')
    seedAgents()
    const created = await createTeam({
      name: 'R31 Repaired Team',
      agentIds: [COS_ID, ORCH_ID, INT_ID, MEMBER_ID], // no ARCHITECT — incomplete
      chiefOfStaffId: COS_ID,
    })
    await freezeIncompleteTeam(created.id)
    expect((loadTeams().find(t => t.id === created.id) as Team).frozen).toBe(true)
    killedSessionNames = [] // clear the freeze's own kills before the call under test

    // Repair the roster: add the missing ARCHITECT back to the registry and team.
    registry.set(ARCH_ID, { id: ARCH_ID, name: 'arch-agent', governanceTitle: 'architect' })
    const teams = loadTeams()
    const idx = teams.findIndex(t => t.id === created.id)
    teams[idx].agentIds.push(ARCH_ID)
    const { saveTeams } = await import('@/lib/team-registry')
    saveTeams(teams)

    const result = await unfreezeTeamIfComplete(created.id)
    expect(result).toEqual({ unfrozen: true })
    expect((loadTeams().find(t => t.id === created.id) as Team).frozen).toBe(false)
    // Wakes nothing — no tmux session was killed by the unfreeze call itself.
    expect(killedSessionNames).toEqual([])
  })

  it('a frozen team still missing a required title stays frozen', async () => {
    const { freezeIncompleteTeam, unfreezeTeamIfComplete, createTeam, loadTeams } = await import('@/lib/team-registry')
    seedAgents()
    const created = await createTeam({
      name: 'R31 Still Incomplete Team',
      agentIds: [COS_ID, ORCH_ID, INT_ID, MEMBER_ID], // no ARCHITECT — incomplete
      chiefOfStaffId: COS_ID,
    })
    await freezeIncompleteTeam(created.id)
    expect((loadTeams().find(t => t.id === created.id) as Team).frozen).toBe(true)

    const result = await unfreezeTeamIfComplete(created.id)
    expect(result).toEqual({ unfrozen: false })
    expect((loadTeams().find(t => t.id === created.id) as Team).frozen).toBe(true)
  })

  it('a team that was never frozen is a no-op (unfrozen: false, no write)', async () => {
    const { unfreezeTeamIfComplete, createTeam, loadTeams } = await import('@/lib/team-registry')
    seedAgents()
    const created = await createTeam({
      name: 'R31 Never Frozen Team',
      agentIds: [COS_ID, ARCH_ID, ORCH_ID, INT_ID, MEMBER_ID], // complete from the start
      chiefOfStaffId: COS_ID,
    })
    const before = (loadTeams().find(t => t.id === created.id) as Team).updatedAt

    const result = await unfreezeTeamIfComplete(created.id)
    expect(result).toEqual({ unfrozen: false })
    const after = loadTeams().find(t => t.id === created.id) as Team
    expect(after.frozen).not.toBe(true)
    expect(after.updatedAt).toBe(before)
  })
})
