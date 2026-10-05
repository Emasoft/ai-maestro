/**
 * G14b fails closed — TRDD-8E6XMDEX.
 *
 * A revocation fault used to be swallowed into a WARN, so the title changed and a credential
 * carrying the OLD title stayed valid. Now the gate throws and the runner rolls the change back.
 * Harness: the same real-pipeline driver as change-title-window.test.ts.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import { existsSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'

const H = vi.hoisted(() => {
  const os = require('os') as typeof import('os')
  const fs = require('fs') as typeof import('fs')
  const path = require('path') as typeof import('path')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-g14b-'))
  return {
    FAKE_HOME: path.join(root, 'home'),
    FAKE_STATE: path.join(root, 'state'),
    BIN: path.join(root, 'bin'),
    registry: new Map<string, Record<string, unknown>>(),
    // Created once, reset in place (Object.assign) — mock factories capture the first object.
    // Fault the token revoke with a caller-chosen error; null = defer to the harness mock.
    fault: { err: null as Error | null, revokeCalls: 0 },
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
vi.mock('@/lib/aid-token', async () => {
  const base = (await import(HELPER)).aidTokenMock(H.world)
  const real = base.revokeTokensForAgentCompensable
  return {
    ...base,
    revokeTokensForAgentCompensable: (...a: []) => {
      H.fault.revokeCalls++
      if (H.fault.err) return Promise.reject(H.fault.err)
      return (real as (...x: []) => Promise<unknown>)(...a)
    },
  }
})
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
let workdir: string

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
  H.fault.err = null
  H.fault.revokeCalls = 0
  Object.assign(H.world, h.newWorld({
    managerId: AGENT_ID,
    teams: [{ id: 'team-1', name: 'Team One', agentIds: [TEAMMATE], chiefOfStaffId: TEAMMATE, blocked: false }],
    hibernatable: [TEAMMATE],
    awake: [TEAMMATE],
    aidTokens: 3,
    portfolioTokens: 0,
  }))
  workdir = h.seedAgent(H.registry as never, H.FAKE_HOME, H.FAKE_STATE, {
    id: AGENT_ID, name: AGENT_ID, governanceTitle: 'manager', program: 'claude',
  })
  h.seedAgent(H.registry as never, H.FAKE_HOME, H.FAKE_STATE, {
    id: TEAMMATE, name: TEAMMATE, governanceTitle: 'chief-of-staff', program: 'claude',
  })
})

describe('ChangeTitle G14b fails closed', () => {
  it('positive control: revocation succeeds, the title changes and the tokens are drained', async () => {
    const { driveChangeTitle } = await import(HELPER)
    const result = await driveChangeTitle(AGENT_ID, 'autonomous')
    expect(result.error ?? null).toBeNull()
    expect(result.success).toBe(true)
    expect(H.registry.get(AGENT_ID)?.governanceTitle).toBe('autonomous')
    expect(H.world.aidTokens).toBe(0)
  })

  // Role-plugin state lives in settings.local.json; G14d/G15/G16 run AFTER G14b, so a G14b failure
  // must leave that file exactly as it was (absent counts as a value).
  const settingsRaw = () => {
    const f = join(workdir, '.claude', 'settings.local.json')
    return existsSync(f) ? readFileSync(f, 'utf-8') : null
  }

  async function expectFailedClosed() {
    const { driveChangeTitle } = await import(HELPER)
    const settingsBefore = settingsRaw()
    const result = await driveChangeTitle(AGENT_ID, 'autonomous')
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/G14b/)
    expect(result.error).not.toMatch(/INVALID STATE/)
    expect(H.registry.get(AGENT_ID)?.governanceTitle).toBe('manager')
    expect(settingsRaw()).toBe(settingsBefore)
    // G10's host-wide mutations were reverted too, and the drained tokens came back.
    expect(H.world.managerId).toBe(AGENT_ID)
    expect(H.world.teams[0].blocked).toBe(false)
    expect(H.world.aidTokens).toBe(3)
  }

  it('a revocation fault fails the change, names G14b, and rolls everything back', async () => {
    H.world.failOn = { revokeTokensForAgentCompensable: 1 }
    await expectFailedClosed()
  })

  it('a BUSY token store (lock timeout) fails closed the same way, with no retry', async () => {
    H.fault.err = new Error("Lock 'governance-tokens' acquisition timed out after 5000ms")
    await expectFailedClosed()
    expect(H.world.calls.filter(c => c === 'revokeTokensForAgentCompensable')).toHaveLength(0)
  })

  it('nothing to revoke is not a fault: the title change succeeds', async () => {
    const { driveChangeTitle } = await import(HELPER)
    H.world.aidTokens = 0
    const result = await driveChangeTitle(AGENT_ID, 'autonomous')
    expect(result.error ?? null).toBeNull()
    expect(result.success).toBe(true)
    expect(H.registry.get(AGENT_ID)?.governanceTitle).toBe('autonomous')
  })

  // CreateAgent passes agentCreatedInThisRun for the id it minted a moment earlier: that id cannot
  // hold a token, so a broken token store must not block creation. Every other caller (option
  // absent) is covered by the fail-closed tests above.
  it('agentCreatedInThisRun: a faulting token store is never touched and the title change succeeds', async () => {
    const { driveChangeTitle } = await import(HELPER)
    H.fault.err = new Error("Lock 'governance-tokens' acquisition timed out after 5000ms")
    const result = await driveChangeTitle(AGENT_ID, 'autonomous', { agentCreatedInThisRun: true })
    expect(result.error ?? null).toBeNull()
    expect(result.success).toBe(true)
    expect(H.fault.revokeCalls).toBe(0)
    expect(H.world.aidTokens).toBe(3)
    expect(result.operations.some((o: string) => /G14b: SKIPPED AID token revocation — agent the-manager/.test(o))).toBe(true)
    expect(H.registry.get(AGENT_ID)?.governanceTitle).toBe('autonomous')
  })

  it('option absent with the same fault still fails closed (the skip is opt-in, not ambient)', async () => {
    H.fault.err = new Error("Lock 'governance-tokens' acquisition timed out after 5000ms")
    await expectFailedClosed()
    expect(H.fault.revokeCalls).toBe(1)
  })
})
