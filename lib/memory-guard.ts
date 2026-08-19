// Absorbed memory-guard lane — TRDD-4QOWVSLU (parent KCRMSNL7). A line-faithful port of the
// janitor's Tier-1 OOM guard: `scripts/lib/memory_guard.py` (the pure truth table + the three I/O
// edges) and `daemon.py::task_memory_guard` (the beat). Every USER-SIGNED constraint of
// TRDD-7100178d Decision 1 (2026-05-31) is carried VERBATIM and cited at the line that carries it:
//
//   (D1-a) ONLY processes whose command line matches an explicit janitor-workload signature are
//          killable — `JANITOR_WORKLOAD_SIGNATURES` is the whole allowlist  (memory_guard.py:9-11, 46-56)
//   (D1-b) a hard SAFELIST protects everything else BY CONSTRUCTION: the calling process, its parent,
//          every system process, and `claude`-anything that is not one of the three plugin-CLI
//          shapes is the USER'S SESSION and is NEVER killable                (memory_guard.py:12-15, 58-62)
//   (D1-c) Tier 2 ("kill the biggest non-interactive process at critical pressure") is NOT
//          implemented — no code path, no enabling flag; a fresh user sign-off is required  (memory_guard.py:16-18)
//   (D1-d) under pressure the process table is snapshotted TO A FILE, never piped into a live
//          grep (the no-self-match discipline; the file is the forensic record)  (memory_guard.py:3-5, 245-263)
//   (D1-e) at most ONE kill per beat — pressure is re-evaluated next beat, so a misread can never
//          cascade into a kill spree                                             (memory_guard.py:202-216, daemon.py:29-30)
//   (D1-f) an unknown free-memory reading is a NO-OP — never kill on missing data  (memory_guard.py:224, daemon.py:46-47)
//   (D1-g) a workload counts as RUNAWAY only past the age gate (default 3600 s)  (memory_guard.py:39-44)
//   (D1-h) every kill is logged LOUDLY with the full command, RSS, age and the free reading  (daemon.py:36-37, 97-101)
//
// Everything decision-shaped is PURE (text in → value out), as in the original; the only I/O lives
// in `freeMemoryMb` / `snapshotProcesses` / `killProcess`. NOTHING here shells out to the janitor's
// rolling plugin cache (the 4OFMHOZ7 lesson): the logic is re-implemented, not re-invoked.
//
// SHIPPING POSTURE (KCRMSNL7 design axis "default-OFF destructive lanes"): the lane is DESTRUCTIVE,
// so the kill is armed ONLY by `AIM_MEMORY_GUARD=1`. Unarmed, the scheduler still runs the probe and
// the truth table and logs what it WOULD kill (`[detect-only: AIM_MEMORY_GUARD not set]`) — the
// same detect-then-arm shape as the fleet-liveness watchdog — but never kills, never stamps, and
// never claims the chore. Arming is the USER's act; it is what makes the lane LIVE, and the claim
// (`markChoreLive('memory-guard')`) is coupled to it so the janitor daemon yields the chore in the
// same instant this server starts performing it — never before (a claim over work nobody does is
// the FXPV7L4D class) and never after (two guards killing in the same window).

import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { statePath } from '@/lib/ecosystem-constants'
import { parseEtimeSeconds } from '@/lib/cache-prune'
import { markChoreLive, stampChoreRun, unmarkChoreLive } from '@/lib/janitor-chore-stamp'

const execFileAsync = promisify(execFile)

/** Free-memory floor (MB) — memory_guard.py:34-37. Below it the guard looks for a runaway. */
export const DEFAULT_MIN_FREE_MB = 1024
/** Runaway age gate — memory_guard.py:39-44 (2× the daemon's 1800 s per-workload wall clock). Our
 *  own marketplace refresh is bounded at 3600 s too (MARKETPLACE_REFRESH_TIMEOUT_MS), so a refresh
 *  of ours can only ever meet this gate at the instant its own timeout would kill it anyway. */
export const DEFAULT_RUNAWAY_ETIME_S = 3600
/** S6 (TRDD-1T53EKTN) refused-hog alert threshold — memory_guard.py:179-183. Alert-only. */
export const DEFAULT_ALERT_RSS_KB = 4 * 1024 * 1024
/** Janitor roster cadence for `memory-guard` (harness_backend.py: 120 s). */
export const DEFAULT_INTERVAL_MS = 120_000

/**
 * (D1-a) Tier-1 killable signatures — the ONLY shapes the guard may ever kill
 * (memory_guard.py:46-56, kept in the SAME ORDER: the first three are the plugin-CLI shapes that
 * `isTier1Killable` clause 3 admits for a `claude`-shaped command). Adding a pattern widens the
 * kill surface; keep it tight.
 */
export const JANITOR_WORKLOAD_SIGNATURES: readonly RegExp[] = [
  /\bclaude\s+plugin\s+marketplace\s+update\b/,
  /\bclaude\s+plugin\s+update\b/,
  /\bclaude\s+plugin\s+list\b/,
  /\boauth_rotator\/rotator\.py\b/,
  /\boauth_rotator\/reauth\.py\b/,
  /\boauth_rotator\/slot_capture_browser\.py\b/,
]
const PLUGIN_CLI_SIGNATURES = JANITOR_WORKLOAD_SIGNATURES.slice(0, 3)

/** (D1-b) `claude`-anything that is NOT a signature is the USER'S interactive session and is NEVER
 *  killable — the Tier-1 contract's load-bearing clause (memory_guard.py:58-62). */
const CLAUDE_ANYTHING = /(?:^|\/|\s)claude(?:\s|$)/

/** One parsed `ps -axo pid,ppid,rss,etime,command` row (memory_guard.py:65-72). */
export interface ProcRow {
  pid: number
  ppid: number
  rssKb: number
  etimeS: number
  command: string
}

// ---------- pure parsers ---------------------------------------------------------------------

/**
 * Parse `ps -axo pid,ppid,rss,etime,command` output, header tolerated (memory_guard.py:96-114).
 * Malformed lines are skipped — the guard prefers missing a row to misattributing one. The
 * command keeps its internal whitespace verbatim (Python `split(None, 4)` semantics).
 */
export function parsePsSnapshot(text: string): ProcRow[] {
  const rows: ProcRow[] = []
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*)$/)
    if (!m) continue
    const [, pid, ppid, rss, etime, command] = m
    if (!/^\d+$/.test(pid) || !/^\d+$/.test(ppid) || !/^\d+$/.test(rss)) continue // header / junk
    rows.push({
      pid: Number(pid),
      ppid: Number(ppid),
      rssKb: Number(rss),
      // unparseable etime → 0: the SAFE direction, it fails the age gate (memory_guard.py:78-82)
      etimeS: parseEtimeSeconds(etime),
      command: command.trim(),
    })
  }
  return rows
}

/** Free MB from macOS `vm_stat`: (free + speculative) pages; null when the lines are absent —
 *  never guess (memory_guard.py:117-136). */
export function parseVmStat(text: string, pageSize: number): number | null {
  let free: number | null = null
  let spec: number | null = null
  for (const line of text.split('\n')) {
    if (line.startsWith('Pages free:')) free = vmStatPages(line)
    else if (line.startsWith('Pages speculative:')) spec = vmStatPages(line)
  }
  if (free === null) return null
  return Math.floor(((free + (spec ?? 0)) * pageSize) / (1024 * 1024))
}

function vmStatPages(line: string): number | null {
  const m = line.match(/(\d+)\.?\s*$/)
  return m ? Number(m[1]) : null
}

/** Free MB from Linux /proc/meminfo `MemAvailable` (kB); null if absent (memory_guard.py:139-145). */
export function parseMeminfo(text: string): number | null {
  for (const line of text.split('\n')) {
    if (line.startsWith('MemAvailable:')) {
      const m = line.match(/(\d+)/)
      return m ? Math.floor(Number(m[1]) / 1024) : null
    }
  }
  return null
}

// ---------- the Tier-1 decision (pure) --------------------------------------------------------

export interface Tier1Policy {
  protectedPids: ReadonlySet<number>
  minEtimeS: number
}

/**
 * The Tier-1 truth: may this row EVER be killed by the guard? (memory_guard.py:150-176)
 * Every clause must pass:
 *   1. not a protected pid (the caller, its parent)                                 — (D1-b)
 *   2. the command matches a janitor-workload signature (the allowlist)              — (D1-a)
 *   3. a `claude`-shaped command may be killed ONLY via the three plugin-CLI signatures; any other
 *      claude-shaped command is the user's session (defense in depth: a future signature edit must
 *      not be able to widen onto user sessions silently)                             — (D1-b)
 *   4. older than the runaway age gate                                               — (D1-g)
 */
export function isTier1Killable(row: ProcRow, policy: Tier1Policy): boolean {
  if (policy.protectedPids.has(row.pid)) return false
  if (!JANITOR_WORKLOAD_SIGNATURES.some((sig) => sig.test(row.command))) return false
  if (CLAUDE_ANYTHING.test(row.command) && !PLUGIN_CLI_SIGNATURES.some((sig) => sig.test(row.command))) {
    return false
  }
  if (row.etimeS < policy.minEtimeS) return false
  return true
}

/** S6 alert selector (memory_guard.py:186-199): the single largest-RSS process at/above
 *  `minRssKb` that `isTier1Killable` REFUSES. Alert-only — the never-kill invariant is untouched;
 *  the caller LOGS the hog so a human learns about the 39-GB-fseventsd class instead of silence. */
export function selectRefusedAlert(rows: readonly ProcRow[], policy: Tier1Policy, minRssKb: number): ProcRow | null {
  let hog: ProcRow | null = null
  for (const r of rows) {
    if (r.rssKb < minRssKb || isTier1Killable(r, policy)) continue
    if (!hog || r.rssKb > hog.rssKb) hog = r
  }
  return hog
}

/** (D1-e) Pick the SINGLE largest-RSS Tier-1-killable row, or null (memory_guard.py:202-216). One
 *  victim per call — the beat kills at most one process and re-evaluates pressure next beat. */
export function selectVictim(rows: readonly ProcRow[], policy: Tier1Policy): ProcRow | null {
  let victim: ProcRow | null = null
  for (const r of rows) {
    if (!isTier1Killable(r, policy)) continue
    if (!victim || r.rssKb > victim.rssKb) victim = r
  }
  return victim
}

// ---------- I/O edges ---------------------------------------------------------------------------

/** System free memory in MB (Linux meminfo / macOS vm_stat); null = unknown (memory_guard.py:221-242).
 *  (D1-f) null makes the beat a NO-OP — never kill on missing data. */
export async function freeMemoryMb(): Promise<number | null> {
  try {
    if (fs.existsSync('/proc/meminfo')) return parseMeminfo(fs.readFileSync('/proc/meminfo', 'utf8'))
    const vm = await execFileAsync('vm_stat', [], { timeout: 10_000 })
    let pageSize = 16384
    try {
      const ps = await execFileAsync('sysctl', ['-n', 'hw.pagesize'], { timeout: 10_000 })
      const n = Number(ps.stdout.trim())
      if (Number.isFinite(n) && n > 0) pageSize = n
    } catch {
      /* the janitor's own fallback page size (Apple Silicon) */
    }
    return parseVmStat(vm.stdout, pageSize)
  } catch {
    return null
  }
}

/** (D1-d) `ps -axo pid,ppid,rss,etime,command` → FILE → parsed rows (memory_guard.py:245-263). The
 *  file hop is the no-self-match discipline (the snapshot is complete before any matching happens)
 *  and doubles as the forensic record of what the guard saw when it acted. [] on any failure. */
export async function snapshotProcesses(
  snapshotFile: string = statePath('memory-guard.ps-snapshot.txt'),
): Promise<ProcRow[]> {
  try {
    const { stdout } = await execFileAsync('ps', ['-axo', 'pid,ppid,rss,etime,command'], {
      timeout: 20_000,
      maxBuffer: 16 * 1024 * 1024,
    })
    fs.mkdirSync(path.dirname(snapshotFile), { recursive: true })
    fs.writeFileSync(snapshotFile, stdout, 'utf8')
    return parsePsSnapshot(fs.readFileSync(snapshotFile, 'utf8'))
  } catch {
    return []
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Alive AND not a zombie (memory_guard.py:285-307): `kill(pid, 0)` succeeds on zombies, but a
 *  zombie has already released its memory — for an OOM guard it counts as GONE. */
async function alive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code
    if (code === 'ESRCH') return false
    if (code !== 'EPERM') return false
    // EPERM: exists under another uid — fall through to the state check
  }
  try {
    const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'stat='], { timeout: 5_000 })
    return !stdout.trim().toUpperCase().startsWith('Z')
  } catch (err) {
    // ps exited non-zero → it cannot see the pid → gone; any other failure → assume alive
    // (conservative for kill-verification), exactly as the original.
    return typeof (err as { code?: unknown })?.code !== 'number'
  }
}

/** SIGTERM → grace → SIGKILL; true iff the process is gone afterwards (memory_guard.py:266-282). */
export async function killProcess(pid: number, termGraceMs = 2000): Promise<boolean> {
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return !(await alive(pid))
  }
  const deadline = Date.now() + termGraceMs
  while (Date.now() < deadline) {
    if (!(await alive(pid))) return true
    await sleep(100)
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    return !(await alive(pid))
  }
  await sleep(200)
  return !(await alive(pid))
}

// ---------- the beat (daemon.py::task_memory_guard, lines 760-802) ----------------------------

function envInt(name: string, dflt: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return dflt
  const v = Number(raw)
  return Number.isFinite(v) ? Math.trunc(v) : dflt
}

/** The kill is armed ONLY by this exact value (default-OFF destructive lane). */
export function memoryGuardArmed(): boolean {
  return process.env.AIM_MEMORY_GUARD === '1'
}

export interface MemoryGuardDeps {
  /** ARMED → kill + stamp + (via the scheduler) claim; unarmed → detect-only. Default: env flag. */
  armed?: boolean
  minFreeMb?: number
  minEtimeS?: number
  alertRssKb?: number
  protectedPids?: ReadonlySet<number>
  freeMb?: () => Promise<number | null>
  snapshot?: () => Promise<ProcRow[]>
  kill?: (pid: number) => Promise<boolean>
  stamp?: () => void
  log?: (msg: string) => void
  snapshotFile?: string
}

export type MemoryGuardAction =
  | 'noop-unknown' // free reading unavailable — (D1-f)
  | 'healthy' // above the floor
  | 'stood-down' // pressure, no Tier-1 candidate (alert may have been logged)
  | 'would-kill' // detect-only: a candidate exists, the lane is not armed
  | 'killed'
  | 'kill-failed'

export interface MemoryGuardBeat {
  action: MemoryGuardAction
  freeMb: number | null
  victim: ProcRow | null
  alert: ProcRow | null
}

// S6 alert dedupe — keyed on the PROGRAM and the threshold, not the pid: the same runaway
// respawning under a new pid is the SAME problem and must not re-alert every beat (daemon.py:81-83).
// ponytail: in-memory per process lifetime (the janitor keeps a seen-file); a restart re-alerts once.
const alertedHogs = new Set<string>()

/**
 * One memory-guard beat — daemon.py:760-802, same order, same early-returns:
 *   free reading → null ⇒ NO-OP (D1-f) · ≥ floor ⇒ healthy · else snapshot TO A FILE (D1-d) →
 *   selectVictim (D1-a/b/g) → none ⇒ stand down (+ S6 refused-hog alert) · else ONE kill (D1-e),
 *   logged LOUDLY (D1-h). The stamp is written on ATTEMPT (pressure path reached) only when ARMED —
 *   an unarmed lane is not performing the chore and must not tell the janitor it is.
 */
export async function runMemoryGuardBeat(deps: MemoryGuardDeps = {}): Promise<MemoryGuardBeat> {
  const armed = deps.armed ?? memoryGuardArmed()
  const minFreeMb = deps.minFreeMb ?? envInt('AIM_MEMORY_GUARD_MIN_FREE_MB', DEFAULT_MIN_FREE_MB)
  const log = deps.log ?? ((m: string) => console.warn(m))
  const snapshotFile = deps.snapshotFile ?? statePath('memory-guard.ps-snapshot.txt')

  const freeMb = await (deps.freeMb ?? freeMemoryMb)()
  // (D1-f) unknown reading = NO-OP (never kill on missing data); healthy = done  (daemon.py:46-47)
  if (freeMb === null) return { action: 'noop-unknown', freeMb, victim: null, alert: null }
  if (freeMb >= minFreeMb) return { action: 'healthy', freeMb, victim: null, alert: null }

  log(`[memory-guard] free ${freeMb}MB < ${minFreeMb}MB floor — scanning for a runaway`)
  if (armed) (deps.stamp ?? (() => stampChoreRun('memory-guard')))()

  const rows = await (deps.snapshot ?? (() => snapshotProcesses(snapshotFile)))()
  const policy: Tier1Policy = {
    // (D1-b) the caller and its parent are protected by construction (daemon.py:54)
    protectedPids: deps.protectedPids ?? new Set([process.pid, process.ppid]),
    minEtimeS: deps.minEtimeS ?? envInt('AIM_MEMORY_GUARD_RUNAWAY_ETIME_S', DEFAULT_RUNAWAY_ETIME_S),
  }
  const victim = selectVictim(rows, policy)

  if (victim === null) {
    log(
      `[memory-guard] pressure but NO Tier-1 candidate (only janitor-owned runaways are killable) — ` +
        `standing down; snapshot kept at ${snapshotFile}`,
    )
    // S6: standing down must not mean SILENCE about a giant we rightly won't kill (daemon.py:67-94)
    const alertRssKb = deps.alertRssKb ?? envInt('AIM_MEMORY_GUARD_ALERT_RSS_KB', DEFAULT_ALERT_RSS_KB)
    let alert: ProcRow | null = null
    if (alertRssKb > 0) {
      alert = selectRefusedAlert(rows, policy, alertRssKb)
      if (alert) {
        const key = `${alert.command.split(/\s+/)[0] || '?'}:${alertRssKb}`
        if (!alertedHogs.has(key)) {
          alertedHogs.add(key)
          log(
            `[memory-guard] ALERT: unkillable runaway pid=${alert.pid} rss=${Math.floor(alert.rssKb / 1024)}MB ` +
              `age=${alert.etimeS}s cmd=${JSON.stringify(alert.command)} — the never-kill invariant holds ` +
              `(not janitor-owned); a HUMAN must decide. Free memory was ${freeMb}MB; snapshot: ${snapshotFile}`,
          )
        }
      }
    }
    return { action: 'stood-down', freeMb, victim: null, alert }
  }

  const describe = `pid=${victim.pid} rss=${victim.rssKb}KB age=${victim.etimeS}s cmd=${JSON.stringify(victim.command)}`
  if (!armed) {
    log(`[memory-guard] would kill runaway ${describe} (free was ${freeMb}MB) [detect-only: AIM_MEMORY_GUARD not set]`)
    return { action: 'would-kill', freeMb, victim, alert: null }
  }
  // (D1-e) exactly ONE kill per beat; (D1-h) logged loudly  (daemon.py:96-101)
  const killed = await (deps.kill ?? killProcess)(victim.pid)
  log(`[memory-guard] ${killed ? 'KILLED' : 'KILL FAILED for'} runaway ${describe} (free was ${freeMb}MB; snapshot: ${snapshotFile})`)
  return { action: killed ? 'killed' : 'kill-failed', freeMb, victim, alert: null }
}

// ---------- scheduler ---------------------------------------------------------------------------

let inFlight = false

async function beat(log: (msg: string) => void, run: () => Promise<unknown>): Promise<void> {
  if (inFlight) return
  inFlight = true
  try {
    await run()
  } catch (err) {
    log(`[memory-guard] beat threw (non-fatal): ${err instanceof Error ? err.message : err}`)
  } finally {
    inFlight = false
  }
}

/**
 * Start the recurring guard. Same shape as the other absorbed lanes: fires once immediately,
 * unref'd, never throws; returns a stop function, or null when disabled (interval <= 0).
 * ARMED (`AIM_MEMORY_GUARD=1`) ⇒ the lane is LIVE: the chore is marked live for the liveness
 * beat's `absorbed_chores` claim, and un-marked by the returned stop function. Unarmed ⇒
 * detect-only, no claim.
 */
export function startMemoryGuardScheduler(
  opts: { intervalMs?: number; log?: (msg: string) => void; runBeat?: () => Promise<unknown> } = {},
): (() => void) | null {
  const intervalMs = opts.intervalMs ?? envInt('AIM_MEMORY_GUARD_INTERVAL_MS', DEFAULT_INTERVAL_MS)
  if (!intervalMs || intervalMs <= 0) return null
  const log = opts.log ?? ((msg: string) => console.warn(msg))
  // `runBeat` is a TEST seam: the scheduler tests must never reach the real probe/kill path.
  const run = opts.runBeat ?? (() => runMemoryGuardBeat({ log }))
  const armed = memoryGuardArmed()
  if (armed) markChoreLive('memory-guard')
  void beat(log, run)
  const timer = setInterval(() => void beat(log, run), intervalMs)
  timer.unref?.()
  return () => {
    clearInterval(timer)
    if (armed) unmarkChoreLive('memory-guard')
  }
}

/** Exported for tests only — the alert dedupe set is process-global. */
export function _resetAlertDedupeForTests(): void {
  alertedHogs.clear()
}
