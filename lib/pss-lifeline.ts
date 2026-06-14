/**
 * PSS component-lifeline integration for the chat-history browser context panel
 * (TRDD-1657a5f4, Phase 7).
 *
 * GOAL
 * ----
 * Given a conversation timestamp T, surface a best-effort list of the Claude Code
 * components (skills / agents / commands / rules / MCP / plugins …) that PSS recorded
 * as ACTIVE at that moment. This powers the context panel's "what was loaded then"
 * view next to a chat message.
 *
 * PRIMARY REQUIREMENT — NEVER BREAK THE PAGE
 * ------------------------------------------
 * The chat browser must render whether or not PSS exists, is fresh, or has any
 * history. This module therefore NEVER throws to its caller. Every failure mode —
 * binary missing, DB missing/empty, stale data, malformed output, a hung process —
 * resolves to a clean `LifelineResult` with `status: 'unavailable' | 'stale'` and an
 * empty `components` array. The caller renders a quiet "lifeline unavailable" /
 * "lifeline stale" note instead of crashing.
 *
 * WHY SHELL OUT (and NEVER read the DB)
 * -------------------------------------
 * PSS ships no MCP server and no Node binding — the only sanctioned integration is the
 * native binary (per IN-2 investigation §3). The CozoDB-on-SQLite file requires honoring
 * an fcntl lock or cozo-ce SIGABRTs ("database is locked"); the `as-of` dedup/exclude-removed
 * logic is non-trivial business logic that would drift if reimplemented in JS. So we shell
 * out, read-only, with `execFile` (args ARRAY — the timestamp flows into argv, never a
 * shell, so no injection) under a hard timeout. We NEVER run `reindex` or any write verb:
 * mutating PSS state from the dashboard violates the project's "investigate before changing"
 * + "no silent mutation" rules, and a reindex takes the exclusive DB lock.
 *
 * KNOWN CONSTRAINTS (IN-2 §4 "PSS#10")
 * ------------------------------------
 * - P-1: there is NO single "active in folder X at T" verb. `as-of --scope project
 *   --scope-path <slug>` returns project/local elements, but per-folder plugin/user
 *   ENABLEMENT at a past timestamp is not modeled. We therefore query best-effort and
 *   tag every component with its scope so the UI can be honest about over-reporting.
 * - P-3/P-4: on a freshly-seeded DB, reindex effectively never re-runs, so most history
 *   is a single synthetic `installed` event at the migration date. The health gate makes
 *   this visible (`status: 'stale'` when the newest scan is older than STALE_THRESHOLD).
 * - P-6: an absolute project path does NOT map to the stored `scope_path` slug reliably.
 *   We pass the absolute path to `--scope-path` (the flag the binary documents) AND keep
 *   a basename fallback — but treat a path mismatch as "no project rows", never an error.
 *
 * VERIFIED against pss 3.7.2 on 2026-05-30 (live binary, real DB):
 *   - `as-of <DATE> [--type T] [--scope S] [--scope-path P] [--limit N]` emits a JSON
 *     array by default (NO `--format` flag; passing one is an arg error). `--limit`
 *     defaults to 1000. Each row: {element_id, element_name, element_type, scope,
 *     scope_path, path, content_hash, file_size, token_count, enabled, event_type}.
 *   - `health --verbose` prints `OK (N entries)`; exit 0=populated, 1=empty/corrupt,
 *     2=missing.
 *   - `scan-log --limit N --format json` emits an array, most-recent-first, each row
 *     carrying `finished_at` / `started_at` (RFC3339). (`scan-log` DOES take `--format`.)
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

/** A single component PSS reports as active at the queried timestamp. */
export interface LifelineComponent {
  /** Element name, e.g. "parallel-tester-agent". */
  name: string
  /** PSS element type: skill | agent | command | rule | mcp | lsp | hook | plugin | … */
  type: string
  /** PSS scope: user | project | local | plugin | marketplace. Lets the UI flag over-reporting (P-1). */
  scope?: string
  /**
   * Best-effort install timestamp (ISO). On a freshly-seeded PSS DB this is usually the
   * migration date, NOT the true install date (P-4) — the UI should present it as "first seen".
   * null when PSS has no usable timestamp.
   */
  installedAtIso?: string | null
}

/**
 * Result of a lifeline query. ALWAYS resolved (never thrown), so the caller can render
 * unconditionally.
 *   - 'ok'          → `components` is meaningful (best-effort, possibly over-reporting per P-1).
 *   - 'stale'       → PSS exists but its newest scan is older than STALE_THRESHOLD_SEC;
 *                     `components` is still returned best-effort but the UI should warn.
 *   - 'unavailable' → PSS binary/DB missing, empty, or output unparseable; `components` is [].
 */
export interface LifelineResult {
  status: 'ok' | 'stale' | 'unavailable'
  /** Human-readable reason for a non-'ok' status (for a UI tooltip / log). */
  reason?: string
  /** The ISO timestamp we queried PSS for (echo of `atMs` as RFC3339). */
  asOfIso?: string
  /** Age in seconds of PSS's newest scan at query time, or null when unknown. */
  scanAgeSec?: number | null
  components: LifelineComponent[]
}

/** Hard ceiling on each binary invocation. PSS `as-of` is <50ms on a 9k-event DB; 4s is generous. */
const EXEC_TIMEOUT_MS = 4_000

/** Newest-scan age above which we report 'stale'. 24h per IN-2 §3 step-3 recommendation. */
const STALE_THRESHOLD_SEC = 24 * 60 * 60

/** `as-of --limit` cap. The default is 1000; we raise it so a busy project isn't silently truncated (P-7). */
const AS_OF_LIMIT = 100_000

/** Plugin cache root that holds versioned PSS binaries: <root>/<version>/bin/pss-<os>-<arch>. */
const PSS_CACHE_ROOT = path.join(
  os.homedir(),
  '.claude',
  'plugins',
  'cache',
  'emasoft-plugins',
  'perfect-skill-suggester',
)

/**
 * Map Node's os.arch()/os.platform() to PSS's binary naming (pss-<platform>-<arch>).
 * Mirrors pss-hook-dispatch.sh normalization (aarch64→arm64, amd64/x64→x86_64).
 */
function pssBinaryBasename(): string | null {
  const plat = os.platform() // 'darwin' | 'linux' | 'win32' | …
  const rawArch = os.arch() // 'arm64' | 'x64' | …
  let platform: string
  if (plat === 'darwin') platform = 'darwin'
  else if (plat === 'linux') platform = 'linux'
  else if (plat === 'win32') platform = 'windows'
  else return null // unsupported platform → caller falls back to PATH/unavailable

  let arch: string
  if (rawArch === 'arm64' || rawArch === 'aarch64') arch = 'arm64'
  else if (rawArch === 'x64' || rawArch === 'amd64' || rawArch === 'x86_64') arch = 'x86_64'
  else return null

  const ext = platform === 'windows' ? '.exe' : ''
  return `pss-${platform}-${arch}${ext}`
}

/**
 * Compare two semver-ish version dir names so we can pick the newest cached PSS.
 * Returns >0 when a is newer than b. Non-numeric segments fall back to string compare.
 */
function compareVersionDesc(a: string, b: string): number {
  const pa = a.split('.')
  const pb = b.split('.')
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const na = Number(pa[i] ?? '0')
    const nb = Number(pb[i] ?? '0')
    if (Number.isFinite(na) && Number.isFinite(nb)) {
      if (na !== nb) return nb - na // descending
    } else {
      const sa = pa[i] ?? ''
      const sb = pb[i] ?? ''
      if (sa !== sb) return sb.localeCompare(sa)
    }
  }
  return 0
}

let cachedBinPath: string | null | undefined // undefined = not resolved yet; null = resolved-but-absent

/**
 * Resolve the PSS binary path best-effort, memoized for the process lifetime.
 * Order: (1) `pss` / `pss-<os>-<arch>` on PATH, (2) newest version under the plugin
 * cache. Returns null if nothing is found — the caller degrades to 'unavailable'.
 *
 * Memoization note: a fresh PSS install mid-process won't be picked up until restart.
 * That's acceptable — the panel is read-only and a stale "unavailable" is harmless, and
 * server processes are long-lived. We deliberately do NOT re-stat on every request.
 */
async function resolvePssBinary(): Promise<string | null> {
  if (cachedBinPath !== undefined) return cachedBinPath

  const candidates: string[] = []
  const archBasename = pssBinaryBasename()

  // (1) PATH lookups — `pss` wrapper first, then the raw per-arch binary name.
  for (const name of ['pss', archBasename].filter((n): n is string => Boolean(n))) {
    try {
      const { stdout } = await execFileAsync(
        process.platform === 'win32' ? 'where' : 'which',
        [name],
        { timeout: EXEC_TIMEOUT_MS },
      )
      const resolved = stdout.split(/\r?\n/)[0]?.trim()
      if (resolved && fs.existsSync(resolved)) {
        cachedBinPath = resolved
        return cachedBinPath
      }
    } catch {
      // not on PATH — try the next candidate. NEVER propagate.
    }
  }

  // (2) Plugin cache — pick the newest version dir that actually contains our arch binary.
  if (archBasename) {
    try {
      const versions = fs
        .readdirSync(PSS_CACHE_ROOT, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort(compareVersionDesc)
      for (const v of versions) {
        const p = path.join(PSS_CACHE_ROOT, v, 'bin', archBasename)
        if (fs.existsSync(p)) {
          candidates.push(p)
          break // newest with the binary present wins
        }
      }
    } catch {
      // cache dir missing/unreadable — fall through to 'not found'.
    }
  }

  cachedBinPath = candidates[0] ?? null
  return cachedBinPath
}

/**
 * Run a PSS verb, returning stdout on success or null on ANY failure (missing binary,
 * non-zero exit, timeout, etc.). NEVER throws. Args are always an array (no shell).
 */
async function runPss(bin: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(bin, args, {
      timeout: EXEC_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024, // a busy project's as-of output can be large; 16MB headroom
      windowsHide: true,
    })
    return stdout
  } catch {
    // Non-zero exit, timeout, ENOENT — all degrade silently. The caller decides the status.
    return null
  }
}

/**
 * Read PSS's newest-scan age in seconds via `scan-log --limit 1 --format json`.
 * Returns null when scan-log is unavailable or unparseable (the caller treats that as
 * "freshness unknown" — NOT as a hard error).
 */
async function newestScanAgeSec(bin: string, nowMs: number): Promise<number | null> {
  const out = await runPss(bin, ['scan-log', '--limit', '1', '--format', 'json'])
  if (out === null) return null
  try {
    const parsed = JSON.parse(out)
    if (!Array.isArray(parsed) || parsed.length === 0) return null
    const row = parsed[0] as Record<string, unknown>
    // Prefer finished_at; fall back to started_at if a scan is mid-flight.
    const ts =
      (typeof row.finished_at === 'string' && row.finished_at) ||
      (typeof row.started_at === 'string' && row.started_at) ||
      null
    if (!ts) return null
    const scanMs = Date.parse(ts)
    if (!Number.isFinite(scanMs)) return null
    const ageSec = Math.max(0, Math.round((nowMs - scanMs) / 1000))
    return ageSec
  } catch {
    return null
  }
}

/**
 * Shape of a single `as-of` JSON row (the fields we consume). Extra fields are ignored.
 */
interface AsOfRow {
  element_name?: unknown
  element_type?: unknown
  scope?: unknown
  observed_at?: unknown
  installed_at?: unknown
}

/** Coerce one as-of row into a LifelineComponent, or null if it lacks a usable name/type. */
function rowToComponent(row: AsOfRow): LifelineComponent | null {
  const name = typeof row.element_name === 'string' ? row.element_name : null
  const type = typeof row.element_type === 'string' ? row.element_type : null
  if (!name || !type) return null
  const scope = typeof row.scope === 'string' ? row.scope : undefined
  // as-of rows don't carry a dedicated install timestamp; best-effort from observed_at/installed_at.
  let installedAtIso: string | null = null
  if (typeof row.installed_at === 'string' && row.installed_at) installedAtIso = row.installed_at
  else if (typeof row.observed_at === 'string' && row.observed_at) installedAtIso = row.observed_at
  return { name, type, scope, installedAtIso }
}

/**
 * Run one `as-of` query and parse it into components. Returns null on any failure so the
 * caller can decide whether a partial set still counts as 'ok'. `scopeFilter` / `scopePath`
 * are optional; when omitted PSS returns all scopes at that cutoff.
 */
async function asOfComponents(
  bin: string,
  iso: string,
  scopeFilter?: string,
  scopePath?: string,
): Promise<LifelineComponent[] | null> {
  const args = ['as-of', iso, '--limit', String(AS_OF_LIMIT)]
  if (scopeFilter) {
    args.push('--scope', scopeFilter)
    if (scopePath) args.push('--scope-path', scopePath)
  }
  const out = await runPss(bin, args)
  if (out === null) return null
  try {
    const parsed = JSON.parse(out)
    if (!Array.isArray(parsed)) return null
    const components: LifelineComponent[] = []
    for (const raw of parsed) {
      if (raw && typeof raw === 'object') {
        const c = rowToComponent(raw as AsOfRow)
        if (c) components.push(c)
      }
    }
    return components
  } catch {
    return null
  }
}

/**
 * componentsActiveAt — best-effort "which components were active in `projectDir` at `atMs`".
 *
 * Pipeline (every step degrades cleanly, never throws):
 *   1. Resolve the PSS binary. Missing → 'unavailable'.
 *   2. HEALTH GATE: `health --verbose` exit code. 1=empty/2=missing → 'unavailable'.
 *   3. FRESHNESS GATE: newest scan age via scan-log. Older than STALE_THRESHOLD_SEC → mark 'stale'
 *      (still return best-effort components so the panel shows *something*).
 *   4. QUERY: union of project-scoped (folder-bound) + user-scoped (global) `as-of` results.
 *      Per P-1 we deliberately scope to project + user only — plugin/marketplace rows in the
 *      live DB carry no real per-folder enablement signal and would massively over-report.
 *      A user can still see plugin-provided elements indirectly (their skills surface as
 *      user/plugin-scope rows once reindexed). If BOTH queries fail to parse → 'unavailable'.
 *
 * @param projectDir Absolute path to the conversation's project folder. Queried against PSS's
 *                   `--scope-path` filter both verbatim AND as its basename (P-6: the live DB
 *                   stores the bare basename slug, not the absolute path).
 * @param atMs       Unix epoch milliseconds of the conversation timestamp T.
 */
export async function componentsActiveAt(projectDir: string, atMs: number): Promise<LifelineResult> {
  try {
    // Defensive input handling — the route validates too, but this function is also a
    // direct lib export and must never assume sanitized input.
    if (!Number.isFinite(atMs)) {
      return { status: 'unavailable', reason: 'invalid timestamp', components: [] }
    }
    const iso = new Date(atMs).toISOString()
    const nowMs = Date.now()

    const bin = await resolvePssBinary()
    if (!bin) {
      return {
        status: 'unavailable',
        reason: 'PSS binary not found on PATH or in plugin cache',
        asOfIso: iso,
        scanAgeSec: null,
        components: [],
      }
    }

    // (2) Health gate. health --verbose exits 0=populated, 1=empty/corrupt, 2=missing.
    // runPss returns null on non-zero exit → can't distinguish 1 vs 2 vs error, all → unavailable.
    const healthOut = await runPss(bin, ['health', '--verbose'])
    if (healthOut === null) {
      return {
        status: 'unavailable',
        reason: 'PSS database empty, missing, or health probe failed',
        asOfIso: iso,
        scanAgeSec: null,
        components: [],
      }
    }

    // (3) Freshness gate.
    const scanAgeSec = await newestScanAgeSec(bin, nowMs)
    const isStale = scanAgeSec !== null && scanAgeSec > STALE_THRESHOLD_SEC

    // (4) Best-effort union of project-scoped + user-scoped active components.
    //
    // P-6 mitigation: PSS stores `scope_path` as a slug that, on the live DB, is the bare
    // project BASENAME (e.g. "ai-maestro"), NOT the absolute path. Passing the absolute path
    // to --scope-path therefore silently returns 0 rows (verified 2026-05-30). We query the
    // project scope with BOTH the absolute path AND the basename, then dedupe — so whichever
    // slug form PSS actually stored is matched, and a future PSS that stores absolute paths
    // keeps working too. A failed slug match is empty, never an error.
    const projectAbs = await asOfComponents(bin, iso, 'project', projectDir)
    const basename = path.basename(projectDir)
    const projectBase =
      basename && basename !== projectDir ? await asOfComponents(bin, iso, 'project', basename) : null
    const userComponents = await asOfComponents(bin, iso, 'user')

    // 'unavailable' only when EVERY query failed to parse. A query that parsed to an empty
    // array (legitimate "nothing active at T" / slug-miss) is success, not failure.
    if (projectAbs === null && projectBase === null && userComponents === null) {
      return {
        status: 'unavailable',
        reason: 'PSS as-of query returned no parseable output',
        asOfIso: iso,
        scanAgeSec,
        components: [],
      }
    }

    // Merge + dedupe by name|type|scope (the absolute-path and basename project queries can
    // overlap once PSS stores absolute paths; today only one of them is non-empty).
    const seen = new Set<string>()
    const components: LifelineComponent[] = []
    for (const c of [...(projectAbs ?? []), ...(projectBase ?? []), ...(userComponents ?? [])]) {
      const key = `${c.name}|${c.type}|${c.scope ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      components.push(c)
    }

    return {
      status: isStale ? 'stale' : 'ok',
      reason: isStale
        ? `PSS history is stale — newest scan is ${Math.round((scanAgeSec ?? 0) / 3600)}h old; run /pss-reindex-skills to refresh`
        : undefined,
      asOfIso: iso,
      scanAgeSec,
      components,
    }
  } catch (err) {
    // Absolute backstop: any unforeseen throw collapses to a clean degraded status.
    // The chat browser MUST render regardless.
    return {
      status: 'unavailable',
      reason: `lifeline error: ${err instanceof Error ? err.message : String(err)}`,
      components: [],
    }
  }
}
