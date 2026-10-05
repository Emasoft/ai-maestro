/**
 * G11 chair-slot clear fails closed — TRDD-XTDMQO68.
 *
 * A failed `updateTeam(chiefOfStaffId: null)` used to be swallowed into a WARN, so the title change
 * succeeded while the team still named the ex-chair — and every chief-of-staff grant is decided by
 * reading that slot. Now the gate throws and the runner rolls the change back.
 * Harness: the same real-pipeline driver as title-change-revocation-fails-closed.test.ts.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import { rmSync } from 'fs'

const H = vi.hoisted(() => {
  const os = require('os') as typeof import('os')
  const fs = require('fs') as typeof import('fs')
  const path = require('path') as typeof import('path')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-g11-'))
  return {
    FAKE_HOME: path.join(root, 'home'),
    FAKE_STATE: path.join(root, 'state'),
    BIN: path.join(root, 'bin'),
    registry: new Map<string, Record<string, unknown>>(),
    // Created once, reset in place (Object.assign) — mock factories capture the first object.
    world: {} as unknown as import('@/tests/helpers/drive-change-title').ChangeTitleWorld,
  }
})

const HELPER = '@/tests/helpers/drive-change-title'

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, homedir: () => H.FAKE_HOME, default: { ...actual, homedir: () => H.FAKE_HOME } }
})
vi.mock('@/lib/ecosystem-constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ecosystem-constants')>()
  const { fakeEcosystemPaths } = await import('@/tests/helpers/fake-ecosystem-home')
  return fakeEcosystemPaths(actual, H.FAKE_HOME, H.FAKE_STATE)
})
vi.mock('@/lib/agent-registry', async () => {
  const h = await import(HELPER)
  return h.registryMock(H.registry as never, h.registryPath(H.FAKE_STATE))
})
vi.mock('@/lib/governance', async () => (await import(HELPER)).governanceMock(H.world))
vi.mock('@/lib/team-registry', async () => ({
  ...(await (await import(HELPER)).teamRegistryMock(H.world)),
  freezeIncompleteTeam: async () => ({ frozen: false, hibernated: [] as string[] }),
}))
vi.mock('@/lib/aid-token', async () => (await import(HELPER)).aidTokenMock(H.world))
vi.mock('@/lib/portfolio-store', async () => (await import(HELPER)).portfolioStoreMock(H.world))
vi.mock('@/lib/governance-request-registry', async () => (await import(HELPER)).stubs.governanceRequests())
vi.mock('@/lib/governance-sync', async () => (await import(HELPER)).stubs.governanceSync())
vi.mock('@/services/shared-state', async () => (await import(HELPER)).stubs.sharedState())
vi.mock('@/lib/ledger-emit', async () => (await import(HELPER)).stubs.ledgerEmit())
vi.mock('@/lib/portfolio-ledger', async () => (await import(HELPER)).stubs.portfolioLedger())
vi.mock('@/lib/ibct-scope-check', async () => (await import(HELPER)).stubs.ibctScopeCheck())
vi.mock('@/services/agents-core-service', async () => (await import(HELPER)).agentsCoreMock(H.world))
vi.mock('@/lib/agent-runtime', async () => (await import(HELPER)).agentRuntimeMock(H.world))

const COS = 'the-chair'
const MEMBER = 'a-member'
let restorePath: () => void

beforeAll(async () => {
  restorePath = (await import(HELPER)).installClaudeShim(H.BIN)
})

afterAll(() => {
  restorePath?.()
  rmSync(H.FAKE_HOME, { recursive: true, force: true })
  rmSync(H.FAKE_STATE, { recursive: true, force: true })
  rmSync(H.BIN, { recursive: true, force: true })
})

// The chair is deliberately NOT in agentIds: G08b refuses to demote a COS that is also a member of
// the team it chairs, so only a slot-only chair reaches G11 through the real pipeline.
const chaired = (id: string) => ({ id, name: `Team ${id}`, agentIds: [MEMBER], chiefOfStaffId: COS, blocked: false })

async function seed(teams: ReturnType<typeof chaired>[]) {
  const h = await import(HELPER)
  H.registry.clear()
  Object.assign(H.world, h.newWorld({ managerId: null, teams, hibernatable: [], awake: [], aidTokens: 0, portfolioTokens: 0 }))
  h.seedAgent(H.registry as never, H.FAKE_HOME, H.FAKE_STATE, {
    id: COS, name: COS, governanceTitle: 'chief-of-staff', program: 'claude',
  })
  h.seedAgent(H.registry as never, H.FAKE_HOME, H.FAKE_STATE, {
    id: MEMBER, name: MEMBER, governanceTitle: 'autonomous', program: 'claude',
  })
}

beforeEach(() => {
  vi.resetModules()
})

describe('ChangeTitle G11 chair clear fails closed', () => {
  it('a failing chair clear fails the change, names G11, and leaves the title unchanged', async () => {
    await seed([chaired('t1')])
    H.world.failOn = { updateTeam: 1 }
    const { driveChangeTitle } = await import(HELPER)
    const result = await driveChangeTitle(COS, 'autonomous')
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/G11/)
    expect(result.error).not.toMatch(/INVALID STATE/)
    expect(H.registry.get(COS)?.governanceTitle).toBe('chief-of-staff')
    expect(H.world.teams[0].chiefOfStaffId).toBe(COS)
  })

  it('a failure on the second chaired team restores the first team chair via the rollback', async () => {
    await seed([chaired('t1'), chaired('t2')])
    H.world.failOn = { updateTeam: 2 }
    const { driveChangeTitle } = await import(HELPER)
    const result = await driveChangeTitle(COS, 'autonomous')
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/G11/)
    expect(H.registry.get(COS)?.governanceTitle).toBe('chief-of-staff')
    expect(H.world.teams.map(t => t.chiefOfStaffId)).toEqual([COS, COS])
    // clear t1, failed clear t2, undo restore t1 — proves the rollback actually wrote.
    expect(H.world.calls.filter(c => c === 'updateTeam')).toHaveLength(3)
  })

  it('positive control: both clears succeed, the title changes and both slots are null', async () => {
    await seed([chaired('t1'), chaired('t2')])
    const { driveChangeTitle } = await import(HELPER)
    const result = await driveChangeTitle(COS, 'autonomous')
    expect(result.error ?? null).toBeNull()
    expect(result.success).toBe(true)
    expect(H.registry.get(COS)?.governanceTitle).toBe('autonomous')
    expect(H.world.teams.map(t => t.chiefOfStaffId)).toEqual([null, null])
  })

  it('a retitle of a chief-of-staff that chairs no team never calls updateTeam', async () => {
    await seed([{ ...chaired('t1'), chiefOfStaffId: MEMBER }])
    const { driveChangeTitle } = await import(HELPER)
    const result = await driveChangeTitle(COS, 'autonomous')
    expect(result.error ?? null).toBeNull()
    expect(result.success).toBe(true)
    expect(H.world.calls).not.toContain('updateTeam')
    expect(H.world.teams[0].chiefOfStaffId).toBe(MEMBER)
  })
})
