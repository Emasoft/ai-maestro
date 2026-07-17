// Enforces the fixed set of Claude Code RUNTIME env keys (+ one top-level
// timeout) in the user-scope `~/.claude/settings.json`, and re-applies them if
// they drift. The harness cannot function without these — background tasks,
// tool search, subagent forking, the retry watchdog, and the AFK / async-stall
// timeouts are all governed here.
//
// ── Why this is allowed despite `feedback_ai_maestro_never_installs_user_scope`
// (the IRON "no user-scope writes" rule, USER-ratified carve-out 2026-07-17,
// TRDD-QZL828OD):
//   That rule forbids user-scope PLUGIN/ELEMENT enablement — `enabledPlugins`,
//   `extraKnownMarketplaces`, the plugins cache — and its WHY is precise: don't
//   leak AI-Maestro's plugins into the user's OTHER Claude Code projects. This
//   enforcer touches NONE of those keys. It writes only Claude Code runtime
//   BEHAVIOUR settings (the `env` object + one top-level timeout). No plugin,
//   skill, agent, hook, or marketplace is installed or enabled, so nothing
//   leaks — the rule's WHY is not engaged. A change to REQUIRED_ENV /
//   REQUIRED_TOP_LEVEL must keep that true: never add an `enabledPlugins` or
//   marketplace key here.
//
// Safety contract (why each choice is load-bearing):
//   - MERGE, never replace: unrelated `env` keys and unrelated top-level keys
//     the user set are preserved. We only add-if-missing / correct-if-different
//     the fixed allowlist.
//   - Fail-CLOSED on a corrupt or non-object settings.json: refuse to write
//     rather than clobber the user's real settings with our merge base.
//   - Atomic tmp+rename write with a single rolling `.aim-bak` backup, and the
//     existing file mode preserved — a crash mid-write can never leave a
//     truncated settings.json.
//   - Idempotent: when nothing differs we do not write at all (no gratuitous
//     churn, and the watchdog stays quiet).

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

/**
 * The fixed allowlist of Claude Code runtime env keys, placed under the
 * settings.json `env` object. Values are strings — Claude Code env values are
 * always strings, so `false`/`1` are the literal strings, not JS booleans/ints.
 */
export const REQUIRED_ENV: Readonly<Record<string, string>> = Object.freeze({
  ENABLE_BACKGROUND_TASKS: '1',
  ENABLE_TOOL_SEARCH: 'false',
  CLAUDE_CODE_FORK_SUBAGENT: '1',
  CLAUDE_AUTO_BACKGROUND_TASKS: '1',
  CLAUDE_CODE_RETRY_WATCHDOG: '1',
  CLAUDE_AFK_COUNTDOWN_MS: '20000',
  CLAUDE_AFK_TIMEOUT_MS: '300000',
  CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS: '2000000',
})

/** Fixed top-level runtime keys (siblings of `env`, not inside it). */
export const REQUIRED_TOP_LEVEL: Readonly<Record<string, string>> = Object.freeze({
  askUserQuestionTimeout: '60s',
})

export interface EnforceResult {
  /** True iff the file was written this run. */
  changed: boolean
  /** Keys set/corrected this run, as `env.KEY` / `KEY` labels. Empty when unchanged. */
  applied: string[]
  /** Set when we deliberately refused to write (corrupt/non-object file, or I/O error). */
  error?: string
  /** The settings.json path acted on. */
  path: string
}

/** The user-scope settings file Claude Code reads its global config from. */
function defaultSettingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json')
}

/** Preserve the existing file mode; default to 0644 (Claude Code's own default) for a new file. */
function fileMode(file: string): number {
  try {
    return fs.statSync(file).mode & 0o777
  } catch {
    return 0o644
  }
}

/**
 * Ensure REQUIRED_ENV + REQUIRED_TOP_LEVEL are present-and-equal in the
 * settings file, preserving every unrelated key. Writes only when something
 * differs. Never throws — every failure is reported via {@link EnforceResult.error}.
 *
 * @param target Optional explicit path (used by tests); defaults to the
 *   user-scope `~/.claude/settings.json`.
 */
export function enforceClaudeSettings(target?: string): EnforceResult {
  const file = target ?? defaultSettingsPath()

  // Read the current file, distinguishing "absent" (create fresh) from a real
  // read error (refuse — a permissions failure must not become a blind write).
  let raw: string | null = null
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      return { changed: false, applied: [], error: `read failed: ${(e as Error).message}`, path: file }
    }
    // ENOENT → the file does not exist yet; we will create it.
  }

  let obj: Record<string, unknown> = {}
  if (raw !== null && raw.trim() !== '') {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (e) {
      // Corrupt JSON — NEVER overwrite. A blind merge-and-write here would
      // destroy whatever the user actually has. Report and leave it untouched.
      return {
        changed: false,
        applied: [],
        error: `settings.json is not valid JSON; refusing to write (${(e as Error).message})`,
        path: file,
      }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        changed: false,
        applied: [],
        error: 'settings.json is not a JSON object; refusing to write',
        path: file,
      }
    }
    obj = parsed as Record<string, unknown>
  }

  const applied: string[] = []

  // env — copy the existing object so unrelated env keys survive the merge.
  // A missing or malformed (non-object) `env` starts as {}, so every required
  // key is flagged as applied and the object is (re)attached below.
  const prevEnv = obj.env
  const env: Record<string, unknown> =
    prevEnv && typeof prevEnv === 'object' && !Array.isArray(prevEnv)
      ? { ...(prevEnv as Record<string, unknown>) }
      : {}
  for (const [k, v] of Object.entries(REQUIRED_ENV)) {
    if (env[k] !== v) {
      env[k] = v
      applied.push(`env.${k}`)
    }
  }

  // top-level runtime keys
  for (const [k, v] of Object.entries(REQUIRED_TOP_LEVEL)) {
    if (obj[k] !== v) {
      obj[k] = v
      applied.push(k)
    }
  }

  if (applied.length === 0) {
    return { changed: false, applied: [], path: file }
  }
  obj.env = env

  // Backup-then-atomic-write. mkdir first so a fresh `.claude/` is created.
  const mode = fileMode(file)
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    if (raw !== null) {
      // Single rolling backup of the pre-change content.
      fs.writeFileSync(`${file}.aim-bak`, raw, { mode })
    }
    const tmp = `${file}.tmp.${process.pid}`
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', { mode })
    fs.renameSync(tmp, file)
  } catch (e) {
    return { changed: false, applied: [], error: `write failed: ${(e as Error).message}`, path: file }
  }

  return { changed: true, applied, path: file }
}

// ── The restore-on-drift watchdog ──────────────────────────────────────────
// Mirrors lib/agent-invariants.ts's watchdog: idempotent, unref'd, never throws.
// A background loop bounds how long a drifted setting lives to one interval,
// and re-applies the allowlist if anything (a user, another tool) changes it.

const WATCHDOG_INTERVAL_MS = Math.max(
  0,
  Number(process.env.AIM_SETTINGS_ENFORCER_INTERVAL_MS) || 300_000
)

let watchdogTimer: NodeJS.Timeout | null = null

/**
 * Start the single restore-on-drift loop. Returns false if already running or
 * if `intervalMs <= 0` (disabled). Never throws; a sweep failure only logs.
 */
export function startClaudeSettingsEnforcerWatchdog(
  intervalMs: number = WATCHDOG_INTERVAL_MS
): boolean {
  if (watchdogTimer !== null || intervalMs <= 0) return false
  watchdogTimer = setInterval(() => {
    try {
      const r = enforceClaudeSettings()
      if (r.error) console.warn(`[SettingsEnforcer] ${r.error}`)
      else if (r.changed) console.warn(`[SettingsEnforcer] restored ${r.applied.join(', ')} in ${r.path}`)
    } catch (e) {
      console.warn('[SettingsEnforcer] sweep failed:', e instanceof Error ? e.message : e)
    }
  }, intervalMs)
  watchdogTimer.unref()
  return true
}

/** Stop the watchdog (used by tests and graceful shutdown). */
export function stopClaudeSettingsEnforcerWatchdog(): void {
  if (watchdogTimer !== null) {
    clearInterval(watchdogTimer)
    watchdogTimer = null
  }
}
