import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import type { LedgerEntry, LedgerFile, LedgerStats, VerifyResult } from '@/types/ledger'
import type { JsonPatch } from '@/types/json-patch'
import { getHostPublicKeyHex, signHostAttestation } from '@/lib/host-keys'
import { acquireLock } from '@/lib/file-lock'
import { getSelfHostId } from '@/lib/hosts-config'

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
    const dir = path.dirname(this.filePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
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

      const partial: Omit<LedgerEntry, 'signature'> = {
        seq: this.entries.length,
        ts: new Date().toISOString(),
        prevHash: this.lastHash(),
        op,
        path: registryPath,
        diff,
        signerHostId: getSelfHostId(),
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

  async verify(): Promise<VerifyResult> {
    const release = await acquireLock(this.lockName)
    try {
      this.loaded = false
      this.ensureLoaded()

      let expectedPrevHash = GENESIS_HASH
      const localFingerprint = hostKeyFingerprint()
      const localPubKeyHex = getHostPublicKeyHex()

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
            const valid = crypto.verify(
              null,
              Buffer.from(canon),
              crypto.createPublicKey({
                key: Buffer.from(localPubKeyHex, 'hex'),
                format: 'der',
                type: 'spki',
              }),
              Buffer.from(entry.signature, 'base64'),
            )
            if (!valid) {
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
