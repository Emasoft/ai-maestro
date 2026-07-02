/**
 * Unit tests for the R34.1 backfill — lib/ledger-startup.ts::backfillAidAssociations().
 *
 * REAL fs + REAL host-keys + sandbox os.homedir(): we seed real agents into the
 * registry file and assert backfillAidAssociations() emits a signed aid_associate
 * for each non-deleted agent that has a metadata.amp.fingerprint, skips the rest,
 * and is idempotent (cache-dedupe → no duplicate rows on a second run).
 *
 * The CLEAN-VERIFY / read-only GATE lives in verifyAllLedgers (it only invokes
 * backfill on allOk && !readOnly). backfillAidAssociations itself is deliberately
 * gate-free so it is independently testable — which is what we exercise here.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-aid-backfill-'))
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return {
    ...actual,
    default: { ...actual, homedir: () => TMP_HOME, hostname: () => 'test-host-bf' },
    homedir: () => TMP_HOME,
    hostname: () => 'test-host-bf',
  }
})

type StartupModule = typeof import('@/lib/ledger-startup')
type AuthorityModule = typeof import('@/lib/aid-ledger-authority')

let startup: StartupModule
let authority: AuthorityModule
const AGENTS_DIR = path.join(TMP_HOME, '.aimaestro', 'agents')
const REGISTRY_FILE = path.join(AGENTS_DIR, 'registry.json')
const REGISTRY_LEDGER = path.join(AGENTS_DIR, 'registry.ledger.json')
const RECOVERY_CACHE = path.join(TMP_HOME, '.aimaestro', 'aid-recovery-cache.json')

beforeAll(async () => {
  const hostKeys = await import('@/lib/host-keys')
  hostKeys.getOrCreateHostKeyPair()
  startup = await import('@/lib/ledger-startup')
  authority = await import('@/lib/aid-ledger-authority')
})

afterAll(() => {
  try { fs.rmSync(TMP_HOME, { recursive: true, force: true }) } catch { /* best-effort */ }
})

function seedRegistry(agents: Record<string, unknown>[]): void {
  fs.mkdirSync(AGENTS_DIR, { recursive: true })
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(agents, null, 2), 'utf-8')
}

beforeEach(async () => {
  // Fresh chain + cache each test (keep host keys).
  try {
    if (fs.existsSync(AGENTS_DIR)) {
      for (const f of fs.readdirSync(AGENTS_DIR)) {
        if (/^registry\.ledger/.test(f) || f === 'registry.json') fs.rmSync(path.join(AGENTS_DIR, f), { force: true })
      }
    }
    if (fs.existsSync(RECOVERY_CACHE)) fs.rmSync(RECOVERY_CACHE, { force: true })
  } catch { /* best-effort */ }
  // The registryLedger singleton caches its entries in memory and only reloads
  // on append/verify. Wiping the FILE alone leaves stale entries that would make
  // the ledger-backed dedupe in recordAidAssociation falsely skip. verify()
  // does `loaded=false; ensureLoaded()`, re-reading the now-empty file → the
  // singleton's in-memory entries reset to match. (This is a test-harness reset,
  // not a production concern — production never wipes the ledger out from under
  // the singleton.)
  const { registryLedger } = await import('@/lib/agent-registry')
  await registryLedger.verify()
  authority.invalidateRecoveryCache()
})

async function flushLedger(): Promise<void> {
  const { acquireLock } = await import('@/lib/file-lock')
  const release = await acquireLock('ledger:registry')
  release()
  await new Promise(r => setTimeout(r, 5))
}

function readLedgerOps(): string[] {
  if (!fs.existsSync(REGISTRY_LEDGER)) return []
  return JSON.parse(fs.readFileSync(REGISTRY_LEDGER, 'utf-8')).entries.map((e: { op: string }) => e.op)
}

describe('backfillAidAssociations (R34.1)', () => {
  it('emits aid_associate for every non-deleted agent with a fingerprint', async () => {
    seedRegistry([
      { id: 'a1', name: 'one', metadata: { amp: { fingerprint: 'SHA256:fp-a1' } } },
      { id: 'a2', name: 'two', metadata: { amp: { fingerprint: 'SHA256:fp-a2' } } },
    ])
    const count = await startup.backfillAidAssociations()
    await flushLedger()
    expect(count).toBe(2)
    const ops = readLedgerOps()
    expect(ops.filter(o => o === 'aid_associate')).toHaveLength(2)

    // The associations are now queryable (Risk R1: nobody is locked out after backfill).
    authority.invalidateRecoveryCache()
    expect(authority.isAidAssociated('SHA256:fp-a1').ok).toBe(true)
    expect(authority.isAidAssociated('SHA256:fp-a2').ok).toBe(true)
  })

  it('skips agents without a fingerprint', async () => {
    seedRegistry([
      { id: 'a1', name: 'one', metadata: { amp: { fingerprint: 'SHA256:fp-a1' } } },
      { id: 'a2', name: 'two', metadata: {} },                 // no amp
      { id: 'a3', name: 'three' },                              // no metadata
    ])
    const count = await startup.backfillAidAssociations()
    await flushLedger()
    expect(count).toBe(1)
    expect(readLedgerOps().filter(o => o === 'aid_associate')).toHaveLength(1)
  })

  it('skips soft-deleted agents (tombstones)', async () => {
    seedRegistry([
      { id: 'a1', name: 'one', metadata: { amp: { fingerprint: 'SHA256:fp-a1' } } },
      { id: 'a2', name: 'gone', deletedAt: new Date().toISOString(), metadata: { amp: { fingerprint: 'SHA256:fp-a2' } } },
    ])
    const count = await startup.backfillAidAssociations()
    await flushLedger()
    expect(count).toBe(1)
    expect(readLedgerOps().filter(o => o === 'aid_associate')).toHaveLength(1)
    authority.invalidateRecoveryCache()
    expect(authority.isAidAssociated('SHA256:fp-a2').ok).toBe(false) // deleted agent never backed
  })

  it('is idempotent — a SECOND run adds no duplicate aid_associate rows (cache dedupe)', async () => {
    seedRegistry([
      { id: 'a1', name: 'one', metadata: { amp: { fingerprint: 'SHA256:fp-a1' } } },
    ])
    await startup.backfillAidAssociations()
    await flushLedger()
    expect(readLedgerOps().filter(o => o === 'aid_associate')).toHaveLength(1)

    // Second run: the cache already has a non-revoked association → no emit.
    const secondCount = await startup.backfillAidAssociations()
    await flushLedger()
    // count counts agents PROCESSED, but recordAidAssociation deduped the emit.
    expect(secondCount).toBe(1)
    expect(readLedgerOps().filter(o => o === 'aid_associate')).toHaveLength(1) // STILL 1, no dup
  })

  it('returns 0 on an empty registry', async () => {
    seedRegistry([])
    const count = await startup.backfillAidAssociations()
    expect(count).toBe(0)
  })
})
