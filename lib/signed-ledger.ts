import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import type { LedgerEntry, LedgerFile, LedgerStats, VerifyResult } from '@/types/ledger'
import type { JsonPatch } from '@/types/json-patch'
import { getOrCreateHostKeyPair, getHostPublicKeyHex, signHostAttestation } from '@/lib/host-keys'
import { acquireLock } from '@/lib/file-lock'

const GENESIS_HASH = '0'.repeat(64)

function blake2b256(data: string): string {
  return crypto.createHash('blake2b512')
    .update(data)
    .digest()
    .subarray(0, 32)
    .toString('hex')
}

function canonicalize(entry: Omit<LedgerEntry, 'signature'>): string {
  return JSON.stringify([
    entry.seq,
    entry.ts,
    entry.prevHash,
    entry.op,
    entry.path,
    entry.diff,
    entry.signerHostId,
    entry.signerKeyFingerprint,
  ])
}

function computeEntryHash(entry: LedgerEntry): string {
  return blake2b256(canonicalize(entry) + entry.signature)
}

function hostKeyFingerprint(): string {
  const pubHex = getHostPublicKeyHex()
  return blake2b256(pubHex).substring(0, 16)
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
    const data: LedgerFile = { version: 1, entries: this.entries }
    const json = JSON.stringify(data, null, 2)
    const tmpPath = `${this.filePath}.tmp.${process.pid}`
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
  ): Promise<LedgerEntry> {
    const release = await acquireLock(this.lockName)
    try {
      this.loaded = false
      this.ensureLoaded()

      const { publicKeyHex } = getOrCreateHostKeyPair()
      const hostId = blake2b256(publicKeyHex).substring(0, 16)

      const partial: Omit<LedgerEntry, 'signature'> = {
        seq: this.entries.length,
        ts: new Date().toISOString(),
        prevHash: this.lastHash(),
        op,
        path: registryPath,
        diff,
        signerHostId: hostId,
        signerKeyFingerprint: hostKeyFingerprint(),
      }

      const signature = signHostAttestation(canonicalize(partial))

      const entry: LedgerEntry = { ...partial, signature }
      this.entries.push(entry)
      this.persist()
      return entry
    } finally {
      release()
    }
  }

  verify(): VerifyResult {
    this.loaded = false
    this.ensureLoaded()

    let expectedPrevHash = GENESIS_HASH

    for (const entry of this.entries) {
      if (entry.prevHash !== expectedPrevHash) {
        return {
          ok: false,
          seq: entry.seq,
          reason: `Hash chain broken: expected prevHash ${expectedPrevHash}, got ${entry.prevHash}`,
        }
      }

      if (entry.seq !== this.entries.indexOf(entry)) {
        return {
          ok: false,
          seq: entry.seq,
          reason: `Sequence gap: entry at index ${this.entries.indexOf(entry)} has seq ${entry.seq}`,
        }
      }

      const canon = canonicalize(entry)
      try {
        const pubHex = entry.signerKeyFingerprint
        // Signature verification requires the signer's full public key.
        // For local-host verification we use our own key; for remote
        // entries a key-registry lookup would be needed (Phase 2).
        const localFingerprint = hostKeyFingerprint()
        if (pubHex === localFingerprint) {
          const pubKeyHex = getHostPublicKeyHex()
          const valid = crypto.verify(
            null,
            Buffer.from(canon),
            crypto.createPublicKey({
              key: Buffer.from(pubKeyHex, 'hex'),
              format: 'der',
              type: 'spki',
            }),
            Buffer.from(entry.signature, 'base64'),
          )
          if (!valid) {
            return { ok: false, seq: entry.seq, reason: 'Invalid signature' }
          }
        }
        // Remote entries: signature check deferred to Phase 2 (key registry)
      } catch {
        return { ok: false, seq: entry.seq, reason: 'Signature verification threw' }
      }

      expectedPrevHash = computeEntryHash(entry)
    }

    return { ok: true }
  }

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
}
