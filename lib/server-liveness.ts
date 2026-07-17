// The auth-free liveness+capability file the ai-maestro server maintains so the janitor's two
// backends coordinate WITHOUT auth (TRDD-P7RPOR5O; coordination on ai-maestro-janitor#100).
//
// WHY a FILE and not the HTTP health endpoint or the frozen CLI: the OUTSIDE janitor daemon (`#N`,
// which manages non-harness agents) has NO `$AID_AUTH`, and the health route 401s unauthenticated.
// A file under ~/.aimaestro that both `#J` (inside the harness) and `#N` (outside) can `stat` is
// the one signal that works for both ends with no credential.
//
// THE LOAD-BEARING RULE (janitor#100): `capabilities` advertises ONLY what the server ACTUALLY owns
// and is RUNNING right now — never what code merely exists. An un-absorbed or INERT chore class is
// simply ABSENT from the list, so the janitor keeps doing it until the server proves ownership. That
// is what makes the whole daemon-absorption a per-class INCREMENTAL HANDOFF with no flag-day: adding
// a capability token BEFORE its chore is live would silence the janitor on a chore nobody runs — the
// exact "nobody does the chore" failure the coordination forbids.

import * as fs from 'fs'
import * as path from 'path'
import { statePath } from './ecosystem-constants'
import { oauthTickEnabled } from './oauth-rotator/server-tick'

/** The liveness+capability file the server maintains; both janitor backends read it. */
export const SERVER_LIVENESS_FILE = statePath('server-liveness.json')

/** How stale (seconds) a consumer should treat the file before deciding the server is down. */
export const LIVENESS_STALE_AFTER_S = 90

export interface ServerLiveness {
  /** Epoch SECONDS of the last heartbeat. A consumer treats `now - ts > 90` as "server down". */
  ts: number
  /** The server process id (for an optional liveness cross-check). */
  pid: number
  /** The chore classes the server owns+runs RIGHT NOW (honest, live-only — see the file header). */
  capabilities: string[]
}

/**
 * Compute the capability tokens the server can HONESTLY advertise. Each appears ONLY when its chore
 * class is actually live:
 *   - `family-a`         → the OAuth rotator tick is ENABLED (the R16 flag file is present). Reuses
 *                          `oauthTickEnabled()` so the flag name is never duplicated. Absent today
 *                          (the flag is USER-held and absent by default — the rotator ships INERT).
 *   - `singleton-chores` → marketplace/user-plugins/version-update absorption is running. NOT built
 *                          yet, so intentionally NOT pushed (a token without its live chore silences
 *                          the janitor on work nobody does). It ships WITH `marketplace-op.lock`.
 *   - `fleet-recovery`   → server-internal session-liveness/fleet-stop for harness agents (CHN16JXZ,
 *                          gated on ai-maestro#60). NOT built yet, so not pushed.
 * An absent token means "the janitor still owns this" — the safe default.
 */
export function currentCapabilities(deps: { oauthEnabled?: () => boolean } = {}): string[] {
  const oauthEnabled = deps.oauthEnabled ?? oauthTickEnabled
  const caps: string[] = []
  if (oauthEnabled()) caps.push('family-a')
  // 'singleton-chores' and 'fleet-recovery' are deliberately NOT computed until their chores are
  // live — their owning NPTs add the guard here when they land (see TRDD-P7RPOR5O STATE).
  return caps
}

/** Injected seams so a unit test drives a write deterministically without the clock or real pid. */
export interface WriteServerLivenessDeps {
  now?: () => number
  pid?: number
  capabilities?: () => string[]
}

/**
 * Atomically write the liveness file (tmp + rename) and NEVER throw. A failed heartbeat must not
 * crash the server (it runs unattended on a timer), so a write error is logged and swallowed; the
 * next beat retries. Re-resolves the path via `statePath(basename(...))` on every call so a unit
 * test that repoints HOME in `beforeEach` (after this module was imported) writes to the temp HOME
 * — the exact idiom `server-tick.ts::oauthTickEnabled` uses.
 */
export function writeServerLiveness(deps: WriteServerLivenessDeps = {}): void {
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000))
  const pid = deps.pid ?? process.pid
  const capabilities = (deps.capabilities ?? currentCapabilities)()
  const payload: ServerLiveness = { ts: now(), pid, capabilities }
  const dest = statePath(path.basename(SERVER_LIVENESS_FILE))
  const tmp = `${dest}.tmp.${pid}`
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify(payload))
    fs.renameSync(tmp, dest) // atomic on POSIX — a reader never sees a half-written file.
  } catch (err) {
    console.warn(`[server-liveness] heartbeat write failed (non-fatal): ${(err as Error)?.message ?? err}`)
    try {
      fs.rmSync(tmp, { force: true })
    } catch {
      /* best effort — the tmp file is orphaned at worst, overwritten next beat */
    }
  }
}

export interface StartServerLivenessOptions {
  /** Beat interval in ms. Default 30000 — a third of the 90 s staleness consumers apply. */
  intervalMs?: number
}

/**
 * Start the liveness heartbeat and return a stop function. Writes ONCE immediately (so the file
 * exists the instant the server is up), then every `intervalMs`. Safe to start unconditionally at
 * boot — the honesty lives inside `currentCapabilities`, so a server with nothing absorbed simply
 * advertises `capabilities: []` and the janitor keeps every chore. The timer is `unref`'d so it
 * never keeps the process alive nor delays shutdown.
 */
export function startServerLiveness(opts: StartServerLivenessOptions = {}): () => void {
  const intervalMs = opts.intervalMs ?? 30_000
  writeServerLiveness()
  const timer = setInterval(() => {
    writeServerLiveness()
  }, intervalMs)
  timer.unref()
  return () => clearInterval(timer)
}
