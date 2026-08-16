/**
 * Auto-update service — periodic plugin/marketplace update scheduler.
 *
 * Runs in-process inside server.mjs (single Node event loop, single setInterval
 * timer). On every tick:
 *   1. Reload the user's settings from disk so toggles take effect on the
 *      next tick without a restart.
 *   2. Skip silently if the master `enabled` flag is false.
 *   3. For every enabled category whose marketplace touches it, refresh the
 *      marketplace manifest if `marketplaceManifests` is also enabled
 *      (otherwise plugin checks below run against the cached manifest).
 *   4. For every enabled plugin category, scan the relevant scope/marketplace
 *      for plugins, compare installed vs latest version, and run
 *      `claude plugin update <name>@<mkt> --scope <scope>` for outdated ones.
 *   5. For every agent whose local-scope plugin was just updated, queue a
 *      stop+restart via the existing inter-process restart-queue path so the
 *      agent's claude session reloads with the new plugin version. The queue
 *      defers the actual restart until the agent reaches `idle_prompt` —
 *      identical to the manual Update button's path.
 *   6. Persist a per-event run summary so the UI can show what happened.
 *
 * The entire tick is wrapped in a try/catch — a single category failure does
 * NOT abort the others, and a thrown exception does NOT crash the server.
 *
 * NOT in this module:
 *   - Notify-only mode: the user explicitly chose auto-apply.
 *   - Cross-process coordination: this is a single-server scheduler. Multi-
 *     host federation would need a separate design (R20.10's "MUST detect"
 *     applies per host).
 */

/**
 * AIO-architecture compliance note:
 *
 * Per the all-in-one pipeline rule, every plugin/marketplace mutation
 * must go through the canonical Change* function so a single set of
 * gates governs all callers (UI, scheduler, CLI). This module therefore
 * does NOT shell out to `claude plugin ...` directly — it dispatches
 * through ChangePlugin / UpdateMarketplace from element-management-service.
 *
 * The system authContext (`{ isSystemOwner: true }`) is what the boot
 * sequence already passes to internal pipeline calls (see CreateAgent
 * G11 / wakeAgent's R17 gate / server.mjs marketplace registration).
 * This is the exact same trust class — automatic background work
 * performed by the server itself, not on behalf of any specific agent.
 */

import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'

import {
  loadSettings,
  saveSettings,
  appendRunEntry,
  type AutoUpdateRunEntry,
  type AutoUpdateSettings,
} from '@/lib/auto-update-settings'
import {
  MAIN_PLUGIN_NAME,
  MARKETPLACE_NAME,
  LOCAL_MARKETPLACE_NAME,
  CUSTOM_MARKETPLACE_NAME,
} from '@/lib/ecosystem-constants'
import { isDependencyPlugin } from '@/lib/dependency-plugins'
import { withMarketplaceLock } from '@/lib/marketplace-lock'
import { isJanitorInstalledAndArmed as realIsJanitorInstalledAndArmed } from '@/lib/janitor-presence'
import { stampChoreRun } from '@/lib/janitor-chore-stamp'
import { consumeWorkRequest } from '@/lib/janitor-work-request'
import { readSettings, editSettings, type SettingsOp } from '@/lib/settings-gate'

/** AuthContext used for every pipeline call this scheduler makes. The
 *  scheduler runs in-process inside the server and has no per-agent
 *  caller — system-owner is the right trust class. */
const SYSTEM_AUTH_CONTEXT = { isSystemOwner: true } as const

/** The janitor plugin's canonical name. Only the `version-update` absorbed
 *  duty targets it specifically (self-update); the other two absorbed
 *  duties are scope-wide, not plugin-specific. */
const JANITOR_PLUGIN_NAME = 'ai-maestro-janitor'

// ── Module-level scheduler state ─────────────────────────────────────────
// We keep a single in-memory timer handle. start/stop are idempotent so
// hot-reload + signal-handler shutdowns don't double-fire or leak timers.
let timerHandle: NodeJS.Timeout | null = null
let currentIntervalMinutes: number | null = null
let tickInFlight = false  // prevents two ticks running concurrently if a slow
                          // run overlaps the next interval boundary

// ── Absorbed-duty lane state (ai-maestro#102, TRDD-5X3P79Q6) ─────────────
// A SEPARATE timer from the master-toggle-gated scheduler above. It runs
// UNCONDITIONALLY at boot (never torn down by the user's `enabled: false`)
// because the three duties it drives were never gated by a user preference
// before this server absorbed them — see lib/janitor-presence.ts's module
// doc for the full "consent-to-add is not consent-to-remove" argument.
let absorbedTimerHandle: NodeJS.Timeout | null = null
// One-shot boot catch-up (see scheduleAbsorbedDutyCatchUp). Held separately from the
// repeating timer so stopAbsorbedDutyScheduler can clear BOTH — otherwise a stopped
// scheduler still fires once after SIGTERM.
let absorbedCatchUpHandle: NodeJS.Timeout | null = null
let absorbedTickInFlight = false
/** Cadence of the absorbed lane: **3 hours** (USER ruling, 2026-08-05, TRDD-PE54D95Q).
 *
 *  It was 3600 s, mirroring the pre-absorption janitor daemon (ai-maestro#102 §2). That
 *  cadence bought nothing and cost connections: `claude plugin marketplace update` is
 *  IDEMPOTENT — running it again inside the same window cannot make a catalog fresher than
 *  the first run already did, it re-asks a question whose answer has not changed and pays a
 *  git fetch for the answer. So the ONLY thing frequency buys here is latency against
 *  upstream publishing, and past that point every extra tick is pure waste, not margin.
 *
 *  ⚠ DO NOT RAISE THIS "to keep plugins fresher" — it will not. Re-running is idempotent, so
 *  you would buy zero freshness at N× the connections, which is the exact state this card
 *  exists to end. The traffic is also invisible to every meter an operator would check: git
 *  protocol operations count against NO GitHub API quota, so `gh api rate_limit` reads clean
 *  while this lane saturates. Measure it with the lane's own `lastRunSummary`, never a quota. */
const ABSORBED_DUTY_INTERVAL_MS = 4 * 60 * 60 * 1000 // USER directive 2026-08-07: 3h -> 4h.
// The move is in the direction the warning above endorses (fewer connections, not more): the
// refresh is idempotent, so a LONGER interval costs only upstream-publishing latency and buys
// back a quarter of the lane's connections. The one argless `claude plugin marketplace update`
// invocation is unchanged and is the other half of the same directive — never one call per agent.

// How long after boot an OVERDUE lane waits before catching up. Not zero: the
// server is still starting, and a refresh is I/O-heavy. Not long: the whole
// point is that a host restarted more often than the interval still runs.
const ABSORBED_DUTY_BOOT_SETTLE_MS = 2 * 60 * 1000

// How often the repeating timer CHECKS due-ness — distinct from
// ABSORBED_DUTY_INTERVAL_MS, which is the CADENCE (how often work actually runs,
// anchored on the persisted lastAbsorbedRunAt stamp). They were one value until
// 2026-08-08 (task #34): with tick == cadence, setInterval anchored the tick grid on
// BOOT, so a restart re-phased the lane and a chore due at stamp+interval waited up
// to a FULL interval — measured live: due 22:43, ran 01:03:50 (boot 21:03:50 + 4h).
// Polling gated on the stamp caps that latency at the poll period while running the
// WORK no more often than the cadence — the do-not-raise warning above is about work
// frequency, and a poll does no work: it reads one local JSON file and returns.
const ABSORBED_DUTY_POLL_MS = 15 * 60 * 1000

/** Restart-queue notifier — wired by start(). The server.mjs entry point
 *  passes a callback that broadcasts a restart-needed signal to the UI's
 *  useRestartQueue hook, which then drives the actual /restart endpoint
 *  through the same idle_prompt-gated path the manual Update button uses.
 *  We accept it as a callback (not a hard import) so this module stays
 *  testable without booting the WebSocket layer. */
type RestartNotifier = (sessionNames: string[]) => void
let restartNotifier: RestartNotifier | null = null

/** WHOLE-FLEET restart notifier — R42.7 / TRDD-QZL828OD.
 *
 *  Distinct from `RestartNotifier` above because the two lanes know different
 *  things. The master-toggle lane updates a plugin AT a known agent, so it can name
 *  the sessions. The absorbed lane updates plugins at USER scope, which every
 *  harness agent reads at launch — there is no session list to compute, the answer
 *  is "all of them". Collapsing the two would force this lane to enumerate the
 *  fleet, which is the fan-out layer's job and its workdir gate. */
type FleetRestartNotifier = (reason: string) => void
let fleetRestartNotifier: FleetRestartNotifier | null = null

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Start the scheduler. Idempotent: calling twice is a no-op.
 *
 * @param notifier  Optional callback the scheduler calls with the list of
 *                  tmux session names that need to be queued for restart
 *                  after this tick. server.mjs wires this to the WebSocket
 *                  broadcast which the UI's useRestartQueue picks up.
 */
export async function startAutoUpdateScheduler(notifier?: RestartNotifier): Promise<void> {
  if (notifier) restartNotifier = notifier
  await rescheduleFromSettings()
}

/** Stop the scheduler. Idempotent. server.mjs calls this on SIGTERM. */
export function stopAutoUpdateScheduler(): void {
  if (timerHandle) {
    clearInterval(timerHandle)
    timerHandle = null
    currentIntervalMinutes = null
  }
}

/**
 * Reload settings from disk and adjust the timer. Called on startup, after
 * each tick (in case the user changed the interval mid-run), and from the
 * PATCH /api/settings/auto-update route after a settings save.
 */
export async function rescheduleFromSettings(): Promise<void> {
  const s = await loadSettings()
  // Disabled → tear down any running timer and leave.
  if (!s.enabled) {
    stopAutoUpdateScheduler()
    return
  }
  // Already running at the requested interval → leave the timer alone so
  // we don't reset its phase (a settings save shouldn't reset the clock).
  if (timerHandle && currentIntervalMinutes === s.intervalMinutes) {
    return
  }
  // Replace the timer.
  if (timerHandle) clearInterval(timerHandle)
  currentIntervalMinutes = s.intervalMinutes
  timerHandle = setInterval(() => {
    runTickSafely().catch(err => {
      console.error('[auto-update] Tick threw:', err)
    })
  }, s.intervalMinutes * 60 * 1000)
  // Allow the process to exit naturally — this timer is opt-in background
  // work, not a reason to keep Node alive past graceful shutdown.
  if (typeof timerHandle.unref === 'function') timerHandle.unref()
}

/**
 * Trigger a single tick out-of-band. Used by the "Run now" button and by
 * tests. Concurrency-safe: if a tick is already in flight, returns
 * immediately (the other tick will pick up the latest settings).
 */
export async function runTickNow(): Promise<{ ran: boolean; entries: AutoUpdateRunEntry[] }> {
  if (tickInFlight) return { ran: false, entries: [] }
  return runTickSafely()
}

// ── Absorbed-duty lane (ai-maestro#102, TRDD-5X3P79Q6) ───────────────────
//
// The three chores the janitor daemon ran unconditionally BEFORE this server
// absorbed them: refresh every registered marketplace ("marketplace-refresh"),
// keep the janitor plugin itself current at user scope ("version-update"),
// and keep every user-scope plugin current ("user-plugins-update"). None of
// them ever had a user-facing category — the janitor being installed+armed
// WAS the consent. So this lane checks `isJanitorInstalledAndArmed()`
// instead of `settings.enabled`, and its own scheduler is started
// UNCONDITIONALLY at boot (server.mjs), never torn down by the master
// toggle. The genuinely-new broad sweeps (`agentLocalScopePlugins`,
// `userScopePlugins` AS A USER-FACING CATEGORY) are unaffected — they still
// gate on `settings.enabled` exactly as before, in `runTick` above.

/** Start the absorbed-duty scheduler. Idempotent. Ticks unconditionally —
 *  every tick re-checks `isJanitorInstalledAndArmed()` itself, so a host
 *  that installs/arms the janitor later starts benefiting on the very next
 *  tick with no restart, and a host that never had the janitor just skips
 *  every tick (self-healing, both directions). */
export function startAbsorbedDutyScheduler(notifier?: FleetRestartNotifier): void {
  if (notifier) fleetRestartNotifier = notifier
  if (absorbedTimerHandle) return
  // The timer fires at the POLL period and each fire gates on the persisted stamp
  // (runAbsorbedDutyPoll), so the tick grid is anchored on lastAbsorbedRunAt — never
  // on boot time. See ABSORBED_DUTY_POLL_MS for the restart-re-phasing defect this ends.
  absorbedTimerHandle = setInterval(() => {
    runAbsorbedDutyPoll().catch(err => {
      console.error('[auto-update] Absorbed-duty poll threw:', err)
    })
  }, ABSORBED_DUTY_POLL_MS)
  if (typeof absorbedTimerHandle.unref === 'function') absorbedTimerHandle.unref()
  scheduleAbsorbedDutyCatchUp()
}

/** One fire of the repeating timer: read the stamp, run the tick iff the lane is
 *  overdue. Extracted as a seam (the same deps pattern as runAbsorbedDutyTick) because
 *  the timer-level happy path is NOT machine-independently testable — the real tick
 *  gates on `isJanitorInstalledAndArmed()`, a disk read of the host's janitor state.
 *  Returns whether the tick was run, so tests assert the DECISION, not a log line. */
export async function runAbsorbedDutyPoll(deps: {
  loadSettingsFn?: typeof loadSettings
  nowMs?: number
  tick?: () => Promise<unknown>
} = {}): Promise<boolean> {
  const load = deps.loadSettingsFn ?? loadSettings
  const s = await load()
  if (!absorbedDutyIsOverdue(s.lastAbsorbedRunAt, deps.nowMs ?? Date.now())) return false
  await (deps.tick ?? runAbsorbedDutyTickSafely)()
  return true
}

/** A bare `setInterval` fires first at boot+INTERVAL, so a host restarted more often
 *  than the interval NEVER runs this lane — and raising the cadence 1 h → 3 h
 *  (TRDD-PE54D95Q) tripled that window. This is the restart-safe half: decide from the
 *  PERSISTED `lastAbsorbedRunAt`, not from process uptime.
 *
 *  Pure on purpose — the decision is pinned by tests without touching a timer, and the
 *  plumbing below stays thin enough to read in one go.
 *
 *  Persistence is also what keeps this safe under a restart LOOP: the first catch-up
 *  stamps `lastAbsorbedRunAt`, so every reboot inside the interval computes "not
 *  overdue" and does nothing. At most one run per interval, however often we boot. */
export function absorbedDutyIsOverdue(lastAbsorbedRunAt: string | null | undefined, nowMs: number): boolean {
  if (!lastAbsorbedRunAt) return true // never run on this host — the lane owes a first run
  const last = Date.parse(lastAbsorbedRunAt)
  if (!Number.isFinite(last)) return true // unparseable stamp: treat as never-run, never as fresh
  if (last > nowMs) return false // clock moved backwards; wait for the interval rather than storm
  return nowMs - last >= ABSORBED_DUTY_INTERVAL_MS
}

/** Fire ONE catch-up tick shortly after boot iff the lane is overdue. Failure here is
 *  logged and swallowed: a scheduler that cannot read its own settings must still tick
 *  on the interval. */
function scheduleAbsorbedDutyCatchUp(): void {
  if (absorbedCatchUpHandle) return
  absorbedCatchUpHandle = setTimeout(() => {
    absorbedCatchUpHandle = null
    void (async () => {
      try {
        const s = await loadSettings()
        if (!absorbedDutyIsOverdue(s.lastAbsorbedRunAt, Date.now())) return
        await runAbsorbedDutyTickSafely()
      } catch (err) {
        console.error('[auto-update] Absorbed-duty boot catch-up failed:', err)
      }
    })()
  }, ABSORBED_DUTY_BOOT_SETTLE_MS)
  if (typeof absorbedCatchUpHandle.unref === 'function') absorbedCatchUpHandle.unref()
}

/** Stop the absorbed-duty scheduler. Idempotent. server.mjs calls this on SIGTERM. */
export function stopAbsorbedDutyScheduler(): void {
  if (absorbedTimerHandle) {
    clearInterval(absorbedTimerHandle)
    absorbedTimerHandle = null
  }
  // Clear the pending catch-up too, or a stopped scheduler still fires one tick
  // after SIGTERM and every test that starts the scheduler leaks a live timer.
  if (absorbedCatchUpHandle) {
    clearTimeout(absorbedCatchUpHandle)
    absorbedCatchUpHandle = null
  }
}

/** True iff the absorbed-duty scheduler's timer is currently running. This is
 *  the SERVER-CAPABILITY signal (`lib/server-liveness.ts::currentCapabilities`
 *  reads it) — distinct from `isJanitorInstalledAndArmed()`, which is a
 *  per-host EXTERNAL fact the scheduler re-checks every tick. The server
 *  "owns and runs" this duty the moment the scheduler is ticking, even on a
 *  tick where the external fact says skip — exactly like any other chore
 *  that can no-op on a given run without ceasing to be "live". */
export function isAbsorbedDutySchedulerRunning(): boolean {
  return absorbedTimerHandle !== null
}

/** Trigger a single absorbed-duty tick out-of-band. Used by tests and by any
 *  future manual "run now" affordance. Concurrency-safe like runTickNow. */
export async function runAbsorbedDutyTickNow(): Promise<{ ran: boolean; entries: AutoUpdateRunEntry[] }> {
  if (absorbedTickInFlight) return { ran: false, entries: [] }
  return runAbsorbedDutyTickSafely()
}

async function runAbsorbedDutyTickSafely(): Promise<{ ran: boolean; entries: AutoUpdateRunEntry[] }> {
  if (absorbedTickInFlight) return { ran: false, entries: [] }
  absorbedTickInFlight = true
  try {
    const entries = await runAbsorbedDutyTick()
    if (entries.length === 0) return { ran: false, entries: [] }
    // Persist into the SAME lastRunSummary the master-toggle lane writes, so
    // the existing settings UI shows absorbed-duty activity without new UI
    // work — but NEVER touch `enabled`. This lane's consent is the janitor's
    // install+arm state, not this preference.
    try {
      const s = await loadSettings()
      let next = s
      for (const e of entries) next = appendRunEntry(next, e)
      // Stamp the absorbed lane's OWN timestamp (TRDD-PE54D95Q, AC5). Without it this file
      // reports `enabled: false` + `lastRunAt: null` while this lane is running every 3 h, and
      // the only evidence is the wall-clock buried in the summary rows. `enabled` is still
      // never touched here — this lane's consent is the janitor's install+arm state, not that
      // preference.
      next = { ...next, lastAbsorbedRunAt: nowIso() }
      await saveSettings(next)
    } catch (err) {
      console.error('[auto-update] Failed to persist absorbed-duty run summary:', err)
    }
    return { ran: true, entries }
  } finally {
    absorbedTickInFlight = false
  }
}

/** Injected seam so a test can force the janitor-presence gate without
 *  touching the real `~/.claude/settings.json` / data dir. Defaults to the
 *  real `lib/janitor-presence.ts` check. */
export interface AbsorbedDutyDeps {
  isJanitorInstalledAndArmed?: () => boolean
  readers?: CandidateReaders
  /** Which settings file the auto-update-flag step writes. Defaults to the REAL
   *  `~/.claude/settings.json`, which is correct in production and catastrophic in a test — a
   *  suite driving the tick body would edit the developer's own global Claude Code config.
   *  That is not hypothetical: it happened the hour this step was added, and every existing
   *  absorbed-duty test passed while it did, because none of them asserts on that file. Tests
   *  MUST pass a tmp path here. */
  settingsPath?: string
}

/** The absorbed-duty tick body. Separated from the safe/scheduled wrapper so
 *  tests can call it directly with injected deps, exactly like `runTick`. */
export async function runAbsorbedDutyTick(deps: AbsorbedDutyDeps = {}): Promise<AutoUpdateRunEntry[]> {
  const installedAndArmed = (deps.isJanitorInstalledAndArmed ?? realIsJanitorInstalledAndArmed)()
  if (!installedAndArmed) {
    // Not an error — the janitor simply isn't this host's consenting owner
    // right now (never installed, or deliberately disarmed). Skip silently;
    // the next tick re-checks.
    return []
  }
  const readers = deps.readers ?? REAL_CANDIDATE_READERS
  const result = await withMarketplaceLock(() => runAbsorbedDutyTickBody(readers, deps.settingsPath))
  if (result === null) {
    console.warn('[auto-update] marketplace-op lock held by another process — skipping absorbed-duty tick')
    return []
  }
  return result
}

/** The USER'S OWN global Claude Code settings file. Not a machine registry — 900+ lines of
 *  their configuration — which is why every write below goes through the settings gate. */
function userGlobalSettingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json')
}

/**
 * Keep `autoUpdate: true` on every marketplace declared in `extraKnownMarketplaces`
 * (USER directive, 2026-08-06 — TRDD-PE54D95Q).
 *
 * WHY THIS EXISTS AT ALL. Refreshing marketplace catalogs upgrades nothing by itself: Claude
 * Code auto-updates a marketplace's plugins only when that marketplace's `autoUpdate` is on,
 * and the default is ON for official Anthropic marketplaces and **OFF for third-party and
 * local-dev** ones. Measured on this host: 275 registered marketplaces, every one third-party
 * or local-dev, `autoUpdate: true` on exactly ZERO. So before this, the absorbed lane paid the
 * entire network cost of the refresh and produced no upgrades at all.
 *
 * FOUR SAFETY PROPERTIES, each guarding a failure this repo has already suffered:
 *
 *  1. **It REFUSES to write when the read did not yield a usable object.** `readSettings`
 *     distinguishes `missing` from `unreadable`; on `unreadable` we return a failure and touch
 *     nothing. A tolerant reader that returns `{}` for a file it cannot parse, followed by a
 *     writer that serialises it, is exactly how a user's settings file gets replaced by a
 *     nearly-empty object while the operation reports success.
 *
 *  2. **It never emits an op for an entry that is not already a plain object.** This is the
 *     subtle one. `applySettingsOps`' `set` walks with `create: true`, which REPLACES any
 *     wrong-shaped intermediate segment with `{}` — so a blind
 *     `set ['extraKnownMarketplaces', name, 'autoUpdate']` against a malformed entry would
 *     silently destroy that entry's `source`, and `extraKnownMarketplaces` is the AUTHORITATIVE
 *     record of where a marketplace comes from. Ops are therefore computed from what is
 *     actually on disk, and a malformed entry is reported, never rewritten.
 *
 *  3. **Zero ops ⇒ zero writes.** The steady state is "already true", and this lane ticks
 *     every 3 h against a file up to a dozen live Claude sessions each hold in memory and
 *     write back from their own boot-time copy. Writing unconditionally would bump the file on
 *     every tick and hand those sessions a lost-update race for no change at all.
 *
 *  4. **All N flags in ONE `editSettings` call.** The ops array is applied inside a single
 *     locked read-modify-write, so this is one transaction, not N chances to lose that race.
 *
 * BOUNDARY, stated because a future reader will assume otherwise: this reaches
 * `extraKnownMarketplaces` in `settings.json` ONLY. The runtime registry
 * `~/.claude/plugins/known_marketplaces.json` holds entries that are not in settings.json, and
 * the gate deliberately refuses that path (wrong basename, wrong parent dir) — so those are
 * NOT covered here. Extending to them is a separate decision about a harness-owned file.
 *
 * ── THAT DECISION WAS MADE (USER directive 2026-08-07): "all plugins are always set to
 * auto-update in the settings.json (remember to use the safe settings editor)". ──────────────
 *
 * We still do NOT write the harness-owned registry — the gate's refusal stands and is right.
 * We write the marketplace's DECLARATION into `settings.json`, which is the lever that actually
 * moves the registry. Measured 2026-08-07, and this is the whole basis for the approach:
 *
 *   - 250 marketplaces appear in BOTH files, with **ZERO `autoUpdate` disagreements** — so
 *     settings.json is the SOURCE and the registry is downstream of it.
 *   - 20 appear in the registry and are UNDECLARED in settings.json. Those 20 are exactly the
 *     12 `autoUpdate:false` + 8 key-absent entries: undeclared ⇒ never enforced ⇒ never true.
 *   - 52 INSTALLED plugins sit on those 20, so this is the gap with real consequences.
 *
 * So an undeclared marketplace is declared here with `autoUpdate: true` and the `source` COPIED
 * VERBATIM from the registry — never invented. A registry entry with no usable `source` is
 * skipped and counted, because a declaration without a source is a broken marketplace, which is
 * worse than an unmanaged one. The registry is read READ-ONLY; if it is missing or unparseable
 * this half is skipped silently and the declared-but-false half still runs.
 *
 * And the flag is read at instance LOAD, so a flip reaches the NEXT session, never this one.
 * Do not report it as effective merely because it was written.
 */
export async function ensureMarketplaceAutoUpdate(
  settingsPath: string = userGlobalSettingsPath(),
): Promise<AutoUpdateRunEntry> {
  const target = 'absorbed:marketplace-auto-update'
  const read = await readSettings(settingsPath)
  if (!read.ok) {
    return read.reason === 'missing'
      ? entry(target, 'skipped', 'No user settings.json yet — nothing declares a marketplace')
      : entry(target, 'failed', `Refusing to write: settings.json is unreadable (${read.error || 'parse failed'})`)
  }
  const extra = read.data.extraKnownMarketplaces
  if (extra === null || typeof extra !== 'object' || Array.isArray(extra)) {
    // Absent is normal (no marketplaces declared); a non-object is someone else's problem —
    // creating one here would invent configuration the user never wrote.
    return entry(target, 'skipped', 'settings.json declares no extraKnownMarketplaces object')
  }

  const ops: SettingsOp[] = []
  const malformed: string[] = []
  for (const [name, value] of Object.entries(extra as Record<string, unknown>)) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      malformed.push(name)
      continue
    }
    if ((value as Record<string, unknown>).autoUpdate === true) continue
    ops.push({ op: 'set', keyPath: ['extraKnownMarketplaces', name, 'autoUpdate'], value: true })
  }
  const flips = ops.length

  // The UNDECLARED half (USER directive 2026-08-07) — see the boundary note above. Each op sets
  // the WHOLE entry rather than just the flag: `set ['extraKnownMarketplaces', name]` on a name
  // that does not exist would otherwise have to vivify the parent, and this way the source and
  // the flag land as one value that cannot be half-written.
  // ⚠ ONLY for the machine-global settings file. The registry is machine-global state; pairing it
  // with a CALLER-SUPPLIED settings path would enrich a temp/project file with this machine's
  // marketplaces — incoherent, and it broke the idempotence test the moment it was written (a
  // temp fixture produced 270 add-ops and a write, against a test whose whole claim is "zero ops
  // ⇒ zero writes"). The test was right; the hidden dependency on `os.homedir()` was the defect.
  let sourceless = 0
  const undeclared = settingsPath === userGlobalSettingsPath() ? await readRegistryMarketplaces() : []
  for (const [name, source] of undeclared) {
    if (name in (extra as Record<string, unknown>)) continue // declared: handled above
    if (source === null) { sourceless++; continue }
    ops.push({ op: 'set', keyPath: ['extraKnownMarketplaces', name], value: { source, autoUpdate: true } })
  }
  const adds = ops.length - flips

  const bits: string[] = []
  if (malformed.length > 0) bits.push(`${malformed.length} malformed entr${malformed.length === 1 ? 'y' : 'ies'} left untouched`)
  if (sourceless > 0) bits.push(`${sourceless} registry entr${sourceless === 1 ? 'y' : 'ies'} skipped for a missing source`)
  const note = bits.length > 0 ? ` (${bits.join('; ')})` : ''
  if (ops.length === 0) return entry(target, 'already-current', `Every declared marketplace already auto-updates${note}`)

  try {
    await editSettings(settingsPath, ops)
    const what = [
      flips > 0 ? `enabled auto-update on ${flips} declared marketplace(s)` : '',
      adds > 0 ? `declared ${adds} previously-undeclared marketplace(s) with auto-update on` : '',
    ].filter(Boolean).join('; ')
    return entry(target, 'updated', `${what}; takes effect at the next session start${note}`)
  } catch (err) {
    return entry(target, 'failed', errMsg(err))
  }
}

/**
 * Every marketplace the harness registry knows, as `[name, source]` — READ-ONLY, and the source
 * is returned verbatim so a caller can copy it rather than invent one. `null` source means the
 * entry is unusable as a declaration (missing/!object), which the caller counts rather than
 * guessing at.
 *
 * Returns `[]` on ANY read/parse failure, deliberately: this is an enrichment pass, and a
 * harness-owned file we do not write is not something whose absence should fail the enforcement
 * step that runs beside it.
 */
async function readRegistryMarketplaces(): Promise<Array<[string, unknown]>> {
  try {
    const p = path.join(os.homedir(), '.claude', 'plugins', 'known_marketplaces.json')
    const parsed: unknown = JSON.parse(await fs.readFile(p, 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return []
    return Object.entries(parsed as Record<string, unknown>).map(([name, e]) => {
      const src = e !== null && typeof e === 'object' && !Array.isArray(e)
        ? (e as Record<string, unknown>).source
        : undefined
      return [name, src === undefined || src === null ? null : src]
    })
  } catch {
    return []
  }
}

async function runAbsorbedDutyTickBody(
  readers: CandidateReaders,
  settingsPath?: string,
): Promise<AutoUpdateRunEntry[]> {
  const entries: AutoUpdateRunEntry[] = []
  const { RefreshAllMarketplaces, ChangePlugin } = await import('@/services/element-management-service')

  // 0. Make the refresh below capable of producing upgrades at all. Ordered FIRST because a
  //    catalog refresh against marketplaces whose autoUpdate is off is pure network cost —
  //    though note the flag is read at instance load, so today's flip serves tomorrow's boot,
  //    not the refresh two lines down.
  entries.push(await ensureMarketplaceAutoUpdate(settingsPath))

  // 1. marketplace-refresh — ONE argless invocation for EVERY registered marketplace.
  //
  //    This was a per-marketplace loop calling `UpdateMarketplace({ name })`, i.e. one
  //    `claude plugin marketplace update <name>` process per entry — 275 of them on this host,
  //    every tick. The loop's own comment already called itself "argless-equivalent", which it
  //    was not: `claude plugin marketplace update` takes an OPTIONAL name and its help says
  //    "updates all if no name specified", so the equivalent was available the whole time and
  //    the loop was paying 275 process spawns and 275 git fetches to reach the same state.
  //
  //    It also collapses the reporting honestly. The loop emitted one entry per marketplace, so
  //    `lastRunSummary` filled with hundreds of rows and its failures were per-name; there is now
  //    ONE row, because there is one operation. A future reader wanting per-marketplace outcomes
  //    should get them from the CLI's own output, not by reinstating the loop.
  try {
    const r = await RefreshAllMarketplaces(SYSTEM_AUTH_CONTEXT)
    //    THREE outcomes, three statuses. `r.skipped` is set when the pipeline deliberately did
    //    not act because another process was already refreshing (G02b). Recording that as
    //    `updated` would claim a refresh that never ran; recording it as `failed` would invent a
    //    fault and pollute the failure trail this card exists to make readable. `skipped` is
    //    already in the entry vocabulary, so the honest answer needs no new type.
    entries.push(
      r.skipped
        ? entry('absorbed:marketplace-refresh', 'skipped', r.skipped)
        : entry(
          'absorbed:marketplace-refresh',
          r.success ? 'updated' : 'failed',
          r.success ? 'Refreshed every registered marketplace (one invocation)' : (r.error || 'Unknown failure'),
        ),
    )
  } catch (err) {
    entries.push(entry('absorbed:marketplace-refresh', 'failed', errMsg(err)))
  }
  // The janitor cannot see this ran unless we say so. Its daemon is SUPPRESSED on a host we own
  // (one-daemon-per-host), so `<task>.last-run.ts` is the only channel by which a chore we
  // absorbed is distinguishable from one nobody is doing — and until TRDD-14HI8ZPR we never
  // wrote it, so all five absorbed chores correctly read as dark for weeks (ai-maestro#111).
  // Stamped OUTSIDE the loop: the chore is `marketplace-refresh` (singular), not one per market.
  stampChoreRun('marketplace-refresh')

  // 2. version-update — keep the janitor plugin itself current at user scope.
  //
  // CONSUME THE RELEASE TRIGGER FIRST (ai-maestro#102 step 3). The janitor's per-session detector
  // raises `version-update-requested.flag` when it notices the cache is behind GitHub, and the
  // owner of the chore is contracted to consume it clear-before-run. We never did: the flag was in
  // `FLEET_CONTROL_FLAGS` but had ZERO readers, so it sat set on this host from 2026-08-02 — long
  // after the 2.1.0->2.3.0 update it asked for had actually completed. A permanently-set trigger is
  // worse than none: the requester cannot distinguish its new request from its own stale one, so
  // the janitor's evidence that we were not running the chore was a flag we simply never cleared.
  //
  // Clearing BEFORE the update (not after) is what makes a request raised mid-run survive to the
  // next pass. See `lib/janitor-work-request.ts`.
  const hadUpdateRequest = consumeWorkRequest('version-update-requested.flag')
  try {
    const r = await ChangePlugin(null, {
      name: JANITOR_PLUGIN_NAME,
      marketplace: MARKETPLACE_NAME,
      action: 'update',
      scope: 'user',
      rolePluginSwap: true,
    }, SYSTEM_AUTH_CONTEXT)
    if (r.success) {
      entries.push(entry(
        `absorbed:${JANITOR_PLUGIN_NAME}@${MARKETPLACE_NAME}`,
        'updated',
        hadUpdateRequest
          ? 'Updated to latest (user, absorbed duty; a pending version-update request was consumed)'
          : 'Updated to latest (user, absorbed duty)',
      ))
    } else {
      const msg = r.error || 'Unknown failure'
      entries.push(entry(
        `absorbed:${JANITOR_PLUGIN_NAME}@${MARKETPLACE_NAME}`,
        /idempotent|already.*installed|no.?op/i.test(msg) ? 'already-current' : 'failed',
        /idempotent|already.*installed|no.?op/i.test(msg) ? undefined : msg,
      ))
    }
  } catch (err) {
    entries.push(entry(`absorbed:${JANITOR_PLUGIN_NAME}@${MARKETPLACE_NAME}`, 'failed', errMsg(err)))
  }
  stampChoreRun('version-update')

  // 3. user-plugins-update — every plugin currently installed at user scope.
  for (const p of await readers.listUserScopePlugins()) {
    const key = `absorbed:${p.name}@${p.marketplace}`
    try {
      const r = await ChangePlugin(null, {
        name: p.name,
        marketplace: p.marketplace,
        action: 'update',
        scope: 'user',
        rolePluginSwap: true,
      }, SYSTEM_AUTH_CONTEXT)
      if (r.success) {
        entries.push(entry(key, 'updated', 'Updated to latest (user, absorbed duty)'))
      } else {
        const msg = r.error || 'Unknown failure'
        entries.push(entry(key, /idempotent|already.*installed|no.?op/i.test(msg) ? 'already-current' : 'failed', /idempotent|already.*installed|no.?op/i.test(msg) ? undefined : msg))
      }
    } catch (err) {
      entries.push(entry(key, 'failed', errMsg(err)))
    }
  }
  stampChoreRun('user-plugins-update')

  // R42.7 — a user-scope plugin that actually CHANGED is a global change: every
  // harness agent loads it at launch, so every one of them is running stale code
  // until it restarts. Fire the whole-fleet notifier, and only on a real 'updated'
  // (never on 'already-current', or an idle host would churn its fleet hourly for
  // no reason). The fan-out layer decides WHICH agents it may touch; the driver's
  // safe-state gate decides which are safe right now.
  //
  // `absorbed:marketplace:*` entries are EXCLUDED, and that exclusion is what makes the
  // sentence above true. A marketplace refresh is a manifest fetch, not a code change: the
  // branch that records it (step 1) has no 'already-current' classification at all — unlike
  // the plugin branches, which do — so `UpdateMarketplace` succeeding stamps 'updated' on
  // every single tick. With at least one registered marketplace the `some(...)` was
  // therefore permanently true, and the guard fired the whole-fleet restart hourly on a
  // completely idle host: exactly the churn the comment above says it exists to prevent.
  // Only a plugin whose CODE changed can leave every agent running stale code.
  const codeChanged = entries.some(e => e.status === 'updated' && !e.target.startsWith('absorbed:marketplace:'))
  if (fleetRestartNotifier && codeChanged) {
    try {
      fleetRestartNotifier('user-scope plugin update (absorbed duty)')
    } catch (err) {
      console.error('[auto-update] fleetRestartNotifier threw:', err)
    }
  }

  return entries
}

// ── Tick implementation ──────────────────────────────────────────────────

async function runTickSafely(): Promise<{ ran: boolean; entries: AutoUpdateRunEntry[] }> {
  if (tickInFlight) return { ran: false, entries: [] }
  tickInFlight = true
  try {
    const s = await loadSettings()
    if (!s.enabled) return { ran: false, entries: [] }
    // Serialise the whole tick behind the marketplace-op lock (TRDD-S5RUHJRP). `tickInFlight`
    // above only guards THIS process; the lock additionally guards a second server-family process
    // (a "Run now" from another worker, a stray second server) from running `claude plugin
    // marketplace update` against the same cache concurrently — which corrupts it into a valid
    // but WRONG catalogue. Held ⇒ SKIP, never block: the next scheduled tick picks the work up.
    const entries = await withMarketplaceLock(() => runTick(s))
    if (entries === null) {
      console.warn('[auto-update] marketplace-op lock held by another process — skipping this tick')
      return { ran: false, entries: [] }
    }
    // Persist the run summary in one final write — keeping per-entry I/O
    // out of the hot path and atomic from the UI's perspective.
    let next = s
    for (const e of entries) next = appendRunEntry(next, e)
    next.lastRunAt = nowIso()
    try {
      await saveSettings(next)
    } catch (err) {
      console.error('[auto-update] Failed to persist run summary:', err)
    }
    // After each tick, give the scheduler a chance to pick up an interval
    // change without waiting for the next fire.
    await rescheduleFromSettings()
    return { ran: true, entries }
  } finally {
    tickInFlight = false
  }
}

/** The actual tick body, separated so tests can call it with a stub
 *  AutoUpdateSettings without going through the disk read path. */
export async function runTick(s: AutoUpdateSettings): Promise<AutoUpdateRunEntry[]> {
  const entries: AutoUpdateRunEntry[] = []
  const sessionNamesNeedingRestart = new Set<string>()

  // ── Step 1: refresh marketplaces ────────────────────────────────────
  // Decide which marketplaces are touched by enabled categories.
  const marketplacesTouched = new Set<string>()
  if (s.categories.core || s.categories.aiMaestroMarketplace) {
    marketplacesTouched.add(MARKETPLACE_NAME)
  }
  if (s.categories.localMarketplaces) {
    marketplacesTouched.add(LOCAL_MARKETPLACE_NAME)
    marketplacesTouched.add(CUSTOM_MARKETPLACE_NAME)
  }
  // dependency / agent-local / user-scope categories may pull from any
  // registered marketplace; refresh ALL when those are enabled.
  if (s.categories.dependencyPlugins || s.categories.agentLocalScopePlugins || s.categories.userScopePlugins) {
    for (const m of await listRegisteredMarketplaces()) marketplacesTouched.add(m)
  }
  if (s.categories.marketplaceManifests) {
    // Lazy-import the AIO pipeline. Imports are inlined so this module
    // doesn't drag the entire element-management-service into module-load
    // for every test that touches the settings types.
    const { UpdateMarketplace } = await import('@/services/element-management-service')
    for (const mkt of marketplacesTouched) {
      try {
        const r = await UpdateMarketplace({ name: mkt }, SYSTEM_AUTH_CONTEXT)
        if (r.success) {
          entries.push(entry(`marketplace:${mkt}`, 'updated', 'Refreshed marketplace manifest'))
        } else {
          entries.push(entry(`marketplace:${mkt}`, 'failed', r.error || 'Unknown failure'))
        }
      } catch (err) {
        entries.push(entry(`marketplace:${mkt}`, 'failed', errMsg(err)))
      }
    }
  } else {
    for (const mkt of marketplacesTouched) {
      entries.push(entry(`marketplace:${mkt}`, 'skipped', 'manifest refresh disabled by user'))
    }
  }

  // ── Step 2: enumerate update candidates per category ─────────────────
  // Extracted to collectUpdateCandidates() so "which plugins does the
  // scheduler consider?" is answerable WITHOUT running Step 3's mutations.
  // That separation is what makes TRDD-YLCTM8EU's claim ("the janitor is in
  // the candidate set, nothing filters it out") a verified fact rather than
  // an asserted one — the readers were module-private, so the only way to
  // exercise this decision was to run the real updates against the real host.
  const candidates = await collectUpdateCandidates(s, marketplacesTouched)

  // ── Step 3: run the updates ──────────────────────────────────────────
  // ⚠ DO NOT DELETE THIS LOOP (TRDD-PE54D95Q AC6). AC6 proposes removing the
  // per-plugin loops once the harness demonstrably upgrades plugins from the
  // refreshed catalogs on its own — and that evidence DOES NOT EXIST yet.
  // Measured 2026-08-06: deleting this loop today would strand up to 52
  // installed plugins (the harness only auto-updates marketplaces whose
  // autoUpdate flag is on, and it acts on its own schedule, not ours).
  // AC6 is gated on EVIDENCE recorded in that card, not on anyone's judgment
  // that this loop "looks redundant" next to the marketplace refresh above.
  //
  // Dispatch through ChangePlugin (the AIO pipeline) instead of shelling
  // out to `claude plugin update` directly. Every gate that protects the
  // manual UI Update button — G02 role-plugin guard, G08 core protection,
  // G11b programArgs rewrite, G12 restart signal — fires for the
  // scheduler's update too, so there's no path-divergence between the
  // two callers.
  if (candidates.size > 0) {
    const { ChangePlugin } = await import('@/services/element-management-service')
    for (const cand of candidates.values()) {
      const key = `${cand.name}@${cand.marketplace}`
      try {
        const r = await ChangePlugin(cand.agentId ?? null, {
          name: cand.name,
          marketplace: cand.marketplace,
          action: 'update',
          scope: cand.scope,
          agentDir: cand.agentDir,
          // Bypass G02's "role-plugins must use ChangeTitle" rejection for
          // updates — the plugin name is unchanged, only the version
          // refreshes, so ChangeTitle would be the wrong dispatch.
          rolePluginSwap: true,
        }, SYSTEM_AUTH_CONTEXT)
        if (r.success) {
          entries.push(entry(key, 'updated', `Updated to latest (${cand.scope}${cand.agentDir ? ` @ ${cand.agentDir}` : ''})`))
          if (cand.sessionName) sessionNamesNeedingRestart.add(cand.sessionName)
        } else {
          const msg = r.error || 'Unknown failure'
          // ChangePlugin marks no-op idempotent paths with action='no-op';
          // treat that as already-current for the UI.
          if (/idempotent|already.*installed|no.?op/i.test(msg)) {
            entries.push(entry(key, 'already-current'))
          } else {
            entries.push(entry(key, 'failed', msg))
          }
        }
      } catch (err) {
        entries.push(entry(key, 'failed', errMsg(err)))
      }
    }
  }

  // ── Step 4: notify the UI's restart queue ────────────────────────────
  if (sessionNamesNeedingRestart.size > 0 && restartNotifier) {
    try {
      restartNotifier(Array.from(sessionNamesNeedingRestart))
    } catch (err) {
      console.error('[auto-update] restartNotifier threw:', err)
    }
  }

  return entries
}

// ── Helpers ──────────────────────────────────────────────────────────────

export interface UpdateCandidate {
  name: string
  marketplace: string
  scope: 'user' | 'local'
  /** Required when scope='local' so ChangePlugin's local-scope path
   *  resolves the right agent directory. */
  agentDir?: string
  /** Optional — when scope='local' and the candidate is bound to a known
   *  registry agent, ChangePlugin uses agentId to look up authContext
   *  details, run G11b correctly, and emit the right agent-scoped ledger
   *  entry. listAgentLocalScopePlugins() populates this; user-scope
   *  candidates leave it undefined. */
  agentId?: string
  /** Optional — when this candidate is owned by a known agent and that
   *  agent has an online tmux session, the scheduler uses this to queue a
   *  restart of the running claude after the update lands. */
  sessionName?: string
}

function addCandidate(map: Map<string, UpdateCandidate>, c: UpdateCandidate) {
  const k = `${c.name}@${c.marketplace}@${c.scope}@${c.agentDir || ''}`
  // First write wins so a candidate that knows its sessionName isn't
  // overwritten by a later candidate without one.
  if (!map.has(k)) map.set(k, c)
  else if (c.sessionName && !map.get(k)!.sessionName) map.set(k, c)
}

/** The three corpus readers the candidate decision consumes. They are the
 *  only I/O in Step 2, so injecting them makes the decision a pure function
 *  of (settings, marketplacesTouched, installed-plugin facts).
 *
 *  Why an injected object rather than `vi.mock` of this module: a test that
 *  mocks the module under test can only observe what it already decided to
 *  stub, and it must first reproduce this file's whole import graph. Fakes
 *  passed in touch no filesystem at all, so the test is 0-IMPACT BY
 *  CONSTRUCTION — it cannot read or write the developer's real
 *  ~/.claude/settings.json or agent registry even if it is wrong. */
export interface CandidateReaders {
  listUserScopePlugins: () => Promise<Array<{ name: string; marketplace: string }>>
  listAgentLocalScopePlugins: () => Promise<Array<{
    name: string; marketplace: string; agentDir: string; agentId: string; sessionName?: string
  }>>
  listInstalledPluginsInMarketplace: (marketplaceName: string) => Promise<Array<{
    name: string; scope: 'user' | 'local'; agentDir?: string; agentId?: string; sessionName?: string
  }>>
}

/** Function declarations hoist, so referencing the real readers here — above
 *  their definitions — is safe at module-evaluation time. */
const REAL_CANDIDATE_READERS: CandidateReaders = {
  listUserScopePlugins,
  listAgentLocalScopePlugins,
  listInstalledPluginsInMarketplace,
}

/** Decide the set of plugins this tick will try to update.
 *
 *  Each candidate is a (name, marketplace, scope, agentDir?) tuple, de-duped
 *  by that same key so a plugin matched by several enabled categories still
 *  gets at most ONE update attempt.
 *
 *  `marketplacesTouched` is computed by the caller (Step 1) because it is
 *  also what decides which manifests get refreshed — recomputing it here
 *  would give two sources of truth for one set. */
export async function collectUpdateCandidates(
  s: AutoUpdateSettings,
  marketplacesTouched: Iterable<string>,
  readers: CandidateReaders = REAL_CANDIDATE_READERS,
): Promise<Map<string, UpdateCandidate>> {
  const candidates = new Map<string, UpdateCandidate>()

  if (s.categories.core) {
    addCandidate(candidates, { name: MAIN_PLUGIN_NAME, marketplace: MARKETPLACE_NAME, scope: 'user' })
  }

  if (s.categories.aiMaestroMarketplace) {
    const remotePlugins = await readers.listInstalledPluginsInMarketplace(MARKETPLACE_NAME)
    for (const p of remotePlugins) {
      addCandidate(candidates, { name: p.name, marketplace: MARKETPLACE_NAME, scope: p.scope, agentDir: p.agentDir, agentId: p.agentId, sessionName: p.sessionName })
    }
  }

  if (s.categories.localMarketplaces) {
    for (const mkt of [LOCAL_MARKETPLACE_NAME, CUSTOM_MARKETPLACE_NAME]) {
      const localPlugins = await readers.listInstalledPluginsInMarketplace(mkt)
      for (const p of localPlugins) {
        addCandidate(candidates, { name: p.name, marketplace: mkt, scope: p.scope, agentDir: p.agentDir, agentId: p.agentId, sessionName: p.sessionName })
      }
    }
  }

  if (s.categories.dependencyPlugins) {
    for (const mkt of marketplacesTouched) {
      const plugins = await readers.listInstalledPluginsInMarketplace(mkt)
      for (const p of plugins) {
        if (isDependencyPlugin(p.name)) {
          addCandidate(candidates, { name: p.name, marketplace: mkt, scope: p.scope, agentDir: p.agentDir, agentId: p.agentId, sessionName: p.sessionName })
        }
      }
    }
  }

  if (s.categories.userScopePlugins) {
    for (const p of await readers.listUserScopePlugins()) {
      addCandidate(candidates, { name: p.name, marketplace: p.marketplace, scope: 'user' })
    }
  }

  if (s.categories.agentLocalScopePlugins) {
    for (const p of await readers.listAgentLocalScopePlugins()) {
      addCandidate(candidates, { name: p.name, marketplace: p.marketplace, scope: 'local', agentDir: p.agentDir, agentId: p.agentId, sessionName: p.sessionName })
    }
  }

  return candidates
}

function entry(target: string, status: AutoUpdateRunEntry['status'], detail?: string): AutoUpdateRunEntry {
  return { target, status, at: nowIso(), ...(detail !== undefined && { detail }) }
}

function nowIso(): string {
  // Local time + offset, the same convention as agent reports — easier to
  // tie to a workday than UTC.
  const d = new Date()
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const pad = (n: number) => String(Math.abs(Math.floor(n))).padStart(2, '0')
  const offStr = `${sign}${pad(off / 60)}${pad(off % 60)}`
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${offStr}`
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  try { return JSON.stringify(e) } catch { return String(e) }
}

function resolveHome(p: string): string {
  return p.startsWith('~') ? p.replace(/^~/, os.homedir()) : p
}

/** List every marketplace currently in scope for the cross-cutting
 *  "any marketplace" categories (dependency / agent-local / user-scope).
 *
 *  We do NOT shell out to `claude plugin marketplace list --json`. Instead
 *  we derive the set from the `name@marketplace` keys in the user-scope
 *  settings.json + every agent's settings.local.json. This avoids a
 *  Claude-CLI dependency in the scheduler (per the AIO rule that pipelines
 *  go through Change* services, not raw CLI invocations) AND gives us the
 *  exact set of marketplaces any installed plugin references — which is
 *  the only set the auto-update categories actually need to refresh. */
async function listRegisteredMarketplaces(readers: CandidateReaders = REAL_CANDIDATE_READERS): Promise<string[]> {
  const found = new Set<string>([MARKETPLACE_NAME, LOCAL_MARKETPLACE_NAME, CUSTOM_MARKETPLACE_NAME])
  for (const u of await readers.listUserScopePlugins()) found.add(u.marketplace)
  for (const l of await readers.listAgentLocalScopePlugins()) found.add(l.marketplace)
  return Array.from(found)
}

/** Discover plugins that the user has installed under user scope.
 *  Reads ~/.claude/settings.json (the Claude Code's global enabledPlugins map). */
async function listUserScopePlugins(): Promise<Array<{ name: string; marketplace: string }>> {
  const file = path.join(os.homedir(), '.claude', 'settings.json')
  try {
    const text = await fs.readFile(file, 'utf8')
    const json = JSON.parse(text) as { enabledPlugins?: Record<string, boolean> }
    const enabled = json.enabledPlugins || {}
    const out: Array<{ name: string; marketplace: string }> = []
    for (const key of Object.keys(enabled)) {
      const at = key.lastIndexOf('@')
      if (at <= 0) continue
      out.push({ name: key.substring(0, at), marketplace: key.substring(at + 1) })
    }
    return out
  } catch {
    return []
  }
}

/** Discover plugins installed under any agent's local scope.
 *  Walks the agent registry and reads each agent's
 *  `<workdir>/.claude/settings.local.json`. */
async function listAgentLocalScopePlugins(): Promise<Array<{
  name: string; marketplace: string; agentDir: string; agentId: string; sessionName?: string
}>> {
  // Lazy-import the registry to keep this module decoupled from agent boot.
  const { loadAgents } = await import('@/lib/agent-registry')
  const { computeSessionName } = await import('@/types/agent')
  const all = loadAgents()
  const out: Array<{ name: string; marketplace: string; agentDir: string; agentId: string; sessionName?: string }> = []
  for (const a of all) {
    if (a.deletedAt) continue
    const wd = a.workingDirectory
    if (!wd) continue
    const file = path.join(resolveHome(wd), '.claude', 'settings.local.json')
    try {
      const text = await fs.readFile(file, 'utf8')
      const json = JSON.parse(text) as { enabledPlugins?: Record<string, boolean> }
      const enabled = json.enabledPlugins || {}
      // Tmux session name is derived from agent name + session index via
      // computeSessionName (the canonical helper used everywhere else in
      // the codebase). We pick the first online session's name; if no
      // session is online (agent hibernated), we leave sessionName
      // undefined and the scheduler skips the restart-queue notification —
      // a hibernated agent will pick up the new plugin on next wake.
      const onlineSession = a.sessions?.find(s => s.status === 'online')
      const sessionName = onlineSession ? computeSessionName(a.name || '', onlineSession.index) : undefined
      for (const key of Object.keys(enabled)) {
        const at = key.lastIndexOf('@')
        if (at <= 0) continue
        out.push({
          name: key.substring(0, at),
          marketplace: key.substring(at + 1),
          agentDir: wd,
          agentId: a.id,
          sessionName,
        })
      }
    } catch {
      // Missing or malformed settings.local.json is fine — agent simply has
      // no local-scope plugins.
    }
  }
  return out
}

/** List plugins installed (user OR local scope) that come from a specific
 *  marketplace. The category logic uses this to bound scans by marketplace
 *  when the user enabled e.g. "Local marketplaces" only. */
async function listInstalledPluginsInMarketplace(marketplaceName: string): Promise<Array<{
  name: string; scope: 'user' | 'local'; agentDir?: string; agentId?: string; sessionName?: string
}>> {
  const out: Array<{ name: string; scope: 'user' | 'local'; agentDir?: string; agentId?: string; sessionName?: string }> = []
  for (const u of await listUserScopePlugins()) {
    if (u.marketplace === marketplaceName) out.push({ name: u.name, scope: 'user' })
  }
  for (const l of await listAgentLocalScopePlugins()) {
    if (l.marketplace === marketplaceName) out.push({ name: l.name, scope: 'local', agentDir: l.agentDir, agentId: l.agentId, sessionName: l.sessionName })
  }
  return out
}
