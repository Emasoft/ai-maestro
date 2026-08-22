/**
 * Installed-script drift — TRDD-GADPGOIR.
 *
 * Agents execute `amp-*` / `aid-*` / `aimaestro-*` from `~/.local/bin`. The repo's `scripts/` is only the
 * SOURCE: nothing syncs them automatically, and until this existed nothing detected when they
 * disagreed. A commit is not an install, and no gate said so.
 *
 * THE INCIDENT (2026-08-04). `scripts/amp-helper.sh` carried two 07-23 commits — the AMP identity
 * self-heal and a refusal-message rewrite — that had never been installed. 32 live agents with
 * colliding AMP addresses were all running the 07-21 copy. The coordination answer given at the
 * time ("each agent repairs itself on its next load_config — nothing to run") was false the moment
 * it was written and stayed false for 12 days, because it was verified against `git log` rather
 * than against the installed artifact. **A claim about RUNNING CODE is one that `git log` cannot
 * falsify.**
 *
 * WHAT MADE IT HARD TO SEE, and why a spot-check is not a check: 29 of 31 installed `amp-*.sh`
 * were byte-identical to source. Exactly two differed. Sampling almost any other script reported
 * "in sync", which is why this compares the WHOLE set and reports a census rather than an opinion.
 *
 * ⚠ THE PARTIAL-REFRESH HAZARD — this detector REPORTS, it must never refresh. The installed copy
 * lacked BOTH fixes, which is what made it inert; that was luck, not a safety property. Applying
 * the self-heal WITHOUT its sibling activates a heal that calls `save_config`, rebuilding the agent
 * object and silently dropping `id` — the uuid that IS the agent's identity in `.index.json` and
 * every envelope. Refresh both or neither; never cherry-pick into the installed layer. Remediation
 * stays manual and USER-gated (`./install-messaging.sh -y`), which is why nothing here writes.
 */

/** One script's state. THREE states, not two: `missing` is a different fault from `drifted` —
 *  a drifted script runs the wrong code, a missing one is `command not found` for any agent that
 *  calls it. Collapsing them would report a never-installed script as merely stale. */
export type ScriptState = 'identical' | 'drifted' | 'missing'

export interface ScriptRow {
  name: string
  state: ScriptState
}

export interface DriftReport {
  rows: ScriptRow[]
  identical: number
  drifted: string[]
  missing: string[]
  /** Total compared. ZERO means the scan built no set at all — never "clean". */
  scanned: number
}

export interface DriftInputs {
  /** Basenames of the source scripts to check (e.g. `amp-helper.sh`). */
  names: string[]
  /** Source bytes by basename. A name absent here is a caller bug, not a finding. */
  readSource: (name: string) => Buffer | string
  /** Installed bytes by basename, or null when the file does not exist. */
  readInstalled: (name: string) => Buffer | string | null
}

/**
 * Does this filename belong to the installed-script layer this detector governs?
 *
 * THE FAMILY LIST IS THE SCAN SET, so a family missing here is not under-reported — it is
 * INVISIBLE, and the census prints a confident "clean" about scripts it never opened. `aid-*`
 * was omitted from this predicate's original inline form and all SIX aid scripts went unchecked
 * for as long as it existed; the drift report read `47 compared` and nobody could tell that the
 * agent-identity family was simply not in the population. That is the same shape as the incident
 * in this file's header — a claim about running code that the instrument cannot falsify.
 *
 * It lives HERE, exported and tested, rather than inline in `scripts/check-script-drift.mjs`,
 * because a predicate in an untested `.mjs` is pinned by nothing: the lib had a full test file
 * and the one line that decided WHAT GETS TESTED sat outside it.
 */
export function isTrackedScriptName(name: string): boolean {
  return /^(amp|aid|aimaestro)-.*\.sh$/.test(name)
}

/**
 * PURE. Compare each named script's source against its installed counterpart.
 *
 * Byte comparison, deliberately — not mtime and not a version string. mtime says when a file was
 * WRITTEN, which an install rewrites even when the content is unchanged, and a version string is
 * only as honest as whoever bumped it. Bytes are the thing an agent actually executes.
 */
export function compareInstalledScripts(input: DriftInputs): DriftReport {
  const rows: ScriptRow[] = []
  for (const name of input.names) {
    const installed = input.readInstalled(name)
    if (installed === null) {
      rows.push({ name, state: 'missing' })
      continue
    }
    const a = Buffer.from(input.readSource(name))
    const b = Buffer.from(installed)
    rows.push({ name, state: a.equals(b) ? 'identical' : 'drifted' })
  }
  return {
    rows,
    identical: rows.filter((r) => r.state === 'identical').length,
    drifted: rows.filter((r) => r.state === 'drifted').map((r) => r.name),
    missing: rows.filter((r) => r.state === 'missing').map((r) => r.name),
    scanned: rows.length,
  }
}

/** Grep's trichotomy, the convention every pillar CLI here follows: 0 clean · 1 findings ·
 *  2 COULD NOT RUN. The third code is the point — a scan that built no set must never exit 0,
 *  because "clean" and "I looked at nothing" are the same output otherwise, and that is precisely
 *  how the human check missed this for 12 days. */
export function driftExitCode(report: DriftReport): 0 | 1 | 2 {
  if (report.scanned === 0) return 2
  return report.drifted.length > 0 || report.missing.length > 0 ? 1 : 0
}

/** One line per finding plus a census line. Names the remediation but never performs it. */
export function formatDriftReport(report: DriftReport): string {
  if (report.scanned === 0) {
    return 'script-drift: COULD NOT RUN — no scripts were compared (empty scan set)'
  }
  const lines: string[] = []
  for (const n of report.drifted) lines.push(`DRIFTED  ${n} — installed copy differs from source`)
  for (const n of report.missing) lines.push(`MISSING  ${n} — never installed; agents calling it get "command not found"`)
  lines.push(
    `script-drift: ${report.scanned} compared — ${report.identical} identical, ` +
      `${report.drifted.length} drifted, ${report.missing.length} missing`,
  )
  if (report.drifted.length > 0 || report.missing.length > 0) {
    // Deliberately an INSTRUCTION TO A HUMAN, not an action. See the partial-refresh hazard above:
    // the refresh changes identity-resolution behaviour underneath live agents, and doing half of
    // it drops every affected agent's uuid.
    lines.push('  remediation is MANUAL and all-or-nothing: `./install-messaging.sh -y` (never cherry-pick a single file)')
  }
  return lines.join('\n')
}
