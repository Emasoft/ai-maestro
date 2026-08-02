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
import { execSync } from 'child_process'
import { statePath } from './ecosystem-constants'
import { oauthTickEnabled } from './oauth-rotator/server-tick'
import { isAbsorbedDutySchedulerRunning } from '@/services/auto-update-service'

/** The liveness+capability file the server maintains; both janitor backends read it. */
export const SERVER_LIVENESS_FILE = statePath('server-liveness.json')

/** How stale (seconds) a consumer should treat the file before deciding the server is down. */
export const LIVENESS_STALE_AFTER_S = 90

export interface ServerLiveness {
  /** Epoch SECONDS of the last heartbeat. A consumer treats `now - ts > 90` as "server down". */
  ts: number
  /** The server process id (for an optional liveness cross-check). */
  pid: number
  /** Short (12-char) git sha of the RUNNING build — the working-tree-is-production deploy oracle a
   *  consumer reads to answer "is server code X live?" (TRDD-T2DVNWVI). `'unknown'` when neither
   *  git nor `AIM_BUILD_SHA` is available (a packaged install). */
  sha: string
  /** Full git sha (or `'unknown'`). */
  sha_full: string
  /** True when the running working tree had uncommitted TRACKED changes at resolve time — under
   *  working-tree-is-production the sha alone does not fully identify a dirty build. */
  dirty: boolean
  /** The chore classes the server owns+runs RIGHT NOW (honest, live-only — see the file header). */
  capabilities: string[]
}

/**
 * Compute the capability tokens the server can HONESTLY advertise. Each appears ONLY when its chore
 * class is actually live:
 *   - `family-a`         → the OAuth rotator tick is ENABLED (the R16 flag file is present). Reuses
 *                          `oauthTickEnabled()` so the flag name is never duplicated. Absent today
 *                          (the flag is USER-held and absent by default — the rotator ships INERT).
 *   - `singleton-chores` → marketplace-refresh / version-update / user-plugins-update absorption is
 *                          running. Live as of ai-maestro#102 / TRDD-5X3P79Q6 — the absorbed-duty
 *                          scheduler (`services/auto-update-service.ts::startAbsorbedDutyScheduler`)
 *                          is started unconditionally at boot, so its OWN ticking (not the per-host
 *                          "is the janitor installed+armed?" fact it re-checks every tick) is what
 *                          this token reports. It ships WITH `marketplace-op.lock`.
 *   - `fleet-recovery`   → server-internal session-liveness/fleet-stop for harness agents (CHN16JXZ,
 *                          gated on ai-maestro#60). NOT built yet, so not pushed.
 *
 * ⚠ THESE TOKENS GATE NOTHING TODAY — VERIFIED ON BOTH SIDES, 2026-08-02. This docstring used to
 * end "an absent token means the janitor still owns this — the safe default", which describes a
 * PER-TOKEN gating contract. The consumer RETIRED that contract in janitor TRDD-LU0C5KAR (owner
 * directive 2026-07-17: "if the ai-maestro server is running, those chores are its responsibility
 * … any other event is a bug"). Measured, not inferred:
 *
 *   - janitor side: `server_capabilities()` has exactly ONE caller, `server_is_alive`, which
 *     returns `server_capabilities(now) is not None` — the token CONTENT is never inspected, and
 *     its own docstring says so ("deliberately IGNORED");
 *   - our side: nothing reads the tokens back either.
 *
 * So the field is WRITE-ONLY across the whole ecosystem, and the janitor yields ALL absorbed chores
 * on FILE FRESHNESS alone. The correction matters because the old sentence was a trap for the next
 * author: it invites you to add a token believing it gates a chore, when it would gate nothing —
 * silently, and looking exactly like it worked. (That is the "control that reads as correct and
 * does nothing" class the janitor hit three times in one day; see janitor#167.)
 *
 * Keep computing them honestly anyway: they are the ecosystem's only machine-readable statement of
 * what the server actually absorbed, they cost nothing, and janitor#134 is an OPEN proposal to gate
 * on them again — at which point this warning is what tells you the contract changed back.
 */
export function currentCapabilities(deps: {
  oauthEnabled?: () => boolean
  singletonChoresLive?: () => boolean
} = {}): string[] {
  const oauthEnabled = deps.oauthEnabled ?? oauthTickEnabled
  const singletonChoresLive = deps.singletonChoresLive ?? isAbsorbedDutySchedulerRunning
  const caps: string[] = []
  if (oauthEnabled()) caps.push('family-a')
  if (singletonChoresLive()) caps.push('singleton-chores')
  // 'fleet-recovery' is deliberately NOT computed until its chore is live — its owning NPT adds the
  // guard here when it lands (see TRDD-P7RPOR5O STATE).
  return caps
}

/** The running build's git identity — the server-side deploy oracle (TRDD-T2DVNWVI). */
export interface BuildSha {
  sha: string
  sha_full: string
  dirty: boolean
}

/**
 * PURE resolver (no cache, no process globals) — env stamp WINS over git so a packaged build can
 * assert its sha without a `.git`. Exported so a unit test drives it deterministically via injected
 * `env`/`runGit`; `runGit` THROWS when git is unavailable, which is the `'unknown'` fallback path.
 */
export function computeBuildSha(
  env: (name: string) => string | undefined,
  runGit: (args: string) => string,
): BuildSha {
  const envSha = env('AIM_BUILD_SHA')?.trim()
  if (envSha) return { sha: envSha.slice(0, 12), sha_full: envSha, dirty: false }
  try {
    const full = runGit('rev-parse HEAD')
    // A dirty tracked tree means the sha under-describes what is actually running.
    const dirty = runGit('status --porcelain --untracked-files=no').length > 0
    return { sha: full.slice(0, 12), sha_full: full, dirty }
  } catch {
    return { sha: 'unknown', sha_full: 'unknown', dirty: false }
  }
}

let cachedBuildSha: BuildSha | undefined

/**
 * Resolve the running build's git sha ONCE (cached — it cannot change without a restart, so
 * re-resolving on every 30 s heartbeat would be wasted git spawns). Reads `process.env` and runs
 * git in the server's cwd (the install dir under pm2). NEVER throws.
 */
export function resolveBuildSha(): BuildSha {
  if (!cachedBuildSha) {
    cachedBuildSha = computeBuildSha(
      (name) => process.env[name],
      (args) =>
        execSync(`git ${args}`, { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(),
    )
  }
  return cachedBuildSha
}

/** Injected seams so a unit test drives a write deterministically without the clock or real pid. */
export interface WriteServerLivenessDeps {
  now?: () => number
  pid?: number
  capabilities?: () => string[]
  buildSha?: () => BuildSha
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
  const build = (deps.buildSha ?? resolveBuildSha)()
  const payload: ServerLiveness = {
    ts: now(),
    pid,
    sha: build.sha,
    sha_full: build.sha_full,
    dirty: build.dirty,
    capabilities,
  }
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
