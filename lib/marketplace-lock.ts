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
// already did for `oauth-rotator-tick.lock`. Until then this lock is honest about what it covers.
//
// ⚠ THE RESIDUAL WINDOW IS NOT HYPOTHETICAL, AND IT IS NOT TRACKED — both corrected 2026-08-16
// (TRDD-PE54D95Q). This block used to end "tracked on ai-maestro-janitor#100". That issue is
// CLOSED and is titled "[COORDINATION] ai-maestro absorbs the daemon's functions … need your
// daemon inventory"; the nearest same-numbered neighbour, Emasoft/ai-maestro#100, is a closed
// umbrella list. Measured the same night: TEN open janitor issues, none of them this. So the
// sentence told every reader the gap was somebody's job when no open issue carried it — worse
// than silence, because it stops the next reader from filing.
//
// MEASURED EVIDENCE that the window bites (all from this host, 2026-08-15):
//   • `RefreshAllMarketplaces` failed 12 times between 08-06 and 08-15, each recorded as a bare
//     `Command failed: claude plugin marketplace update` with the CLI's stdout discarded.
//   • The 22:12:22 failure is exactly 1800 s — the refresh timeout — after its own tick's
//     preceding step-0 row, i.e. a timeout kill.
//   • The janitor daemon's own log puts its `marketplace-refresh` at 21:25:23→21:55:31, so it was
//     still running when the server started one at 21:42:22: a 13 min 9 s overlap.
//   • Its durations that day: 1815 s · 84 s · 1134 s · 1254 s · 1808 s. TWO exceed the server's
//     1800 s cap, so contention alone can push a healthy refresh past the kill.
//
// AND THE JANITOR IS NOT AT FAULT — check before blaming it. The server logged NOTHING in hours
// 18, 19 and 20 that day and booted at 21:36:10, so the daemon's 18:45, 20:04 and 21:25 refreshes
// all began while the server was DOWN, which is exactly when it is supposed to own the chore. The
// collision is ours: the server's boot catch-up starts a refresh without checking whether the
// daemon it just displaced is still finishing one. Boot is therefore the HIGHEST-risk moment for
// this window, not a random one — the daemon is active by definition immediately before we start.

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
