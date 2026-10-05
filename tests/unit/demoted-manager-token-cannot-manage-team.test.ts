/**
 * A demoted MANAGER's OLD governance token cannot manage teams — TRDD-8E6XMDEX.
 *
 * title-change-revocation-fails-closed.test.ts proves G14b revokes (against a counter double of
 * lib/aid-token). This is the missing end-to-end half: a token minted while the agent WAS the
 * MANAGER stops working for a manager-only action once the title changes.
 *
 * REAL: ChangeTitle pipeline (gates incl. G14b), lib/aid-token (real issueGovernanceToken /
 *   revokeTokensForAgentCompensable / validateGovernanceToken, real governance-tokens file under
 *   the temp state root), lib/agent-auth authenticateAgent, lib/authorization authorize,
 *   lib/file-lock, lib/security-config, lib/aid-ledger-authority.
 * DOUBLED (same harness as title-change-revocation-fails-closed): agent-registry (in-memory Map
 *   mirrored to a temp registry.json), governance (manager pointer), team-registry, portfolio-store,
 *   governance-request-registry, governance-sync, shared-state, ledger/portfolio-ledger emitters,
 *   ibct-scope-check, agents-core-service, agent-runtime, and a fake `claude` binary on PATH.
 * CONTAINMENT: os.homedir + ecosystem paths point at a temp root; positive control below checks the
 *   token file landed there.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import { existsSync, rmSync } from 'fs'
import { join } from 'path'

const H = vi.hoisted(() => {
  const os = require('os') as typeof import('os')
  const fs = require('fs') as typeof import('fs')
  const path = require('path') as typeof import('path')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-demoted-mgr-'))
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
// NOTE: '@/lib/aid-token' is deliberately NOT mocked — the real token store is the subject.
vi.mock('@/lib/portfolio-store', async () => (await import(HELPER)).portfolioStoreMock(H.world))
vi.mock('@/lib/governance-request-registry', async () => (await import(HELPER)).stubs.governanceRequests())
vi.mock('@/lib/governance-sync', async () => (await import(HELPER)).stubs.governanceSync())
vi.mock('@/services/shared-state', async () => (await import(HELPER)).stubs.sharedState())
vi.mock('@/lib/ledger-emit', async () => (await import(HELPER)).stubs.ledgerEmit())
vi.mock('@/lib/portfolio-ledger', async () => (await import(HELPER)).stubs.portfolioLedger())
vi.mock('@/lib/ibct-scope-check', async () => (await import(HELPER)).stubs.ibctScopeCheck())
vi.mock('@/services/agents-core-service', async () => (await import(HELPER)).agentsCoreMock(H.world))
vi.mock('@/lib/agent-runtime', async () => (await import(HELPER)).agentRuntimeMock(H.world))

const AGENT_ID = 'the-manager'
const TEAMMATE = 'someone-else'
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

beforeEach(async () => {
  vi.resetModules()
  const h = await import(HELPER)
  H.registry.clear()
  Object.assign(H.world, h.newWorld({
    managerId: AGENT_ID,
    teams: [{ id: 'team-1', name: 'Team One', agentIds: [TEAMMATE], chiefOfStaffId: TEAMMATE, blocked: false }],
    hibernatable: [TEAMMATE],
    awake: [TEAMMATE],
  }))
  h.seedAgent(H.registry as never, H.FAKE_HOME, H.FAKE_STATE, {
    id: AGENT_ID, name: AGENT_ID, governanceTitle: 'manager', program: 'claude',
  })
  h.seedAgent(H.registry as never, H.FAKE_HOME, H.FAKE_STATE, {
    id: TEAMMATE, name: TEAMMATE, governanceTitle: 'chief-of-staff', program: 'claude',
  })
})

/** Mint a real governance token for the-manager, as it is registered right now. */
async function mintManagerToken(): Promise<string> {
  // The token file lives on disk and outlives vi.resetModules(): an earlier test's token would
  // otherwise be counted here, so start from an empty store.
  rmSync(join(H.FAKE_STATE, 'governance-tokens'), { recursive: true, force: true })
  const { issueGovernanceToken } = await import('@/lib/aid-token')
  const issued = await issueGovernanceToken(AGENT_ID, AGENT_ID, 'manager', null)
  return issued.access_token
}

async function presentToken(token: string) {
  const { authenticateAgent } = await import('@/lib/agent-auth')
  const { authorize } = await import('@/lib/authorization')
  const auth = authenticateAgent(`Bearer ${token}`, null)
  return { auth, manageTeam: authorize(auth, 'manage-team') }
}

describe('a demoted MANAGER token cannot manage teams (real token store, real auth, real authorize)', () => {
  it('positive control: before the demotion the minted token authenticates as manager and may manage teams', async () => {
    const token = await mintManagerToken()
    expect(existsSync(join(H.FAKE_STATE, 'governance-tokens', 'active-tokens.json'))).toBe(true)
    const { auth, manageTeam } = await presentToken(token)
    expect(auth.error).toBeUndefined()
    expect(auth.agentId).toBe(AGENT_ID)
    expect(auth.governanceTitle).toBe('manager')
    expect(manageTeam.allowed).toBe(true)
  })

  it('after ChangeTitle away from manager the OLD token is refused by authenticateAgent', async () => {
    const token = await mintManagerToken()
    const { driveChangeTitle } = await import(HELPER)
    const { countTokensForAgent } = await import('@/lib/aid-token')
    expect(countTokensForAgent(AGENT_ID)).toBe(1)

    const result = await driveChangeTitle(AGENT_ID, 'autonomous')
    expect(result.success).toBe(true)
    expect(H.registry.get(AGENT_ID)?.governanceTitle).toBe('autonomous')
    expect(countTokensForAgent(AGENT_ID)).toBe(0)

    const { auth } = await presentToken(token)
    expect(auth.status).toBe(401)
    expect(auth.error).toMatch(/Invalid or expired governance token/)
    expect(auth.agentId).toBeUndefined()
    expect(auth.governanceTitle).toBeUndefined()
  })

  it('after ChangeTitle away from manager the OLD token is refused by authorize(manage-team) with the auth error', async () => {
    const token = await mintManagerToken()
    const { driveChangeTitle } = await import(HELPER)
    expect((await driveChangeTitle(AGENT_ID, 'autonomous')).success).toBe(true)

    const { manageTeam } = await presentToken(token)
    expect(manageTeam.allowed).toBe(false)
    expect(manageTeam.reason).toMatch(/Invalid or expired governance token/)
  })

  it('a token minted AFTER the demotion carries the new title and is refused for manage-team on the title rule', async () => {
    const { driveChangeTitle } = await import(HELPER)
    expect((await driveChangeTitle(AGENT_ID, 'autonomous')).success).toBe(true)
    const { issueGovernanceToken } = await import('@/lib/aid-token')
    const fresh = (await issueGovernanceToken(AGENT_ID, AGENT_ID, 'autonomous', null)).access_token

    const { auth, manageTeam } = await presentToken(fresh)
    expect(auth.error).toBeUndefined()
    expect(auth.governanceTitle).toBe('autonomous')
    expect(manageTeam.allowed).toBe(false)
    expect(manageTeam.reason).toMatch(/Only MANAGER can manage teams/)
  })
})
