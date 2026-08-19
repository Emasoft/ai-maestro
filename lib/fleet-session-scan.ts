// The SECOND fleet population (TRDD-99LV0U4I, parent KCRMSNL7): claude sessions on this host
// that are NOT registered agents — plugin-dev Claudes, the owner's terminal sessions, anything
// the janitor's `fleet_scan.gather_fleet` sees and `scanFleetLiveness`'s registry walk cannot.
// This is the population gap between the janitor's `session-liveness` / `fleet-stop` chores
// and the server's registry-only scan; until it is closed the server cannot honestly claim
// either chore. DETECT-ONLY: nothing here actuates, and the watchdog leg that consumes it only
// logs. Actuation on non-agent sessions (the validated tmux channel) is a separate, default-OFF
// lane — see the parent card's three cross-cutting axes.
//
// Line-faithful port of the janitor's discovery half (`scripts/lib/fleet_scan.py`, 3.3.16):
// the SAME `ps` predicate, the SAME one-shot-verb exclusion, the SAME `.janitor/` root walk,
// the SAME transcript slug. A port that reads the population differently from the daemon it
// replaces would make the handover a silent population change, which is the #111 blackout
// shape one level down.
//
// What is deliberately NOT ported yet (ponytail: detect-only ceiling, upgrade path on the card):
// the substantive-tail transcript analysis (`substantive_age_from_tail`, `awaiting_user`),
// the iTerm/osascript TTY resolution, and `diagnose_root`'s cron/rate-limit ladder. The
// newest-transcript mtime is an UPPER bound on substantive age, so the coarse class below can
// only ever read a session as MORE alive than the daemon would — the safe direction for a
// detector that actuates nothing.

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { isClaudeSession } from './cache-prune'

const execFileAsync = promisify(execFile)

/** Seconds without a transcript write past which a session reads `stale` (janitor `STALE_S`:
 *  3× the 5-min heartbeat cadence — tolerates two missed fires before flagging). */
export const SESSION_STALE_S = 15 * 60
/** Seconds under which a session is BUSY working rather than merely heartbeat-alive. */
export const SESSION_ACTIVE_FRESH_S = 5 * 60

/**
 * Every `claude` verb that starts a ONE-SHOT invocation rather than an interactive session.
 * Copied verbatim from the janitor's `_CLAUDE_SUBCOMMANDS` — maintained from OBSERVED
 * processes, not from `claude --help` (which omits `daemon`, `bg-spare`, `bg-pty-host`). A
 * one-shot verb inherits its project's newest transcript age and looks more dead every day
 * (`claude daemon run` read 16.3 days once), so excluding it is what keeps the population honest.
 */
export const CLAUDE_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'agents', 'auth', 'auto-mode', 'bg-pty-host', 'bg-spare', 'daemon', 'doctor', 'gateway',
  'import', 'install', 'mcp', 'plugin', 'plugins', 'project', 'setup-token', 'ultrareview',
  'update', 'upgrade',
])

/** True iff `cmd` starts an interactive claude SESSION. Only the token IMMEDIATELY after argv[0]
 *  is consulted (a flag VALUE can never sit at position 1, so `--agent foo` cannot be misread as
 *  a verb); an UNKNOWN first token is a SESSION, deliberately — including a non-session costs one
 *  no-op, excluding a real headless session loses it. */
export function isReplInvocation(cmd: string): boolean {
  const toks = cmd.trim().split(/\s+/)
  if (toks.length < 2) return true
  return !CLAUDE_SUBCOMMANDS.has(toks[1])
}

/** Normalize a TTY to a comparable key (`ttys003`): `ps -o tty=` prints `s003` on macOS,
 *  `tmux`/`lsof` print `/dev/ttys003`. No controlling tty (`?`, `??`, `-`) ⇒ ''. */
export function normalizeTty(raw: string): string {
  let t = (raw || '').trim()
  if (!t || t === '?' || t === '??' || t === '-') return ''
  if (t.startsWith('/dev/')) t = t.slice(5)
  if (t.startsWith('s') && !t.startsWith('tty')) t = 'tty' + t
  return t
}

export interface ClaudeProcess {
  pid: number
  tty: string
  command: string
}

/** `(pid, tty, command)` for every claude SESSION in `ps -eo pid=,tty=,command=` output.
 *  Malformed rows are skipped; one-shot verbs are excluded (`isReplInvocation`). */
export function parsePsClaude(psText: string): ClaudeProcess[] {
  const out: ClaudeProcess[] = []
  for (const ln of psText.split('\n')) {
    if (!ln.trim()) continue
    const m = ln.trim().match(/^(\S+)\s+(\S+)\s+(.*)$/)
    if (!m) continue
    const pid = Number.parseInt(m[1], 10)
    if (!Number.isInteger(pid)) continue
    const cmd = m[3]
    if (!isClaudeSession(cmd)) continue
    if (!isReplInvocation(cmd)) continue
    out.push({ pid, tty: normalizeTty(m[2]), command: cmd })
  }
  return out
}

/** `tmux list-panes -a -F '#{pane_tty} #{pane_id}'` → normalized tty → pane id. */
export function parseTmuxPanes(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const ln of text.split('\n')) {
    const parts = ln.trim().split(/\s+/)
    if (parts.length < 2) continue
    const tty = normalizeTty(parts[0])
    if (tty) out.set(tty, parts[1])
  }
  return out
}

/** Walk up from `cwd` to the nearest dir containing `.janitor/` — the project where the
 *  janitor is/was armed. Bounded to 8 levels. `null` ⇒ not a janitor-armed session. */
export function findJanitorRoot(cwd: string | null | undefined, isDir: (p: string) => boolean = defaultIsDir): string | null {
  if (!cwd) return null
  let d = path.resolve(cwd)
  for (let i = 0; i < 8; i++) {
    if (isDir(path.join(d, '.janitor'))) return d
    const parent = path.dirname(d)
    if (parent === d) break
    d = parent
  }
  return null
}

function defaultIsDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** The harness per-project transcript slug: the absolute path with EVERY non-alphanumeric char
 *  dashed (janitor `memory_scopes.project_slug`) — a separators-only replace resolves a
 *  nonexistent dir for any dotted/underscored path and blinds the scan to those sessions. */
export function projectSlug(projectDir: string): string {
  return projectDir.replace(/[^A-Za-z0-9]/g, '-')
}

/** Seconds since the newest `*.jsonl` transcript under `~/.claude/projects/<slug>/` was
 *  written, or null when the project has no transcripts. */
export function transcriptAgeS(projectRoot: string, nowS: number, homeDir: string = os.homedir()): number | null {
  const tdir = path.join(homeDir, '.claude', 'projects', projectSlug(projectRoot))
  let newest: number | null = null
  let names: string[]
  try {
    names = fs.readdirSync(tdir)
  } catch {
    return null
  }
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue
    try {
      const mtimeS = Math.floor(fs.statSync(path.join(tdir, name)).mtimeMs / 1000)
      if (newest === null || mtimeS > newest) newest = mtimeS
    } catch {
      // a transcript vanishing mid-read is not evidence about the session
    }
  }
  return newest === null ? null : Math.max(0, nowS - newest)
}

export type SessionClass = 'active' | 'alive' | 'stale' | 'unknown'

/** Coarse liveness from transcript age alone. `unknown` (no transcript) is NOT stale — a
 *  session that never wrote is not evidence of a dead one, and inventing staleness is the
 *  alarming direction. */
export function classifySessionAge(ageS: number | null): SessionClass {
  if (ageS === null) return 'unknown'
  if (ageS < SESSION_ACTIVE_FRESH_S) return 'active'
  if (ageS < SESSION_STALE_S) return 'alive'
  return 'stale'
}

export interface JanitorSession {
  /** Population tag — threads through the snapshot so actuation policy is per-origin. */
  origin: 'janitor-session'
  pid: number
  tty: string
  /** tmux pane id when the session's TTY is a tmux pane — the only channel a later actuation
   *  lane may use for this population (the validated tmux channel). */
  tmuxPane: string | null
  projectRoot: string
  transcriptAgeS: number | null
  class: SessionClass
}

export interface JanitorSessionScanDeps {
  nowS?: () => number
  /** `ps -eo pid=,tty=,command=` text. */
  ps?: () => Promise<string>
  /** `tmux list-panes -a -F '#{pane_tty} #{pane_id}'` text ('' when tmux is absent). */
  tmuxPanes?: () => Promise<string>
  /** The cwd of a pid (lsof on macOS), or null. */
  cwdOf?: (pid: number) => Promise<string | null>
  isDir?: (p: string) => boolean
  homeDir?: string
  /** Filter: true ⇒ this root belongs to a REGISTERED agent and is already covered by the
   *  registry scan (origin `registry`), so it is NOT reported here. */
  isRegistryRoot?: (projectRoot: string) => boolean
}

async function run(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 })
    return stdout
  } catch {
    return ''
  }
}

async function defaultCwdOf(pid: number): Promise<string | null> {
  const out = await run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], 8000)
  for (const line of out.split('\n')) if (line.startsWith('n')) return line.slice(1)
  return null
}

/**
 * Discover every janitor-armed claude session on this host that is NOT a registered agent's.
 * One `ps`, one `tmux`, one `lsof` per claude pid — the daemon's exact I/O shape. Read-only.
 * Sessions whose project root fails `isRegistryRoot` are the ones reported; a registered
 * agent's session is origin `registry` and lives in `snapshot.agents`, never here (no double
 * counting, and a future actuation lane cannot reach a registered agent through this path).
 */
export async function gatherJanitorSessions(deps: JanitorSessionScanDeps = {}): Promise<JanitorSession[]> {
  const nowS = (deps.nowS ?? (() => Math.floor(Date.now() / 1000)))()
  const psText = await (deps.ps ?? (() => run('ps', ['-eo', 'pid=,tty=,command='], 10_000)))()
  const tmuxText = await (deps.tmuxPanes ?? (() => run('tmux', ['list-panes', '-a', '-F', '#{pane_tty} #{pane_id}'], 10_000)))()
  const cwdOf = deps.cwdOf ?? defaultCwdOf
  const isRegistryRoot = deps.isRegistryRoot ?? (() => false)
  const tmuxByTty = parseTmuxPanes(tmuxText)
  const out: JanitorSession[] = []
  for (const proc of parsePsClaude(psText)) {
    const root = findJanitorRoot(await cwdOf(proc.pid), deps.isDir)
    if (!root) continue
    if (isRegistryRoot(root)) continue
    const age = transcriptAgeS(root, nowS, deps.homeDir)
    out.push({
      origin: 'janitor-session',
      pid: proc.pid,
      tty: proc.tty,
      tmuxPane: (proc.tty && tmuxByTty.get(proc.tty)) || null,
      projectRoot: root,
      transcriptAgeS: age,
      class: classifySessionAge(age),
    })
  }
  return out
}

/** True iff `root` equals or is inside one of `registryDirs` (real-path compare, no realpath
 *  syscall — a lexical prefix match after `path.resolve`, which is what both sides are built from). */
export function makeRegistryRootFilter(registryDirs: Array<string | null | undefined>): (root: string) => boolean {
  const dirs = registryDirs.filter((d): d is string => typeof d === 'string' && d.length > 0).map((d) => path.resolve(d))
  return (root: string) => {
    const r = path.resolve(root)
    return dirs.some((d) => r === d || r.startsWith(d + path.sep))
  }
}
