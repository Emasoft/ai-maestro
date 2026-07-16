// Server-internal OAuth-rotation tick lock (TRDD-1GGQ4HWY Phase C).
//
// The janitor's Python daemon serialises its rotation ticks with POSIX fcntl.flock(2) on
// `oauth-rotator-tick.lock`. Node.js has no fcntl.flock in its standard library, and an
// O_EXCL/mtime lockfile can NOT interoperate with a kernel flock (both sides would "acquire"),
// so the server cannot faithfully share that lock without a native addon. The USER chose a
// SERVER-INTERNAL lock (2026-07-17) over adding a native dependency under this repo's hard
// Node-22 ABI constraint — consistent with the reframe (the server REPLACES the daemon and is
// the sole live-credential writer in normal operation; the janitor `#J` build delegates to it,
// and the `#N` fallback runs only when the server is DOWN, i.e. not concurrently).
//
// So this lock serialises the SERVER's OWN rotation ticks (a tick must never overlap another
// tick, in this process or a stray second server-family process). Cross-process safety against
// the `#N` fallback is the delegation/presence model, NOT this lock. It deliberately uses a
// DISTINCT filename (`oauth-rotator-server-tick.lock`, never the janitor's
// `oauth-rotator-tick.lock`) so it can never be mistaken for cross-mechanism coordination that
// does not exist.
//
// Mechanism: an O_EXCL lockfile carrying the holder's pid + timestamp. A lock whose holder pid
// is dead, or that is older than STALE_LOCK_MS (a crashed holder that never released), is
// reclaimed. Non-blocking (like the Python LOCK_NB): a caller that cannot get the lock SKIPS
// this round and re-fires on its normal cadence — a rotation tick must never block.

import * as fs from 'fs'
import * as path from 'path'
import { globalStateDir } from './global-state'

const SERVER_TICK_LOCK_NAME = 'oauth-rotator-server-tick.lock'

// A rotation tick is short (seconds). A lock held longer than this is presumed abandoned by a
// crashed holder and is reclaimed. Generous, so a slow-but-live tick is never stolen from it.
const STALE_LOCK_MS = 5 * 60_000

export interface TickLock {
  /** Release the lock (idempotent). Safe to call in a finally even if never acquired again. */
  release(): void
}

function lockPath(): string {
  return path.join(globalStateDir(), SERVER_TICK_LOCK_NAME)
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
function isStale(p: string): boolean {
  let mtimeMs: number
  let content: string
  try {
    mtimeMs = fs.statSync(p).mtimeMs
    content = fs.readFileSync(p, 'utf8')
  } catch {
    return true // vanished / unreadable between checks → let the caller retry the create
  }
  if (Date.now() - mtimeMs > STALE_LOCK_MS) return true // crashed holder never released
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

function makeHandle(p: string): TickLock {
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

/**
 * Try to acquire the server rotation-tick lock WITHOUT blocking. Returns a {@link TickLock}
 * handle on success, or null when a live holder already has it (skip this tick). Reclaims a
 * lock whose holder is dead or that has gone stale.
 */
export function tryAcquireTickLock(): TickLock | null {
  const p = lockPath()
  fs.mkdirSync(path.dirname(p), { recursive: true })

  if (createExclusive(p)) return makeHandle(p)

  // A lockfile exists. Reclaim it if the holder is dead / it went stale, then retry ONCE. If
  // another server-family process wins that reclaim race, our retry gets EEXIST → we skip.
  if (isStale(p)) {
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
 * Run `fn` under the server tick lock. If the lock is already held, returns null WITHOUT
 * running `fn` (the tick is skipped this round). Always releases on completion or throw.
 */
export async function withTickLock<T>(fn: () => Promise<T>): Promise<T | null> {
  const lock = tryAcquireTickLock()
  if (!lock) return null
  try {
    return await fn()
  } finally {
    lock.release()
  }
}
