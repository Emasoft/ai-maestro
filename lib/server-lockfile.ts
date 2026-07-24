// Generic SERVER-INTERNAL lockfile in the janitor's machine-wide global-state dir
// (extracted from oauth-rotator/tick-lock.ts, TRDD-S5RUHJRP — the mechanism is now shared by the
// rotation tick and the marketplace/plugin-update chore).
//
// ─── READ THIS BEFORE USING IT FOR CROSS-PROCESS COORDINATION: IT CANNOT DO THAT ───
//
// The janitor's Python daemon serialises with POSIX `fcntl.flock(2)`. Node.js has no flock in its
// standard library, and an O_EXCL lockfile CANNOT interoperate with a kernel flock — both sides
// would happily "acquire" and neither would exclude the other. Sharing the janitor's lock would
// need a native addon, which this repo's hard Node-22 ABI constraint rules out (node-pty and
// better-sqlite3 already pin the runtime; a third native dep is a third way to break PTY).
//
// The USER ruled on exactly this trade-off on 2026-07-17, for the rotation tick: take a
// SERVER-INTERNAL lock rather than add a native dependency. That ruling generalises here, and so
// does its safety argument — the server REPLACES the daemon (the daemon EXITS when the server owns
// the host), so in normal operation there is no concurrent Python holder to exclude. The janitor's
// own source calls its locks "the collision backstop", not the primary mechanism.
//
// CONSEQUENCE, AND WHY THE FILENAME MATTERS: every lock taken through this module MUST use a name
// DISTINCT from the janitor's own (`oauth-rotator-server-tick.lock`, never `oauth-rotator-tick.lock`;
// `marketplace-op-server.lock`, never `marketplace-op.lock`). Sharing the janitor's filename would
// LOOK like cross-process coordination while providing none — the most dangerous kind of bug,
// because it is silent and it reads as correct. The distinct name makes the absence honest and
// greppable.
//
// Mechanism: an O_EXCL lockfile carrying the holder's pid + timestamp. A lock whose holder pid is
// dead, or that is older than its stale window (a crashed holder that never released), is
// reclaimed. Non-blocking by default (like Python's LOCK_NB): a caller that cannot get the lock
// SKIPS this round and re-fires on its normal cadence.

import * as fs from 'fs'
import * as path from 'path'
import { globalStateDir } from './oauth-rotator/global-state'

/** A held lock. `release` is idempotent — safe in a `finally` that may run twice. */
export interface ServerLock {
  release(): void
}

/** True iff pid is a live process (EPERM means alive but not ours → still alive). */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** True iff an existing lockfile is reclaimable: unreadable, corrupt, too old, or its holder
 * pid is dead. A fresh lock held by a live pid returns false (genuinely held). */
function isStale(p: string, staleMs: number): boolean {
  let mtimeMs: number
  let content: string
  try {
    mtimeMs = fs.statSync(p).mtimeMs
    content = fs.readFileSync(p, 'utf8')
  } catch {
    return true // vanished / unreadable between checks → let the caller retry the create
  }
  if (Date.now() - mtimeMs > staleMs) return true // crashed holder never released
  const pid = parseInt(content.split('\t')[0], 10)
  if (!Number.isInteger(pid) || pid <= 0) return true // empty / corrupt file → reclaim
  return !pidAlive(pid)
}

/** Attempt an exclusive create of the lockfile. Returns true iff THIS call created it. */
function createExclusive(p: string): boolean {
  let fd: number
  try {
    fd = fs.openSync(p, 'wx') // O_CREAT | O_EXCL — fails EEXIST if a holder already exists
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw e
  }
  try {
    fs.writeSync(fd, `${process.pid}\t${new Date().toISOString()}\n`)
  } finally {
    fs.closeSync(fd) // always close, even if the write throws (leaves an empty → stale lock)
  }
  return true
}

function makeHandle(p: string): ServerLock {
  let released = false
  return {
    release() {
      if (released) return
      released = true
      try {
        fs.rmSync(p)
      } catch {
        // already gone (reclaimed as stale, or removed) — nothing to do
      }
    },
  }
}

/** Absolute path of a named server lock. Always inside the janitor's global-state dir, so a
 *  human debugging a stuck chore finds every lock in ONE place. */
export function serverLockPath(name: string): string {
  return path.join(globalStateDir(), name)
}

/**
 * Try to acquire a named server lock WITHOUT blocking. Returns a handle on success, or null when
 * a live holder already has it (skip this round). Reclaims a lock whose holder is dead or stale.
 */
export function tryAcquireServerLock(name: string, staleMs: number): ServerLock | null {
  const p = serverLockPath(name)
  fs.mkdirSync(path.dirname(p), { recursive: true })

  if (createExclusive(p)) return makeHandle(p)

  // A lockfile exists. Reclaim it if the holder is dead / it went stale, then retry ONCE. If
  // another server-family process wins that reclaim race, our retry gets EEXIST → we skip.
  if (isStale(p, staleMs)) {
    try {
      fs.rmSync(p)
    } catch {
      // someone else reclaimed it first — the create below decides the winner
    }
    if (createExclusive(p)) return makeHandle(p)
  }
  return null
}

/**
 * Run `fn` under a named server lock. If the lock is already held, returns null WITHOUT running
 * `fn` (this round is skipped). Always releases on completion or throw.
 */
export async function withServerLock<T>(
  name: string,
  staleMs: number,
  fn: () => Promise<T>,
): Promise<T | null> {
  const lock = tryAcquireServerLock(name, staleMs)
  if (!lock) return null
  try {
    return await fn()
  } finally {
    lock.release()
  }
}

/**
 * Acquire a named server lock, WAITING up to `timeoutMs` for a current holder to release (polling
 * every `pollMs`). Returns the handle, or null on timeout. For callers whose work must not be
 * silently dropped merely because a periodic tick momentarily holds the lock.
 */
export async function tryAcquireServerLockWait(
  name: string,
  staleMs: number,
  timeoutMs: number,
  opts: { pollMs?: number } = {},
): Promise<ServerLock | null> {
  const pollMs = Math.max(1, opts.pollMs ?? 50)
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const lock = tryAcquireServerLock(name, staleMs)
    if (lock) return lock
    if (Date.now() >= deadline) return null
    await new Promise(resolve => setTimeout(resolve, pollMs))
  }
}
