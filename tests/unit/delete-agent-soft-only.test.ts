/**
 * TRDD-A50RC5G8 (USER ruling 2026-10-05): an AGENT caller may only SOFT-delete. Hard delete and folder deletion are
 * reserved to the user. The refusal lives in the SERVICE (`DeleteAgent`, right after G00) so both server modes get it.
 *
 * What each test asserts, and why it can fail:
 *  - refusal cases: the REASON string, plus three independent no-side-effect witnesses (registry row still present
 *    and not tombstoned, workdir still on disk, tmux kill never called) and no G01 ops line (the guard precedes G01).
 *  - positive controls assert the pipeline WENT ON past G00 (an ops line from G01b, a later gate) rather than
 *    `success`, because a fixture may fail later for unrelated reasons.
 *
 * USER-AUTHORITY MODEL: the contexts below are built literally in the shape `buildAuthContext` produces (Q6 of the
 * TRDD-A50RC5G8 investigation): model OFF web session = `{ isSystemOwner: true }`; model ON MAESTRO =
 * `{ isSystemOwner: true, userId, userTitle: 'maestro' }`; model ON ordinary user = `{ isSystemOwner: false, userId,
 * userTitle: 'user' }`. `buildAuthContext` itself is not called (it reads the live governance flag).
 */
import { describe, it, expect, vi, afterAll, beforeEach } from 'vitest'
import { existsSync } from 'fs'

const H = vi.hoisted(() => {
  const { mkdtempSync: mk } = require('fs') as typeof import('fs')
  const { join: j } = require('path') as typeof import('path')
  const root = (process.env.TMPDIR || '/tmp').replace(/\/$/, '')
  const FAKE_HOME = mk(j(root, 'aim-deleteagent-softonly-'))
  return {
    FAKE_HOME,
    FAKE_STATE: j(FAKE_HOME, '.aimaestro'),
    store: new Map<string, Record<string, unknown>>(),
    killed: [] as string[],
  }
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
vi.mock('@/lib/agent-registry', async () => {
  const h = await import(HELPER)
  return h.registryMock(H.store as never, h.registryPath(H.FAKE_STATE))
})
vi.mock('@/lib/governance', async () => (await import(HELPER)).stubs.governance())
vi.mock('@/lib/team-registry', async () => ({
  ...(await import(HELPER)).stubs.teamRegistry(),
  // team-1 holds victim-1: authorize() needs it to see a COS and its target as same-team (USER ruling 2026-10-05).
  loadTeams: () => [{ id: 'team-1', agentIds: ['victim-1'], chiefOfStaffId: 'cos-1', orchestratorId: null }],
  freezeIncompleteTeam: async () => ({ frozen: false, hibernated: [] }),
}))
vi.mock('@/lib/group-registry', async () => (await import(HELPER)).stubs.groupRegistry())
// Own runtime stub (not the shared one) so the tmux kill is observable.
vi.mock('@/lib/agent-runtime', () => ({
  getRuntime: () => ({
    killSession: async (name: string) => { H.killed.push(name) },
    sessionExists: async () => false,
    listSessions: async () => [],
  }),
}))
vi.mock('@/lib/session-persistence', async () => (await import(HELPER)).stubs.sessionPersistence())
vi.mock('@/lib/amp-auth', async () => (await import(HELPER)).stubs.ampAuth())
vi.mock('@/lib/aid-token', async () => (await import(HELPER)).stubs.aidToken())
vi.mock('@/lib/governance-request-registry', async () => (await import(HELPER)).stubs.governanceRequests())
vi.mock('@/lib/ledger-emit', async () => (await import(HELPER)).stubs.ledgerEmit())
vi.mock('@/lib/aid-ledger-authority', () => ({ recordAidRevocation: async () => undefined }))
vi.mock('@/services/agents-transfer-service', async () => (await import(HELPER)).stubs.agentsTransfer())

import { seedAgent, type FakeRegistryStore } from '@/tests/helpers/drive-delete-agent'
import { DeleteAgent } from '@/services/element-management-service'
import type { AuthContext } from '@/lib/agent-auth'

const store = H.store as unknown as FakeRegistryStore
const REASON = 'hard delete and folder deletion are reserved to the user (TRDD-A50RC5G8); an agent may only soft-delete'

const manager: AuthContext = { agentId: 'mgr-1', isSystemOwner: false, governanceTitle: 'manager' }
const cosOwnTeam: AuthContext = { agentId: 'cos-1', isSystemOwner: false, governanceTitle: 'chief-of-staff', teamId: 'team-1' }
const owner: AuthContext = { isSystemOwner: true }
const maestroUser: AuthContext = { isSystemOwner: true, userId: 'u-maestro', userTitle: 'maestro' }
const plainUser: AuthContext = { isSystemOwner: false, userId: 'u-plain', userTitle: 'user' }

let workdir: string
beforeEach(() => {
  H.killed.length = 0
  store.clear()
  workdir = seedAgent(store, H.FAKE_HOME, H.FAKE_STATE, { id: 'victim-1', name: 'victim-1', governanceTitle: 'member' })
})
afterAll(() => { /* the temp home is under TMPDIR and holds only fixtures */ })

/** Nothing happened: row intact (not removed, not tombstoned), folder present, tmux untouched. */
function expectNoSideEffects() {
  const row = store.get('victim-1') as { deletedAt?: string | null } | undefined
  expect(row, 'registry row was removed').toBeDefined()
  expect(row?.deletedAt, 'registry row was tombstoned').toBeNull()
  expect(existsSync(workdir), 'workdir was removed').toBe(true)
  expect(H.killed, 'tmux session was killed').toEqual([])
}

describe('DeleteAgent — an agent caller may only soft-delete (TRDD-A50RC5G8)', () => {
  it('MANAGER agent + hard:true is refused with the soft-only reason and no side effect', async () => {
    const r = await DeleteAgent('victim-1', { authContext: manager, hard: true })
    expect(r.success).toBe(false)
    expect(r.error).toBe(REASON)
    expect(r.operations.some((o) => o.startsWith('G01'))).toBe(false)
    expectNoSideEffects()
  })

  it('MANAGER agent + deleteFolder:true on a SOFT delete is refused too, no side effect', async () => {
    const r = await DeleteAgent('victim-1', { authContext: manager, hard: false, deleteFolder: true })
    expect(r.success).toBe(false)
    expect(r.error).toBe(REASON)
    expect(r.operations.some((o) => o.startsWith('G01'))).toBe(false)
    expectNoSideEffects()
  })

  it('MANAGER agent + hard:true + deleteFolder:true is refused, no side effect', async () => {
    const r = await DeleteAgent('victim-1', { authContext: manager, hard: true, deleteFolder: true })
    expect(r.error).toBe(REASON)
    expectNoSideEffects()
  })

  it('a CHIEF-OF-STAFF agent + hard:true passes G00 (own team, USER ruling 2026-10-05) and is refused by the soft-only guard', async () => {
    const r = await DeleteAgent('victim-1', { authContext: cosOwnTeam, hard: true })
    expect(r.success).toBe(false)
    expect(r.error).toBe(REASON)
    expectNoSideEffects()
  })

  it('POSITIVE CONTROL: MANAGER agent SOFT delete passes G00 and the guard — the pipeline goes on to G01/G01b', async () => {
    const r = await DeleteAgent('victim-1', { authContext: manager })
    // Asserting the pipeline advanced, not `success`: a fixture may fail at a later gate for unrelated reasons.
    expect(r.operations.some((o) => o.startsWith('G01b'))).toBe(true)
    expect(r.error ?? '').not.toBe(REASON)
    expect(existsSync(workdir)).toBe(true) // soft keeps the folder
  })

  it('POSITIVE CONTROL: system owner + hard:true is NOT refused by the guard (model OFF context)', async () => {
    const r = await DeleteAgent('victim-1', { authContext: owner, hard: true })
    expect(r.error ?? '').not.toBe(REASON)
    expect(r.operations.some((o) => o.startsWith('G01b'))).toBe(true)
  })

  it('model-ON MAESTRO user (isSystemOwner true) + hard:true is NOT refused by the guard', async () => {
    const r = await DeleteAgent('victim-1', { authContext: maestroUser, hard: true })
    expect(r.error ?? '').not.toBe(REASON)
    expect(r.operations.some((o) => o.startsWith('G01b'))).toBe(true)
  })

  it('model-ON non-MAESTRO user + hard:true is stopped at G00 (never reaches the guard); nothing happens', async () => {
    const r = await DeleteAgent('victim-1', { authContext: plainUser, hard: true })
    expect(r.success).toBe(false)
    expect(r.error).toBe('User "user" is not authorized to delete-agent via the AI Maestro API')
    expectNoSideEffects()
  })
})
