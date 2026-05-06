/**
 * Auto-update settings — types, defaults, atomic load/save.
 *
 * Lives at `~/.aimaestro/auto-update-settings.json`. Read by:
 *   - The auto-update scheduler (services/auto-update-service.ts) on every
 *     tick. The scheduler re-reads on each tick rather than caching so a
 *     user toggle takes effect on the next interval without a restart.
 *   - The settings UI (components/settings/PluginUpdatesSection.tsx) via
 *     GET /api/settings/auto-update.
 *
 * Mutated by:
 *   - PATCH /api/settings/auto-update (sudo-gated — auto-update settings
 *     change runtime behaviour of every agent on the host).
 *
 * Concurrency model: a single in-memory write lock per file (similar to
 * settings.local.json's withSettingsLock). All writes go through saveSettings
 * which does tmp+rename for crash safety.
 */

import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'

/** All seven category checkboxes shown in the UI. The names mirror the
 *  user's plain-English wording so the UI can render labels directly from
 *  this enum without a separate i18n table. */
export interface AutoUpdateCategories {
  /** [Mandatory prerequisite] Refresh marketplace manifests so the server
   *  knows what versions are available. Without this every plugin check
   *  below sees the cached (possibly stale) manifest. The UI warns when
   *  this is OFF and any plugin category is ON. */
  marketplaceManifests: boolean
  /** Update the core ai-maestro-plugin (R17). Critical security/feature
   *  updates land here; default ON when the master toggle is enabled. */
  core: boolean
  /** Update plugins discovered in the two AI Maestro local marketplaces:
   *  ai-maestro-local-roles-marketplace and ai-maestro-local-custom-marketplace. */
  localMarketplaces: boolean
  /** Update plugins from the remote ai-maestro-plugins marketplace
   *  (the 8 predefined role-plugins + the bundled core mirror). */
  aiMaestroMarketplace: boolean
  /** Update the curated list of AI Maestro dependency plugins
   *  (PSS, CPV, llm-externalizer, code-auditor, serena, grepika). See
   *  lib/dependency-plugins.ts for the canonical list. */
  dependencyPlugins: boolean
  /** Update every plugin currently installed in any agent's
   *  .claude/settings.local.json (cross-marketplace, cross-name). */
  agentLocalScopePlugins: boolean
  /** Update every plugin currently installed at user scope
   *  (~/.claude/settings.json's enabledPlugins). */
  userScopePlugins: boolean
}

/** A single update event recorded in lastRunSummary. */
export interface AutoUpdateRunEntry {
  /** "<name>@<marketplace>" for plugin updates; "marketplace:<name>" for
   *  marketplace-manifest refreshes. */
  target: string
  /** Plain-language outcome shown in the UI. */
  status: 'updated' | 'already-current' | 'failed' | 'skipped'
  /** When the operation was attempted. ISO 8601 in local time. */
  at: string
  /** Optional human-readable detail (e.g. error message, version delta). */
  detail?: string
}

export interface AutoUpdateSettings {
  /** Schema version. Bump when fields change in a non-additive way so a
   *  loadSettings() running against a future schema can migrate or reject. */
  version: 1
  /** Master switch. When false, the scheduler does not tick at all (no
   *  category-level work, no logging, no notifications). Default false so
   *  first-boot is silent and the user must opt in deliberately — unattended
   *  background restarts are surprising and need explicit consent. */
  enabled: boolean
  /** Tick interval in minutes. The scheduler clamps to a sane range
   *  (5..1440) to prevent both runaway tight loops and "effectively
   *  disabled" settings. UI presets: 15 / 30 / 60 / 360 / 1440. */
  intervalMinutes: number
  /** Per-category toggles. See AutoUpdateCategories. */
  categories: AutoUpdateCategories
  /** Wall-clock time of the most recent successful tick (any category).
   *  Null until the scheduler has run at least once. */
  lastRunAt: string | null
  /** Outcome of the most recent tick — capped to 200 entries to bound the
   *  file size while still giving the UI a meaningful audit trail. */
  lastRunSummary: AutoUpdateRunEntry[]
}

/** Default settings shipped on first read when the file doesn't exist.
 *  Master toggle is OFF so the install-time UX is "nothing changes until
 *  you opt in". When the user enables it, every category EXCEPT
 *  agent/user-scope sweeping defaults ON — those two are catch-alls that
 *  may produce many updates at once and should be deliberate opt-ins. */
export const DEFAULT_SETTINGS: AutoUpdateSettings = {
  version: 1,
  enabled: false,
  intervalMinutes: 60,
  categories: {
    marketplaceManifests: true,
    core: true,
    localMarketplaces: true,
    aiMaestroMarketplace: true,
    dependencyPlugins: true,
    agentLocalScopePlugins: false,
    userScopePlugins: false,
  },
  lastRunAt: null,
  lastRunSummary: [],
}

/** Min/max bounds for intervalMinutes. Anything outside these is clamped
 *  on save AND on load so a hand-edited file doesn't break the scheduler. */
export const MIN_INTERVAL_MINUTES = 5
export const MAX_INTERVAL_MINUTES = 1440 // 24 hours

/** Where the file lives. Exported so tests can override $HOME and verify
 *  the resolved path. */
export function getSettingsPath(): string {
  return path.join(os.homedir(), '.aimaestro', 'auto-update-settings.json')
}

/** Clamp the interval to the legal range. Used on both load and save so a
 *  pre-existing out-of-range value silently corrects itself. */
function clampInterval(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return DEFAULT_SETTINGS.intervalMinutes
  if (n < MIN_INTERVAL_MINUTES) return MIN_INTERVAL_MINUTES
  if (n > MAX_INTERVAL_MINUTES) return MAX_INTERVAL_MINUTES
  return Math.floor(n)
}

/** Coerce an arbitrary input shape into a strictly-typed AutoUpdateSettings.
 *  Missing fields are filled from DEFAULT_SETTINGS so an old-version file
 *  loads without throwing. */
function normalize(raw: unknown): AutoUpdateSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const cats = (r.categories && typeof r.categories === 'object'
    ? r.categories
    : {}) as Record<string, unknown>
  return {
    version: 1,
    enabled: r.enabled === true,
    intervalMinutes: clampInterval(r.intervalMinutes),
    categories: {
      marketplaceManifests: cats.marketplaceManifests !== false,  // default-on if missing
      core: cats.core !== false,
      localMarketplaces: cats.localMarketplaces !== false,
      aiMaestroMarketplace: cats.aiMaestroMarketplace !== false,
      dependencyPlugins: cats.dependencyPlugins !== false,
      agentLocalScopePlugins: cats.agentLocalScopePlugins === true,  // default-off
      userScopePlugins: cats.userScopePlugins === true,  // default-off
    },
    lastRunAt: typeof r.lastRunAt === 'string' ? r.lastRunAt : null,
    lastRunSummary: Array.isArray(r.lastRunSummary)
      ? (r.lastRunSummary.slice(0, 200) as AutoUpdateRunEntry[])
      : [],
  }
}

/** Load settings from disk. If the file doesn't exist, returns
 *  DEFAULT_SETTINGS WITHOUT writing it — the caller decides whether to
 *  persist defaults (the API GET handler does, the scheduler does not). */
export async function loadSettings(): Promise<AutoUpdateSettings> {
  try {
    const text = await fs.readFile(getSettingsPath(), 'utf8')
    return normalize(JSON.parse(text))
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'ENOENT') {
      return { ...DEFAULT_SETTINGS, categories: { ...DEFAULT_SETTINGS.categories } }
    }
    // Corrupted JSON / permission error: surface defaults so the server
    // keeps booting. The UI's GET handler can detect a corrupted file and
    // surface a "reset" affordance, but boot-time we never block.
    return { ...DEFAULT_SETTINGS, categories: { ...DEFAULT_SETTINGS.categories } }
  }
}

/** Atomic save: write to a tmp file, rename into place. Mode 0600 because
 *  the file does NOT contain secrets but it does represent a trust
 *  boundary (it controls automatic mutations across every agent on the
 *  host). The same scope as ~/.aimaestro/governance.json. */
export async function saveSettings(s: AutoUpdateSettings): Promise<void> {
  const target = getSettingsPath()
  await fs.mkdir(path.dirname(target), { recursive: true })
  // Re-normalize on write so a UI-supplied object can never push an
  // out-of-range interval / unknown category onto disk.
  const clean = normalize(s)
  const tmp = `${target}.tmp.${process.pid}`
  await fs.writeFile(tmp, JSON.stringify(clean, null, 2), { encoding: 'utf8', mode: 0o600 })
  await fs.rename(tmp, target)
}

/** Append a run-summary entry, capping at 200 most-recent. The cap keeps
 *  the file under ~50 KB even with verbose error details. */
export function appendRunEntry(s: AutoUpdateSettings, entry: AutoUpdateRunEntry): AutoUpdateSettings {
  const next: AutoUpdateRunEntry[] = [entry, ...s.lastRunSummary].slice(0, 200)
  return { ...s, lastRunSummary: next }
}
