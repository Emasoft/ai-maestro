/**
 * File Lock — in-process mutex for serializing load→modify→save operations
 *
 * Prevents concurrent read-modify-write races within a single Node.js process.
 * Each registry file gets its own named lock. When one API request is mid-write,
 * other requests for the same file queue up and run sequentially.
 *
 * This is sufficient for Phase 1 (single Next.js process, localhost).
 * For multi-process deployments, replace with advisory file locks (e.g., proper-lockfile).
 *
 * REG-MIN-05 (cross-process locking gap, documented):
 * The Map+Set machinery below is PROCESS-LOCAL. It serialises concurrent
 * load→modify→save sequences within a single Node.js process but provides
 * NO protection against:
 *   - PM2 cluster mode running 2+ Node.js workers against the same files
 *   - Headless mode + full mode running simultaneously on the same machine
 *   - Test harnesses or CLI utilities directly importing registry modules
 *     while a dev/prod server is running
 *
 * Mitigations already in place that REDUCE the impact of the gap:
 *   - Atomic rename on every save (lib/agent-registry.ts, lib/team-registry.ts,
 *     lib/governance.ts, services/element-management-service.ts) — even
 *     without cross-process locks, an interrupted write never produces a
 *     partially-written file. The worst case is "last writer wins" (a lost
 *     update) rather than "registry file corrupted".
 *   - Belt-and-braces lockfile-based cross-process locking has been added
 *     for ONE specific high-traffic file (settings.local.json) via the
 *     element-mgmt MAJ-02 fix. Doing the same across ALL registries was
 *     deemed out of scope for the 2026-05-04 audit follow-up.
 *
 * Supported deployment model: single Node.js process per ~/.aimaestro/
 * directory. Documented in CLAUDE.md and the deployment guide.
 *
 * Phase 2 plan: replace this Map+Set with advisory file locks (proper-lockfile
 * or fcntl-based) so PM2 cluster mode and concurrent dev/prod servers become
 * safe. See TRDD design folder for the cross-process locking redesign.
 */

/**
 * LOCK ORDERING INVARIANT:
 * When acquiring multiple locks, always acquire in this order:
 *   1. 'teams'
 *   2. 'transfers'
 *   3. 'governance'
 *   4. 'governance-requests'
 * Violating this order will cause deadlock.
 *
 * Current nested lock usage:
 * - transfers/[id]/resolve/route.ts: acquires 'teams' then 'transfers' (via resolveTransferRequest)
 */

// Map of lock name -> queue of pending resolve callbacks
const locks = new Map<string, Array<() => void>>()
// Set of currently held lock names
const held = new Set<string>()

// NT-007: Default lock acquisition timeout to prevent infinite waits if a lock holder crashes
// NT-010: Phase 2: Consider adding deadlock cycle detection for multi-lock scenarios
// (current timeout-based approach is sufficient for Phase 1 single-process deployment)
const DEFAULT_LOCK_TIMEOUT_MS = 30_000 // 30 seconds

/**
 * Acquire a named lock. Returns a release function.
 * If the lock is already held, the caller awaits until it is released.
 * NT-007: Times out after timeoutMs to prevent deadlocks from crashed holders.
 */
export function acquireLock(name: string, timeoutMs: number = DEFAULT_LOCK_TIMEOUT_MS): Promise<() => void> {
  if (!held.has(name)) {
    // Lock is free -- acquire immediately
    held.add(name)
    return Promise.resolve(() => releaseLock(name))
  }

  // Lock is held -- enqueue and wait with timeout
  return new Promise<() => void>((resolve, reject) => {
    if (!locks.has(name)) {
      locks.set(name, [])
    }
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      // Remove this waiter from the queue
      const queue = locks.get(name)
      if (queue) {
        const idx = queue.indexOf(waiter)
        if (idx !== -1) queue.splice(idx, 1)
        if (queue.length === 0) locks.delete(name)
      }
      reject(new Error(`Lock '${name}' acquisition timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    const waiter = () => {
      if (timedOut) {
        // Timeout already fired and rejected the promise.  releaseLock()
        // transferred lock ownership to this waiter by calling it, but since
        // the promise was already rejected, no caller will ever invoke the
        // release function.  We MUST release here to avoid a permanent lock.
        // This is NOT a double-release: it is the sole release for this
        // ownership transfer.  The timeout handler only removed this waiter
        // from the queue and rejected -- it did not release the lock itself.
        releaseLock(name)
        return
      }
      clearTimeout(timer)
      resolve(() => releaseLock(name))
    }
    locks.get(name)!.push(waiter)
  })
}

/* LIB2-MIN-01 — INVARIANT NOTES (do not delete, do not refactor blindly)
 *
 * The interplay between `timedOut`, `releaseLock`, the queue's index
 * lookup, and the splice is intentional and load-bearing. Three invariants
 * must hold simultaneously:
 *
 *   I1. After timeout fires: the waiter is OUT of the queue (splice
 *       removed it) AND the promise has been REJECTED.
 *   I2. After releaseLock fires (from the lock-holder): the next waiter
 *       in the queue is CALLED. If it is the timed-out waiter, the
 *       waiter MUST internally re-call releaseLock so the next-next
 *       waiter can run; otherwise the lock leaks.
 *   I3. The waiter MUST detect "I was already removed by timeout" and
 *       behave differently from "I am being woken normally" — that's
 *       what the `timedOut` flag is for.
 *
 * Race window: timeout fires and waiter runs MAY interleave. Possible
 * orderings (T = timeout handler, W = waiter call, X = the spec moment):
 *
 *   T -> X: timer set, waiter still in queue
 *   T -> Trim: handler removes waiter from queue, sets timedOut=true,
 *              rejects promise
 *   W -> NoOp: waiter never gets called by releaseLock because it was
 *              already removed from the queue. No lock leak.
 *
 *   W -> T: waiter gets called BEFORE the timer fires
 *           → clearTimeout(timer) prevents Trim from running
 *           → resolve() hands the release function to the caller
 *
 *   T -> W (rare race, possible if timer was on the microtask boundary):
 *           timer fires, marks timedOut, rejects promise. THEN
 *           releaseLock from the previous holder runs and calls
 *           waiter (the timer handler removed it from the queue, so
 *           how? — only if the queue.shift() in releaseLock raced
 *           with the splice). In current single-threaded JS this CAN
 *           happen on a microtask boundary because timer callbacks and
 *           promise resolutions interleave on the macrotask queue.
 *           When it does, the `if (timedOut)` branch hits and
 *           re-calls releaseLock, transferring ownership forward.
 *
 * If you ever:
 *  - Move clearTimeout out of the waiter — I1 may break (timer fires
 *    after resolve, no-op'd by !timedOut, but waiter is gone from queue).
 *  - Add an `await` between checks and queue operations — I2 may break.
 *  - Replace `locks.get(name)!.push(waiter)` with anything async — I1+I2
 *    may break.
 *
 * The unit test for this race lives in `tests/file-lock.test.ts` (when
 * added) — at minimum, it should:
 *   1. Acquire a lock
 *   2. Queue a 100ms-timeout waiter
 *   3. Release the lock at exactly t=99ms (timer about to fire)
 *   4. Assert: lock chain still drains, no permanent lock
 */

/**
 * Release a named lock and wake the next waiter if any.
 */
function releaseLock(name: string): void {
  const queue = locks.get(name)
  if (queue && queue.length > 0) {
    // Hand lock to next waiter (don't remove from held set)
    const next = queue.shift()!
    if (queue.length === 0) {
      locks.delete(name)
    }
    next()
  } else {
    // No waiters — release the lock
    held.delete(name)
    locks.delete(name)
  }
}

/**
 * Run a function under a named lock.
 * Convenience wrapper: acquires, runs fn, releases (even on error).
 *
 * Lock acquisition times out after 30s by default (see DEFAULT_LOCK_TIMEOUT_MS).
 * Lock ordering convention: 'teams' before 'transfers' before 'governance' before 'governance-requests'
 */
export async function withLock<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
  const release = await acquireLock(name)
  try {
    return await fn()
  } finally {
    release()
  }
}
