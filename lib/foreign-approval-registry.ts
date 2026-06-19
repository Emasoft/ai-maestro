/**
 * Foreign Approval Registry (R34.2 / R35 / R40).
 *
 * File-based CRUD for ~/.aimaestro/foreign-approvals.json — the queue of
 * agent/user AIDs from OTHER hosts awaiting this host's MAESTRO approval.
 *
 * Storage + ledger pattern is cloned byte-for-byte from lib/human-directory.ts:
 *   - lazy SignedLedger (only for the real state dir, not test overrides),
 *   - atomic tmp+rename write at 0o600,
 *   - _prev diff via fast-json-patch,
 *   - corruption-heal-to-empty on SyntaxError (back up the bad file first),
 *   - fire-and-forget ledger append with an AUDIT GAP log on failure.
 *
 * The file is boot-verified (lib/ledger-startup.ts adds its path to
 * LEDGER_PATHS), so a tampered foreign-approval file is caught alongside the
 * other host-signed chains.
 */

import fs from 'fs'
import path from 'path'
import { compare as jsonPatchCompare } from 'fast-json-patch'
import type {
  ForeignApprovalEntry,
  ForeignApprovalFile,
} from '@/types/foreign-approval'
import { isForeignApprovalFile } from '@/types/foreign-approval'
import type { JsonPatch } from '@/types/json-patch'
import { getStateDir } from '@/lib/ecosystem-constants'
import { SignedLedger } from '@/lib/signed-ledger'

// ---------------------------------------------------------------------------
// Storage Paths
// ---------------------------------------------------------------------------

const FOREIGN_APPROVALS_FILENAME = 'foreign-approvals.json'

export function getForeignApprovalsPath(stateDir?: string): string {
  const dir = stateDir ?? getStateDir()
  return path.join(dir, FOREIGN_APPROVALS_FILENAME)
}

/** Lazily-created ledger instance (only for the real state dir, not test overrides). */
let _defaultLedger: SignedLedger | null = null
function getDefaultLedger(): SignedLedger {
  if (!_defaultLedger) {
    _defaultLedger = new SignedLedger(getForeignApprovalsPath())
  }
  return _defaultLedger
}

let _prevEntries: ForeignApprovalEntry[] = []

// ---------------------------------------------------------------------------
// Load / Save
// ---------------------------------------------------------------------------

/**
 * Load all foreign-approval entries. Returns an empty array if the file does
 * not exist or is corrupted (and heals a corrupted file to empty).
 */
export function loadForeignApprovals(stateDir?: string): ForeignApprovalEntry[] {
  const filePath = getForeignApprovalsPath(stateDir)
  try {
    if (!fs.existsSync(filePath)) {
      return []
    }
    const data = fs.readFileSync(filePath, 'utf-8')
    const parsed: unknown = JSON.parse(data)
    // Defense at the trust boundary: only trust a well-shaped file. A
    // structurally-valid-but-wrong file (e.g. version mismatch) reads as empty
    // rather than flowing malformed entries downstream.
    const entries = isForeignApprovalFile(parsed) ? parsed.entries : []
    if (!stateDir) _prevEntries = entries
    return entries
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error('[foreign-approval] CORRUPTION: foreign-approvals.json contains invalid JSON — returning empty.', filePath)
      try {
        const backupPath = filePath + '.corrupted.' + Date.now()
        fs.copyFileSync(filePath, backupPath)
        console.error(`[foreign-approval] Corrupted file backed up to ${backupPath}`)
      } catch { /* best-effort */ }
      // Heal by writing empty.
      saveForeignApprovals([], stateDir)
    } else {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        // TOCTOU: file disappeared between existsSync and readFileSync.
        console.warn('[foreign-approval] foreign-approvals.json disappeared between check and read — returning empty')
      } else {
        console.error(`[foreign-approval] Failed to load foreign approvals (${code ?? 'unknown'}):`, error)
      }
    }
    return []
  }
}

/**
 * Persist foreign-approval entries with atomic write (tmp + rename) and 0o600
 * perms. Records the mutation in the signed ledger for tamper-evident audit.
 */
export function saveForeignApprovals(entries: ForeignApprovalEntry[], stateDir?: string): void {
  const filePath = getForeignApprovalsPath(stateDir)
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const prevForDiff = stateDir ? [] : _prevEntries
  const diff = jsonPatchCompare(prevForDiff, entries) as JsonPatch
  const op = prevForDiff.length === 0 && entries.length > 0
    ? 'create' as const
    : entries.length < prevForDiff.length
      ? 'delete' as const
      : 'update' as const

  const file: ForeignApprovalFile = { version: 1, entries }
  const tmpFile = filePath + '.tmp.' + process.pid
  fs.writeFileSync(tmpFile, JSON.stringify(file, null, 2), { encoding: 'utf-8', mode: 0o600 })
  fs.renameSync(tmpFile, filePath)
  // Belt-and-braces: ensure the final file also has 0o600.
  fs.chmodSync(filePath, 0o600)

  if (!stateDir) {
    _prevEntries = entries
    if (diff.length > 0) {
      getDefaultLedger().append(op, FOREIGN_APPROVALS_FILENAME, diff).catch(err => {
        console.error('[foreign-approval] AUDIT GAP: foreign-approvals mutation NOT recorded in ledger:',
          err instanceof Error ? err.message : err)
      })
    }
  }
}

// ---------------------------------------------------------------------------
// CRUD Operations
// ---------------------------------------------------------------------------

/** List only the pending entries (the approval UI default view). */
export function listPendingForeignApprovals(stateDir?: string): ForeignApprovalEntry[] {
  return loadForeignApprovals(stateDir).filter(e => e.status === 'pending')
}

/** Get a single entry by id (`<fingerprint>@<sourceHostId>`). Returns null if absent. */
export function getForeignApproval(id: string, stateDir?: string): ForeignApprovalEntry | null {
  return loadForeignApprovals(stateDir).find(e => e.id === id) ?? null
}

/**
 * Enqueue (or replace) a pending foreign-approval request. Matched by `entry.id`.
 * A re-request for the same fingerprint@host overwrites the prior entry so a
 * duplicate import does not pile up rows.
 */
export function upsertForeignApproval(entry: ForeignApprovalEntry, stateDir?: string): ForeignApprovalEntry {
  const entries = loadForeignApprovals(stateDir)
  const idx = entries.findIndex(e => e.id === entry.id)
  if (idx >= 0) {
    entries[idx] = entry
  } else {
    entries.push(entry)
  }
  saveForeignApprovals(entries, stateDir)
  return entry
}

/**
 * Apply a partial update to an entry by id. Returns the updated entry, or null
 * if no entry with that id exists. Used by the approve/reject routes to flip
 * status + record decision metadata.
 */
export function updateForeignApproval(
  id: string,
  patch: Partial<ForeignApprovalEntry>,
  stateDir?: string,
): ForeignApprovalEntry | null {
  const entries = loadForeignApprovals(stateDir)
  const idx = entries.findIndex(e => e.id === id)
  if (idx < 0) return null
  // id is immutable — never let a patch rewrite the primary key.
  const updated: ForeignApprovalEntry = { ...entries[idx], ...patch, id: entries[idx].id }
  entries[idx] = updated
  saveForeignApprovals(entries, stateDir)
  return updated
}
