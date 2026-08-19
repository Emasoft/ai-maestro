// The absorbed rules-cleanup lane (TRDD-5II83KK4) — a line-faithful port of the janitor's
// post-uninstall orphaned-rule cleanup: `rules_installer.py::cleanup_user_orphans_if_uninstalled`
// driven by `daemon.py:1081 task_rules_cleanup` (cadence 3600 s), janitor cache 3.3.16.
//
// WHY THE SERVER MUST DO THIS AT ALL: Claude Code has NO uninstall hook and never removes a
// plugin's `~/.claude/rules/` files, so the janitor's installed rules would sit forever as
// orphans after a full uninstall. The janitor's own answer is its still-running daemon — which
// survives only until its orphaned cache is GC'd (~7 days). The server has no such window: it
// runs indefinitely, so this lane strictly improves on the original (the card's stated reason).
//
// SERVER POSTURE = DAEMON POSTURE: user scope ONLY (`~/.claude/rules/`). The daemon has no
// project context (`_known_rules_dirs` sees only the user dir when `CLAUDE_PROJECT_DIR` is
// unset), and neither does the server; per-project orphans stay with the sessions' own
// `remove_orphaned_rules` — exactly the split the janitor documents.
//
// THE CONFIRMED-UNINSTALLED PREDICATE (mirrors `rules_installer.py::janitor_uninstalled`,
// docstring quoted): "True iff the janitor appears FULLY uninstalled: referenced in NO
// settings.json scope AND its persistent DATA dir is gone. BOTH must hold — requiring the two
// independent signals to agree resists a transient false positive […] A merely DISABLED plugin
// still appears in settings.json, so this returns False for it." Our port checks the same two
// signals in the same AND (user settings.json string-match, then the data dir stat).
//
// SAFETY (mirrors `_remove_janitor_rules_in` + `_is_janitor_installed_rule`): only `*.md` files
// INSIDE `~/.claude/rules/` carrying the provenance marker are ever touched; an unreadable file
// is NEVER removed (fail-closed); no memory store can be affected (nothing outside rulesDir).
//
// DESTRUCTIVE ⇒ DARK-SHIPPED (the parent KCRMSNL7 axis; the janitor itself runs this
// default-ON, but its posture predates the fleet's default-OFF rule for file-deleting lanes):
// unarmed (AIM_RULES_CLEANUP unset) the beat is DETECT-ONLY — it logs what it WOULD remove,
// deletes nothing, stamps nothing, claims nothing, so the janitor daemon keeps the chore.
// Armed (AIM_RULES_CLEANUP=1) it removes, stamps on attempt, and claims `rules-cleanup` in
// `absorbed_chores` (a CONDITIONAL_CHORES entry, same shape as memory-guard).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { markChoreLive, stampChoreRun, unmarkChoreLive } from '@/lib/janitor-chore-stamp'

export const PROVENANCE_MARKER = 'ai-maestro-janitor:installed-rule'
export const JANITOR_PLUGIN_NAME = 'ai-maestro-janitor'
const DEFAULT_INTERVAL_MS = 3_600_000 // the janitor's own cadence (daemon.py:197, 3600 s)

/** The janitor's canonical persistent DATA dir — its ABSENCE is one of the two uninstall
 *  signals (`rules_installer.py::_data_dir`, verbatim path shape). */
export function janitorDataDir(): string {
  return path.join(os.homedir(), '.claude', 'plugins', 'data', `${JANITOR_PLUGIN_NAME}-ai-maestro-plugins`)
}

export function userRulesDir(): string {
  return path.join(os.homedir(), '.claude', 'rules')
}

export function userSettingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json')
}

/** True iff `p` is a rule file the JANITOR installed — it carries the provenance marker.
 *  Fail-closed: an unreadable file returns false (never removed) — `_is_janitor_installed_rule`. */
export function isJanitorInstalledRule(p: string): boolean {
  try {
    return fs.readFileSync(p, 'utf8').includes(PROVENANCE_MARKER)
  } catch {
    return false
  }
}

/** The provenance-marked `*.md` files in `rulesDir`, sorted — the set the sweep would remove.
 *  Split from the remover so the DETECT-ONLY beat can report without deleting. */
export function janitorRuleFilesIn(rulesDir: string): string[] {
  let names: string[]
  try {
    names = fs.readdirSync(rulesDir)
  } catch {
    return [] // absent dir = nothing to clean (the janitor's `if not rules_dir.is_dir()`)
  }
  return names
    .filter((n) => n.endsWith('.md'))
    .sort()
    .map((n) => path.join(rulesDir, n))
    .filter(isJanitorInstalledRule)
}

/** Remove every provenance-marked janitor rule in `rulesDir`; returns the removed paths.
 *  A user's own rule (no marker) is left alone; a per-file unlink error is skipped, never
 *  thrown (`_remove_janitor_rules_in`, line for line). */
export function removeJanitorRulesIn(rulesDir: string): string[] {
  const removed: string[] = []
  for (const p of janitorRuleFilesIn(rulesDir)) {
    try {
      fs.unlinkSync(p)
      removed.push(p)
    } catch {
      continue
    }
  }
  return removed
}

export interface RulesCleanupDeps {
  /** user settings.json text; null = absent/unreadable (both count as "no reference",
   *  matching `_detect_install_scopes`'s swallowed OSError — the data-dir signal guards it) */
  settingsText?: () => string | null
  dataDirExists?: () => boolean
  rulesDir?: string
  enumerate?: (dir: string) => string[]
  remove?: (dir: string) => string[]
  /** the scheduler wires stampChoreRun ONLY when armed; default is no stamp */
  stamp?: () => void
  log?: (msg: string) => void
  armed?: boolean
}

/** BOTH signals must agree (see the header). A merely-disabled plugin still appears in
 *  settings.json ⇒ installed; a settings miss with the data dir still present ⇒ installed. */
export function janitorUninstalled(deps: RulesCleanupDeps = {}): boolean {
  const text = (deps.settingsText ?? readUserSettings)()
  if (text !== null && text.includes(JANITOR_PLUGIN_NAME)) return false
  return !(deps.dataDirExists ?? (() => fs.existsSync(janitorDataDir())))()
}

function readUserSettings(): string | null {
  try {
    return fs.readFileSync(userSettingsPath(), 'utf8')
  } catch {
    return null
  }
}

export interface RulesCleanupResult {
  uninstalled: boolean
  wouldRemove: string[]
  removed: string[]
}

/** One beat. Steady state (janitor installed) is two cheap checks and NO enumeration —
 *  the janitor's own `if not janitor_uninstalled(): return []`. Stamps on ATTEMPT via
 *  deps.stamp (wired only by the armed scheduler). */
export function runRulesCleanup(deps: RulesCleanupDeps = {}): RulesCleanupResult {
  const log = deps.log ?? ((m: string) => console.warn(m))
  deps.stamp?.()
  if (!janitorUninstalled(deps)) return { uninstalled: false, wouldRemove: [], removed: [] }
  const rulesDir = deps.rulesDir ?? userRulesDir()
  const wouldRemove = (deps.enumerate ?? janitorRuleFilesIn)(rulesDir)
  if (wouldRemove.length === 0) return { uninstalled: true, wouldRemove, removed: [] }
  if (!deps.armed) {
    log(
      `[rules-cleanup] janitor uninstalled — would remove ${wouldRemove.length} orphaned rule(s):` +
        ` ${wouldRemove.join(', ')} [detect-only: AIM_RULES_CLEANUP not set]`,
    )
    return { uninstalled: true, wouldRemove, removed: [] }
  }
  const removed = (deps.remove ?? removeJanitorRulesIn)(rulesDir)
  log(`[rules-cleanup] janitor uninstalled — removed ${removed.length} orphaned rule(s): ${removed.join(', ')}`)
  return { uninstalled: true, wouldRemove, removed }
}

/** Fires once immediately (persisted-stamp catch-up is unnecessary here: the beat is two stats
 *  in steady state, so a boot fire costs nothing), then hourly. Claim + stamp ONLY when armed —
 *  unarmed, the janitor daemon keeps executing the chore and nothing here asserts otherwise. */
export function startRulesCleanupScheduler(
  opts: { intervalMs?: number; log?: (msg: string) => void; runBeat?: () => RulesCleanupResult } = {},
): (() => void) | null {
  const raw = Number(process.env.AIM_RULES_CLEANUP_INTERVAL_MS)
  const intervalMs = opts.intervalMs ?? (Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_INTERVAL_MS)
  if (!intervalMs || intervalMs <= 0) return null
  const armed = process.env.AIM_RULES_CLEANUP === '1'
  const log = opts.log ?? ((msg: string) => console.warn(msg))
  const runBeat =
    opts.runBeat ??
    (() =>
      runRulesCleanup({
        armed,
        log,
        stamp: armed ? () => stampChoreRun('rules-cleanup') : undefined,
      }))
  if (armed) markChoreLive('rules-cleanup')
  const beat = () => {
    try {
      runBeat()
    } catch (err) {
      log(`[rules-cleanup] beat threw (non-fatal): ${err instanceof Error ? err.message : err}`)
    }
  }
  beat()
  const timer = setInterval(beat, intervalMs)
  timer.unref?.()
  return () => {
    clearInterval(timer)
    if (armed) unmarkChoreLive('rules-cleanup')
  }
}
