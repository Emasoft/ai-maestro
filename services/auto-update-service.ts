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
let absorbedTickInFlight = false
/** Mirrors the pre-absorption janitor daemon's own cadence for
 *  `marketplace-refresh` / `user-plugins-update` (3600 s — ai-maestro#102 §2). */
const ABSORBED_DUTY_INTERVAL_MS = 60 * 60 * 1000

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
  absorbedTimerHandle = setInterval(() => {
    runAbsorbedDutyTickSafely().catch(err => {
      console.error('[auto-update] Absorbed-duty tick threw:', err)
    })
  }, ABSORBED_DUTY_INTERVAL_MS)
  if (typeof absorbedTimerHandle.unref === 'function') absorbedTimerHandle.unref()
}

/** Stop the absorbed-duty scheduler. Idempotent. server.mjs calls this on SIGTERM. */
export function stopAbsorbedDutyScheduler(): void {
  if (absorbedTimerHandle) {
    clearInterval(absorbedTimerHandle)
    absorbedTimerHandle = null
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
  const result = await withMarketplaceLock(() => runAbsorbedDutyTickBody(readers))
  if (result === null) {
    console.warn('[auto-update] marketplace-op lock held by another process — skipping absorbed-duty tick')
    return []
  }
  return result
}

async function runAbsorbedDutyTickBody(readers: CandidateReaders): Promise<AutoUpdateRunEntry[]> {
  const entries: AutoUpdateRunEntry[] = []
  const { UpdateMarketplace, ChangePlugin } = await import('@/services/element-management-service')

  // 1. marketplace-refresh — EVERY registered marketplace, argless-equivalent
  //    (the pre-absorption daemon called `claude plugin marketplace update`
  //    with no name filter at all).
  for (const mkt of await listRegisteredMarketplaces(readers)) {
    try {
      const r = await UpdateMarketplace({ name: mkt }, SYSTEM_AUTH_CONTEXT)
      entries.push(entry(
        `absorbed:marketplace:${mkt}`,
        r.success ? 'updated' : 'failed',
        r.success ? 'Refreshed marketplace manifest (absorbed duty)' : (r.error || 'Unknown failure'),
      ))
    } catch (err) {
      entries.push(entry(`absorbed:marketplace:${mkt}`, 'failed', errMsg(err)))
    }
  }

  // 2. version-update — keep the janitor plugin itself current at user scope.
  try {
    const r = await ChangePlugin(null, {
      name: JANITOR_PLUGIN_NAME,
      marketplace: MARKETPLACE_NAME,
      action: 'update',
      scope: 'user',
      rolePluginSwap: true,
    }, SYSTEM_AUTH_CONTEXT)
    if (r.success) {
      entries.push(entry(`absorbed:${JANITOR_PLUGIN_NAME}@${MARKETPLACE_NAME}`, 'updated', 'Updated to latest (user, absorbed duty)'))
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
