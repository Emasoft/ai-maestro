/**
 * Unit tests for lib/signed-ledger.ts — Phase 1.0.A of TRDD-eac02238.
 *
 * Coverage:
 *   - v1 entries (no auth fields) append + verify successfully
 *   - v1.1 entries (with auth fields) append + verify successfully
 *   - Interleaved v1 and v1.1 entries in the SAME chain all verify
 *   - Backward compat: a chain written under v1 semantics still
 *     verifies after the v1.1 canonicalize() upgrade
 *   - AppendOptions partial fields (only one of three set) are
 *     properly round-tripped
 *   - Tampered entry is detected
 *
 * Mocking strategy: fs is mocked (no real disk writes); host-keys runs
 * for real so signatures are actually signed and verified.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

let fsStore: Record<string, string> = {}

vi.mock('fs', () => ({
  default: {
    existsSync: (p: string) => p in fsStore,
    readFileSync: (p: string) => {
      if (p in fsStore) return fsStore[p]
      const err = new Error(`ENOENT: ${p}`) as NodeJS.ErrnoException
      err.code = 'ENOENT'
      throw err
    },
    writeFileSync: (p: string, data: string) => { fsStore[p] = data },
    renameSync: (from: string, to: string) => {
      if (from in fsStore) {
        fsStore[to] = fsStore[from]
        delete fsStore[from]
      }
    },
    mkdirSync: () => { /* no-op */ },
  },
  existsSync: (p: string) => p in fsStore,
  readFileSync: (p: string) => {
    if (p in fsStore) return fsStore[p]
    const err = new Error(`ENOENT: ${p}`) as NodeJS.ErrnoException
    err.code = 'ENOENT'
    throw err
  },
  writeFileSync: (p: string, data: string) => { fsStore[p] = data },
  renameSync: (from: string, to: string) => {
    if (from in fsStore) {
      fsStore[to] = fsStore[from]
      delete fsStore[from]
    }
  },
  mkdirSync: () => { /* no-op */ },
}))

vi.mock('@/lib/file-lock', () => ({
  acquireLock: async () => () => { /* release no-op */ },
}))

// Mutable so a test can shrink the rotation window instead of appending 10001
// entries to reach it. Reset in beforeEach so it cannot leak between tests.
const LEDGER_CFG_DEFAULT = { maxEntriesPerFile: 10000, compactAfterEntries: 5000 }
const ledgerCfg = vi.hoisted(() => ({
  value: { maxEntriesPerFile: 10000, compactAfterEntries: 5000 },
}))

vi.mock('@/lib/security-config', () => ({
  loadSecurityConfig: () => ({ ledger: ledgerCfg.value }),
}))

vi.mock('@/lib/hosts-config', () => ({
  getSelfHostId: () => 'test-host-id-01',
}))

// host-keys runs for real — we want actual Ed25519 signatures.
// But we need to mock its disk access. host-keys uses fs for key-file
// storage, which our fs-mock handles transparently.

describe('signed-ledger — Phase 1.0.A per-op audit extension', () => {
  beforeEach(() => {
    fsStore = {}
    ledgerCfg.value = { ...LEDGER_CFG_DEFAULT }
    // Reset modules so host-keys re-generates its keypair AND re-writes
    // public.hex/private.hex to the (now-empty) fsStore. Without this,
    // the cached keypair in host-keys signs correctly but verify() fails
    // because it reads public.hex from disk which was wiped with fsStore.
    vi.resetModules()
  })

  async function makeLedger() {
    const { SignedLedger } = await import('@/lib/signed-ledger')
    return new SignedLedger('/tmp/test-registry.json')
  }

  describe('v1 (legacy) append + verify', () => {
    it('appends 3 v1-style entries with no auth fields and verifies the chain', async () => {
      const ledger = await makeLedger()
      await ledger.append('create', 'test.json', [{ op: 'add', path: '/a', value: 1 }])
      await ledger.append('update', 'test.json', [{ op: 'replace', path: '/a', value: 2 }])
      await ledger.append('delete', 'test.json', [{ op: 'remove', path: '/a' }])
      const res = await ledger.verify()
      expect(res.ok).toBe(true)
    })

    it('v1 entries do NOT include auth fields in serialized form', async () => {
      const ledger = await makeLedger()
      await ledger.append('create', 'test.json', [{ op: 'add', path: '/a', value: 1 }])
      const entries = ledger.getEntries()
      expect(entries).toHaveLength(1)
      expect(entries[0].authAction).toBeUndefined()
      expect(entries[0].authAgentId).toBeUndefined()
      expect(entries[0].authActor).toBeUndefined()
    })
  })

  describe('v1.1 (per-op taxonomy) append + verify', () => {
    it('appends v1.1 entries with full auth trio and verifies', async () => {
      const ledger = await makeLedger()
      await ledger.append(
        'change_title',
        'agents/registry.json',
        [{ op: 'replace', path: '/agents/0/governanceTitle', value: 'manager' }],
        { authAction: 'change_title', authAgentId: 'agent-abc', authActor: 'user' },
      )
      await ledger.append(
        'change_plugin',
        'agents/registry.json',
        [{ op: 'add', path: '/agents/0/plugins/-', value: 'test-plugin' }],
        { authAction: 'install_element', authAgentId: 'agent-abc', authActor: 'user' },
      )
      const res = await ledger.verify()
      if (!res.ok) console.error('verify failed:', res.reason)
      expect(res.ok).toBe(true)
    })

    it('round-trips partial auth fields (only authAction set)', async () => {
      const ledger = await makeLedger()
      await ledger.append(
        'hibernate_role_missing',
        'agents/registry.json',
        [{ op: 'replace', path: '/agents/0/status', value: 'hibernated' }],
        { authAction: 'hibernate_role_missing', authActor: 'system' },
      )
      const entries = ledger.getEntries()
      expect(entries[0].authAction).toBe('hibernate_role_missing')
      expect(entries[0].authActor).toBe('system')
      expect(entries[0].authAgentId).toBeUndefined()
      const res = await ledger.verify()
      expect(res.ok).toBe(true)
    })
  })

  describe('interleaved v1 + v1.1', () => {
    it('chains v1 → v1.1 → v1 → v1.1 entries and verifies full chain', async () => {
      const ledger = await makeLedger()
      await ledger.append('create', 'test.json', [{ op: 'add', path: '/a', value: 1 }])
      await ledger.append(
        'change_title', 'test.json',
        [{ op: 'replace', path: '/a', value: 2 }],
        { authAction: 'change_title', authActor: 'user' },
      )
      await ledger.append('update', 'test.json', [{ op: 'replace', path: '/a', value: 3 }])
      await ledger.append(
        'delete_agent', 'test.json',
        [{ op: 'remove', path: '/a' }],
        { authAction: 'delete_agent', authAgentId: 'x', authActor: 'system' },
      )
      const res = await ledger.verify()
      expect(res.ok).toBe(true)
      expect(ledger.stats().entryCount).toBe(4)
    })
  })

  describe('backward compatibility', () => {
    it('a v1-shaped file on disk (no auth fields anywhere) verifies after upgrade', async () => {
      // Simulate a ledger written BEFORE the v1.1 extension: entries
      // have no auth fields. Verify still works because canonicalize()
      // omits the auth trio when all three are undefined.
      const ledger = await makeLedger()
      await ledger.append('create', 'test.json', [{ op: 'add', path: '/a', value: 1 }])
      await ledger.append('update', 'test.json', [{ op: 'replace', path: '/a', value: 2 }])

      // Re-instantiate (simulates fresh process load)
      const { SignedLedger } = await import('@/lib/signed-ledger')
      const reloaded = new SignedLedger('/tmp/test-registry.json')
      const res = await reloaded.verify()
      expect(res.ok).toBe(true)
    })
  })

  describe('tamper detection still works under v1.1', () => {
    it('detects tampered v1.1 entry', async () => {
      const ledger = await makeLedger()
      await ledger.append(
        'change_title', 'test.json',
        [{ op: 'replace', path: '/a', value: 'manager' }],
        { authAction: 'change_title', authActor: 'user' },
      )
      // Tamper: flip the authActor in the persisted file
      const rawPath = '/tmp/test-registry.ledger.json'
      const file = JSON.parse(fsStore[rawPath]) as { entries: Array<{ authActor?: string }> }
      file.entries[0].authActor = 'agent'   // was 'user'
      fsStore[rawPath] = JSON.stringify(file)

      const { SignedLedger } = await import('@/lib/signed-ledger')
      const reloaded = new SignedLedger('/tmp/test-registry.json')
      const res = await reloaded.verify()
      expect(res.ok).toBe(false)
    })
  })

  // Rotation had NO test at all, which is how the seq counter came to restart
  // mid-file on the live registry ledger and pinned the server in READ-ONLY
  // mode for a day. A tiny window reaches rotation in 8 appends instead of
  // 10001.
  describe('rotation', () => {
    async function appendN(ledger: { append: (...a: never[]) => Promise<unknown> }, n: number) {
      for (let i = 0; i < n; i++) {
        await (ledger.append as unknown as (
          op: string, p: string, d: unknown[],
        ) => Promise<unknown>)('update', 'test.json', [{ op: 'replace', path: '/n', value: i }])
      }
    }

    it('keeps seq strictly increasing ACROSS a rotation', async () => {
      ledgerCfg.value = { maxEntriesPerFile: 6, compactAfterEntries: 3 }
      const ledger = await makeLedger()
      await appendN(ledger as never, 10)

      const live = JSON.parse(fsStore['/tmp/test-registry.ledger.json']) as {
        entries: Array<{ seq: number }>
      }
      const seqs = live.entries.map(e => e.seq)

      // The bug: after rotation truncated the array, the next seq was derived
      // from the new (shorter) length and restarted, duplicating a seq that
      // had already been archived.
      expect(new Set(seqs).size).toBe(seqs.length) // no duplicates
      for (let i = 1; i < seqs.length; i++) {
        expect(seqs[i]).toBe(seqs[i - 1] + 1) // contiguous and ascending
      }
    })

    it('still verifies after rotating — the read-only trigger', async () => {
      ledgerCfg.value = { maxEntriesPerFile: 6, compactAfterEntries: 3 }
      const ledger = await makeLedger()
      await appendN(ledger as never, 10)

      // On failure vitest prints the whole result, so the "Sequence gap" reason
      // is visible without asserting on a field the ok-branch does not carry.
      const res = await ledger.verify()
      expect(res).toEqual({ ok: true })
    })

    it('actually rotated — otherwise the two tests above prove nothing', async () => {
      ledgerCfg.value = { maxEntriesPerFile: 6, compactAfterEntries: 3 }
      const ledger = await makeLedger()
      await appendN(ledger as never, 10)

      // A positive control: an archive file must exist and the live file must
      // be shorter than the total appended, or no rotation happened and the
      // seq assertions are vacuous.
      const archives = Object.keys(fsStore).filter(p => p.includes('.archive.json'))
      expect(archives.length).toBeGreaterThan(0)

      const live = JSON.parse(fsStore['/tmp/test-registry.ledger.json']) as {
        entries: Array<{ seq: number }>
      }
      expect(live.entries.length).toBeLessThan(10)
      expect(live.entries[0].seq).toBeGreaterThan(0) // the tail starts mid-chain
    })
  })
})
