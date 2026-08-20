// The absorbed cold-cache-clear lane (TRDD-<authored below>, parent KCRMSNL7) — the LAST of the
// janitor's GLOBAL_CHORES, absorbed via the SHELL-OUT contract the janitor named on 2026-08-20
// (their TRDD-9ZPU69UC, commit 1d5a3b16, ships in v3.3.19):
//
//     <data-dir>/dispatcher-stub.py --run-cold-cache-clear
//
// That argv IS the entire integration — zero janitor imports. The stub auto-rolls to the newest
// cached plugin version (its own C2/C3 verify walk) and passes argv through to dispatch.py,
// whose flag branch runs ONE beat of lib/cold_cache_clear_task.run_once (moved verbatim from
// their daemon task) and passes the beat's rc through. Semantics stay THEIRS: default-OFF via
// their external_clear.enabled() opt-in, one candidate per invocation, never an active
// transcript, per-project clear cooldown. Double-ownership is safe by design: their daemon
// yields `cold-cache-clear` the tick we claim it, and the cooldown is the backstop either way.
//
// VERSION GATE (their note, verbatim requirement): the flag branch exists only from v3.3.19's
// cache onward — a pre-3.3.19 dispatch treats the argv as noise and runs a FULL heartbeat
// turn's phases. So every beat probes the NEWEST cached dispatch.py for the flag string and,
// absent it, releases the claim and does nothing. The probe re-runs per beat because the cache
// auto-rolls forward mid-run — the lane self-activates when 3.3.19 lands, no restart needed.
//
// WHY unarmed is a full no-op (unlike memory-guard's detect-only): "what would be cleared" is
// computed inside the janitor's own beat, which ACTS when it decides — there is no read-only
// half we can run to report without acting. Unarmed ⇒ no spawn, no claim, no stamp; the
// janitor daemon keeps executing the chore exactly as today.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { markChoreLive, stampChoreRun, unmarkChoreLive } from '@/lib/janitor-chore-stamp'

const execFileAsync = promisify(execFile)

const DEFAULT_INTERVAL_MS = 300_000 // the janitor's own cadence (daemon.py:181, 300 s)
const LAUNCHER_FLAG = '--run-cold-cache-clear'

export function dispatcherStubPath(): string {
  return path.join(
    os.homedir(),
    '.claude',
    'plugins',
    'data',
    'ai-maestro-janitor-ai-maestro-plugins',
    'dispatcher-stub.py',
  )
}

export function janitorCacheRoot(): string {
  return path.join(os.homedir(), '.claude', 'plugins', 'cache', 'ai-maestro-plugins', 'ai-maestro-janitor')
}

/** Newest cached version dir by SEMVER-ish sort (numeric segment compare — a lexical sort
 *  would put 3.3.9 above 3.3.19). Suffixed dirs like `3.1.28-4c799…` sort by their numeric
 *  prefix, suffix ignored. Null when the cache root is unreadable. */
export function newestCachedVersionDir(root: string = janitorCacheRoot()): string | null {
  let names: string[]
  try {
    names = fs.readdirSync(root).filter((n) => /^\d+\.\d+\.\d+/.test(n))
  } catch {
    return null
  }
  if (names.length === 0) return null
  const key = (n: string) => n.split('-')[0].split('.').map(Number)
  names.sort((a, b) => {
    const ka = key(a), kb = key(b)
    for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i]
    return a < b ? -1 : 1
  })
  return path.join(root, names[names.length - 1])
}

/** The version gate: true iff the NEWEST cached dispatch.py carries the flag branch
 *  (≥3.3.19). Fail-closed: unreadable ⇒ absent ⇒ the lane stays inert and unclaimed. */
export function launcherFlagPresent(root: string = janitorCacheRoot()): boolean {
  const dir = newestCachedVersionDir(root)
  if (!dir) return false
  try {
    return fs.readFileSync(path.join(dir, 'scripts', 'dispatch.py'), 'utf8').includes('run-cold-cache-clear')
  } catch {
    return false
  }
}

export interface ColdCacheClearDeps {
  probe?: () => boolean
  /** spawns the stub with the flag; returns the exit code (their beat's rc, passed through). */
  spawn?: () => Promise<number>
  stamp?: () => void
  markLive?: () => void
  unmarkLive?: () => void
  log?: (msg: string) => void
  armed?: boolean
}

export interface ColdCacheClearResult {
  ran: boolean
  rc: number | null
  reason: 'unarmed' | 'launcher-absent' | 'ran' | 'spawn-failed'
}

export async function runColdCacheClear(deps: ColdCacheClearDeps = {}): Promise<ColdCacheClearResult> {
  const log = deps.log ?? ((m: string) => console.warn(m))
  if (!deps.armed) return { ran: false, rc: null, reason: 'unarmed' }
  if (!(deps.probe ?? launcherFlagPresent)()) {
    // Pre-3.3.19 cache: running the stub would fire a FULL heartbeat turn (their warning).
    // Release the claim so the janitor daemon keeps the chore until the launcher lands.
    ;(deps.unmarkLive ?? (() => unmarkChoreLive('cold-cache-clear')))()
    return { ran: false, rc: null, reason: 'launcher-absent' }
  }
  ;(deps.markLive ?? (() => markChoreLive('cold-cache-clear')))()
  deps.stamp?.()
  try {
    const rc = await (deps.spawn ?? spawnStub)()
    if (rc !== 0) log(`[cold-cache-clear] beat rc=${rc} (their beat's own exit passed through)`)
    return { ran: true, rc, reason: 'ran' }
  } catch (err) {
    log(`[cold-cache-clear] spawn failed (non-fatal): ${err instanceof Error ? err.message : err}`)
    return { ran: false, rc: null, reason: 'spawn-failed' }
  }
}

/** Same invocation shape the janitor heartbeat uses for the stub. Bounded: one candidate per
 *  invocation by their contract, but a wedged uv resolve must not pile up beats. */
async function spawnStub(): Promise<number> {
  try {
    await execFileAsync('uv', ['run', '--script', '--quiet', dispatcherStubPath(), LAUNCHER_FLAG], {
      timeout: 240_000,
    })
    return 0
  } catch (err) {
    const code = (err as { code?: unknown }).code
    return typeof code === 'number' ? code : 1
  }
}

let inFlight = false

/** 5 min (their cadence); AIM_COLD_CACHE_CLEAR=1 arms; AIM_COLD_CACHE_CLEAR_INTERVAL_MS
 *  overrides, 0 disables. Claim is DYNAMIC (per beat, inside runColdCacheClear) because the
 *  cache rolls forward mid-run — the lane claims the tick the 3.3.19 launcher appears. */
export function startColdCacheClearScheduler(
  opts: { intervalMs?: number; log?: (msg: string) => void; runBeat?: () => Promise<ColdCacheClearResult> } = {},
): (() => void) | null {
  const raw = Number(process.env.AIM_COLD_CACHE_CLEAR_INTERVAL_MS)
  const intervalMs = opts.intervalMs ?? (Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_INTERVAL_MS)
  if (!intervalMs || intervalMs <= 0) return null
  const armed = process.env.AIM_COLD_CACHE_CLEAR === '1'
  const log = opts.log ?? ((msg: string) => console.warn(msg))
  const runBeat =
    opts.runBeat ??
    (() =>
      runColdCacheClear({
        armed,
        log,
        stamp: () => stampChoreRun('cold-cache-clear'),
      }))
  const beat = () => {
    if (inFlight) return
    inFlight = true
    void runBeat()
      .catch((err) => log(`[cold-cache-clear] beat threw (non-fatal): ${err instanceof Error ? err.message : err}`))
      .finally(() => {
        inFlight = false
      })
  }
  beat()
  const timer = setInterval(beat, intervalMs)
  timer.unref?.()
  return () => {
    clearInterval(timer)
    if (armed) unmarkChoreLive('cold-cache-clear')
  }
}
