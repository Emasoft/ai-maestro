/**
 * TRDD-8E6XMDEX: portfolio tokens issued TO an agent (`subject_agent_id`) must be revoked by a COMPLETED DeleteAgent
 * (soft or hard) and restored by a ROLLED-BACK one — DeleteAgent gate G06b. Commit 40ca151fd only made them dormant
 * while the holder's row is soft-deleted; after a hard delete (or a revive under a new id) the old id has no row.
 *
 * WHAT IS REAL: the DeleteAgent pipeline and its runner, the portfolio store (real `issueToken`, real files under a
 * temp FAKE_STATE, real lock) — assertions read the stored JSON files, not an in-memory view.
 * WHAT IS NOT: registry, teams, tmux, session persistence, AMP/AID stores, the ledger and the cemetery zip are the
 * shared stubs of tests/helpers/drive-delete-agent.ts. The registry double used here additionally (1) restores the
 * store in `saveAgents` (the helper's is a no-op, so a rollback could not be observed) and (2) can skip the registry
 * flush, which is how a REAL later gate (G08b, on-disk verification) is made to fail for the rollback case.
 * CONTAINMENT: os.homedir and the ecosystem paths point at a temp FAKE_HOME; the positive control asserts the
 * portfolio files live under it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'

const H = vi.hoisted(() => {
  const { mkdtempSync: mk } = require('fs') as typeof import('fs')
  const { join: j } = require('path') as typeof import('path')
  const root = (process.env.TMPDIR || '/tmp').replace(/\/$/, '')
  const FAKE_HOME = mk(j(root, 'aim-g06b-'))
  return {
    FAKE_HOME,
    FAKE_STATE: j(FAKE_HOME, '.aimaestro'),
    store: new Map<string, Record<string, unknown>>(),
    /** When true the registry double soft/hard-deletes in memory but never flushes registry.json. */
    skipFlush: false,
  }
})

// vi.hoisted: the agent-registry factory runs while portfolio-store is imported, before a plain const would be initialised.
const HELPER = vi.hoisted(() => '@/tests/helpers/drive-delete-agent')

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
  const file = h.registryPath(H.FAKE_STATE)
  const base = h.registryMock(H.store as never, file)
  const flush = (): void => {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify([...H.store.values()], null, 2), 'utf-8')
  }
  return {
    ...base,
    // Restores the store G08 snapshotted — the helper's no-op would make a rollback unobservable.
    saveAgents: (rows: Array<Record<string, unknown>>) => {
      H.store.clear()
      for (const r of rows) H.store.set(r.id as string, r)
      flush()
    },
    deleteAgent: async (id: string, hard: boolean) => {
      const existing = H.store.get(id)
      if (!existing) return false
      if (hard) H.store.delete(id)
      else H.store.set(id, { ...existing, deletedAt: new Date().toISOString(), status: 'deleted' })
      if (!H.skipFlush) flush()
      return true
    },
  }
})
vi.mock('@/lib/governance', async () => (await import(HELPER)).stubs.governance())
vi.mock('@/lib/team-registry', async () => ({
  ...(await import(HELPER)).stubs.teamRegistry(),
  freezeIncompleteTeam: async () => ({ frozen: false, hibernated: [] }),
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

import { seedAgent, driveDeleteAgent, type FakeRegistryStore } from '@/tests/helpers/drive-delete-agent'
import { issueToken, _resetPortfolioCacheForTests } from '@/lib/portfolio-store'
import type { PortfolioToken } from '@/types/portfolio'

const store = H.store as unknown as FakeRegistryStore
const portfoliosDir = () => join(H.FAKE_STATE, 'agents', 'portfolios')
const stored = (id: string): PortfolioToken[] =>
  (JSON.parse(readFileSync(join(portfoliosDir(), `${id}.json`), 'utf-8')) as { tokens: PortfolioToken[] }).tokens

const mint = (tokenId: string, subject: string): PortfolioToken => ({
  token_id: tokenId, kind: 'mandate', subject_agent_id: subject, scope: 'agent:create',
  issuer_agent_id: 'mgr-x', issuer_title: 'manager', uses_remaining: null,
  issued_at: '2026-10-01T00:00:00.000Z', expires_at: null, issuer_sig: 'sig', ledger_seq: null, status: 'active',
})

beforeEach(async () => {
  store.clear()
  H.skipFlush = false
  rmSync(portfoliosDir(), { recursive: true, force: true })
  _resetPortfolioCacheForTests()
  seedAgent(store, H.FAKE_HOME, H.FAKE_STATE, { id: 'holder-1', name: 'holder-1', governanceTitle: 'member' })
  seedAgent(store, H.FAKE_HOME, H.FAKE_STATE, { id: 'other-1', name: 'other-1', governanceTitle: 'member' })
  await issueToken(mint('t-h1', 'holder-1'))
  await issueToken(mint('t-h2', 'holder-1'))
  await issueToken(mint('t-o1', 'other-1'))
})

describe('DeleteAgent G06b — portfolio tokens HELD BY the deleted agent, revoked on HARD delete only (TRDD-8E6XMDEX)', () => {
  it('SOFT delete: the holder\'s 2 tokens stay stored as ACTIVE (left dormant, not revoked), the other agent\'s 1 is untouched', async () => {
    expect(portfoliosDir().startsWith(H.FAKE_HOME)).toBe(true) // positive control: the FAKE root took effect
    const before = stored('holder-1')
    expect(before.map(t => t.status)).toEqual(['active', 'active'])
    const r = await driveDeleteAgent({ agentId: 'holder-1', hard: false })
    expect(r.error).toBeUndefined()
    expect(r.success).toBe(true)
    expect((store.get('holder-1') as { deletedAt?: string | null }).deletedAt).toBeTruthy() // it really was soft-deleted
    expect(r.operations).toContain('G06b: soft delete — held portfolio tokens left dormant (TRDD-8E6XMDEX)')
    expect(stored('holder-1')).toEqual(before)
    expect(stored('other-1').map(t => t.status)).toEqual(['active'])
  })

  it('HARD delete: the holder\'s 2 active tokens are revoked in the stored file, the other agent\'s 1 is untouched', async () => {
    const r = await driveDeleteAgent({ agentId: 'holder-1', hard: true })
    expect(r.error).toBeUndefined()
    expect(r.success).toBe(true)
    expect(store.has('holder-1')).toBe(false) // the row is gone — exactly the case where dormancy no longer covers it
    expect(r.operations).toContain('G06b: 2 portfolio token(s) held by this agent revoked')
    expect(stored('holder-1').map(t => t.status)).toEqual(['revoked', 'revoked'])
    expect(stored('other-1').map(t => t.status)).toEqual(['active'])
  })

  it('ROLLBACK of a HARD delete: a later gate (G08b, registry write never landed on disk) fails → delete fails and the 2 tokens are restored byte-for-byte', async () => {
    const before = stored('holder-1')
    H.skipFlush = true
    const r = await driveDeleteAgent({ agentId: 'holder-1', hard: true })
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/G08b/)
    expect(r.error).toMatch(/still present in registry\.json/)
    expect(r.operations).toContain('G06b: 2 portfolio token(s) held by this agent revoked') // the revoke DID run before the rollback
    expect(stored('holder-1')).toEqual(before)
    expect(stored('holder-1').every(t => t.status === 'active')).toBe(true)
    expect(stored('other-1').map(t => t.status)).toEqual(['active'])
  })

  it('FAULT in the revocation on HARD delete (unsafe subject id → store throws): delete FAILS naming G06b and the agent row is NOT deleted', async () => {
    seedAgent(store, H.FAKE_HOME, H.FAKE_STATE, { id: 'bad id', name: 'bad-id', governanceTitle: 'member' })
    const r = await driveDeleteAgent({ agentId: 'bad id', hard: true })
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/G06b: portfolio token revocation failed/)
    expect(r.error).toMatch(/Unsafe subject agent id/)
    expect(store.has('bad id')).toBe(true)
    expect((store.get('bad id') as { deletedAt?: string | null }).deletedAt).toBeNull()
  })

  it('agent holding no tokens: HARD delete succeeds and G06b reports 0 revoked', async () => {
    seedAgent(store, H.FAKE_HOME, H.FAKE_STATE, { id: 'empty-1', name: 'empty-1', governanceTitle: 'member' })
    expect(existsSync(join(portfoliosDir(), 'empty-1.json'))).toBe(false)
    const r = await driveDeleteAgent({ agentId: 'empty-1', hard: true })
    expect(r.error).toBeUndefined()
    expect(r.success).toBe(true)
    expect(r.operations).toContain('G06b: 0 portfolio token(s) held by this agent revoked')
    expect(stored('other-1').map(t => t.status)).toEqual(['active'])
  })
})
