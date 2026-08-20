// Absorbed fleet-plugins-update lane — TRDD-JBFM8XR0 (parent KCRMSNL7). A line-faithful port of
// the janitor's `scripts/lib/fleet_plugin_updates.py` + `daemon.py::task_fleet_plugins_update`
// (roster cadence 21600 s).
//
// THE BUG THE ORIGINAL EXISTS FOR, kept verbatim because it is the whole design: `claude plugin
// update` takes no project argument — only `--scope` — so a `local`/`project`-scope update
// resolves WHICH project from the process cwd. Every caller that omits `cwd` works only by
// accident (a per-session detector already runs inside its own project), and a project with no
// live Claude session is never updated by anyone. Measured on this host when the janitor module
// was written: 101 local-scope install records across 79 project paths, six pinned six minor
// releases behind. The fix is one option — `cwd: target.projectPath` in `updateTarget` — and
// everything else is the plumbing that lets a session-less actor discover the (plugin, project)
// pairs. FAIL-OPEN means SKIP: a project we cannot read is not updated this pass; the next pass
// retries (the safe direction for an idempotent write).
//
// THE THREE MEASURED-INCIDENT REQUIREMENTS (KCRMSNL7 design section), where each lives here:
//  1. ATOMIC CACHE POPULATION (TRDD-4OFMHOZ7: a partial cache dir bricked every session's hooks
//     for 20 min) — this lane NEVER writes into `~/.claude/plugins/cache` (or any cache) itself:
//     its ONLY mutation channel is the `claude plugin update` subprocess, whose cache writes are
//     the CLI's own transaction. Pinned by the no-direct-cache-write test (the module contains no
//     fs write primitive at all — grep-provable).
//  2. QUARANTINE OUTSIDE EVERY SCANNED TREE (the janitor's first mv-aside parked a broken copy
//     inside the marketplace cache → 7 load errors) — this lane quarantines NOTHING and deletes
//     NOTHING; there is no mv-aside to misplace. If a future version ever adds a repair step, its
//     parking lot must live outside `~/.claude/plugins/**` and outside every project tree.
//  3. EXPLICIT CACHE-PARENT ROOT RESOLUTION (TRDD-ZM5LZ24Y: a __dirname-relative root guess left
//     the janitor's version-update silently dead for a MONTH) — every root this lane reads is
//     stated here and anchored on `os.homedir()`, never on `__dirname`, never on the server's own
//     cwd, never on CLAUDE_PROJECT_DIR:
//       · the install registry:  ~/.claude/plugins/installed_plugins.json   (`registryPath()`)
//       · each target's gate:    <projectPath>/.claude/settings.local.json  (scope `local`)
//                                <projectPath>/.claude/settings.json        (scope `project`)
//     where `projectPath` comes from the registry RECORD, verbatim.
//
// Runs under `withMarketplaceLock`: `claude plugin update` mutates the same plugin-cache/registry
// state as the marketplace refresh and the user-scope sweep, and two concurrent updaters racing
// on it is the janitor-issue-#7 pile-up. (The janitor's own lanes hold THEIR lock, not ours — the
// non-interlock is safe because the claim in `absorbed_chores` suppresses their lane entirely
// while ours runs.) NOT destructive (idempotent CLI updates, same class as the always-on
// marketplace-refresh), so the lane ships ON and `fleet-plugins-update` joins ABSORBED_CHORES in
// the SAME COMMIT that wires this scheduler — the claim-when-live rule.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { withMarketplaceLock } from '@/lib/marketplace-lock'
import { stampChoreRun } from '@/lib/janitor-chore-stamp'
import { writePluginsUpdatedSignal } from '@/lib/plugins-updated-signal'
import { appendUpdateTrailRow } from '@/lib/plugin-update-trail'

const execFileAsync = promisify(execFile)

/** Scopes whose updates are cwd-relative. `user`/`managed` are machine-global — the auto-update
 *  service's existing absorbed duty, deliberately not touched here (fleet_plugin_updates.py:33). */
export const PROJECT_SCOPES = ['local', 'project'] as const
export type ProjectScope = (typeof PROJECT_SCOPES)[number]

/** Which settings file carries a scope's `enabledPlugins` map (fleet_plugin_updates.py:38). */
const SETTINGS_FOR_SCOPE: Record<ProjectScope, string> = {
  local: '.claude/settings.local.json',
  project: '.claude/settings.json',
}

/** Bound one sweep — a pathological registry must not turn a beat into an hour of subprocesses;
 *  the leftovers are picked up next pass, and a cap is always SAID (no silent caps). */
export const MAX_TARGETS_PER_SWEEP = 60
export const UPDATE_TIMEOUT_MS = 120_000
/** Janitor roster cadence (21600 s); the janitor's stale bound is max(3×cadence, cadence+600). */
export const DEFAULT_INTERVAL_MS = 21_600_000

/** Requirement 3: the registry root, anchored on the HOME dir explicitly — never __dirname. */
export function registryPath(): string {
  return path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json')
}

/** One (plugin, scope, project) the sweep may update (fleet_plugin_updates.py::Target). */
export interface Target {
  pluginId: string // "<name>@<marketplace>" — the registry key IS the id
  scope: ProjectScope
  projectPath: string
}

export function settingsPathFor(target: Target): string {
  return path.join(target.projectPath, SETTINGS_FOR_SCOPE[target.scope])
}

/**
 * Plugin ids explicitly enabled in a settings file, or [] on absent/malformed
 * (fleet_plugin_updates.py:67-94 — THE shared gate: enabled means the value is EXACTLY `true`;
 * a string/object spelling from a future schema is NOT read as enabled, because guessing
 * "truthy" would silently update a plugin the project disabled in a spelling we don't know).
 */
export function enabledPlugins(settingsPath: string): string[] {
  let data: unknown
  try {
    data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
  } catch {
    return []
  }
  if (typeof data !== 'object' || data === null) return []
  const enabled = (data as Record<string, unknown>).enabledPlugins
  if (typeof enabled !== 'object' || enabled === null || Array.isArray(enabled)) return []
  return Object.entries(enabled as Record<string, unknown>)
    .filter(([k, v]) => typeof k === 'string' && k !== '' && v === true)
    .map(([k]) => k)
}

/** Both spellings in the wild: `name@marketplace` and bare `name` (fleet_plugin_updates.py:97-108).
 *  Matching only the qualified form would silently skip every project using the short one. */
export function pluginIsEnabled(pluginId: string, enabled: readonly string[]): boolean {
  const name = pluginId.split('@', 1)[0]
  return enabled.some((e) => e === pluginId || e === name || e.startsWith(name + '@'))
}

/** `(pluginId, record)` for every install record — the registry maps id → LIST of records, and a
 *  single-record dict spelling is tolerated (fleet_plugin_updates.py:111-127). */
function records(registry: Record<string, unknown>): Array<[string, Record<string, unknown>]> {
  const out: Array<[string, Record<string, unknown>]> = []
  const plugins = registry.plugins
  if (typeof plugins !== 'object' || plugins === null) return out
  for (const [pluginId, entries] of Object.entries(plugins as Record<string, unknown>)) {
    const list = Array.isArray(entries) ? entries : typeof entries === 'object' && entries !== null ? [entries] : []
    for (const rec of list) {
      if (typeof rec === 'object' && rec !== null) out.push([pluginId, rec as Record<string, unknown>])
    }
  }
  return out
}

/** Parse the install registry, or {} when missing/unreadable/malformed — fail-open = skip. */
export function readRegistry(registryFile: string = registryPath()): Record<string, unknown> {
  try {
    const data = JSON.parse(fs.readFileSync(registryFile, 'utf8'))
    return typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * Every (plugin, scope, project) this sweep should update, deduped and ordered
 * (fleet_plugin_updates.py:139-178). Filters, each for its stated reason:
 *  · scope ∈ PROJECT_SCOPES — user/managed is the existing absorbed duty's job;
 *  · projectPath present and still a DIRECTORY — a path we cannot see is SKIPPED, not updated
 *    (71 of 79 recorded paths on this host were deleted workdirs when the janitor measured);
 *  · the plugin is ENABLED in that project's own settings file.
 * Deduped on (plugin, scope, project): one project legitimately holds several records for one
 * plugin over its history, and updating it twice is pure waste.
 */
export function enumerateTargets(registry?: Record<string, unknown>): Target[] {
  const reg = registry ?? readRegistry()
  const seen = new Set<string>()
  const out: Target[] = []
  const enabledCache = new Map<string, string[]>()
  for (const [pluginId, rec] of records(reg)) {
    const scope = rec.scope
    const project = rec.projectPath
    if (
      (scope !== 'local' && scope !== 'project') ||
      typeof project !== 'string' ||
      project === ''
    ) {
      continue
    }
    const key = `${pluginId} ${scope} ${project}`
    if (seen.has(key)) continue
    try {
      if (!fs.statSync(project).isDirectory()) continue
    } catch {
      continue // unreadable ⇒ skip this pass (fail-open = do nothing, not do it blindly)
    }
    const target: Target = { pluginId, scope, projectPath: project }
    const sp = settingsPathFor(target)
    if (!enabledCache.has(sp)) enabledCache.set(sp, enabledPlugins(sp))
    if (!pluginIsEnabled(pluginId, enabledCache.get(sp)!)) continue
    seen.add(key)
    out.push(target)
  }
  return out
}

/**
 * Run `claude plugin update <id> --scope <scope>` FOR THAT PROJECT (fleet_plugin_updates.py:181-200).
 * `cwd: target.projectPath` IS the fix this lane exists for — the CLI has no project flag, so the
 * working directory is the only channel that tells it which project's local/project scope to act
 * on. Requirement 1 lives here too: the subprocess is the lane's ONLY mutation channel.
 */
export async function updateTarget(
  target: Target,
  timeoutMs: number = UPDATE_TIMEOUT_MS,
): Promise<{ ok: boolean; detail: string }> {
  try {
    const proc = await execFileAsync('claude', ['plugin', 'update', target.pluginId, '--scope', target.scope], {
      cwd: target.projectPath,
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
    })
    const lines = (proc.stdout || proc.stderr || '').trim().split('\n')
    return { ok: true, detail: (lines[lines.length - 1] || '').slice(0, 200) }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string }
    const lines = (e.stdout || e.stderr || e.message || '').trim().split('\n')
    return { ok: false, detail: (lines[lines.length - 1] || '').slice(0, 200) }
  }
}

export interface FleetPluginsUpdateDeps {
  targets?: () => Target[]
  update?: (t: Target) => Promise<{ ok: boolean; detail: string }>
  stamp?: () => void
  signal?: (updated: readonly string[]) => void
  trail?: (row: import('@/lib/plugin-update-trail').UpdateTrailRow) => void
  log?: (msg: string) => void
  maxTargets?: number
}

export interface FleetPluginsUpdateResult {
  targets: number
  updated: string[]
  failed: number
  capped: boolean
}

/**
 * One sweep (fleet_plugin_updates.py::sweep + task_fleet_plugins_update). Stamps the chore on
 * ATTEMPT COMPLETION — a flaky sweep is still owned; failures have their own log lines. Updated
 * plugins are not live until each session reloads ("restart required to apply", the CLI's own
 * words) — the per-session reload surfacing stays with the sessions' own janitor heartbeat; this
 * lane only logs the count (parity with the janitor daemon, whose reload flag is ITS state file —
 * we never write into the janitor's data dir).
 */
export async function runFleetPluginsUpdate(deps: FleetPluginsUpdateDeps = {}): Promise<FleetPluginsUpdateResult> {
  const log = deps.log ?? ((m: string) => console.warn(m))
  const maxTargets = deps.maxTargets ?? MAX_TARGETS_PER_SWEEP
  const targets = (deps.targets ?? enumerateTargets)()
  const updated: string[] = []
  let failed = 0
  for (const target of targets.slice(0, maxTargets)) {
    const startEpoch = Math.floor(Date.now() / 1000)
    const { ok, detail } = await (deps.update ?? updateTarget)(target)
    // TRDD-MNN0VAS6: one trail row per INVOCATION — the janitor attributes interrupted
    // extractions from these, which a last-run-only summary cannot support.
    ;(deps.trail ?? appendUpdateTrailRow)({
      target: target.pluginId,
      scope: target.scope,
      project: target.projectPath,
      start_epoch: startEpoch,
      end_epoch: Math.floor(Date.now() / 1000),
      ok,
      detail,
      by: 'fleet-plugins-update',
    })
    if (ok) updated.push(target.pluginId)
    else {
      failed++
      log(`[fleet-plugins-update] ${target.pluginId} @ ${target.projectPath}: FAILED ${detail}`)
    }
  }
  const capped = targets.length > maxTargets
  if (capped) {
    // Never silently truncate: a capped sweep must say so, or a permanently-behind tail looks
    // like a fully-updated fleet (fleet_plugin_updates.py:220-223).
    log(`[fleet-plugins-update] capped at ${maxTargets}/${targets.length} targets — rest next pass`)
  }
  ;(deps.stamp ?? (() => stampChoreRun('fleet-plugins-update')))()
  // The janitor-named reload contract (lib/plugins-updated-signal.ts): publish the sweep so
  // their dispatcher can surface [janitor-reload] to every session. The helper no-ops on an
  // empty list, so an empty sweep never touches the file (the consumer's semantics).
  ;(deps.signal ?? writePluginsUpdatedSignal)(updated)
  return { targets: targets.length, updated, failed, capped }
}

// ── scheduler (same shape as the other absorbed lanes) ─────────────────────────────────────────

let inFlight = false

async function beat(log: (msg: string) => void): Promise<void> {
  if (inFlight) return
  inFlight = true
  try {
    const r = await withMarketplaceLock(() => runFleetPluginsUpdate({ log }))
    if (r === null) {
      log('[fleet-plugins-update] deferred (another marketplace op holds the lock)')
    } else if (r.updated.length || r.failed) {
      log(
        `[fleet-plugins-update] ${r.updated.length} plugin(s) updated across the fleet` +
          (r.failed ? `; ${r.failed} FAILED (lines above)` : '') +
          (r.capped ? ' [capped]' : '') +
          ` — sessions pick changes up on their next reload`,
      )
    }
  } catch (err) {
    log(`[fleet-plugins-update] beat threw (non-fatal): ${err instanceof Error ? err.message : err}`)
  } finally {
    inFlight = false
  }
}

/** Fires once immediately (a bare interval starves under restart loops shorter than 6 h),
 *  unref'd, never throws; null when disabled (AIM_FLEET_PLUGINS_UPDATE_INTERVAL_MS=0). */
export function startFleetPluginsUpdateScheduler(
  opts: { intervalMs?: number; log?: (msg: string) => void } = {},
): (() => void) | null {
  const raw = Number(process.env.AIM_FLEET_PLUGINS_UPDATE_INTERVAL_MS)
  const intervalMs = opts.intervalMs ?? (Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_INTERVAL_MS)
  if (!intervalMs || intervalMs <= 0) return null
  const log = opts.log ?? ((msg: string) => console.warn(msg))
  void beat(log)
  const timer = setInterval(() => void beat(log), intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}
