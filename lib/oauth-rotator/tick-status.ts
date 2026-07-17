import * as fs from 'fs'
import * as path from 'path'
import { statePath } from '../ecosystem-constants'
import type { NextAction } from './tick'

// The persisted stamp that bridges the OAuth-rotator beat to the continuity `status` verb
// (TRDD-1GGQ4HWY → TRDD-DXJZM3BW). The beat (server-tick.ts::runOneTick) ACTUATES behind the R16
// flag gate and concludes a cascade `next_action`; the `status` verb only READS. This module is
// the ONE owner of that bridge — the path, the on-disk shape, the writer, and the reader all live
// here, so the two sides can never disagree about the file (One Source of Truth).
//
// WHY A FILE (PERSIST-THEN-READ), not a shared call: it is exactly what keeps R16 intact. A status
// GET must NEVER run the tick (running it could write a live credential), so the read side may only
// consult a value the beat already persisted. A stamp on disk is the whole coupling; the read side
// cannot actuate anything.

/** The cascade states the tick can conclude — the SAME vocabulary as tick.ts's TickResult. */
const VALID: ReadonlySet<string> = new Set<NextAction>(['ok', 'rotating', 'reauth-needed'])

/** On-disk shape: the last tick's cascade conclusion plus when it was written (ISO 8601). */
interface TickStatusFile {
  nextAction: NextAction
  at: string
}

/** A stamp older than this is IGNORED. The beat writes every ~60 s while the flag is armed; once
 *  the human disarms it the beat stops writing, so a wide window would let a stale `rotating` keep
 *  overriding the live observable heuristic — dishonest (the module's own honesty invariant). A
 *  few missed beats are tolerated; a long-disarmed value is not. */
const MAX_AGE_S = 300

/** Resolve the stamp path FRESH on every call. `getStateDir()` is anchored on os.homedir(), and a
 *  unit test points HOME at a temp dir AFTER this module was imported — the same reason
 *  server-tick.ts::oauthTickEnabled re-resolves rather than caching a module-load constant. */
function tickStatusPath(): string {
  return statePath('oauth-rotator-tick-status.json')
}

/**
 * Persist the tick's cascade `nextAction`. Accepts the beat's result as `unknown` on purpose:
 * server-tick's `runTickImpl` seam is typed `unknown`, and `withTickLock` returns `null` when a
 * concurrent beat held the lock. A missing / null / invalid `nextAction` is a SILENT no-op, so a
 * skipped, stubbed, or shapeless beat never clobbers the last good value. Atomic tmp+rename, and
 * it NEVER throws — a persistence hiccup must not crash an unattended background beat; the read
 * side already degrades to the interim heuristic when the stamp is absent or stale.
 */
export function writeTickStatus(result: unknown): void {
  try {
    const na = (result as { nextAction?: unknown } | null)?.nextAction
    if (typeof na !== 'string' || !VALID.has(na)) return
    const payload: TickStatusFile = { nextAction: na as NextAction, at: new Date().toISOString() }
    const file = tickStatusPath()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(payload))
    fs.renameSync(tmp, file)
  } catch {
    /* best-effort: a failed stamp just means the read side uses the interim heuristic this tick */
  }
}

/**
 * The last tick's cascade `nextAction`, or `null` when ABSENT / unparseable / STALE. `null` is the
 * EXPECTED default — the beat is OFF unless the human armed the flag (R16) — and the caller falls
 * back to the observable heuristic, never an error. Pure read (R16): it touches only the stamp
 * file, never the tick. `now()` is seconds-since-epoch (matching tick.ts's `now` seam).
 */
export function readTickStatus(opts?: { now?: () => number }): NextAction | null {
  let data: unknown
  try {
    data = JSON.parse(fs.readFileSync(tickStatusPath(), 'utf8'))
  } catch {
    return null // absent or garbage → interim heuristic
  }
  if (!data || typeof data !== 'object') return null
  const d = data as { nextAction?: unknown; at?: unknown }
  if (typeof d.nextAction !== 'string' || !VALID.has(d.nextAction)) return null
  if (typeof d.at !== 'string') return null
  const ts = Date.parse(d.at)
  if (Number.isNaN(ts)) return null
  const nowMs = opts?.now ? opts.now() * 1000 : Date.now()
  if ((nowMs - ts) / 1000 > MAX_AGE_S) return null // stale → do not override the live heuristic
  return d.nextAction as NextAction
}
