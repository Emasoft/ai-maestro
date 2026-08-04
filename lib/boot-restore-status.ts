import * as fs from 'fs'
import * as path from 'path'
import { statePath } from './ecosystem-constants'

// The persisted stamp that bridges boot-restore to the continuity `status` verb
// (TRDD-JAU1ES1C → TRDD-DXJZM3BW). While `restoreActiveAgentsOnBoot` is walking the fleet the
// host is mid-resurrection, and `status` must be able to say so — otherwise the one verb an agent
// can call reports a transient view as if it were steady state. This module is the ONE owner of
// that bridge: the path, the on-disk shape, the writer and the reader all live here, so the two
// sides can never disagree about the file (One Source of Truth), exactly as `tick-status.ts` owns
// the OAuth-cascade bridge.
//
// WHY A FILE AND NOT AN IN-MEMORY FLAG — this is not a style choice, an in-memory flag CANNOT
// WORK HERE. `server.mjs:2220` imports boot-restore-service at RUNTIME (`await
// import('./services/boot-restore-service.ts')`, transpiled by tsx), while the status route is
// served from the prebuilt `.next` bundle, which carries its OWN copy of every `lib/*.ts` it
// imports. Same process, two module graphs — so a module-level `let inFlight` set by the service
// is invisible to the route, and the bug would be silent: the flag would simply never be true on
// the read side, and the status verb would look correct while reporting nothing.

/** On-disk shape. `pid` is the process that claimed the restore (see `clearBootRestore`); `at` is
 *  the last heartbeat, ISO 8601 — it is REWRITTEN as the walk progresses, not just at the start,
 *  so a long fleet restore does not go stale halfway through its own run. */
interface BootRestoreStatusFile {
  pid: number
  at: string
}

/** A stamp older than this is IGNORED — the reader treats it as "not restoring".
 *
 *  This is the whole reason a crashed restore self-heals. If the server dies mid-walk the
 *  `finally` never runs and the stamp is never cleared; without an age bound the status verb
 *  would answer `restoring` FOREVER, which is worse than the gap it was added to close — a
 *  permanent "wait" that no operator can distinguish from a real one.
 *
 *  The bound is generous against real progress and short against a hang: the writer re-stamps on
 *  every session (each iteration costs a stagger of ~1.5 s plus at most a few seconds of wake
 *  retry/backoff), so a healthy restore of any fleet size refreshes far inside this window. Only
 *  a single wake that hangs for two minutes can age it out — and at that point the restore IS
 *  stuck, so falling back to the live heuristic is the honest answer, not a lost signal. */
const MAX_AGE_S = 120

/** Resolve the stamp path FRESH on every call. `getStateDir()` is anchored on `os.homedir()`, and
 *  a unit test points HOME at a temp dir AFTER this module was imported — the same reason
 *  `tick-status.ts::tickStatusPath` re-resolves rather than caching a module-load constant. */
function bootRestoreStatusPath(): string {
  return statePath('boot-restore-in-flight.json')
}

/**
 * Stamp "a boot restore is in flight, as of now". Called once before the walk and again on every
 * session, so the timestamp is a HEARTBEAT rather than a start marker (see `MAX_AGE_S`).
 *
 * Atomic tmp+rename, and it NEVER throws: this runs on the boot path of an unattended server, and
 * a failed stamp must not abort the restore it is merely describing. The read side already
 * degrades to the live heuristic when the stamp is absent, so the cost of a lost write is one
 * less-informative status answer — never a lost agent.
 */
export function markBootRestoreInFlight(): void {
  try {
    const file = bootRestoreStatusPath()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const payload: BootRestoreStatusFile = { pid: process.pid, at: new Date().toISOString() }
    const tmp = `${file}.tmp.${process.pid}`
    fs.writeFileSync(tmp, JSON.stringify(payload))
    fs.renameSync(tmp, file)
  } catch {
    /* best-effort: an unstamped restore just reports the live heuristic instead of `restoring` */
  }
}

/**
 * Clear the stamp — ONLY if this process is the one that wrote it.
 *
 * The pid guard matters because the clear runs in a `finally`: without it, a process finishing
 * its own restore would delete a stamp another process is still heartbeating, and the status verb
 * would answer `ok` in the middle of a live restore — the exact dishonesty this bridge exists to
 * remove. A foreign or unreadable stamp is therefore LEFT ALONE and aged out by `MAX_AGE_S`,
 * which is the safe direction to fail: a stale `restoring` expires on its own in two minutes,
 * whereas a wrongly-cleared one is simply wrong and nothing recovers it.
 */
export function clearBootRestore(): void {
  try {
    const file = bootRestoreStatusPath()
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { pid?: unknown }
    if (data?.pid !== process.pid) return
    fs.unlinkSync(file)
  } catch {
    /* absent, unreadable, or already gone — nothing to clear, and MAX_AGE_S covers the rest */
  }
}

/**
 * Is a boot restore in flight RIGHT NOW? True only for a stamp that exists, parses, and is FRESH.
 * `false` is the expected steady-state answer (the file exists only during a restore), and every
 * failure mode — absent, garbage, stale — also answers `false`, so the caller falls back to the
 * live view rather than to an error.
 *
 * Pure read: it touches only the stamp file, never the restore. `now()` is ms-since-epoch.
 */
export function isBootRestoreInFlight(opts?: { now?: () => number }): boolean {
  let data: unknown
  try {
    data = JSON.parse(fs.readFileSync(bootRestoreStatusPath(), 'utf8'))
  } catch {
    return false // absent or garbage → not restoring
  }
  if (!data || typeof data !== 'object') return false
  const d = data as { at?: unknown }
  if (typeof d.at !== 'string') return false
  const ts = Date.parse(d.at)
  if (Number.isNaN(ts)) return false
  const nowMs = opts?.now ? opts.now() : Date.now()
  return (nowMs - ts) / 1000 <= MAX_AGE_S
}
