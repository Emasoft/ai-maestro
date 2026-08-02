/**
 * The fleet-wide roll-up over statusline observations — the pure half of `GET /api/statusline`.
 *
 * TRDD-D8OYFG35. "How close is this host to its 5-hour limit?" is the question every agent actually
 * has, and no single session can answer it: each one observes the same shared account at a
 * different instant. This aggregates them.
 *
 * ⚠ THE ROLL-UP TAKES THE MAXIMUM, NOT THE NEWEST. Every session on this host bills one account, so
 * in principle they agree; they are sampled at different moments, so in practice they do not. When
 * two snapshots disagree the SAFE reading is the higher percentage — it is the one that says "you
 * are closer to the limit than you thought". Taking the newest instead would let one idle session's
 * stale-but-recently-written record understate a limit that a busy session had already seen climb.
 *
 * ⚠ ONLY FRESH SNAPSHOTS CONTRIBUTE. A session that ended hours ago still has a file, and its last
 * gauge reading is a fact about a window that has since reset. `sessions` lists everything (a
 * caller may legitimately want the history); `rateLimits` is built only from the fresh ones, and
 * `freshSessions` says how many that was — so a roll-up computed from nothing is visibly a roll-up
 * computed from nothing, rather than a confident zero.
 *
 * ⚠ IT LIVES IN A LIB, NOT IN THE ROUTE, AND THAT IS NOT A STYLE CHOICE. A Next.js `route.ts`
 * module's exports are a CLOSED set — the HTTP verbs plus a fixed config list (`dynamic`,
 * `revalidate`, `runtime`, …) — so `export function rollUp` from the route fails the build with
 * *"rollUp is not a valid Route export field"*. `tsc --noEmit` does NOT see it: the constraint is
 * applied by Next.js's own generated route types at build time, so `yarn build` is the only gate
 * that catches it. `tests/governance/route-exports-are-closed.test.ts` now catches it earlier.
 */
import { STATUSLINE_FRESH_MS } from '@/lib/statusline-store'
import type { StatuslineRateWindow, StatuslineRollup, StatuslineSnapshot } from '@/types/statusline'

/** The tighter of two windows, treating "no reading" as no constraint. */
function tighter(a: StatuslineRateWindow | null, b: StatuslineRateWindow | null): StatuslineRateWindow | null {
  if (!a) return b
  if (!b) return a
  return b.usedPercentage > a.usedPercentage ? b : a
}

export function rollUp(snapshots: StatuslineSnapshot[], now = Date.now()): StatuslineRollup {
  const fresh = snapshots.filter((s) => now - s.capturedAt <= STATUSLINE_FRESH_MS)
  return {
    freshSessions: fresh.length,
    totalSessions: snapshots.length,
    rateLimits: {
      fiveHour: fresh.reduce<StatuslineRateWindow | null>((acc, s) => tighter(acc, s.rateLimits?.fiveHour ?? null), null),
      sevenDay: fresh.reduce<StatuslineRateWindow | null>((acc, s) => tighter(acc, s.rateLimits?.sevenDay ?? null), null),
    },
    sessions: snapshots,
  }
}
