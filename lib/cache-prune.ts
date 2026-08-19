// Absorbed cache-prune lane — TRDD-B8B6D56P (parent KCRMSNL7). A line-faithful port of the
// janitor's `scripts/lib/cache_prune.py` (3.3.16) + `daemon.py::task_cache_prune`, so the
// server can claim the `cache-prune` chore and the daemon's ONE-DAEMON-PER-HOST exit gets a
// step closer to `server_owns_every_chore`.
//
// WHAT IT DOES: the plugin cache `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`
// grows without bound (a fast-publishing plugin ships several versions a day; measured: one
// plugin at 49 cached versions, the cache at 4.5 GB). Each beat plans and deletes the stale
// version dirs. A cache dir is regeneratable (re-downloaded on demand), so the delete is
// safe-by-construction.
//
// THE CARDINAL SAFETY RULE, ported verbatim and the reason this is more than "keep newest N":
//
//     NEVER prune a version a LIVE session might still have loaded.
//
// A `claude` session loaded the plugin version current when it STARTED and may have reloaded
// forward — so nothing with a dir mtime newer than the OLDEST live session's start (minus a
// margin) is ever eligible. The fixed MIN_AGE floor is only the secondary guard for when no
// long session is running. This cutoff is exactly why the 2026-08-05 absorbability review
// said "no" (recorded in .claude/project/memory/janitor-chore-absorbability.md): absorbing
// the prune WITHOUT the cutoff takes the one chore whose failure mode is pulling a plugin
// out from under a running session. The absorption is safe BECAUSE the cutoff comes along.
//
// Decision functions are PURE (versions + mtimes + cutoff in, plan out); the lane gathers
// inputs — including a ps snapshot written TO A FILE first (the no-self-match discipline;
// the file doubles as the forensic record) — and applies the deletes best-effort.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { statePath } from '@/lib/ecosystem-constants'
import { stampChoreRun } from '@/lib/janitor-chore-stamp'

const execFileAsync = promisify(execFile)

/** A plugin-cache version directory name: a dotted-int run, optionally with a pre-release /
 *  build suffix (`1.2.3`, `1.0.0-rc1`). Mirrors the janitor's `_SEMVERISH_RE` (issue #137:
 *  a malformed record must contribute NOTHING rather than a wrong answer). */
const SEMVERISH_RE = /^\d+(?:\.\d+)*(?:[-+][0-9A-Za-z.]+)?$/

/**
 * True iff `command` (a full ps argv line) is a real Claude Code CLI session. Ported
 * verbatim: argv[0] BASENAME exactly `claude`, or the versioned binary path anywhere in the
 * line. Over-detection is SAFE (a false positive only KEEPS more cache); never
 * substring-match `claude` — it would hit `.claude` paths, plugin names like
 * `claude-plugins-validation`, and python argvs about claude.
 */
export function isClaudeSession(command: string): boolean {
  const line = command.trim()
  if (!line) return false
  const first = line.split(/\s+/)[0]
  if (path.basename(first) === 'claude') return true
  return line.includes('/share/claude/versions/')
}

/**
 * Parse a ps `etime` value — `[[dd-]hh:]mm:ss` — into seconds. An unparseable value returns
 * 0 (start ≈ now): the min-age floor still guards, and `oldestClaudeSessionStart` can only
 * ever LOWER the cutoff, so a too-recent estimate never prunes more than the floor allows.
 */
export function parseEtimeSeconds(etime: string): number {
  const m = etime.trim().match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/)
  if (!m) return 0
  const [, dd, hh, mm, ss] = m
  return (
    (dd ? parseInt(dd, 10) * 86400 : 0) +
    (hh ? parseInt(hh, 10) * 3600 : 0) +
    parseInt(mm, 10) * 60 +
    parseInt(ss, 10)
  )
}

/** The START epoch of the OLDEST live Claude session, or null when none is detected. Pure —
 *  the caller supplies the (command, etimeS) rows from its snapshot. */
export function oldestClaudeSessionStart(
  sessions: readonly { command: string; etimeS: number }[],
  now: number,
): number | null {
  let oldest: number | null = null
  for (const s of sessions) {
    if (!isClaudeSession(s.command)) continue
    const start = now - Math.max(0, s.etimeS)
    if (oldest === null || start < oldest) oldest = start
  }
  return oldest
}

/** Versions whose dir mtime is STRICTLY OLDER than the returned epoch are old enough to
 *  prune: `now - minAgeS`, but never newer than `oldestSessionStart - sessionMarginS`. */
export function pruneCutoff(args: {
  now: number
  minAgeS: number
  oldestSessionStart: number | null
  sessionMarginS: number
}): number {
  let cutoff = args.now - Math.max(0, args.minAgeS)
  if (args.oldestSessionStart !== null) {
    cutoff = Math.min(cutoff, args.oldestSessionStart - Math.max(0, args.sessionMarginS))
  }
  return cutoff
}

/**
 * Decide (prune, keep) for ONE plugin's ASCENDING-sorted version list. Pure. KEEP = the
 * newest `keepRecent` ∪ EVERY pinned version — `pinned` is a SET because one host holds
 * several install records for one plugin (user scope + one per agent workdir), each free to
 * sit on a different version; protecting only one left the rest prunable while actively
 * loaded (janitor issue #137). Unknown mtime defaults to `now` → kept (never prune what you
 * cannot date).
 */
export function planPluginPrune(args: {
  versions: readonly string[]
  versionMtime: Readonly<Record<string, number>>
  pinned: ReadonlySet<string>
  keepRecent: number
  cutoffEpoch: number
  now: number
}): { prune: string[]; keep: string[] } {
  const protectedSet = new Set<string>(args.keepRecent > 0 ? args.versions.slice(-args.keepRecent) : [])
  for (const p of args.pinned) protectedSet.add(p)
  const prune: string[] = []
  const keep: string[] = []
  for (const v of args.versions) {
    if (protectedSet.has(v)) {
      keep.push(v)
      continue
    }
    if ((args.versionMtime[v] ?? args.now) < args.cutoffEpoch) prune.push(v)
    else keep.push(v)
  }
  return { prune, keep }
}

/**
 * EVERY version of `<plugin>@<marketplace>` that some install record uses — read from the
 * record FIELDS (`version`, else the `installPath`/`path` leaf), never a blob scan (a wrong
 * version asserted with confidence is worse than a missing one). Malformed input → empty set
 * ("nothing known to be in use"); `keepRecent` still protects the current version.
 */
export function pinnedVersionsFor(installedPlugins: unknown, plugin: string, marketplace: string): Set<string> {
  const found = new Set<string>()
  const plugins = (installedPlugins as { plugins?: unknown } | null)?.plugins
  if (!plugins || typeof plugins !== 'object' || Array.isArray(plugins)) return found
  const entry = (plugins as Record<string, unknown>)[`${plugin}@${marketplace}`]
  const records = Array.isArray(entry) ? entry : [entry]
  for (const rec of records) {
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) continue
    const r = rec as Record<string, unknown>
    const version = r.version
    if (typeof version === 'string' && SEMVERISH_RE.test(version.trim())) {
      found.add(version.trim())
      continue
    }
    // The current schema writes `installPath` (verified live), an older one wrote `path`.
    for (const key of ['installPath', 'path'] as const) {
      const raw = r[key]
      if (typeof raw !== 'string') continue
      const leaf = raw.replace(/\/+$/, '').split('/').pop() ?? ''
      if (SEMVERISH_RE.test(leaf)) {
        found.add(leaf)
        break
      }
    }
  }
  return found
}

/** Ascending sort by the leading dotted-int run; a name with no leading digit sorts first
 *  ("oldest/unknown"). Numeric, not lexical: 0.9.0 < 0.10.0. */
export function semverSorted(versionDirs: readonly string[]): string[] {
  const key = (name: string): [number, number[]] => {
    const parts: number[] = []
    for (const seg of name.split('.')) {
      let num = ''
      for (const ch of seg) {
        if (ch >= '0' && ch <= '9') num += ch
        else break
      }
      if (num === '') break
      parts.push(parseInt(num, 10))
    }
    return [parts.length ? 1 : 0, parts]
  }
  return [...versionDirs].sort((a, b) => {
    const [fa, pa] = key(a)
    const [fb, pb] = key(b)
    if (fa !== fb) return fa - fb
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const da = pa[i] ?? -1
      const db = pb[i] ?? -1
      if (da !== db) return da - db
    }
    return 0
  })
}

export interface PrunePlan {
  pluginDir: string
  marketplace: string
  plugin: string
  pinned: Set<string>
  prune: string[]
  keep: string[]
}

/** Build a prune plan for every `<marketplace>/<plugin>/` under `cacheRoot`. Reads dir
 *  listings + mtimes only — no deletes. */
export function planCachePrune(
  cacheRoot: string,
  installedPlugins: unknown,
  args: { keepRecent: number; cutoffEpoch: number; now: number },
): PrunePlan[] {
  const plans: PrunePlan[] = []
  if (!fs.existsSync(cacheRoot) || !fs.statSync(cacheRoot).isDirectory()) return plans
  const dirsIn = (p: string): string[] =>
    fs
      .readdirSync(p, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
  for (const market of dirsIn(cacheRoot)) {
    const marketDir = path.join(cacheRoot, market)
    for (const plugin of dirsIn(marketDir)) {
      const pluginDir = path.join(marketDir, plugin)
      const versionDirs = dirsIn(pluginDir)
      if (versionDirs.length === 0) continue
      const versions = semverSorted(versionDirs)
      const mtimes: Record<string, number> = {}
      for (const v of versions) {
        try {
          mtimes[v] = Math.floor(fs.statSync(path.join(pluginDir, v)).mtimeMs / 1000)
        } catch {
          mtimes[v] = args.now // undateable → treated as now → never pruned
        }
      }
      const pinned = pinnedVersionsFor(installedPlugins, plugin, market)
      const { prune, keep } = planPluginPrune({
        versions,
        versionMtime: mtimes,
        pinned,
        keepRecent: args.keepRecent,
        cutoffEpoch: args.cutoffEpoch,
        now: args.now,
      })
      if (prune.length > 0) plans.push({ pluginDir, marketplace: market, plugin, pinned, prune, keep })
    }
  }
  return plans
}

/** Delete the planned version dirs. Best-effort: a failed delete is recorded, never thrown —
 *  a cache prune must never crash the server. */
export function applyPrunePlan(plans: readonly PrunePlan[]): { removed: string[]; failed: string[] } {
  const removed: string[] = []
  const failed: string[] = []
  for (const plan of plans) {
    for (const version of plan.prune) {
      const rel = `${plan.marketplace}/${plan.plugin}/${version}`
      try {
        fs.rmSync(path.join(plan.pluginDir, version), { recursive: true, force: false })
        removed.push(rel)
      } catch {
        failed.push(rel)
      }
    }
  }
  return { removed, failed }
}

// ── the lane ─────────────────────────────────────────────────────────────────────────────

/** Janitor-roster cadence: 6 h. 0 disables. */
const DEFAULT_INTERVAL_MS = Number(process.env.AIM_CACHE_PRUNE_INTERVAL_MS) || 21_600_000

const DEFAULT_KEEP_RECENT = 5
const DEFAULT_MIN_AGE_DAYS = 7
const DEFAULT_SESSION_MARGIN_HOURS = 24

function envInt(name: string, dflt: number): number {
  const v = Number(process.env[name])
  return Number.isFinite(v) && v >= 0 ? v : dflt
}

/** Snapshot ps TO A FILE (forensic record + the no-self-match discipline), then parse
 *  (etime, command) rows from the captured text. Best-effort: [] on any failure — an empty
 *  session list only means the min-age floor alone guards, which is the janitor's own
 *  degraded mode too. */
export async function snapshotSessions(
  snapshotFile: string = statePath('cache-prune.ps-snapshot.txt'),
): Promise<{ command: string; etimeS: number }[]> {
  try {
    const { stdout } = await execFileAsync('ps', ['-axo', 'etime=,command='], {
      timeout: 10_000,
      maxBuffer: 8 * 1024 * 1024,
    })
    try {
      fs.mkdirSync(path.dirname(snapshotFile), { recursive: true })
      fs.writeFileSync(snapshotFile, stdout)
    } catch {
      /* the snapshot file is forensics, never load-bearing */
    }
    const rows: { command: string; etimeS: number }[] = []
    for (const line of stdout.split('\n')) {
      const t = line.trim()
      if (!t) continue
      const sp = t.indexOf(' ')
      if (sp <= 0) continue
      rows.push({ etimeS: parseEtimeSeconds(t.slice(0, sp)), command: t.slice(sp + 1).trim() })
    }
    return rows
  } catch {
    return []
  }
}

export interface CachePruneDeps {
  cacheRoot?: string
  installedPluginsPath?: string
  sessions?: () => Promise<{ command: string; etimeS: number }[]>
  now?: () => number
  /** Stamp writer — the real janitor-chore-stamp by default; tests pass a spy. */
  stamp?: () => void
}

export interface CachePruneResult {
  plans: number
  removed: string[]
  failed: string[]
  oldestSessionAgeS: number | null
  cutoffAgeS: number
}

/**
 * One cache-prune beat. Stamps the chore on ATTEMPT COMPLETION (success or partial failure)
 * — the stamp answers "is anyone doing this on cadence?", and a flaky beat is still owned;
 * failures have their own reporting (the returned `failed` list, logged by the scheduler).
 */
export async function runCachePrune(deps: CachePruneDeps = {}): Promise<CachePruneResult> {
  const now = (deps.now ?? (() => Math.floor(Date.now() / 1000)))()
  const cacheRoot = deps.cacheRoot ?? path.join(os.homedir(), '.claude', 'plugins', 'cache')
  const installedPath = deps.installedPluginsPath ?? path.join(path.dirname(cacheRoot), 'installed_plugins.json')

  const sessions = await (deps.sessions ?? snapshotSessions)()
  const oldestStart = oldestClaudeSessionStart(sessions, now)
  const cutoff = pruneCutoff({
    now,
    minAgeS: envInt('AIM_CACHE_PRUNE_MIN_AGE_DAYS', DEFAULT_MIN_AGE_DAYS) * 86400,
    oldestSessionStart: oldestStart,
    sessionMarginS: envInt('AIM_CACHE_PRUNE_SESSION_MARGIN_HOURS', DEFAULT_SESSION_MARGIN_HOURS) * 3600,
  })

  let installed: unknown = {}
  try {
    installed = JSON.parse(fs.readFileSync(installedPath, 'utf8'))
  } catch {
    installed = {} // no pin info → keepRecent still protects the current version
  }

  const plans = planCachePrune(cacheRoot, installed, {
    keepRecent: envInt('AIM_CACHE_PRUNE_KEEP_RECENT', DEFAULT_KEEP_RECENT),
    cutoffEpoch: cutoff,
    now,
  })
  const { removed, failed } = plans.length ? applyPrunePlan(plans) : { removed: [], failed: [] }
  ;(deps.stamp ?? (() => stampChoreRun('cache-prune')))()
  return {
    plans: plans.length,
    removed,
    failed,
    oldestSessionAgeS: oldestStart === null ? null : now - oldestStart,
    cutoffAgeS: now - cutoff,
  }
}

let inFlight = false

async function beat(log: (msg: string) => void): Promise<void> {
  if (inFlight) return
  inFlight = true
  try {
    const r = await runCachePrune()
    if (r.removed.length || r.failed.length) {
      const sess =
        r.oldestSessionAgeS === null ? 'no live session' : `oldest live session ~${Math.floor(r.oldestSessionAgeS / 3600)}h old`
      log(
        `[cache-prune] removed ${r.removed.length} stale version dir(s) across ${r.plans} plugin(s) ` +
          `(cutoff ${Math.floor(r.cutoffAgeS / 86400)}d back; ${sess})` +
          (r.failed.length ? `; ${r.failed.length} delete(s) FAILED: ${r.failed.join(', ')}` : ''),
      )
    }
  } catch (err) {
    log(`[cache-prune] beat threw (non-fatal): ${err instanceof Error ? err.message : err}`)
  } finally {
    inFlight = false
  }
}

/** Start the recurring prune. Same shape as startGithubConfigAuditScheduler: fires once
 *  immediately (a bare interval would starve under a restart loop shorter than 6 h),
 *  unref'd, never throws. Returns a stop function, or null when disabled (interval <= 0). */
export function startCachePruneScheduler(
  opts: { intervalMs?: number; log?: (msg: string) => void } = {},
): (() => void) | null {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS
  if (!intervalMs || intervalMs <= 0) return null
  const log = opts.log ?? ((msg: string) => console.warn(msg))
  void beat(log)
  const timer = setInterval(() => void beat(log), intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}
