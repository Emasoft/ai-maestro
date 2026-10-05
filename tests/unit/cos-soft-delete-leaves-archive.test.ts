/**
 * TRDD-A50RC5G8 (USER ruling 2026-10-05: MANAGER and CHIEF-OF-STAFF "can kill/delete an agent. but only soft-kill. the
 * agent corpse in the cemetery can always be resurrected by the user maestro"). The COS grant rests on one guarantee:
 * a COS delete is SOFT and leaves a cemetery archive. This file drives the REAL `DeleteAgent` as a COS.
 *
 * WHAT IS REAL AND WHAT IS NOT: G00 authorization, the soft-only guard, G01c's cemetery write (real `mkdir` +
 * `writeFileSync` into the FAKE state dir) and the registry tombstone are real. `exportAgentZip` is STUBBED (it
 * zips the agent folder with tar/keys; the stub returns a file named after the agent and records the id it was asked
 * for). So the archive FILE's existence under the fake cemetery is proven; the ZIP CONTENT being a restorable agent
 * is NOT proven by this test.
 * CONTAINMENT: os.homedir and the ecosystem paths point at a temp FAKE_HOME; the positive control asserts the archive
 * landed under FAKE_STATE, i.e. the fake root is what was written to.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { existsSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'

const H = vi.hoisted(() => {
  const { mkdtempSync: mk } = require('fs') as typeof import('fs')
  const { join: j } = require('path') as typeof import('path')
  const root = (process.env.TMPDIR || '/tmp').replace(/\/$/, '')
  const FAKE_HOME = mk(j(root, 'aim-cos-softdelete-'))
  return {
    FAKE_HOME,
    FAKE_STATE: j(FAKE_HOME, '.aimaestro'),
    store: new Map<string, Record<string, unknown>>(),
    teams: [] as Array<Record<string, unknown>>,
    exported: [] as string[],
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
// loadTeams feeds authorize()'s own-team test (lookupTeamIdForAgent); the rest of the registry is the shared stub.
vi.mock('@/lib/team-registry', async () => ({
  ...(await import(HELPER)).stubs.teamRegistry(),
  freezeIncompleteTeam: async () => ({ frozen: false, hibernated: [] }),
  loadTeams: () => H.teams,
}))
vi.mock('@/lib/group-registry', async () => (await import(HELPER)).stubs.groupRegistry())
vi.mock('@/lib/agent-runtime', async () => (await import(HELPER)).stubs.agentRuntime())
vi.mock('@/lib/session-persistence', async () => (await import(HELPER)).stubs.sessionPersistence())
vi.mock('@/lib/amp-auth', async () => (await import(HELPER)).stubs.ampAuth())
vi.mock('@/lib/aid-token', async () => (await import(HELPER)).stubs.aidToken())
vi.mock('@/lib/governance-request-registry', async () => (await import(HELPER)).stubs.governanceRequests())
vi.mock('@/lib/ledger-emit', async () => (await import(HELPER)).stubs.ledgerEmit())
vi.mock('@/lib/aid-ledger-authority', () => ({ recordAidRevocation: async () => undefined }))
// Records WHICH agent G01c asked to archive and names the file after it, so the cemetery listing is attributable.
vi.mock('@/services/agents-transfer-service', () => ({
  exportAgentZip: async (id: string) => {
    H.exported.push(id)
    return { data: { filename: `${id}-export-test.zip`, buffer: Buffer.from('stub-zip-payload') } }
  },
}))

import { seedAgent, type FakeRegistryStore } from '@/tests/helpers/drive-delete-agent'
import { DeleteAgent } from '@/services/element-management-service'
import type { AuthContext } from '@/lib/agent-auth'

const store = H.store as unknown as FakeRegistryStore
const cemetery = () => join(H.FAKE_STATE, 'cemetery')
const archives = () => (existsSync(cemetery()) ? readdirSync(cemetery()) : [])
const REASON = 'hard delete and folder deletion are reserved to the user (TRDD-A50RC5G8); an agent may only soft-delete'
const cos: AuthContext = { agentId: 'cos-1', isSystemOwner: false, governanceTitle: 'chief-of-staff', teamId: 'team-a' }

let own: string
let other: string
beforeEach(() => {
  store.clear()
  H.exported.length = 0
  rmSync(cemetery(), { recursive: true, force: true }) // the FAKE cemetery persists across tests in this file
  H.teams.splice(0, H.teams.length, { id: 'team-a', agentIds: ['own-1'], chiefOfStaffId: 'cos-1', orchestratorId: null },
    { id: 'team-b', agentIds: ['other-1'], chiefOfStaffId: null, orchestratorId: null })
  own = seedAgent(store, H.FAKE_HOME, H.FAKE_STATE, { id: 'own-1', name: 'own-1', governanceTitle: 'member' })
  other = seedAgent(store, H.FAKE_HOME, H.FAKE_STATE, { id: 'other-1', name: 'other-1', governanceTitle: 'member' })
})

describe('DeleteAgent as a CHIEF-OF-STAFF — soft delete leaves a cemetery archive (TRDD-A50RC5G8)', () => {
  it('own-team member: succeeds as SOFT, cemetery archive exists in the FAKE state dir, folder kept, row tombstoned', async () => {
    const r = await DeleteAgent('own-1', { authContext: cos })
    expect(r.error).toBeUndefined()
    expect(r.success).toBe(true)
    expect(r.hard).toBeFalsy()
    expect(H.exported).toEqual(['own-1'])
    // positive control: the archive is under the FAKE root, not the developer's real ~/.aimaestro
    expect(cemetery().startsWith(H.FAKE_HOME)).toBe(true)
    expect(archives()).toEqual(['own-1-export-test.zip'])
    expect(existsSync(own), 'agent folder must be kept').toBe(true)
    expect((store.get('own-1') as { deletedAt?: string | null }).deletedAt).toBeTruthy()
  })

  it('other-team member: refused at G00, no archive requested or written, registry unchanged, folder kept', async () => {
    const r = await DeleteAgent('other-1', { authContext: cos })
    expect(r.success).toBe(false)
    expect(r.error).toBe('Chief-of-Staff can only delete agents in their own team (soft delete only)')
    expect(H.exported).toEqual([])
    expect(archives()).toEqual([])
    expect((store.get('other-1') as { deletedAt?: string | null }).deletedAt).toBeNull()
    expect(existsSync(other)).toBe(true)
  })

  it('own-team member with hard:true is refused by the soft-only guard: no archive, row intact, folder kept', async () => {
    const r = await DeleteAgent('own-1', { authContext: cos, hard: true })
    expect(r.success).toBe(false)
    expect(r.error).toBe(REASON)
    expect(H.exported).toEqual([])
    expect(archives()).toEqual([])
    expect((store.get('own-1') as { deletedAt?: string | null }).deletedAt).toBeNull()
    expect(existsSync(own)).toBe(true)
  })

  it('R39.6: a COS deleting an ASSISTANT of its own team is refused (now at G00, ahead of G01b): no archive, row intact', async () => {
    seedAgent(store, H.FAKE_HOME, H.FAKE_STATE, { id: 'asst-1', name: 'asst-1', governanceTitle: 'assistant' })
    H.teams[0].agentIds = ['own-1', 'asst-1']
    const r = await DeleteAgent('asst-1', { authContext: cos })
    expect(r.success).toBe(false)
    expect(r.error).toBe('A CHIEF-OF-STAFF may delete only team members it supervises (member, architect, orchestrator, integrator); target title is assistant')
    expect(H.exported).toEqual([])
    expect(archives()).toEqual([])
    expect((store.get('asst-1') as { deletedAt?: string | null }).deletedAt).toBeNull()
  })

  it('own-team MANAGER: refused at G00, no archive written, registry unchanged', async () => {
    seedAgent(store, H.FAKE_HOME, H.FAKE_STATE, { id: 'mgr-1', name: 'mgr-1', governanceTitle: 'manager' })
    H.teams[0].agentIds = ['own-1', 'mgr-1']
    const r = await DeleteAgent('mgr-1', { authContext: cos })
    expect(r.success).toBe(false)
    expect(r.error).toBe('A CHIEF-OF-STAFF may delete only team members it supervises (member, architect, orchestrator, integrator); target title is manager')
    expect(H.exported).toEqual([])
    expect(archives()).toEqual([])
    expect((store.get('mgr-1') as { deletedAt?: string | null }).deletedAt).toBeNull()
  })
})
