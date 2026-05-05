import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import type { LedgerEntry, LedgerFile, LedgerStats, VerifyResult, AppendOptions } from '@/types/ledger'
import type { JsonPatch } from '@/types/json-patch'
import { getHostPublicKeyHex, signHostAttestation } from '@/lib/host-keys'
import { acquireLock } from '@/lib/file-lock'
import { getSelfHostId } from '@/lib/hosts-config'
import { verifyWithCurrentOrPrevious } from '@/lib/key-rotation'
import { loadSecurityConfig } from '@/lib/security-config'

const GENESIS_HASH = '0'.repeat(64)

function blake2bTrunc256(data: string): string {
  return crypto.createHash('blake2b512')
    .update(data)
    .digest()
    .subarray(0, 32)
    .toString('hex')
}

/**
 * Canonicalize a ledger entry for hashing + signing.
 *
 * v1 layout (pre-2026-04-20):
 *   [seq, ts, prevHash, op, path, diff, signerHostId, signerKeyFingerprint]
 *
 * v1.1 layout (TRDD-eac02238 — per-op audit):
 *   [seq, ts, prevHash, op, path, diff, signerHostId, signerKeyFingerprint,
 *    authAction, authAgentId, authActor]
 *
 * BACKWARD COMPATIBILITY: if any of `authAction/authAgentId/authActor` is
 * undefined on the entry, the extra fields are OMITTED ENTIRELY (not
 * serialized as null, not as undefined). The resulting canonical array
 * for such entries is identical to what v1 produced. Existing ledger
 * files continue to verify byte-for-byte after this change lands.
 */
function canonicalize(entry: Omit<LedgerEntry, 'signature'>): string {
  const base: unknown[] = [
    entry.seq,
    entry.ts,
    entry.prevHash,
    entry.op,
    entry.path,
    entry.diff,
    entry.signerHostId,
    entry.signerKeyFingerprint,
  ]
  // Only include the auth trio when ANY of them is set. If present, all
  // three are appended in a fixed order so the shape is deterministic.
  // Individual undefined values become null within that trio, but the
  // trio is only added when at least one is defined.
  const hasAuth =
    entry.authAction !== undefined ||
    entry.authAgentId !== undefined ||
    entry.authActor !== undefined
  if (hasAuth) {
    base.push(entry.authAction ?? null, entry.authAgentId ?? null, entry.authActor ?? null)
  }
  return JSON.stringify(base)
}

function computeEntryHash(entry: LedgerEntry): string {
  return blake2bTrunc256(canonicalize(entry) + entry.signature)
}

function hostKeyFingerprint(): string {
  const pubHex = getHostPublicKeyHex()
  return blake2bTrunc256(pubHex).substring(0, 32)
}

export class SignedLedger {
  private readonly filePath: string
  private readonly lockName: string
  private entries: LedgerEntry[] = []
  private loaded = false

  constructor(registryPath: string) {
    const dir = path.dirname(registryPath)
    const base = path.basename(registryPath, path.extname(registryPath))
    this.filePath = path.join(dir, `${base}.ledger.json`)
    this.lockName = `ledger:${base}`
  }

  private ensureLoaded(): void {
    if (this.loaded) return
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8')
      const parsed: LedgerFile = JSON.parse(raw)
      if (parsed.version !== 1) {
        throw new Error(`Unsupported ledger version: ${parsed.version}`)
      }
      this.entries = parsed.entries
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.entries = []
      } else {
        throw err
      }
    }
    this.loaded = true
  }

  private persist(): void {
    const dir = path.dirname(this.filePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    const data: LedgerFile = { version: 1, entries: this.entries }
    const json = JSON.stringify(data, null, 2)
    const tmpPath = `${this.filePath}.tmp.${process.pid}.${Date.now()}`
    fs.writeFileSync(tmpPath, json, { mode: 0o600 })
    fs.renameSync(tmpPath, this.filePath)
  }

  private lastHash(): string {
    if (this.entries.length === 0) return GENESIS_HASH
    return computeEntryHash(this.entries[this.entries.length - 1])
  }

  async append(
    op: LedgerEntry['op'],
    registryPath: string,
    diff: JsonPatch,
    opts?: AppendOptions,
  ): Promise<LedgerEntry> {
    const release = await acquireLock(this.lockName)
    try {
      this.loaded = false
      this.ensureLoaded()

      const partial: Omit<LedgerEntry, 'signature'> = {
        seq: this.entries.length,
        ts: new Date().toISOString(),
        prevHash: this.lastHash(),
        op,
        path: registryPath,
        diff,
        signerHostId: getSelfHostId(),
        signerKeyFingerprint: hostKeyFingerprint(),
        // Only set fields when defined — preserves omit-when-absent
        // canonicalization semantics (see canonicalize() above).
        ...(opts?.authAction !== undefined && { authAction: opts.authAction }),
        ...(opts?.authAgentId !== undefined && { authAgentId: opts.authAgentId }),
        ...(opts?.authActor !== undefined && { authActor: opts.authActor }),
      }

      const signature = signHostAttestation(canonicalize(partial))

      const entry: LedgerEntry = { ...partial, signature }
      this.entries.push(entry)

      const cfg = loadSecurityConfig().ledger
      if (this.entries.length > cfg.maxEntriesPerFile) {
        this.rotateLedger()
      }

      this.persist()
      return entry
    } finally {
      release()
    }
  }

  async verify(): Promise<VerifyResult> {
    const release = await acquireLock(this.lockName)
    try {
      this.loaded = false
      this.ensureLoaded()

      let expectedPrevHash = GENESIS_HASH
      const localFingerprint = hostKeyFingerprint()

      for (let i = 0; i < this.entries.length; i++) {
        const entry = this.entries[i]

        if (entry.prevHash !== expectedPrevHash) {
          return {
            ok: false,
            seq: entry.seq,
            reason: `Hash chain broken at index ${i}: expected prevHash ${expectedPrevHash.substring(0, 16)}…, got ${entry.prevHash.substring(0, 16)}…`,
          }
        }

        if (entry.seq !== i) {
          return {
            ok: false,
            seq: entry.seq,
            reason: `Sequence gap: entry at index ${i} has seq ${entry.seq}`,
          }
        }

        const canon = canonicalize(entry)
        try {
          if (entry.signerKeyFingerprint === localFingerprint) {
            if (!verifyWithCurrentOrPrevious(canon, entry.signature)) {
              return { ok: false, seq: entry.seq, reason: `Invalid signature at index ${i}` }
            }
          }
        } catch {
          return { ok: false, seq: entry.seq, reason: `Signature verification threw at index ${i}` }
        }

        expectedPrevHash = computeEntryHash(entry)
      }

      return { ok: true }
    } finally {
      release()
    }
  }

  // ─── Lock-free read methods (REG-MIN-01) ───────────────────────────────
  // The three read methods below — `stats`, `getEntries`, `getEntriesForPath` —
  // intentionally do NOT acquire `withLock(\`ledger:${this.base}\`, ...)`. They
  // are diagnostic / audit-trail queries, not security-gating reads, and the
  // performance cost of holding the ledger lock for every read would be
  // significant when the ledger contains thousands of entries.
  //
  // Concurrent `append()` calls DO acquire the lock and rebuild
  // `this.entries` after force-reloading. A reader that arrives during an
  // append therefore sees one of two consistent snapshots — never a partial
  // mutation, because `this.entries` is replaced by reference, not patched.
  // That's good enough for stats/audit. The only cost is eventual
  // consistency — a reader may see an entry count that is one or two behind
  // a just-completed append. For the current use cases (admin dashboard,
  // ledger-rotate decision, audit export) that's acceptable.
  //
  // The append-only invariant itself — entries are signed, hashes chain,
  // never mutated — is enforced under the lock in `append()` and `rotateLedger()`.
  // No reader can corrupt the ledger.
  stats(): LedgerStats {
    this.ensureLoaded()
    const last = this.entries[this.entries.length - 1]
    return {
      entryCount: this.entries.length,
      lastSeq: last?.seq ?? -1,
      lastTs: last?.ts ?? '',
      rootHash: this.lastHash(),
    }
  }

  getEntries(): readonly LedgerEntry[] {
    this.ensureLoaded()
    return this.entries
  }

  getEntriesForPath(registryPath: string): LedgerEntry[] {
    this.ensureLoaded()
    return this.entries.filter(e => e.path === registryPath)
  }

  private rotateLedger(): void {
    const cfg = loadSecurityConfig().ledger
    const archivePath = this.filePath.replace('.ledger.json', `.ledger.${Date.now()}.archive.json`)
    const archiveEntries = this.entries.slice(0, this.entries.length - cfg.compactAfterEntries)
    const keepEntries = this.entries.slice(this.entries.length - cfg.compactAfterEntries)

    const archiveData: LedgerFile = { version: 1, entries: archiveEntries }
    const archiveTmp = `${archivePath}.tmp.${process.pid}`
    fs.writeFileSync(archiveTmp, JSON.stringify(archiveData), { mode: 0o600 })
    fs.renameSync(archiveTmp, archivePath)

    this.entries = keepEntries
    console.log(`[signed-ledger] Rotated: archived ${archiveEntries.length} entries to ${path.basename(archivePath)}, keeping ${keepEntries.length}`)
  }
}
