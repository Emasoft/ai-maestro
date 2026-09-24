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
import { activeAbsorbedChores, CONDITIONAL_CHORES, registerChoreClaimPredicate } from './janitor-chore-stamp'
import type { AbsorbedChore } from './janitor-chore-stamp'
import { oauthTickEnabled } from './oauth-rotator/server-tick'
import { isAbsorbedDutySchedulerRunning } from '@/services/auto-update-service'
import { isGithubConfigAuditSchedulerRunning } from './github-config-audit'
import { isCachePruneSchedulerRunning } from './cache-prune'
import { isFleetPluginsUpdateSchedulerRunning } from './fleet-plugins-update'

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
  /**
   * The janitor-registry names of the daemon chores THIS server absorbs — `activeAbsorbedChores()`:
   * the unconditional `ABSORBED_CHORES` plus every default-OFF conditional lane that is armed AND
   * running right now (TRDD-4QOWVSLU: `memory-guard` under `AIM_MEMORY_GUARD=1`) (`Emasoft/ai-maestro#111` asks us to "expose which chores the server claims").
   *
   * UNLIKE `capabilities`, THIS FIELD IS MEANT TO BE READ. `capabilities` is write-only across the
   * ecosystem (see the long note on `currentCapabilities`); this one exists precisely so the janitor
   * can stop hardcoding the boundary. Today its `harness_backend.SERVER_ABSORBED_TASKS` is a frozen
   * literal of FIVE names, while we absorb SIX — `github-config-audit` joined on 2026-08-05 — so the
   * two sides already disagree about who owns that chore, and neither can see the disagreement.
   *
   * That drift is harmless only while the janitor daemon is suppressed outright. The moment it
   * narrows suppression to "run what the server does not claim" (#111 resolution 2, which is the one
   * we are asking for), a stale five-name list makes BOTH sides run `github-config-audit` — the
   * two-owners-per-chore condition the one-daemon-per-host rule exists to prevent. So publishing the
   * list is not a convenience for that fix; it is a precondition of it.
   *
   * A consumer that finds the field ABSENT is reading an older server and should fall back to its own
   * list — an absent field must never be read as "this server absorbs nothing", which would hand every
   * chore back to a daemon that is still suppressed.
   */
  absorbed_chores: string[]
}

/**
 * Compute the capability tokens the server can HONESTLY advertise, per the ratified rev-8 contract
 * (`docs/claimed-chores-contract.md`; janitor `harness_backend.claimed_chores()`). That function
 * honours ONLY an EXACT name from its `GLOBAL_CHORES` roster (a per-chore claim). The coarse legacy
 * token `family-a` is RETIRED here (TRDD-X9VLHBFZ) — every chore it used to stand in for now has its
 * own exact-name publish below, so the coarse token adds nothing and is dropped rather than carried
 * forever. Any other token — `singleton-chores` used to be one — claims NOTHING and is silently
 * dropped, so the janitor keeps running that chore even while we believe we told it otherwise.
 *
 * So each pushed token is a chore name from `lib/janitor-chore-stamp.ts`, gated on the SAME predicate
 * that proves the chore is live right now:
 *   - `oauth-rotator-tick` / `oauth-rotator-supervisor` ← `oauthTickEnabled()` (the R16 flag file).
 *   - `version-update` ← `isAbsorbedDutySchedulerRunning()` (ai-maestro#102 / TRDD-5X3P79Q6;
 *     the scheduler also ran `marketplace-refresh` until that duty was retired 2026-09-17).
 *   - `github-config-audit` ← `isGithubConfigAuditSchedulerRunning()`, `cache-prune` ←
 *     `isCachePruneSchedulerRunning()`, `fleet-plugins-update` ← `isFleetPluginsUpdateSchedulerRunning()`
 *     — each scheduler starts unconditionally at boot (server.mjs) and now exports its own
 *     not-null-timer-handle liveness check (TRDD-X9VLHBFZ; promised on ai-maestro#126).
 *   - the 4 `CONDITIONAL_CHORES` (`memory-guard`, `rules-cleanup`, `fleet-stop`, `cold-cache-clear`)
 *     ← whichever are armed AND running right now, read via `activeAbsorbedChores()` (the same
 *     `markChoreLive`/`unmarkChoreLive` set `absorbed_chores` publishes) filtered down to just the
 *     conditional lanes — the unconditional 7 in `ABSORBED_CHORES` are handled by name above/below.
 *
 * `fleet-recovery` is not a real chore name and was never pushed — left out here too.
 */
export function currentCapabilities(deps: {
  oauthEnabled?: () => boolean
  singletonChoresLive?: () => boolean
  githubConfigAuditLive?: () => boolean
  cachePruneLive?: () => boolean
  fleetPluginsUpdateLive?: () => boolean
  liveConditionalChores?: () => readonly string[]
} = {}): string[] {
  const oauthEnabled = deps.oauthEnabled ?? oauthTickEnabled
  const singletonChoresLive = deps.singletonChoresLive ?? isAbsorbedDutySchedulerRunning
  const githubConfigAuditLive = deps.githubConfigAuditLive ?? isGithubConfigAuditSchedulerRunning
  const cachePruneLive = deps.cachePruneLive ?? isCachePruneSchedulerRunning
  const fleetPluginsUpdateLive = deps.fleetPluginsUpdateLive ?? isFleetPluginsUpdateSchedulerRunning
  const liveConditionalChores =
    deps.liveConditionalChores ??
    (() => activeAbsorbedChores().filter((c) => (CONDITIONAL_CHORES as readonly string[]).includes(c)))
  const caps: string[] = []
  if (oauthEnabled()) caps.push('oauth-rotator-tick', 'oauth-rotator-supervisor')
  // marketplace-refresh dropped 2026-09-17 (duty retired; see janitor-chore-stamp.ts).
  if (singletonChoresLive()) caps.push('version-update')
  if (githubConfigAuditLive()) caps.push('github-config-audit')
  if (cachePruneLive()) caps.push('cache-prune')
  if (fleetPluginsUpdateLive()) caps.push('fleet-plugins-update')
  caps.push(...liveConditionalChores())
  return caps
}

/**
 * Is `chore` currently CLAIMED — i.e. would it be a member of `currentCapabilities()` right now?
 *
 * THE SINGLE AUTHORITY both the liveness beat (this file, published to the janitor) and the
 * chore-stamp writer (`janitor-chore-stamp.ts::stampChoreRun`) must agree on. Before this existed
 * the two had drifted: `stampChoreRun` wrote a stamp on every ATTEMPT regardless of whether the
 * chore's own gate (a flag file, a scheduler-running check, an armed conditional lane) actually
 * held, while `currentCapabilities` only ever claimed the chore when that same gate held. So a
 * chore this server had disclaimed — the OAuth rotator's flag turned off being the concrete case,
 * spec `design/specs/oauth-rotation-and-chore-handover-spec.md` ORH-4/M3 ("the server claims a
 * chore only when able") and ORH-32/R3 (the flag removal is the deliberate kill switch) — still
 * got a fresh stamp every beat, telling the janitor "still owned" for a chore nobody was running.
 * The janitor's suppressed daemon then never resumed it, and NEITHER side ran the chore.
 *
 * This supersedes the "stamp on attempt regardless of gate" half of TRDD-14HI8ZPR /
 * ai-maestro#111's original design — that card's INTENT (let the janitor tell an absorbed chore
 * from an unowned one) is exactly why a disclaimed chore must not be stamped as owned. The
 * after-completion refinement ORH-4/M3 also asks for (moving the janitor-control stamp to fire
 * only once a run has actually COMPLETED, not merely attempted) is a separate, still-open
 * implementation step — tracked as its own card (C8) — this function only closes the R3
 * kill-switch half: never claim what the gate says we do not currently own.
 *
 * `deps` forwards to `currentCapabilities` unchanged so a caller (or a test) can stub the same
 * seams without this function inventing a second copy of them.
 */
export function isChoreClaimed(
  chore: AbsorbedChore | string,
  deps: Parameters<typeof currentCapabilities>[0] = {},
): boolean {
  return currentCapabilities(deps).includes(chore)
}

// Wire the REAL predicate into `janitor-chore-stamp.ts::stampChoreRun` — a runtime registration,
// not a static import, because that module is imported BY this one (`activeAbsorbedChores`,
// `CONDITIONAL_CHORES` above), so importing it back here would be a real 2-file cycle.
// `registerChoreClaimPredicate`'s doc comment covers the alternatives tried and why this is the
// one that survives every module runtime this app runs under (production bundling AND vitest).
//
// PRODUCTION LOAD-ORDER, VERIFIED (not assumed) against `server.mjs` as of this change: this
// file's `await import('./lib/server-liveness.ts')` sits inside the shared `startServer()`
// function (server.mjs:585-2579), which BOTH `MAESTRO_MODE=full` and `MAESTRO_MODE=headless`
// call — so this registration runs on every boot, in every mode, not only the dashboard one. Each
// chore's own `await import(...)` (oauth tick, oauth supervisor, this file, ...) is wrapped in its
// OWN try/catch that logs and continues, so one import throwing never skips a later one; and a
// dynamic `import()` fully evaluates a module's top-level code (this line included) before
// resolving, so even if `startServerLiveness()` itself later throws, this registration has
// already landed. No chore beat fires for 60s+ after boot, so registration is always complete in
// time. If `server.mjs`'s import order or structure changes, re-verify this comment's premise —
// `stampChoreRun` degrades to its pre-fix unconditional-write behaviour, silently, if this file
// is never loaded before a real beat fires.
registerChoreClaimPredicate(isChoreClaimed)

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
    // `--no-optional-locks`: a plain `git status` REFRESHES the index and takes `.git/index.lock`
    // to do it. This runs at server boot, and a boot that is interrupted (pm2 restart racing a
    // previous start, a crash loop) leaves a 0-byte orphan lock that blocks every later commit in
    // the checkout until someone removes it by hand — measured twice on 2026-08-19 (19:20, 19:57,
    // each a 0-byte lock with no holder, each minutes after a server start). A liveness probe must
    // not hold a write lock on the repo it reports on.
    const dirty = runGit('--no-optional-locks status --porcelain --untracked-files=no').length > 0
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
    // A fresh mutable array per write (`activeAbsorbedChores` builds one): handing a frozen
    // readonly tuple to `JSON.stringify` would serialise identically but lets a future caller of
    // `writeServerLiveness` mutate the module's own constant through the payload it gets back.
    absorbed_chores: activeAbsorbedChores(),
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
  /** Injected clock seam for the late-beat gap check below — real `Date.now` by default. */
  now?: () => number
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
  const now = opts.now ?? Date.now
  writeServerLiveness()
  // TRDD-OUAQARPL: a late beat (event loop descheduled under load — e.g. a loadavg spike) and a
  // downstream reader simply misjudging staleness are indistinguishable without a signal on OUR
  // side too. Log ONLY the transition (a gap wider than 2x the interval), never every beat, so
  // this stays silent under normal load and only speaks when the writer itself was actually late.
  let lastBeatMs = now()
  const timer = setInterval(() => {
    const nowMs = now()
    const gapMs = nowMs - lastBeatMs
    if (gapMs > intervalMs * 2) {
      console.warn(`[server-liveness] late beat: gap ${gapMs}ms exceeds 2x interval ${intervalMs}ms`)
    }
    lastBeatMs = nowMs
    writeServerLiveness()
  }, intervalMs)
  timer.unref()
  return () => clearInterval(timer)
}
