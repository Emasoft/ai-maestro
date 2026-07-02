/**
 * Unit tests for lib/foreign-approval-registry.ts (R34.2 / R35 / R40).
 *
 * Two modes, matching the human-directory pattern:
 *   - stateDir-override CRUD: pass an explicit temp dir → no ledger, pure
 *     load/save/upsert/update/list correctness + corruption-heal-to-empty.
 *   - default-path ledger emission: sandbox os.homedir() + real host-keys →
 *     the SignedLedger actually signs an append on the foreign-approvals chain.
 *
 * No toggle: this registry is pure storage (the enforceAidAssociation flag only
 * gates the token MINT / SPEND paths, not this file).
 */

import { describe, it, expect, beforeEach, afterAll, beforeAll, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { ForeignApprovalEntry } from '@/types/foreign-approval'

// Sandbox os.homedir() for the default-path (ledger) tests.
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-foreign-approval-home-'))
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return {
    ...actual,
    default: { ...actual, homedir: () => TMP_HOME, hostname: () => 'test-host-fa' },
    homedir: () => TMP_HOME,
    hostname: () => 'test-host-fa',
  }
})

type RegistryModule = typeof import('@/lib/foreign-approval-registry')
let reg: RegistryModule

// A separate temp dir for the stateDir-override CRUD tests (no ledger).
let CRUD_DIR: string

beforeAll(async () => {
  const hostKeys = await import('@/lib/host-keys')
  hostKeys.getOrCreateHostKeyPair()
  reg = await import('@/lib/foreign-approval-registry')
})

afterAll(() => {
  try { fs.rmSync(TMP_HOME, { recursive: true, force: true }) } catch { /* best-effort */ }
})

beforeEach(() => {
  CRUD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-fa-crud-'))
})

function makeEntry(over: Partial<ForeignApprovalEntry> = {}): ForeignApprovalEntry {
  return {
    id: `SHA256:fp-x@remote-host`,
    fingerprint: 'SHA256:fp-x',
    kind: 'agent',
    sourceHostId: 'remote-host',
    displayName: 'remote-agent',
    status: 'pending',
    requestedAt: new Date().toISOString(),
    ...over,
  }
}

describe('foreign-approval-registry — stateDir-override CRUD', () => {
  it('loadForeignApprovals returns [] when the file does not exist', () => {
    expect(reg.loadForeignApprovals(CRUD_DIR)).toEqual([])
  })

  it('upsert then load round-trips an entry', () => {
    reg.upsertForeignApproval(makeEntry(), CRUD_DIR)
    const all = reg.loadForeignApprovals(CRUD_DIR)
    expect(all).toHaveLength(1)
    expect(all[0].fingerprint).toBe('SHA256:fp-x')
    expect(all[0].status).toBe('pending')
  })

  it('upsert replaces an entry with the same id (no duplicate rows)', () => {
    reg.upsertForeignApproval(makeEntry(), CRUD_DIR)
    reg.upsertForeignApproval(makeEntry({ displayName: 'renamed' }), CRUD_DIR)
    const all = reg.loadForeignApprovals(CRUD_DIR)
    expect(all).toHaveLength(1)
    expect(all[0].displayName).toBe('renamed')
  })

  it('getForeignApproval finds by id, null when absent', () => {
    reg.upsertForeignApproval(makeEntry(), CRUD_DIR)
    expect(reg.getForeignApproval('SHA256:fp-x@remote-host', CRUD_DIR)?.fingerprint).toBe('SHA256:fp-x')
    expect(reg.getForeignApproval('nope', CRUD_DIR)).toBeNull()
  })

  it('listPendingForeignApprovals returns only pending entries', () => {
    reg.upsertForeignApproval(makeEntry({ id: 'a@h', fingerprint: 'a', status: 'pending' }), CRUD_DIR)
    reg.upsertForeignApproval(makeEntry({ id: 'b@h', fingerprint: 'b', status: 'approved' }), CRUD_DIR)
    reg.upsertForeignApproval(makeEntry({ id: 'c@h', fingerprint: 'c', status: 'rejected' }), CRUD_DIR)
    const pending = reg.listPendingForeignApprovals(CRUD_DIR)
    expect(pending).toHaveLength(1)
    expect(pending[0].fingerprint).toBe('a')
  })

  it('updateForeignApproval flips status + records decision, keeps id immutable', () => {
    reg.upsertForeignApproval(makeEntry(), CRUD_DIR)
    const updated = reg.updateForeignApproval('SHA256:fp-x@remote-host', {
      status: 'approved',
      decidedBy: 'system-owner',
      newAgentId: 'local-1',
      // attempt to rewrite id — must be ignored
      id: 'HACKED',
    }, CRUD_DIR)
    expect(updated).not.toBeNull()
    expect(updated!.id).toBe('SHA256:fp-x@remote-host') // unchanged
    expect(updated!.status).toBe('approved')
    expect(updated!.newAgentId).toBe('local-1')
    // Persisted.
    expect(reg.getForeignApproval('SHA256:fp-x@remote-host', CRUD_DIR)?.status).toBe('approved')
  })

  it('updateForeignApproval returns null for an unknown id', () => {
    expect(reg.updateForeignApproval('missing', { status: 'rejected' }, CRUD_DIR)).toBeNull()
  })

  it('heals a corrupted file to empty (invalid JSON)', () => {
    const filePath = reg.getForeignApprovalsPath(CRUD_DIR)
    fs.writeFileSync(filePath, '{ this is not valid json', 'utf-8')
    const all = reg.loadForeignApprovals(CRUD_DIR)
    expect(all).toEqual([])
    // A .corrupted backup was written and the file healed to a valid empty file.
    const healed = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    expect(healed.version).toBe(1)
    expect(healed.entries).toEqual([])
  })

  it('a structurally-wrong file (bad version) reads as empty', () => {
    const filePath = reg.getForeignApprovalsPath(CRUD_DIR)
    fs.writeFileSync(filePath, JSON.stringify({ version: 99, entries: [makeEntry()] }), 'utf-8')
    expect(reg.loadForeignApprovals(CRUD_DIR)).toEqual([])
  })

  it('writes the file with 0o600 perms', () => {
    reg.upsertForeignApproval(makeEntry(), CRUD_DIR)
    const filePath = reg.getForeignApprovalsPath(CRUD_DIR)
    const mode = fs.statSync(filePath).mode & 0o777
    expect(mode).toBe(0o600)
  })
})

describe('foreign-approval-registry — default-path ledger emission', () => {
  it('records a signed ledger entry on the foreign-approvals chain', async () => {
    // Default path (no stateDir) → ledger fires.
    reg.upsertForeignApproval(makeEntry({ id: 'led@h', fingerprint: 'led' }))
    // Drain the foreign-approvals ledger lock to flush the fire-and-forget append.
    const { acquireLock } = await import('@/lib/file-lock')
    const release = await acquireLock('ledger:foreign-approvals')
    release()
    await new Promise(r => setTimeout(r, 10))

    const ledgerPath = path.join(TMP_HOME, '.aimaestro', 'foreign-approvals.ledger.json')
    expect(fs.existsSync(ledgerPath)).toBe(true)
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf-8'))
    expect(ledger.entries.length).toBeGreaterThanOrEqual(1)
    // First mutation on an empty store is a 'create'.
    expect(['create', 'update']).toContain(ledger.entries[0].op)
    expect(ledger.entries[0].path).toBe('foreign-approvals.json')
  })
})
