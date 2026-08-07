/**
 * Discovery for the settings-ledger watcher — TRDD-MN0Q1IA2 items 8 + 9.
 *
 * Answers ONE question: which files must the watcher observe? It does not watch anything and is
 * not wired into the server. Ships dark, exactly like the model-fallback leg, because a file
 * watcher's failure mode is silence — and silence is indistinguishable from "nothing changed".
 *
 * WHY DISCOVERY IS ITS OWN MODULE. The watch set is not a constant. Projects appear and are
 * deleted (8 of 46 decoded working directories no longer existed when measured), so the watcher
 * must RE-SCAN periodically rather than arm once at boot. Separating "what to watch" from "how to
 * watch" makes the moving half testable without a filesystem event in sight.
 *
 * ── THE TRAP THIS MODULE EXISTS TO ENCODE ────────────────────────────────────────────────────
 * A safe write is `write <path>.tmp.N` then RENAME OVER the target — which is what this repo's own
 * `saveJsonSafe` does, and the house pattern generally. `fs.watch` on a FILE binds the **inode**,
 * so after the first atomic write the watcher holds the ORPHANED old inode: it reports nothing,
 * forever, while the file keeps changing. A dead-inode watcher and a quiet file look identical.
 *
 * ⇒ Callers watch `t.dir` and filter events by `t.basename`. This module therefore returns
 *   DIRECTORY + BASENAME, never a file path to hand to `fs.watch`. That is not a convenience —
 *   it is the whole reason the return type is shaped this way.
 *
 * ── MEASURED 2026-08-07, and both numbers overturned an assumption ───────────────────────────
 * `~/.claude/projects/` holds ZERO settings files; those dirs carry conversation TRANSCRIPTS. The
 * settings live in the WORKING DIRECTORIES the slugs encode — and a slug cannot be un-mangled
 * (every non-alphanumeric maps to `-`, so a path containing a real `-` is unrecoverable). The
 * reliable decode is the transcript's own `cwd` field.
 *
 * Of 97 project dirs: 44 yield `cwd` within 5 lines, 3 only deeper, **49 have no `.jsonl` at all**,
 * 1 has content but no `cwd`. So the "53 undecodable" figure was 49 EMPTY directories — reading
 * deeper buys +3 and nothing more. The operative rule is that a dir with no JSONL is **ABSENT**,
 * not undecodable — treating those 49 as "unknown" is what inflated the corpus estimate to ~100.
 *
 * Final chain: 46 distinct cwds → 38 still on disk → 18 settings files, plus the agent workdirs and
 * the 2 global files ⇒ ~32 targets. The descriptor-exhaustion fear that shaped the original design
 * does not apply at this scale.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/** The two settings files a Claude workspace can carry. `.local` is the machine-private one. */
export const SETTINGS_BASENAMES = ['settings.json', 'settings.local.json'] as const

/**
 * How many BYTES of a transcript to read while looking for `cwd`.
 *
 * Replaced a LINE cap (50) that sat on top of `readFileSync(whole file)` — so it limited PARSING
 * while the expensive part, reading a transcript that can run to megabytes, happened anyway. A
 * byte-bounded read caps the I/O that actually costs something. 512 KiB is far past any observed
 * `cwd` position and still a fraction of a large transcript.
 *
 * ⚠ WHAT PROMPTED THE CHANGE WAS A MISDIAGNOSIS, recorded because the wrong version is the
 * plausible one. Running discovery against the real `$HOME` returned **15** project-sourced
 * targets where a direct filesystem count found **18**, and I read that as "the line cap is
 * silently missing 3 workspaces" — alarming for a ledger required to record EVERY change. It is
 * not what was happening. Measured: all three are DEDUPE COLLISIONS, and every decoded settings
 * file is present in the result under a different `source`:
 *
 *   1 collides with `global`        — a session whose cwd IS `$HOME`, so its `.claude/settings.json`
 *                                     is literally the global file
 *   2 collide with `agent-workdir`  — a workdir reachable both ways
 *
 * Nothing was ever unwatched. The byte budget is the right shape on its own merits (bounded I/O),
 * but it fixed no coverage bug, because there was none. The lesson worth keeping: when two counts
 * of the same set disagree, find the mapping between them before naming a defect — a lower count
 * downstream of a dedupe is the dedupe, not a loss.
 */
export const BYTE_BUDGET = 512 * 1024


/** One thing to watch. `dir` + `basename`, never a file path — see the inode trap above. */
export interface WatchTarget {
  /** The DIRECTORY to hand to `fs.watch`. Survives atomic rename-over; a file path does not. */
  dir: string
  /** The filename to filter events by. */
  basename: string
  /** Absolute path of the file itself — for hashing and reporting, NOT for `fs.watch`. */
  file: string
  /** Where this target came from, so a surprising entry can be traced back. */
  source: 'global' | 'agent-workdir' | 'project-cwd'
}

export interface DiscoverOptions {
  /** Defaults to `os.homedir()`. Injectable so tests never touch the developer's real `$HOME`. */
  home?: string
  /** Defaults to `<home>/agents`. */
  agentsRoot?: string
  /** Defaults to `<home>/.claude/projects`. */
  projectsRoot?: string
}

/**
 * Read a transcript's `cwd` from a BYTE-BOUNDED prefix. Returns null when absent or unreadable.
 *
 * Reads at most `byteBudget` bytes rather than the whole file — a transcript can be megabytes, and
 * `cwd` is in the first handful of lines in 44 of 47 observed cases.
 */
export function cwdFromTranscript(jsonlPath: string, byteBudget = BYTE_BUDGET): string | null {
  let raw: string
  let fd: number | undefined
  try {
    fd = fs.openSync(jsonlPath, 'r')
    const buf = Buffer.allocUnsafe(byteBudget)
    const read = fs.readSync(fd, buf, 0, byteBudget, 0)
    raw = buf.subarray(0, read).toString('utf-8')
  } catch {
    return null
  } finally {
    // A leaked descriptor here would accumulate across every periodic re-scan, over ~97 dirs.
    if (fd !== undefined) { try { fs.closeSync(fd) } catch { /* already closed */ } }
  }
  const lines = raw.split('\n')
  // The final line of a truncated read is almost certainly cut mid-JSON; parsing it would fail
  // harmlessly, but dropping it makes that explicit rather than incidental.
  if (raw.length === byteBudget && lines.length > 1) lines.pop()
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    // A transcript line is one JSON object per line; a malformed line is skipped, never fatal —
    // a partially-written last line is normal for a session still in progress.
    let obj: unknown
    try { obj = JSON.parse(line) } catch { continue }
    if (obj && typeof obj === 'object') {
      const c = (obj as Record<string, unknown>).cwd
      if (typeof c === 'string' && c.length > 0) return c
    }
  }
  return null
}

/** Every working directory `~/.claude/projects/` can be resolved to. Deduplicated, sorted. */
export function decodeProjectCwds(projectsRoot: string, byteBudget = BYTE_BUDGET): string[] {
  let dirs: fs.Dirent[]
  try { dirs = fs.readdirSync(projectsRoot, { withFileTypes: true }) } catch { return [] }

  const found = new Set<string>()
  for (const d of dirs) {
    if (!d.isDirectory()) continue
    const dir = path.join(projectsRoot, d.name)
    let entries: string[]
    try { entries = fs.readdirSync(dir) } catch { continue }
    const jsonl = entries.filter(f => f.endsWith('.jsonl')).sort()
    // No transcript ⇒ ABSENT, not undecodable. 49 of 97 dirs measured are exactly this, and
    // treating them as "unknown" is what inflated the corpus estimate.
    if (jsonl.length === 0) continue
    for (const f of jsonl) {
      const cwd = cwdFromTranscript(path.join(dir, f), byteBudget)
      if (cwd) { found.add(cwd); break }
    }
  }
  return [...found].sort()
}

function settingsIn(workdir: string, source: WatchTarget['source'], out: WatchTarget[]): void {
  const dir = path.join(workdir, '.claude')
  for (const basename of SETTINGS_BASENAMES) {
    const file = path.join(dir, basename)
    // Only existing files become targets. A workspace that gains a settings.json later is picked
    // up by the next re-scan — which the caller owes anyway, since the project set is dynamic.
    if (fs.existsSync(file)) out.push({ dir, basename, file, source })
  }
}

/**
 * The full watch set. Callers RE-RUN this periodically: projects and agents come and go, and a
 * one-shot arm silently stops covering everything created after boot.
 */
export function discoverSettingsTargets(opts: DiscoverOptions = {}): WatchTarget[] {
  const home = opts.home ?? os.homedir()
  const agentsRoot = opts.agentsRoot ?? path.join(home, 'agents')
  const projectsRoot = opts.projectsRoot ?? path.join(home, '.claude', 'projects')

  const out: WatchTarget[] = []

  // 1. The two global files. `~/.claude` is the directory, so no `.claude` suffix here.
  for (const basename of SETTINGS_BASENAMES) {
    const dir = path.join(home, '.claude')
    const file = path.join(dir, basename)
    if (fs.existsSync(file)) out.push({ dir, basename, file, source: 'global' })
  }

  // 2. Every agent working directory.
  let agents: fs.Dirent[] = []
  try { agents = fs.readdirSync(agentsRoot, { withFileTypes: true }) } catch { /* absent is fine */ }
  for (const a of agents) {
    if (a.isDirectory()) settingsIn(path.join(agentsRoot, a.name), 'agent-workdir', out)
  }

  // 3. Every working directory decoded from a transcript.
  for (const cwd of decodeProjectCwds(projectsRoot)) settingsIn(cwd, 'project-cwd', out)

  // A workdir can be reached both as an agent dir and as a decoded cwd; watch it once.
  const seen = new Set<string>()
  return out.filter(t => (seen.has(t.file) ? false : (seen.add(t.file), true)))
}

/** The distinct DIRECTORIES to arm. Fewer than the targets — several settings files share a dir. */
export function watchDirs(targets: readonly WatchTarget[]): string[] {
  return [...new Set(targets.map(t => t.dir))].sort()
}
