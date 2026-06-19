/**
 * User Registry — File-based CRUD for human-user persistence (R36/R37/R38).
 *
 * Storage: ~/.aimaestro/users.json
 * Mirrors lib/team-registry.ts: withLock('users', …) serialization, atomic
 * temp-file-then-rename writes, and a module-level SignedLedger that records
 * every mutation (R34 — the ledger is the ultimate source of truth).
 *
 * This registry is the authority for human users (NOT agents — those live in
 * lib/agent-registry.ts). The MAESTRO / MAESTRO-DELEGATE / user titles and the
 * R37.2 "delegate suspends maestro" rule are encapsulated here so callers never
 * recompute "who is the active maestro".
 *
 * IMPORTANT: this entire registry is meaningful only when the user-authority
 * model is ENABLED (governance.userAuthorityModelEnabled). With the model OFF
 * the file is never populated (the one-shot migration in lib/governance.ts is
 * gated on the flag), so getActiveMaestroUserId() returns null and every gate
 * that consults it falls back to legacy behavior.
 */

import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { compare as jsonPatchCompare } from 'fast-json-patch'
import type { UserRecord, UsersFile } from '@/types/user'
import type { JsonPatch } from '@/types/json-patch'
import { withLock } from '@/lib/file-lock'
import { getStateDir } from '@/lib/ecosystem-constants'
import { SignedLedger } from '@/lib/signed-ledger'

const AIMAESTRO_DIR = getStateDir()
const USERS_FILE = path.join(AIMAESTRO_DIR, 'users.json')
const usersLedger = new SignedLedger(USERS_FILE)

// REG-MIN-03 pattern (mirrors team-registry): previous-snapshot reference for
// the jsonPatch diff. Re-read from disk inside withLock before every write so a
// concurrent process can't make this stale (saveUser reloads first).
let _prevUsers: UserRecord[] = []

function ensureAimaestroDir(): void {
  if (!fs.existsSync(AIMAESTRO_DIR)) {
    fs.mkdirSync(AIMAESTRO_DIR, { recursive: true })
  }
}

/**
 * Load all user records (including soft-deleted ones, which keep their
 * deletedAt tombstone — the cemetery soft-delete model, R39.6). Returns []
 * when the file does not exist yet.
 */
export function loadUsers(): UserRecord[] {
  try {
    ensureAimaestroDir()
    if (!fs.existsSync(USERS_FILE)) {
      // No file yet → the diff base is empty. Reset _prevUsers so a stale
      // snapshot from a prior load (or a deleted file) can't make the first
      // write's diff/op wrong.
      _prevUsers = []
      return []
    }
    const data = fs.readFileSync(USERS_FILE, 'utf-8')
    const parsed: UsersFile = JSON.parse(data)
    const users = Array.isArray(parsed.users) ? parsed.users : []
    // REG-MIN-03 (R34 ledger integrity): the previous-snapshot used for the
    // jsonPatch diff MUST be an INDEPENDENT copy, not the same reference we
    // return. saveUser mutates the returned array in place (`users[idx] = rec`),
    // and if `_prevUsers` aliased that array the diff would compare an array to
    // itself → empty → the ledger would silently MISS every update. Deep-clone
    // the snapshot so an in-place mutation of the returned array never corrupts
    // the diff base. JSON round-trip is sufficient — UserRecord is plain data.
    _prevUsers = JSON.parse(data).users ?? []
    return users
  } catch (error: unknown) {
    // ENOENT is expected before the first user is created — return empty.
    // All other errors (JSON parse failure, permission denied) indicate real
    // problems and must propagate so they are never silently masked.
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }
}

/** Atomic write of the full user list + ledger append (mirrors saveTeams). */
function writeUsers(users: UserRecord[]): void {
  ensureAimaestroDir()

  const diff = jsonPatchCompare(_prevUsers, users) as JsonPatch
  const op = _prevUsers.length === 0 && users.length > 0
    ? 'create' as const
    : users.length < _prevUsers.length
      ? 'delete' as const
      : 'update' as const

  const file: UsersFile = { version: 1, users }
  const tmpFile = USERS_FILE + '.tmp.' + process.pid
  fs.writeFileSync(tmpFile, JSON.stringify(file, null, 2), 'utf-8')
  fs.renameSync(tmpFile, USERS_FILE)
  _prevUsers = users

  if (diff.length > 0) {
    usersLedger.append(op, 'users/users.json', diff).catch(err => {
      console.error('[signed-ledger] AUDIT GAP: users mutation NOT recorded in ledger:', err instanceof Error ? err.message : err)
    })
  }
}

/** Get a single ACTIVE (non-soft-deleted) user by id, or null. */
export function getUser(id: string): UserRecord | null {
  if (!id) return null
  const u = loadUsers().find(u => u.id === id)
  return u && !u.deletedAt ? u : null
}

/** Get a single ACTIVE user by AID, or null (R34/R36 — AID is the identity). */
export function getUserByAid(aid: string): UserRecord | null {
  if (!aid) return null
  const u = loadUsers().find(u => u.aid === aid)
  return u && !u.deletedAt ? u : null
}

/** Get a single ACTIVE user by display name (case-sensitive), or null. */
export function getUserByName(name: string): UserRecord | null {
  if (!name) return null
  const u = loadUsers().find(u => u.name === name)
  return u && !u.deletedAt ? u : null
}

/**
 * Insert or update a user record (keyed by id). Serialized via withLock and
 * re-reads the current list inside the lock so concurrent saves cannot lose
 * each other's writes.
 */
export async function saveUser(rec: UserRecord): Promise<UserRecord> {
  return withLock('users', () => {
    const users = loadUsers()
    const idx = users.findIndex(u => u.id === rec.id)
    if (idx >= 0) {
      users[idx] = rec
    } else {
      users.push(rec)
    }
    writeUsers(users)
    return rec
  })
}

/**
 * Soft-delete a user (sets deletedAt). R39.6: deleting the USER cascades a soft
 * delete to that user's bound ASSISTANT agent — the ASSISTANT cannot be deleted
 * independently and must not outlive its user. The cascade delegates to the
 * agent-registry's soft-delete via a runtime require (avoids a module cycle and
 * keeps user-registry free of an agent-registry static import).
 *
 * Returns the updated record, or null if the user did not exist / was already
 * deleted.
 */
export async function softDeleteUser(id: string): Promise<UserRecord | null> {
  const updated = await withLock('users', () => {
    const users = loadUsers()
    const idx = users.findIndex(u => u.id === id)
    if (idx < 0 || users[idx].deletedAt) return null
    users[idx] = { ...users[idx], deletedAt: new Date().toISOString() }
    writeUsers(users)
    return users[idx]
  })
  if (!updated) return null

  // R39.6 cascade: soft-delete the bound ASSISTANT agent. agent-registry's
  // deleteAgent(id, hard=false) IS the soft delete (tombstone, recoverable from
  // the cemetery). Best-effort — a failure here is logged but does not un-delete
  // the user (the user delete is the authoritative action; an orphaned ASSISTANT
  // is surfaced for cleanup). Runtime require avoids a module-load cycle.
  if (updated.assistantAgentId) {
    try {
      const agentRegistry = require('./agent-registry') as typeof import('./agent-registry')
      await agentRegistry.deleteAgent(updated.assistantAgentId, false)
    } catch (err) {
      console.error('[user-registry] R39.6 ASSISTANT cascade-delete failed for', updated.assistantAgentId, '—', err instanceof Error ? err.message : err)
    }
  }
  return updated
}

/**
 * The id of the user whose title is currently authoritative for MAESTRO powers
 * — scanning ONLY the user list (no governance.json read). R37.2: a
 * maestro-delegate SUSPENDS the maestro, so when a delegate exists it is the
 * active maestro; otherwise the maestro is. Returns null when neither exists.
 *
 * This is the list-only primitive used by the governance migration (which must
 * not re-enter loadGovernance). Most callers should use getActiveMaestroUserId.
 */
export function getActiveMaestroUserIdFromList(): string | null {
  const users = loadUsers().filter(u => !u.deletedAt)
  const delegate = users.find(u => u.title === 'maestro-delegate')
  if (delegate) return delegate.id
  const maestro = users.find(u => u.title === 'maestro')
  return maestro ? maestro.id : null
}

/**
 * The id of the currently-acting MAESTRO (R37.2 invariant, encapsulated so
 * callers never compute it): the delegate's id when a delegate exists (the
 * delegate suspends the maestro), else the maestro's id, else null.
 */
export function getActiveMaestroUserId(): string | null {
  return getActiveMaestroUserIdFromList()
}

/** The id of the active MAESTRO-DELEGATE user (R37.2), or null when none. */
export function getMaestroDelegateUserId(): string | null {
  const u = loadUsers().find(u => u.title === 'maestro-delegate' && !u.deletedAt)
  return u ? u.id : null
}

/** The id of the (possibly suspended) MAESTRO user, or null. R37.2: this is the
 *  ORIGINAL maestro regardless of an active delegate. */
export function getMaestroUserId(): string | null {
  const u = loadUsers().find(u => u.title === 'maestro' && !u.deletedAt)
  return u ? u.id : null
}

/**
 * Create the first MAESTRO user from the legacy single-user fields. Used ONLY
 * by the one-shot governance migration (R36/R37). Does NOT take the lock — the
 * caller (loadGovernance) already holds the synchronous single-threaded path
 * and writes the governance pointer; saveUser would re-enter loadGovernance via
 * its own lock acquisition. We therefore write synchronously here.
 */
export function createMaestroFromLegacy(legacy: {
  name: string
  avatar?: string
  passwordHash: string | null
  passwordSetAt: string | null
}): UserRecord {
  const now = new Date().toISOString()
  const rec: UserRecord = {
    id: uuidv4(),
    aid: '', // populated when the user's AID is registered; empty = not yet bound
    name: legacy.name,
    avatar: legacy.avatar,
    title: 'maestro',
    native: true,
    passwordHash: legacy.passwordHash,
    passwordSetAt: legacy.passwordSetAt,
    assistantAgentId: null, // MAESTRO uses the MANAGER agent — no ASSISTANT (R39.1)
    createdAt: now,
  }
  const users = loadUsers()
  users.push(rec)
  writeUsers(users)
  return rec
}
