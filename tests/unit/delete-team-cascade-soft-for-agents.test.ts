/**
 * TRDD-A50RC5G8 (USER ruling 2026-10-05: "hard-kill is strictly reserved to the user maestro"): the DeleteTeam G07
 * "delete agents too" cascade must delete SOFT (cemetery archive kept, folder kept) when the caller is an AGENT,
 * and keep the hard + folder-wipe behaviour for the system owner.
 *
 * These tests DRIVE THE REAL `DeleteTeam` AND THE REAL `DeleteAgent` (same module, so DeleteAgent cannot be mocked
 * anyway); only the stores/IO around them are faked (registry, team registry, tmux, ledger...). Effects asserted:
 * the member row is tombstoned (soft) or gone (hard), and the member workdir is still on disk (soft) or wiped (hard).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { existsSync } from 'fs'

const H = vi.hoisted(() => {
  const { mkdtempSync: mk } = require('fs') as typeof import('fs')
  const { join: j } = require('path') as typeof import('path')
  const root = (process.env.TMPDIR || '/tmp').replace(/\/$/, '')
  const FAKE_HOME = mk(j(root, 'aim-deleteteam-cascade-'))
  return {
    FAKE_HOME,
    FAKE_STATE: j(FAKE_HOME, '.aimaestro'),
    store: new Map<string, Record<string, unknown>>(),
    teams: [] as Array<Record<string, unknown>>,
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
// loadGovernance has no passwordHash, so DeleteTeam's G00b never calls verifyPassword — but it imports it.
vi.mock('@/lib/governance', async () => ({
  ...(await import(HELPER)).stubs.governance(),
  verifyPassword: async () => true,
}))
// A stateful team registry: DeleteTeam reads the team, edits it in G03 and deletes it in G04.
vi.mock('@/lib/team-registry', async () => ({
  ...(await import(HELPER)).stubs.teamRegistry(),
  freezeIncompleteTeam: async () => ({ frozen: false, hibernated: [] }),
  loadTeams: () => H.teams,
  saveTeams: (t: Array<Record<string, unknown>>) => { H.teams.splice(0, H.teams.length, ...t) },
  getTeam: (id: string) => H.teams.find((t) => t.id === id),
  updateTeam: async (id: string, patch: Record<string, unknown>) => {
    const i = H.teams.findIndex((t) => t.id === id)
    if (i >= 0) H.teams[i] = { ...H.teams[i], ...patch }
  },
  deleteTeam: async (id: string) => {
    const i = H.teams.findIndex((t) => t.id === id)
    if (i < 0) return false
    H.teams.splice(i, 1)
    return true
  },
}))
vi.mock('@/lib/group-registry', async () => (await import(HELPER)).stubs.groupRegistry())
vi.mock('@/lib/agent-runtime', async () => (await import(HELPER)).stubs.agentRuntime())
vi.mock('@/lib/session-persistence', async () => (await import(HELPER)).stubs.sessionPersistence())
vi.mock('@/lib/amp-auth', async () => (await import(HELPER)).stubs.ampAuth())
vi.mock('@/lib/aid-token', async () => (await import(HELPER)).stubs.aidToken())
vi.mock('@/lib/governance-request-registry', async () => (await import(HELPER)).stubs.governanceRequests())
vi.mock('@/lib/ledger-emit', async () => (await import(HELPER)).stubs.ledgerEmit())
vi.mock('@/lib/aid-ledger-authority', () => ({ recordAidRevocation: async () => undefined }))
vi.mock('@/services/agents-transfer-service', async () => (await import(HELPER)).stubs.agentsTransfer())
// G03 hibernates each member; the real one drives tmux. The cascade under test is unrelated to it.
vi.mock('@/services/agents-core-service', () => ({
  hibernateAgent: async () => ({ data: { success: true } }),
}))

import { seedAgent, type FakeRegistryStore } from '@/tests/helpers/drive-delete-agent'
import { DeleteTeam } from '@/services/element-management-service'
import type { AuthContext } from '@/lib/agent-auth'

const store = H.store as unknown as FakeRegistryStore
const manager: AuthContext = { agentId: 'mgr-1', isSystemOwner: false, governanceTitle: 'manager' }
const owner: AuthContext = { isSystemOwner: true }

let workdirs: Record<string, string>
beforeEach(() => {
  store.clear()
  H.teams.splice(0, H.teams.length)
  // 'maintainer' is a global title: G03 skips the ChangeTitle revert, keeping the fixture on the cascade path.
  workdirs = {
    'm-1': seedAgent(store, H.FAKE_HOME, H.FAKE_STATE, { id: 'm-1', name: 'member-one', governanceTitle: 'maintainer' }),
    'm-2': seedAgent(store, H.FAKE_HOME, H.FAKE_STATE, { id: 'm-2', name: 'member-two', governanceTitle: 'maintainer' }),
  }
  H.teams.push({ id: 'team-1', name: 'doomed', agentIds: ['m-1', 'm-2'], chiefOfStaffId: null, orchestratorId: null })
})

describe('DeleteTeam G07 cascade — soft for an agent caller, hard for the user (TRDD-A50RC5G8)', () => {
  it('MANAGER agent: every member is SOFT-deleted (row tombstoned, folder kept), none refused', async () => {
    const r = await DeleteTeam('team-1', { authContext: manager, deleteAgents: true })
    expect(r.success).toBe(true)
    expect(r.error, 'no member may be left behind with a failure').toBeUndefined()
    // (the success line itself says "hard delete is reserved to the user", so match refusals, not that phrase)
    expect(r.operations.some((o) => o.includes('DeleteAgent FAILED') || o.includes('DENIED'))).toBe(false)
    expect(r.operations.some((o) => o.includes('Cascade summary — 2/2 agents deleted, 0 failed'))).toBe(true)
    for (const id of ['m-1', 'm-2']) {
      const row = store.get(id) as { deletedAt?: string | null } | undefined
      expect(row, `${id} row must survive as a cemetery tombstone`).toBeDefined()
      expect(row?.deletedAt, `${id} must be tombstoned`).toBeTruthy()
      expect(existsSync(workdirs[id]), `${id} folder must NOT be wiped`).toBe(true)
    }
  })

  it('MANAGER agent: the ops trace says soft and never claims hard or a wiped folder', async () => {
    const r = await DeleteTeam('team-1', { authContext: manager, deleteAgents: true })
    const g07 = r.operations.filter((o) => o.includes('DeleteAgent succeeded'))
    expect(g07).toHaveLength(2)
    for (const line of g07) {
      expect(line).toContain('soft')
      expect(line).toContain('cemetery')
    }
    expect(r.operations.some((o) => /hard, folder wiped/i.test(o))).toBe(false)
  })

  it('POSITIVE CONTROL: the system owner hard-deletes the members and wipes their folders, as before', async () => {
    const r = await DeleteTeam('team-1', { authContext: owner, deleteAgents: true })
    expect(r.success).toBe(true)
    expect(r.operations.filter((o) => o.includes('(hard, folder wiped)'))).toHaveLength(2)
    for (const id of ['m-1', 'm-2']) {
      expect(store.has(id), `${id} row must be gone`).toBe(false)
      expect(existsSync(workdirs[id]), `${id} folder must be wiped`).toBe(false)
    }
  })
})
