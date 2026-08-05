// Preserve the janitor's global-status HTML documents as an AUDIT TRAIL (TRDD-TCKNOA72).
//
// WHY THIS EXISTS, AND WHY IT PRESERVES BYTES RATHER THAN RE-RENDERING. The USER's requirement is
// that the document is kept EXACTLY as the janitor rendered it, because it is evidence to consult
// when something goes wrong. That rules out reading the underlying data and drawing our own table:
// an audit artifact that has been through our renderer is no longer the artifact. It also happens
// to be the only honest option — the document is a whole-HOST view (every running claude instance,
// found by process scan), and this server can only see its own registry, so a table we re-derived
// would silently be missing rows we cannot even enumerate.
//
// THE DATA IS ACTIVELY BEING LOST. `fleet_status.py::_write_temp` uses `tempfile.mkstemp()`, so
// every document lands in the OS temp dir and is swept. Measured 2026-08-05: ZERO
// `janitor-global-status-*.html` files remained in $TMPDIR — both of the USER's own samples were
// already gone, and only hand-rescued copies survived. Discovery-archiving is what stops that.
//
// ── WHY THE GENERATOR NEEDS A PATH SHIM ─────────────────────────────────────────────────────────
//
// `fleet_status.py:499-501` ends with an UNCONDITIONAL browser open:
//
//     opener = "open" if sys.platform == "darwin" else "xdg-open"
//     try: subprocess.Popen([opener, out_path], start_new_session=True)
//     except Exception as exc: print(f"(could not auto-open: {exc} …)")
//
// There is no `--no-open` flag (only `--ci` and `--text`). The USER's directive is that the
// document appears in an IFRAME and never as a popup, so a server that invokes this on demand must
// neutralise that call. Two properties make it safe rather than clever:
//
//   1. `opener` is a BARE command name inside `Popen` without `shell=True`, so it is resolved via
//      PATH in the CHILD process — an environment we fully control and which cannot leak to the
//      user's own shell.
//   2. The call is ALREADY inside a try/except that degrades to one printed line. So the failure
//      mode of the shim is a harmless log message, never a broken generator.
//
// VERIFIED 2026-08-05 before this module was written: with the shim on PATH, Chrome window count
// was 1 before and 1 after, exit 0, the document was produced (18,638,285 B) and the `Dashboard:`
// line parsed. `BROWSER=true` is belt-and-braces in case upstream ever switches to Python's
// `webbrowser` module (which reads that variable) instead of a subprocess.
//
// The proper fix is upstream and is requested on `Emasoft/ai-maestro-janitor#196` (`--no-open` /
// `--out <path>`); when it lands, `generateNow` drops the shim and this comment goes with it.
//
// ── RETENTION IS A REAL HORIZON, NOT A CACHE BOUND ──────────────────────────────────────────────
//
// The USER chose keep-the-newest-50. Note what that means and do not soften it: these documents
// CANNOT be regenerated — each is a point-in-time snapshot of a host state that no longer exists.
// That is exactly the class `lib/statusline-store.ts::pruneStatuslineSnapshots` excludes in its own
// docstring ("pure regenerable runtime state … where a plain unlink is the correct tool"), so this
// prune is deliberately NOT that case even though it copies that helper's shape. Deletion is
// authorised by the USER's explicit choice; the mitigation is that every removal is logged with
// its filename and size, so what left the archive is always recoverable from the record even when
// the bytes are not.

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { statePath } from './ecosystem-constants'

const execFileAsync = promisify(execFile)

/** The janitor writes `janitor-global-status-<8 random>.html` via `tempfile.mkstemp`. */
const SOURCE_PREFIX = 'janitor-global-status-'
const SOURCE_SUFFIX = '.html'

/** Keep the newest N documents. USER decision, 2026-08-05. */
export const ARCHIVE_KEEP = 50

/** A host-wide process scan is not fast; the measured run was tens of seconds. */
const GENERATE_TIMEOUT_MS = 180_000

export interface ArchiveEntry {
  /** Archive filename — safe to hand back to a route as an opaque id. */
  name: string
  /** Epoch ms, from the file's mtime. */
  mtimeMs: number
  bytes: number
}

export function archiveDir(): string {
  return statePath('janitor-reports')
}

/**
 * Local time with the GMT offset, per the project's timestamp rule (`%Y%m%d_%H%M%S%z`) — never
 * UTC, so a human can tie a document to their own workday without timezone arithmetic, and never
 * with a `:` in the offset, which Windows filesystems reject.
 */
export function stampFor(d: Date): string {
  const p = (n: number, w = 2) => String(Math.abs(n)).padStart(w, '0')
  const offMin = -d.getTimezoneOffset()
  const sign = offMin < 0 ? '-' : '+'
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}` +
    `${sign}${p(Math.floor(Math.abs(offMin) / 60))}${p(Math.abs(offMin) % 60)}`
  )
}

/**
 * Archive name for a source document.
 *
 * The mkstemp suffix is carried through deliberately: it makes the name unique per SOURCE FILE, so
 * "have I archived this already?" is answered by a plain existence check rather than a sidecar
 * index that could drift from the directory it describes. Two documents generated in the same
 * second stay distinct for the same reason.
 */
export function archiveNameFor(sourceBasename: string, mtime: Date): string {
  const unique = sourceBasename.slice(SOURCE_PREFIX.length, -SOURCE_SUFFIX.length) || 'unknown'
  return `${stampFor(mtime)}-${SOURCE_PREFIX}${unique}${SOURCE_SUFFIX}`
}

/**
 * Guard for anything that came from a request. An archive name is never joined into a path without
 * passing this — it admits only names this module itself produces.
 *
 * THE ANCHORED REGEX IS THE LOAD-BEARING CHECK. Measured by neuter 2026-08-05: replacing it with
 * a match-anything pattern reddens the shape test immediately, while removing all three `includes`
 * checks and keeping the regex reddens NOTHING — nothing containing `/`, `\` or `..` can match an
 * anchored pattern whose body is `[A-Za-z0-9_]+`. So the three `includes` calls are today STRICTLY
 * REDUNDANT and are unpinnable by construction.
 *
 * They stay anyway, and it is worth saying why rather than deleting them as dead: they are the
 * defence that survives someone loosening the regex later — the exact edit whose author would be
 * thinking about filenames, not traversal. What must NOT happen is reading them as the working
 * guard: if the regex is ever relaxed, these three become load-bearing and need their own test.
 */
export function isValidArchiveName(name: string): boolean {
  return (
    typeof name === 'string' &&
    !name.includes('/') &&
    !name.includes('\\') &&
    !name.includes('..') &&
    /^\d{8}_\d{6}[+-]\d{4}-janitor-global-status-[A-Za-z0-9_]+\.html$/.test(name)
  )
}

export function listArchive(): ArchiveEntry[] {
  const dir = archiveDir()
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return []
  }
  const out: ArchiveEntry[] = []
  for (const name of names) {
    if (!isValidArchiveName(name)) continue
    try {
      const st = fs.statSync(path.join(dir, name))
      out.push({ name, mtimeMs: st.mtimeMs, bytes: st.size })
    } catch {
      // Vanished between readdir and stat — skip it rather than fail the listing.
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

/**
 * Keep the newest `keep` documents; remove the rest.
 *
 * Ordering is by MTIME, not by filename. The names embed a local-time stamp with its UTC offset,
 * and that offset CHANGES at a DST boundary — so a lexicographic sort would mis-order documents
 * written either side of it and could delete the wrong one. mtime has no such discontinuity.
 */
export function pruneArchive(
  keep: number = ARCHIVE_KEEP,
  log: (msg: string) => void = msg => console.warn(msg),
): number {
  const entries = listArchive()
  if (entries.length <= keep) return 0
  let removed = 0
  for (const e of entries.slice(keep)) {
    try {
      fs.unlinkSync(path.join(archiveDir(), e.name))
      removed++
      // Logged individually and deliberately: these documents cannot be regenerated, so the record
      // of what left the archive is the only trace that it ever existed.
      log(`[janitor-archive] pruned ${e.name} (${e.bytes} bytes) — over the ${keep}-document limit`)
    } catch (err) {
      log(`[janitor-archive] prune failed for ${e.name}: ${err instanceof Error ? err.message : err}`)
    }
  }
  return removed
}

/**
 * Copy any not-yet-archived janitor status documents out of the OS temp dir.
 *
 * This is pure preservation: it runs the generator NEVER, so it cannot open a browser window and
 * cannot cost a host scan. It captures whatever the USER (or any janitor session) produced via
 * `/janitor-show-global-status` before the temp sweeper takes it.
 */
export function archiveDiscovered(
  tmpDir: string = os.tmpdir(),
  log: (msg: string) => void = msg => console.warn(msg),
): ArchiveEntry[] {
  let names: string[]
  try {
    names = fs.readdirSync(tmpDir)
  } catch {
    return []
  }

  const dir = archiveDir()
  const added: ArchiveEntry[] = []
  for (const name of names) {
    if (!name.startsWith(SOURCE_PREFIX) || !name.endsWith(SOURCE_SUFFIX)) continue
    const src = path.join(tmpDir, name)
    try {
      const st = fs.statSync(src)
      if (!st.isFile()) continue
      const target = path.join(dir, archiveNameFor(name, st.mtime))
      if (fs.existsSync(target)) continue // already preserved — see archiveNameFor
      fs.mkdirSync(dir, { recursive: true })
      // Copy via a tmp name + rename so a reader (or the route serving the iframe) never sees a
      // half-copied 26 MB document.
      const tmp = `${target}.tmp.${process.pid}`
      fs.copyFileSync(src, tmp)
      fs.renameSync(tmp, target)
      added.push({ name: path.basename(target), mtimeMs: st.mtimeMs, bytes: st.size })
      log(`[janitor-archive] preserved ${path.basename(target)} (${st.size} bytes)`)
    } catch (err) {
      log(`[janitor-archive] could not preserve ${name}: ${err instanceof Error ? err.message : err}`)
    }
  }
  if (added.length) pruneArchive(ARCHIVE_KEEP, log)
  return added
}

// ── generating a fresh document ─────────────────────────────────────────────────────────────────

const JANITOR_CACHE_ROOT = path.join(
  os.homedir(),
  '.claude',
  'plugins',
  'cache',
  'ai-maestro-plugins',
  'ai-maestro-janitor',
)

/** Descending semver-ish comparator, with a string fallback for non-numeric dirs. */
function compareVersionDesc(a: string, b: string): number {
  const pa = a.split('.').map(n => parseInt(n, 10))
  const pb = b.split('.').map(n => parseInt(n, 10))
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i]
    const y = pb[i]
    if (Number.isNaN(x) || Number.isNaN(y) || x === undefined || y === undefined) break
    if (x !== y) return y - x
  }
  return b.localeCompare(a)
}

/**
 * Newest installed `fleet_status.py`, or null.
 *
 * Never hard-code a version: the plugin cache rolls forward on its own and a pinned path silently
 * stops existing. "Newest version that actually CONTAINS the script wins" — a version dir can exist
 * mid-install without the file.
 */
export function resolveFleetStatusScript(): string | null {
  let dirs: string[]
  try {
    dirs = fs
      .readdirSync(JANITOR_CACHE_ROOT, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort(compareVersionDesc)
  } catch {
    return null
  }
  for (const v of dirs) {
    const p = path.join(JANITOR_CACHE_ROOT, v, 'scripts', 'fleet_status.py')
    if (fs.existsSync(p)) return p
  }
  return null
}

/** `uv` is required to run the script (its shebang is `env -S uv run --script`). pm2 may hand the
 *  server a narrower PATH than an interactive shell, so fall back to the usual install sites. */
function resolveUv(): string | null {
  for (const c of [
    path.join(os.homedir(), '.local', 'bin', 'uv'),
    '/opt/homebrew/bin/uv',
    '/usr/local/bin/uv',
  ]) {
    if (fs.existsSync(c)) return c
  }
  return 'uv' // last resort: hope it is on PATH; execFile will fail cleanly if not
}

/**
 * A private directory whose `open` is a no-op, prepended to the child's PATH.
 *
 * Written under the archive dir rather than the OS temp dir on purpose — a shim that the temp
 * sweeper can delete would make generation start popping windows again, silently, weeks later.
 */
function ensureOpenShimDir(): string {
  const dir = path.join(archiveDir(), '.open-shim')
  fs.mkdirSync(dir, { recursive: true })
  for (const name of ['open', 'xdg-open']) {
    const p = path.join(dir, name)
    // Rewrite every time: cheap, and it self-heals if the file was truncated or lost its +x.
    fs.writeFileSync(p, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    fs.chmodSync(p, 0o755)
  }
  return dir
}

let generateInFlight = false

export interface GenerateResult {
  ok: boolean
  entry?: ArchiveEntry
  reason?: string
}

/**
 * Run the janitor's generator with the popup suppressed, then archive what it produced.
 *
 * Serialised by `generateInFlight`: the generator scans every process on the host, so overlapping
 * runs would multiply that cost for no benefit. This also bounds what a held-down Refresh button
 * can do, which is why the route needs no sudo gate for what is otherwise a read-only observation.
 */
export async function generateNow(
  log: (msg: string) => void = msg => console.warn(msg),
): Promise<GenerateResult> {
  if (generateInFlight) return { ok: false, reason: 'a generation is already running' }

  const script = resolveFleetStatusScript()
  if (!script) return { ok: false, reason: 'the ai-maestro-janitor plugin is not installed' }

  generateInFlight = true
  try {
    const shim = ensureOpenShimDir()
    const { stdout } = await execFileAsync(
      resolveUv() as string,
      ['run', '--script', '--quiet', script],
      {
        timeout: GENERATE_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024, // stdout is three lines; the document goes to a file
        windowsHide: true,
        env: {
          ...process.env,
          PATH: `${shim}${path.delimiter}${process.env.PATH ?? ''}`,
          BROWSER: 'true',
        },
      },
    )

    // The script prints `Dashboard: <path>`; that line is its only output contract we depend on.
    const m = /^Dashboard:\s*(.+)$/m.exec(stdout)
    if (!m) return { ok: false, reason: 'the generator printed no Dashboard path' }
    const produced = m[1].trim()

    const st = fs.statSync(produced)
    const dir = archiveDir()
    fs.mkdirSync(dir, { recursive: true })
    const target = path.join(dir, archiveNameFor(path.basename(produced), st.mtime))
    const tmp = `${target}.tmp.${process.pid}`
    fs.copyFileSync(produced, tmp)
    fs.renameSync(tmp, target)

    const entry: ArchiveEntry = {
      name: path.basename(target),
      mtimeMs: st.mtimeMs,
      bytes: st.size,
    }
    log(`[janitor-archive] generated ${entry.name} (${entry.bytes} bytes)`)
    pruneArchive(ARCHIVE_KEEP, log)
    return { ok: true, entry }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  } finally {
    generateInFlight = false
  }
}

// ── the scheduler ───────────────────────────────────────────────────────────────────────────────

/** Short, because it is racing the OS temp sweeper for documents the USER just generated. Copying
 *  is cheap and the common case finds nothing. Env-overridable; 0 disables. */
const DEFAULT_INTERVAL_MS = Number(process.env.AIM_JANITOR_ARCHIVE_INTERVAL_MS) || 60_000

/**
 * Start the discovery archiver. Returns a stop function, or null when disabled.
 * Fires once immediately, `unref`'d, and never throws.
 */
export function startJanitorStatusArchiver(opts: {
  intervalMs?: number
  log?: (msg: string) => void
} = {}): (() => void) | null {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS
  if (!intervalMs || intervalMs <= 0) return null
  const log = opts.log ?? ((msg: string) => console.warn(msg))

  const beat = () => {
    try {
      archiveDiscovered(os.tmpdir(), log)
    } catch (err) {
      log(`[janitor-archive] sweep threw (non-fatal): ${err instanceof Error ? err.message : err}`)
    }
  }
  beat()
  const timer = setInterval(beat, intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}
