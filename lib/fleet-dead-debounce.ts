// Boot-debounce for the `dead` liveness class (CHN16JXZ / TRDD-SX593MDG D2).
//
// A `dead` agent (the registry expects a running session but its tmux pane is gone) is a
// CRASHED process — but a FRESHLY (re)launched agent looks identical for a moment: its
// session is already registered while its tmux pane has not reappeared YET (the restart
// cycle is exit → poll for the shell → relaunch, ~15-30s). Hard-recovering (relaunch /
// force_restart / resurrect) such an agent would KILL a process that is merely booting. So a
// `dead` agent becomes a HARD-recovery candidate ONLY after it has been continuously observed
// dead for a BOOT WINDOW.
//
// The debounce is measured from FIRST-OBSERVED-DEAD — the only timestamp available, since a
// crashed process whose tmux is gone has no readable start time. It mirrors the OAuth
// supervisor's cookie-leg-since sidecar (TRDD-7DRSIKVZ trackCannotSelfRenew): persist the
// first-seen epoch per agent, prune agents no longer dead, and a dead agent crosses into
// hard-recoverable when `now - firstSeen > windowMs`. Because it is wall-clock based, the
// debounce is robust to the watchdog's scan cadence (a genuine crash stays dead across scans;
// a booting agent reappears within one scan interval and is pruned before it ever crosses).
//
// THIS MODULE ADDS NO ACTUATION. It is the safety GUARD the still-dark, owner-gated Phase-C
// hard actuator MUST consult before it can ever fire. Building the guard ahead of the
// dangerous mechanism is deliberate fail-safe posture — the hard rung cannot be armed
// correctly without it.

import fs from 'node:fs'
import path from 'node:path'
import { statePath } from '@/lib/ecosystem-constants'

/** How long an agent must be continuously observed dead before it is a hard-recovery candidate.
 *  Default 120s — comfortably longer than any boot/restart cycle, short enough that a genuine
 *  crash is confirmed within one extra scan. Override with `AIM_FLEET_DEAD_BOOT_WINDOW_MS`. */
export const DEFAULT_BOOT_WINDOW_MS = Number(process.env.AIM_FLEET_DEAD_BOOT_WINDOW_MS) || 120_000

export interface DeadPartition {
  /** dead PAST the boot window — a genuine crash; a hard-recovery candidate once Phase C is armed. */
  hardRecoverable: string[]
  /** dead but WITHIN the boot window — maybe still booting; suppress hard recovery. */
  debouncing: string[]
  /** the pruned first-seen map to persist (only currently-dead agents survive). */
  nextFirstSeen: Record<string, number>
}

/**
 * PURE: partition the currently-dead agents into those past the boot window vs still debouncing,
 * and compute the pruned first-seen map. `firstSeen[id]` is the epoch (ms) the agent was FIRST
 * observed dead; an agent absent from `firstSeen` is being seen dead for the first time, so its
 * first-seen is `now` (age 0 → always debouncing this round). An agent no longer dead is dropped
 * from `nextFirstSeen` (so a later re-death starts a fresh window — a recovered-then-crashed-again
 * agent is correctly re-debounced, not treated as dead-since-forever).
 */
export function partitionDeadByBootWindow(
  firstSeen: Record<string, number>,
  deadIds: readonly string[],
  now: number,
  windowMs: number = DEFAULT_BOOT_WINDOW_MS,
): DeadPartition {
  const hardRecoverable: string[] = []
  const debouncing: string[] = []
  const nextFirstSeen: Record<string, number> = {}
  for (const id of deadIds) {
    const prior = firstSeen[id]
    const first = typeof prior === 'number' && Number.isFinite(prior) ? prior : now
    nextFirstSeen[id] = first
    if (now - first > windowMs) hardRecoverable.push(id)
    else debouncing.push(id)
  }
  return { hardRecoverable, debouncing, nextFirstSeen }
}

/** The first-seen-dead sidecar path (under ~/.aimaestro). Resolved at call time so a test's
 *  HOME override is honored (the same trap server-tick.ts documents for its flag path). */
export function deadSincePath(): string {
  return statePath('fleet-dead-since.json')
}

export interface TrackDeadDeps {
  windowMs?: number
  /** Sidecar path override — for tests. Defaults to `deadSincePath()`. */
  sidecarPath?: string
}

/**
 * Read the first-seen-dead sidecar, partition the currently-dead set against the boot window, and
 * persist the pruned map. Best-effort I/O: an unreadable/unwritable sidecar degrades to "everyone
 * is being seen dead for the first time" (all debouncing) — NEVER hard-recovers on a read failure,
 * the fail-safe direction. Rewrites the sidecar only when the pruned map differs (retired agents
 * don't leave stale entries; a stable dead set writes nothing).
 */
export function trackDeadDebounce(deadIds: readonly string[], now: number, deps: TrackDeadDeps = {}): DeadPartition {
  const windowMs = deps.windowMs ?? DEFAULT_BOOT_WINDOW_MS
  const sidecar = deps.sidecarPath ?? deadSincePath()
  let firstSeen: Record<string, number> = {}
  try {
    if (fs.existsSync(sidecar) && fs.statSync(sidecar).isFile()) {
      const parsed = JSON.parse(fs.readFileSync(sidecar, 'utf8'))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) firstSeen = parsed as Record<string, number>
    }
  } catch {
    firstSeen = {}
  }
  const part = partitionDeadByBootWindow(firstSeen, deadIds, now, windowMs)
  const sameKeys =
    Object.keys(part.nextFirstSeen).length === Object.keys(firstSeen).length &&
    Object.keys(part.nextFirstSeen).every((k) => firstSeen[k] === part.nextFirstSeen[k])
  if (!sameKeys) {
    try {
      fs.mkdirSync(path.dirname(sidecar), { recursive: true })
      const tmp = sidecar + '.tmp'
      const sorted: Record<string, number> = {}
      for (const k of Object.keys(part.nextFirstSeen).sort()) sorted[k] = part.nextFirstSeen[k]
      fs.writeFileSync(tmp, JSON.stringify(sorted))
      fs.renameSync(tmp, sidecar)
    } catch {
      // observability state only — never break the watchdog tick
    }
  }
  return part
}
