/**
 * DeleteAgent rollback parity — R51 / TRDD-DQ6XN2VP.
 *
 * THE CLAIM UNDER TEST: when a gate fails mid-pipeline, every store DeleteAgent already touched is
 * back exactly as it was, and the caller is told no changes were made.
 *
 * Before this file, the only rollback tests in the repo drove `lib/gate-transaction.ts` against
 * SYNTHETIC gates. Nothing forced a failure through a real pipeline and asserted the system was
 * left unchanged — so the compensation could have been wrong in every gate and the suite would not
 * have noticed.
 *
 * WHY THE STORES ARE MODELLED RATHER THAN STUBBED INERT. The shared `drive-delete-agent` stubs are
 * no-ops (`saveTeams: () => undefined`), which is right for tests about something else and fatal
 * here: an undo that calls a no-op writer leaves an unchanged store, so byte-equality would pass
 * with every compensation deleted. These stubs hold real arrays and really mutate them, so the
 * before/after comparison can only pass if the undos actually ran.
 *
 * THE GATE-ID ASSERTION IS LOAD-BEARING, not decoration. Deleting an `undo` makes the runner's
 * pre-flight REFUSE the sequence (`failedGateId: 'PRECHECK'`) — nothing runs, so nothing changes,
 * so byte-equality passes VACUOUSLY. Only `failedGateId === 'G08'` distinguishes "rolled back
 * correctly" from "never started". Both neuters below are recorded in the TRDD.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { mkdirSync, existsSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'

const H = vi.hoisted(() => {
  const os = require('os') as typeof import('os')
  const fs = require('fs') as typeof import('fs')
  const path = require('path') as typeof import('path')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-rollback-'))

  /** Every store DeleteAgent mutates, as live data. Reset in beforeEach. */
  const state = {
    teams: [] as Array<Record<string, unknown>>,
    groups: [] as Array<Record<string, unknown>>,
    requests: { requests: [] as Array<Record<string, unknown>> },
    persisted: [] as Array<Record<string, unknown>>,
    keys: [] as Array<Record<string, unknown>>,
    tokens: [] as Array<Record<string, unknown>>,
    /** G05's observable effect, kept in its OWN field: folding it into `persisted` tangled it with
     *  G05b's mutation of the same array and made the positive control read a false failure. */
    sessionKilled: false,
    /** Flipped on to make G08 fail, which is the injection point. */
    failRegistryDelete: false,
  }
  const registry = new Map<string, Record<string, unknown>>()
  return { FAKE_HOME: path.join(root, 'home'), FAKE_STATE: path.join(root, 'state'), state, registry }
})

const HELPER = '@/tests/helpers/drive-delete-agent'

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, homedir: () => H.FAKE_HOME, default: { ...actual, homedir: () => H.FAKE_HOME } }
})
vi.mock('@/lib/ecosystem-constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ecosystem-constants')>()
  const { fakeEcosystemPaths } = await import('@/tests/helpers/fake-ecosystem-home')
  return fakeEcosystemPaths(actual, H.FAKE_HOME, H.FAKE_STATE)
})

// The registry keeps the shared helper's disk-flushing mock — G08b reads registry.json with real
// `fs`, so a purely in-memory registry would make that gate unobservable. `deleteAgent` is wrapped
// to give the test an injection point that fails EXACTLY at G08, after every other gate has run.
vi.mock('@/lib/agent-registry', async () => {
  const h = await import(HELPER)
  const base = h.registryMock(H.registry as never, h.registryPath(H.FAKE_STATE))
  return {
    ...base,
    deleteAgent: async (id: string, hard: boolean) => {
      if (H.state.failRegistryDelete) return false   // → G08 throws 'registry delete returned false'
      return base.deleteAgent(id, hard)
    },
  }
})

vi.mock('@/lib/governance', async () => (await import(HELPER)).stubs.governance())
vi.mock('@/lib/ledger-emit', async () => (await import(HELPER)).stubs.ledgerEmit())
vi.mock('@/lib/aid-ledger-authority', () => ({ recordAidRevocation: async () => undefined }))
vi.mock('@/services/agents-transfer-service', async () => (await import(HELPER)).stubs.agentsTransfer())
vi.mock('@/lib/agent-runtime', () => ({
  getRuntime: () => ({
    // Alive, so G05 really kills it and its undo really has to wake it.
    sessionExists: async () => true,
    killSession: async () => { H.state.sessionKilled = true },
    listSessions: async () => [],
  }),
}))
vi.mock('@/services/agents-core-service', () => ({
  // `sessionKilled` is part of the snapshot, so a missing G05 undo shows up as a byte-equality
  // failure rather than passing unnoticed.
  wakeAgent: async () => { H.state.sessionKilled = false; return { data: { woken: true }, status: 200 } },
}))

vi.mock('@/lib/team-registry', () => ({
  loadTeams: () => JSON.parse(JSON.stringify(H.state.teams)),
  saveTeams: (t: Array<Record<string, unknown>>) => { H.state.teams = JSON.parse(JSON.stringify(t)) },
}))
vi.mock('@/lib/group-registry', () => ({
  loadGroups: () => JSON.parse(JSON.stringify(H.state.groups)),
  saveGroups: (g: Array<Record<string, unknown>>) => { H.state.groups = JSON.parse(JSON.stringify(g)) },
}))
vi.mock('@/lib/governance-request-registry', () => ({
  loadGovernanceRequests: () => JSON.parse(JSON.stringify(H.state.requests)),
  saveGovernanceRequests: (f: { requests: Array<Record<string, unknown>> }) => {
    H.state.requests = JSON.parse(JSON.stringify(f))
  },
  rejectGovernanceRequest: async (id: string) => {
    const r = H.state.requests.requests.find(x => x.id === id)
    if (r) r.status = 'rejected'
  },
}))
vi.mock('@/lib/session-persistence', () => ({
  loadPersistedSessions: () => JSON.parse(JSON.stringify(H.state.persisted)),
  savePersistedSessions: (s: Array<Record<string, unknown>>) => {
    H.state.persisted = JSON.parse(JSON.stringify(s))
  },
  unpersistSession: async (name: string) => {
    const i = H.state.persisted.findIndex(p => p.id === name)
    if (i < 0) return 'absent'
    H.state.persisted.splice(i, 1)
    return 'removed'
  },
}))
vi.mock('@/lib/amp-auth', () => ({
  getKeysForAgent: () => [],
  revokeAllKeysForAgentCompensable: async (agentId: string) => {
    const flipped = H.state.keys.filter(k => k.agent_id === agentId && k.status === 'active')
    flipped.forEach(k => { k.status = 'revoked' })
    return {
      count: flipped.length,
      restore: async () => { flipped.forEach(k => { k.status = 'active' }); return flipped.length },
    }
  },
}))
vi.mock('@/lib/aid-token', () => ({
  countTokensForAgent: () => 0,
  revokeTokensForAgentCompensable: async (agentId: string) => {
    const removed = H.state.tokens.filter(t => t.agent_id === agentId)
    H.state.tokens = H.state.tokens.filter(t => t.agent_id !== agentId)
    return {
      count: removed.length,
      restore: async () => { H.state.tokens.push(...removed); return removed.length },
    }
  },
}))

const AGENT_ID = 'doomed-agent'
const OWNER_CTX = { isSystemOwner: true, agentId: null, governanceTitle: null } as never

function seed(): void {
  H.state.teams = [{ id: 'team-1', name: 'Team One', agentIds: [AGENT_ID, 'other'], chiefOfStaffId: AGENT_ID, orchestratorId: null, blocked: false }]
  H.state.groups = [{ id: 'group-1', name: 'Group One', subscriberIds: [AGENT_ID, 'other'] }]
  H.state.requests = { requests: [{ id: 'req-1', type: 'transfer-agent', status: 'pending', payload: { agentId: AGENT_ID } }] }
  H.state.persisted = [{ id: AGENT_ID, name: AGENT_ID }]
  H.state.keys = [{ key_hash: 'sha256:aaa', agent_id: AGENT_ID, status: 'active' }]
  H.state.tokens = [{ token_hash: 'sha256:bbb', agent_id: AGENT_ID }]
  H.state.sessionKilled = false
  H.state.failRegistryDelete = false

  H.registry.clear()
  H.registry.set(AGENT_ID, {
    id: AGENT_ID, name: AGENT_ID, governanceTitle: 'member',
    workingDirectory: join(H.FAKE_HOME, 'agents', AGENT_ID), status: 'online',
  })
  mkdirSync(join(H.FAKE_HOME, 'agents', AGENT_ID), { recursive: true })
}

const snapshot = () => JSON.stringify({
  teams: H.state.teams, groups: H.state.groups, requests: H.state.requests,
  persisted: H.state.persisted, keys: H.state.keys, tokens: H.state.tokens,
  sessionKilled: H.state.sessionKilled,
})

const cemeteryFiles = (): string[] => {
  const dir = join(H.FAKE_STATE, 'cemetery')
  return existsSync(dir) ? readdirSync(dir) : []
}

beforeEach(() => {
  vi.resetModules()
  seed()
})

afterAll(() => {
  rmSync(H.FAKE_HOME, { recursive: true, force: true })
  rmSync(H.FAKE_STATE, { recursive: true, force: true })
})

describe('DeleteAgent rollback parity (R51)', () => {
  /**
   * The POSITIVE CONTROL, and it comes first on purpose: if a delete changed nothing, the parity
   * test below would pass against a pipeline that does nothing at all.
   */
  it('a successful delete really does mutate every store — otherwise parity proves nothing', async () => {
    const before = snapshot()
    const { DeleteAgent } = await import('@/services/element-management-service')

    const result = await DeleteAgent(AGENT_ID, { authContext: OWNER_CTX, hard: false })

    expect(result.success).toBe(true)
    expect(snapshot()).not.toBe(before)
    // Named individually so a partial pipeline cannot hide behind one changed store.
    expect(H.state.teams[0].chiefOfStaffId).toBeNull()
    expect(H.state.teams[0].agentIds).toEqual(['other'])
    expect(H.state.groups[0].subscriberIds).toEqual(['other'])
    expect(H.state.requests.requests[0].status).toBe('rejected')
    expect(H.state.persisted).toHaveLength(0)
    expect(H.state.sessionKilled).toBe(true)
    expect(H.state.keys[0].status).toBe('revoked')
    expect(H.state.tokens).toHaveLength(0)
    expect(cemeteryFiles()).toHaveLength(1)
  })

  it('a failure at G08 leaves every store byte-identical to before the call', async () => {
    const before = snapshot()
    H.state.failRegistryDelete = true
    const { DeleteAgent } = await import('@/services/element-management-service')

    const result = await DeleteAgent(AGENT_ID, { authContext: OWNER_CTX, hard: false })

    expect(result.success).toBe(false)
    expect(snapshot()).toBe(before)
  })

  /**
   * Without this, deleting any `undo` still passes the parity assertion: the pre-flight refuses,
   * nothing runs, and "unchanged" is trivially true. Naming G08 is what proves the sequence RAN
   * and then rewound.
   */
  it('names G08 as the gate that failed — not PRECHECK, which would mean nothing ran', async () => {
    H.state.failRegistryDelete = true
    const { DeleteAgent } = await import('@/services/element-management-service')

    const result = await DeleteAgent(AGENT_ID, { authContext: OWNER_CTX, hard: false })

    expect(result.error).toMatch(/GATE NUMBER \d+ \(G08\)/)
    expect(result.error).toContain('NO CHANGES WERE MADE TO THE SYSTEM')
    expect(result.error).not.toContain('PRECHECK')
  })

  it('removes the cemetery archive it wrote, so a rolled-back delete leaves no ghost entry', async () => {
    H.state.failRegistryDelete = true
    const { DeleteAgent } = await import('@/services/element-management-service')

    await DeleteAgent(AGENT_ID, { authContext: OWNER_CTX, hard: false })

    // The cemetery lists agents that ARE deleted. A row for an agent that never went anywhere is
    // read by the restore UI as a recoverable agent.
    expect(cemeteryFiles()).toHaveLength(0)
  })

  it('reports each gate it reverted, so the rollback is auditable and not merely claimed', async () => {
    H.state.failRegistryDelete = true
    const { DeleteAgent } = await import('@/services/element-management-service')

    const result = await DeleteAgent(AGENT_ID, { authContext: OWNER_CTX, hard: false })

    for (const id of ['G01c', 'G04', 'G05', 'G05b', 'G06', 'G07', 'G07c', 'G08']) {
      expect(result.operations).toContain(`${id}: reverted`)
    }
  })
})
