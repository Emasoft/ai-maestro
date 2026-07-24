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
// The MECHANISM (O_EXCL lockfile + pid liveness + stale reclaim, non-blocking) now lives in
// `lib/server-lockfile.ts`, shared with the marketplace/plugin-update chore (TRDD-S5RUHJRP).
// This module is the rotation tick's binding of it: the lock NAME, the stale window, and the
// capture path's blocking-with-timeout variant. The public API is unchanged.

import {
  tryAcquireServerLock,
  tryAcquireServerLockWait,
  withServerLock,
  type ServerLock,
} from '../server-lockfile'

const SERVER_TICK_LOCK_NAME = 'oauth-rotator-server-tick.lock'

// A rotation tick is short (seconds). A lock held longer than this is presumed abandoned by a
// crashed holder and is reclaimed. Generous, so a slow-but-live tick is never stolen from it.
const STALE_LOCK_MS = 5 * 60_000

/** A held tick lock. `release` is idempotent — safe in a `finally` even if never re-acquired. */
export type TickLock = ServerLock

/**
 * Try to acquire the server rotation-tick lock WITHOUT blocking. Returns a {@link TickLock}
 * handle on success, or null when a live holder already has it (skip this tick). Reclaims a
 * lock whose holder is dead or that has gone stale.
 */
export function tryAcquireTickLock(): TickLock | null {
  return tryAcquireServerLock(SERVER_TICK_LOCK_NAME, STALE_LOCK_MS)
}

/**
 * Run `fn` under the server tick lock. If the lock is already held, returns null WITHOUT
 * running `fn` (the tick is skipped this round). Always releases on completion or throw.
 */
export async function withTickLock<T>(fn: () => Promise<T>): Promise<T | null> {
  return withServerLock(SERVER_TICK_LOCK_NAME, STALE_LOCK_MS, fn)
}

/**
 * Acquire the server rotation-tick lock, WAITING up to `timeoutMs` for a current holder to
 * release (polling every `pollMs`). Returns the {@link TickLock} on success, or null on
 * timeout. Unlike {@link tryAcquireTickLock}'s skip-on-contention, this is for the CAPTURE
 * path (`fileSlot`): a freshly captured account must not be silently dropped just because a
 * rotation tick momentarily holds the lock, so it waits — the semantic of rotator.py's
 * `oauth_rotator_lock_wait(timeout_s)` (a blocking-with-timeout flock), realised here as a
 * bounded poll on the server-internal lock (poll latency is why the janitor's kernel flock
 * woke instantly and this does not — immaterial at the 60 s capture timeout).
 */
export async function tryAcquireTickLockWait(
  timeoutMs: number,
  opts: { pollMs?: number } = {},
): Promise<TickLock | null> {
  return tryAcquireServerLockWait(SERVER_TICK_LOCK_NAME, STALE_LOCK_MS, timeoutMs, opts)
}
