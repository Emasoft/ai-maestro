import type { JsonPatch } from './json-patch'

export interface LedgerEntry {
  seq: number
  ts: string
  prevHash: string
  op: 'create' | 'update' | 'delete'
  path: string
  diff: JsonPatch
  signerHostId: string
  signerKeyFingerprint: string
  signature: string
}

export interface LedgerFile {
  version: 1
  entries: LedgerEntry[]
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; seq: number; reason: string }

export interface LedgerStats {
  entryCount: number
  lastSeq: number
  lastTs: string
  rootHash: string
}
