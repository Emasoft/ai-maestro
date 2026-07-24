// The marketplace/plugin-update chore lock (TRDD-S5RUHJRP — Flock-D D4).
//
// Serialises everything that mutates marketplaces or installed plugins — `claude plugin
// marketplace update`, plugin installs/updates — so two server-family processes (the scheduled
// tick and a "Run now" from another process, or a stray second server) can never run the CLI
// against the same plugin cache concurrently. Concurrent `claude plugin` mutations corrupt the
// cache, and the failure is not clean: a half-written marketplace manifest reads as a VALID but
// WRONG catalogue.
//
// SCOPE — read `lib/server-lockfile.ts` before assuming more than this gives: it is a
// SERVER-INTERNAL lock. It does NOT exclude the janitor's Python daemon, which uses a kernel
// `fcntl.flock(2)` on its OWN `marketplace-op.lock` — a lock Node cannot join without a native
// addon (the USER ruled against adding one on 2026-07-17, for the rotation tick; the same
// reasoning binds here). Hence the DISTINCT filename: sharing the janitor's name would look like
// coordination while providing none.
//
// WHY THAT IS ACCEPTABLE: the daemon EXITS when the ai-maestro server owns the host, so in normal
// operation there is no concurrent Python holder — the janitor's own source calls these locks
// "the collision backstop", not the primary mechanism. The residual window is a `#N` standalone
// daemon running while the server is also live. Closing it properly needs the janitor to move
// `marketplace-op.lock` into the FIXED control dir (`~/.claude/janitor-control/`), exactly as it
// already did for `oauth-rotator-tick.lock` — tracked on ai-maestro-janitor#100. Until then this
// lock is honest about what it covers.

import { tryAcquireServerLock, withServerLock, type ServerLock } from './server-lockfile'

/** DISTINCT from the janitor's `marketplace-op.lock` — see the header. */
export const MARKETPLACE_OP_LOCK_NAME = 'marketplace-op-server.lock'

// A full marketplace refresh plus plugin updates across the fleet legitimately runs for minutes
// (the janitor budgets ~10 min for its own bulk refresh). The window is deliberately generous:
// reclaiming a lock from a SLOW BUT LIVE holder would start the second concurrent `claude plugin`
// mutation this lock exists to prevent, whereas an over-long window only DELAYS a maintenance
// chore that is not time-critical. Skew the error toward waiting.
export const MARKETPLACE_STALE_LOCK_MS = 30 * 60_000

/** Try to take the marketplace-op lock without blocking. null ⇒ a live holder has it; the caller
 *  MUST skip this round rather than wait (a maintenance chore never blocks the tick). */
export function tryAcquireMarketplaceLock(): ServerLock | null {
  return tryAcquireServerLock(MARKETPLACE_OP_LOCK_NAME, MARKETPLACE_STALE_LOCK_MS)
}

/** Run `fn` under the marketplace-op lock. Returns null WITHOUT running `fn` when the lock is
 *  held — the next scheduled tick picks the work up. Always releases, including on throw. */
export async function withMarketplaceLock<T>(fn: () => Promise<T>): Promise<T | null> {
  return withServerLock(MARKETPLACE_OP_LOCK_NAME, MARKETPLACE_STALE_LOCK_MS, fn)
}
