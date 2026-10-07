/**
 * createNewTeam team-level compensation — TRDD-C3CHP8L2.
 *
 * A throw AFTER the team record and the auto-created COS agent exist must remove both
 * (record, agent, workdir) and the caller must still get the ORIGINAL error. Real
 * team-registry + agent-registry against a temp state root and a temp $HOME (0-IMPACT);
 * only the surroundings are stubbed (governance MANAGER id, ChangeTitle, tmux). The
 * failure is injected at the latest bare step, the R31 freeze.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { rmSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

const { FAKE_HOME, FAKE_STATE } = vi.hoisted(() => {
  const os = require('os') as typeof import('os')
  const fs = require('fs') as typeof import('fs')
  const path = require('path') as typeof import('path')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-create-team-comp-'))
  return { FAKE_HOME: path.join(root, 'home'), FAKE_STATE: path.join(root, 'state') }
})

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, default: { ...actual, homedir: () => FAKE_HOME }, homedir: () => FAKE_HOME }
})

vi.mock('@/lib/ecosystem-constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ecosystem-constants')>()
  const { fakeEcosystemPaths } = await import('@/tests/helpers/fake-ecosystem-home')
  return fakeEcosystemPaths(actual, FAKE_HOME, FAKE_STATE)
})

vi.mock('@/lib/team-registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/team-registry')>()
  return {
    ...actual,
    freezeIncompleteTeam: vi.fn((...a: Parameters<typeof actual.freezeIncompleteTeam>) => actual.freezeIncompleteTeam(...a)),
  }
})

vi.mock('@/lib/governance', () => ({
  getManagerId: vi.fn(() => 'manager-1'),
  isManager: vi.fn(() => false),
  isChiefOfStaffAnywhere: vi.fn(() => false),
  verifyPassword: vi.fn(() => true),
  loadGovernance: vi.fn(() => ({})),
}))
vi.mock('@/services/element-management-service', () => ({
  assertForeignUserMayCall: vi.fn(async () => null),
  ChangeTitle: vi.fn(async () => ({ success: true })),
}))
vi.mock('child_process', () => ({
  execFile: (_c: string, _a: string[], _o: unknown, cb: (e: Error | null, r?: { stdout: string; stderr: string }) => void) =>
    cb(null, { stdout: '', stderr: '' }),
}))

// First test pays the cold import of real registries; under a loaded machine 5s flaked.
vi.setConfig({ testTimeout: 30_000 })

const TEAM = 'Compensation Team'
const COS_DIR = join(FAKE_HOME, 'agents', 'cos-compensation-team')

beforeEach(async () => {
  const { saveTeams } = await import('@/lib/team-registry')
  const { saveAgents } = await import('@/lib/agent-registry')
  saveTeams([])
  saveAgents([])
  rmSync(COS_DIR, { recursive: true, force: true })
})

afterAll(() => {
  rmSync(join(FAKE_HOME, '..'), { recursive: true, force: true })
})

describe('createNewTeam compensates a failure after the team + auto-COS exist (TRDD-C3CHP8L2)', () => {
  it('a throw at the freeze leaves no team record, no COS agent record and no COS folder, and reports the original error', async () => {
    const { createNewTeam } = await import('@/services/teams-service')
    const { loadTeams, freezeIncompleteTeam } = await import('@/lib/team-registry')
    const { loadAgents } = await import('@/lib/agent-registry')
    vi.mocked(freezeIncompleteTeam).mockImplementationOnce(() => { throw new Error('simulated freeze failure') })

    const result = await createNewTeam({ name: TEAM, agentIds: [] })

    expect(result.status).toBe(500)
    expect((result as { error: string }).error).toBe('simulated freeze failure')
    expect(loadTeams().filter(t => t.name === TEAM)).toEqual([])
    expect(loadAgents().filter(a => a.name === 'cos-compensation-team')).toEqual([])
    expect(existsSync(COS_DIR)).toBe(false)
  })

  it('positive control: without the injected failure the team, COS agent and folder do exist', async () => {
    const { createNewTeam } = await import('@/services/teams-service')
    const { loadTeams } = await import('@/lib/team-registry')
    const { loadAgents } = await import('@/lib/agent-registry')

    const result = await createNewTeam({ name: TEAM, agentIds: [] })

    expect(result.status).toBe(201)
    expect(loadTeams().filter(t => t.name === TEAM)).toHaveLength(1)
    expect(loadAgents().filter(a => a.name === 'cos-compensation-team')).toHaveLength(1)
    expect(existsSync(COS_DIR)).toBe(true)
  })

  it('a pre-existing COS folder is not ours to delete', async () => {
    const { createNewTeam } = await import('@/services/teams-service')
    const { freezeIncompleteTeam } = await import('@/lib/team-registry')
    mkdirSync(COS_DIR, { recursive: true })
    vi.mocked(freezeIncompleteTeam).mockImplementationOnce(() => { throw new Error('boom') })

    const result = await createNewTeam({ name: TEAM, agentIds: [] })

    expect(result.status).toBe(500)
    expect(existsSync(COS_DIR)).toBe(true)
  })
})
