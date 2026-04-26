/**
 * Human Directory — File-based CRUD for VPN human user entries.
 *
 * Storage: ~/.aimaestro/humans.json (or overridden via stateDir param for tests)
 * Pattern: Same atomic-write + signed-ledger approach as lib/group-registry.ts
 */

import fs from 'fs'
import path from 'path'
import { compare as jsonPatchCompare } from 'fast-json-patch'
import type { HumanEntry, HumanDirectoryFile } from '@/types/human-directory'
import type { JsonPatch } from '@/types/json-patch'
import { getStateDir } from '@/lib/ecosystem-constants'
import { SignedLedger } from '@/lib/signed-ledger'

// ---------------------------------------------------------------------------
// Storage Paths
// ---------------------------------------------------------------------------

const HUMANS_FILENAME = 'humans.json'

function getHumansFilePath(stateDir?: string): string {
  const dir = stateDir ?? getStateDir()
  return path.join(dir, HUMANS_FILENAME)
}

/** Lazily-created ledger instance (only for the real state dir, not test overrides) */
let _defaultLedger: SignedLedger | null = null
function getDefaultLedger(): SignedLedger {
  if (!_defaultLedger) {
    _defaultLedger = new SignedLedger(getHumansFilePath())
  }
  return _defaultLedger
}

let _prevHumans: HumanEntry[] = []

// ---------------------------------------------------------------------------
// Load / Save
// ---------------------------------------------------------------------------

/**
 * Load all human entries from the directory file.
 * Returns an empty array if the file does not exist or is corrupted.
 */
export function loadHumans(stateDir?: string): HumanEntry[] {
  const filePath = getHumansFilePath(stateDir)
  try {
    if (!fs.existsSync(filePath)) {
      return []
    }
    const data = fs.readFileSync(filePath, 'utf-8')
    const parsed: HumanDirectoryFile = JSON.parse(data)
    const humans = Array.isArray(parsed.humans) ? parsed.humans : []
    if (!stateDir) _prevHumans = humans
    return humans
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error('[human-directory] CORRUPTION: humans.json contains invalid JSON — returning empty.', filePath)
      // Backup corrupted file
      try {
        const backupPath = filePath + '.corrupted.' + Date.now()
        fs.copyFileSync(filePath, backupPath)
        console.error(`[human-directory] Corrupted file backed up to ${backupPath}`)
      } catch { /* best-effort */ }
      // Heal by writing empty
      saveHumans([], stateDir)
    } else {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        // TOCTOU: file disappeared between existsSync and readFileSync
        console.warn('[human-directory] humans.json disappeared between check and read — returning empty')
      } else {
        console.error(`[human-directory] Failed to load humans (${code ?? 'unknown'}):`, error)
      }
    }
    return []
  }
}

/**
 * Persist human entries to disk with atomic write (tmp + rename) and 0o600 perms.
 * Records the mutation in the signed ledger for tamper-evident audit.
 */
export function saveHumans(humans: HumanEntry[], stateDir?: string): void {
  const filePath = getHumansFilePath(stateDir)
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  const prevForDiff = stateDir ? [] : _prevHumans
  const diff = jsonPatchCompare(prevForDiff, humans) as JsonPatch
  const op = prevForDiff.length === 0 && humans.length > 0
    ? 'create' as const
    : humans.length < prevForDiff.length
      ? 'delete' as const
      : 'update' as const

  const file: HumanDirectoryFile = { version: 1, humans }
  const tmpFile = filePath + '.tmp.' + process.pid
  fs.writeFileSync(tmpFile, JSON.stringify(file, null, 2), { encoding: 'utf-8', mode: 0o600 })
  fs.renameSync(tmpFile, filePath)
  // Ensure final file also has correct perms (rename preserves tmp perms on most
  // POSIX systems, but belt-and-braces)
  fs.chmodSync(filePath, 0o600)

  if (!stateDir) {
    _prevHumans = humans
    if (diff.length > 0) {
      getDefaultLedger().append(op, 'humans.json', diff).catch(err => {
        console.error('[signed-ledger] AUDIT GAP: humans mutation NOT recorded in ledger:',
          err instanceof Error ? err.message : err)
      })
    }
  }
}

// ---------------------------------------------------------------------------
// CRUD Operations
// ---------------------------------------------------------------------------

/**
 * Get a single human entry by id (`<userName>@<hostId>`).
 * Returns null if not found.
 */
export function getHuman(id: string, stateDir?: string): HumanEntry | null {
  const humans = loadHumans(stateDir)
  return humans.find(h => h.id === id) ?? null
}

/**
 * Insert or update a human entry. Matched by `entry.id`.
 * If an entry with the same id exists, it is replaced (preserving createdAt).
 * Otherwise a new entry is appended.
 */
export function upsertHuman(entry: HumanEntry, stateDir?: string): void {
  const humans = loadHumans(stateDir)
  const idx = humans.findIndex(h => h.id === entry.id)
  if (idx >= 0) {
    // Preserve original createdAt
    const existing = humans[idx]
    humans[idx] = { ...entry, createdAt: existing.createdAt ?? entry.createdAt }
  } else {
    humans.push({ ...entry, createdAt: entry.createdAt ?? new Date().toISOString() })
  }
  saveHumans(humans, stateDir)
}
