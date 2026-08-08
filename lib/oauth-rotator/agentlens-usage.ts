/**
 * agentlenspro as a SECOND usage source for the rotator — TRDD-SLSSUIQ8.
 *
 * `agentlenspro statusline-history windows --json` is the only un-quantized 5h/7d reading on the
 * host (its own help says so), and it answers from disk with the agentlens server down. The rows
 * are mapped into the SAME `UsageObservation` shape the statusline store produces, so the
 * existing admission machinery (`statusline-admissible.ts`) re-filters them — this module makes
 * agentlens rows first-class citizens of that guard, never a bypass of it.
 *
 * ── THE ATTRIBUTION HAZARD, and why the cohort check is not optional ────────────────────────────
 * Rows carry NO account identity, and a live measurement (2026-08-08) showed rows from TWO
 * accounts side by side: one session at 23%/4% with `resets_5h` 00:00 among eleven at ~52-60%
 * with 10:00. A timestamp-only attribution would hand the rotator another account's numbers —
 * precisely the misattribution `statusline-admissible.ts`'s header documents as the loop that
 * "burns every remaining account in minutes". The identity surrogate is the 5h RESET INSTANT:
 * two accounts' windows reset at different moments, so a row whose `resets_5h` exactly equals
 * the live account's (persisted from the last endpoint probe as
 * `WindowSnapshot.fiveHourResetsAtSec`) is the live account's row. **No known cohort ⇒ ZERO
 * observations** — never guess.
 *
 * Everything here is fail-soft: an uninstalled CLI, a non-zero exit, garbage stdout, or a
 * malformed row yields fewer observations, never an error. The rotator's behavior on absent
 * data is already "do not rotate", which is the safe direction.
 */
import { execFile } from 'child_process'
import type { UsageObservation } from '@/lib/statusline-admissible'

/** One row of `statusline-history windows --json` (shape measured 2026-08-08). */
export interface AgentlensWindowRow {
  session_id: string
  /** Sample instant, epoch MILLISECONDS. */
  ts: number
  pct_5h: number
  pct_7d: number
  /** The 5h window's reset instant, epoch SECONDS — the account-attribution cohort key. */
  resets_5h: number
}

/** Bounded so a hung CLI cannot stall a rotator beat. */
const AGENTLENS_TIMEOUT_MS = 10_000

export interface AgentlensReaderDeps {
  /** Injectable subprocess, so tests never spawn anything. Same signature slice as execFile. */
  execFileImpl?: (
    cmd: string,
    args: string[],
    opts: { timeout: number },
    cb: (err: Error | null, stdout: string) => void,
  ) => void
}

/**
 * Read the window rows from the CLI. Fail-soft `[]` on EVERY failure — ENOENT (agentlenspro is
 * optional host tooling, not a dependency), non-zero exit, timeout, unparseable stdout. A
 * malformed individual row is dropped, never defaulted: a guessed percentage is worse than a
 * missing one (the missing-gauge-read-as-0% trap `statusline-admissible.ts` documents).
 */
export async function readAgentlensWindowRows(deps: AgentlensReaderDeps = {}): Promise<AgentlensWindowRow[]> {
  const run = deps.execFileImpl ?? execFile
  const stdout = await new Promise<string | null>((resolve) => {
    try {
      run('agentlenspro', ['statusline-history', 'windows', '--json'], { timeout: AGENTLENS_TIMEOUT_MS }, (err, out) =>
        resolve(err ? null : out),
      )
    } catch {
      resolve(null)
    }
  })
  if (!stdout) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return []
  }
  const rows = (parsed as { rows?: unknown } | null)?.rows
  if (!Array.isArray(rows)) return []
  const out: AgentlensWindowRow[] = []
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue
    const row = r as Record<string, unknown>
    if (
      typeof row.ts !== 'number' || !Number.isFinite(row.ts) ||
      typeof row.pct_5h !== 'number' || !Number.isFinite(row.pct_5h) ||
      typeof row.resets_5h !== 'number' || !Number.isFinite(row.resets_5h)
    ) continue
    out.push({
      session_id: typeof row.session_id === 'string' ? row.session_id : '',
      ts: row.ts,
      pct_5h: row.pct_5h,
      pct_7d: typeof row.pct_7d === 'number' && Number.isFinite(row.pct_7d) ? row.pct_7d : NaN,
      resets_5h: row.resets_5h,
    })
  }
  return out
}

export interface AgentlensAttribution {
  /** The rotator's live-account fingerprint — becomes the observation's identity stamp. */
  liveFp: string | null
  /** `RotatorState.last_switch_at`, epoch SECONDS (the documented s-vs-ms trap lives here). */
  lastSwitchAtS: number | null
  /** The live account's 5h reset instant, epoch SECONDS, from the persisted window stamp. */
  liveResets5hSec: number | null
}

/**
 * PURE mapper: attribute rows to the live account and shape them as `UsageObservation`s.
 *
 * A row is emitted ONLY when ALL hold:
 *   (a) a live cohort is KNOWN — `liveResets5hSec` finite; unknown ⇒ EMPTY output, never a guess;
 *   (b) `row.resets_5h === liveResets5hSec` — the exact cohort match (the identity surrogate);
 *   (c) the row post-dates the last account switch — `row.ts >= lastSwitchAtS * 1000`.
 *       ⚠ SECONDS → MILLISECONDS: `last_switch_at` is epoch seconds (`rotate.ts:44`), `ts` is
 *       epoch ms. Without the ×1000 the comparison is ms ≥ s, ALWAYS true, and every pre-switch
 *       row — the old exhausted account's — is admitted: the exact vacuous-guard direction
 *       `admitSnapshot`'s own comment documents.
 *
 * The emitted observation is stamped with the live fingerprint, so `admitSnapshot` downstream
 * re-checks identity and pre-switch age with the system's ONE predicate — this mapper mirrors
 * those checks at the source (a row that fails them must not even enter the pool) but never
 * replaces them.
 */
export function agentlensObservations(
  rows: readonly AgentlensWindowRow[],
  opts: AgentlensAttribution,
): UsageObservation[] {
  const cohort = opts.liveResets5hSec
  if (typeof cohort !== 'number' || !Number.isFinite(cohort)) return []
  const switchMs =
    typeof opts.lastSwitchAtS === 'number' && Number.isFinite(opts.lastSwitchAtS)
      ? opts.lastSwitchAtS * 1000
      : null
  const out: UsageObservation[] = []
  for (const row of rows) {
    if (row.resets_5h !== cohort) continue
    if (switchMs !== null && row.ts < switchMs) continue
    if (!Number.isFinite(row.pct_5h)) continue
    out.push({
      liveFp: opts.liveFp,
      capturedAt: row.ts,
      rateLimits: {
        fiveHour: { usedPercentage: row.pct_5h, resetsAtMs: row.resets_5h * 1000, source: 'agentlens' },
        sevenDay: Number.isFinite(row.pct_7d)
          ? { usedPercentage: row.pct_7d, resetsAtMs: null, source: 'agentlens' }
          : null,
      },
    })
  }
  return out
}
