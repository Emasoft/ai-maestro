/**
 * §D4 watchdog scheduler — the sweep's ONE scheduled host (TRDD-TGNU1EP7, 3P-ZON-11).
 *
 * 3P-ZON-11 closes with "a watchdog scheduled NOWHERE satisfies nothing here — being
 * scheduled is part of the clause". Until this module, every governance check was a
 * command a human types (`yarn trdd:doctor` / `yarn trdd:watchdog`). TGNU1EP7 required
 * picking ONE host and saying so: this is the SERVER-SIDE IDLE SWEEP — the server owns
 * the authority-ladder model the sweep enforces, which is the ownership argument that
 * ruled out the janitor heartbeat (it would be enforcing a contract it does not own,
 * cross-ref janitor#84). No second host may be added; two mechanisms with independent
 * cooldowns defeat each other (ai-maestro#51, 2026-07-25).
 *
 * REPORTING-ONLY, by both parent cards' explicit risk directive: the beat logs and
 * writes a report the MANAGER drains; it never fails a build, never edits a card, never
 * nudges an agent. And it LOGS EVERY RUN, findings or none — "absence of findings on a
 * clean corpus is NOT evidence the sweep ran; the log line is" (TGNU1EP7's verification,
 * written against the failure mode of a sweep that runs and reports nothing while
 * looking healthy).
 *
 * Same shape as `startGithubConfigAuditScheduler`: fires once at start (which also
 * sidesteps the bare-setInterval boot+INTERVAL starvation on a restart-looped server),
 * `unref`'d, in-flight-guarded, never throws.
 */
import fs from 'fs'
import path from 'path'
import { lintCorpus } from './trdd-doctor'
import { watchdogSweep } from './trdd-watchdog'

/** 6 h — the janitor's own drift cadence, coarse enough for a lazy audit. Env-overridable; `0` disables. */
const DEFAULT_INTERVAL_MS = Number(process.env.AIM_TRDD_WATCHDOG_INTERVAL_MS) || 6 * 60 * 60 * 1000

let inFlight = false

export interface SweepResult {
  ran: boolean
  reason?: string
  scanned?: number
  errors?: number
  warnings?: number
  reportPath?: string
}

/** One sweep over the hub corpus. Exported so a test can drive a beat without a timer. */
export function runTrddWatchdogSweep(repoRoot: string = process.cwd()): SweepResult {
  const designDir = path.join(repoRoot, 'design')
  if (!fs.existsSync(path.join(designDir, 'tasks'))) {
    return { ran: false, reason: `no design/tasks under ${repoRoot} — nothing to sweep` }
  }
  const doctor = lintCorpus(designDir)
  const watchdog = watchdogSweep(designDir)
  const scanned = doctor.scanned
  // Zero scanned is never clean — the CLI refuses too; here it is a skip with a reason.
  if (scanned === 0) return { ran: false, reason: 'scanned 0 TRDDs — refusing to report a corpus it never read' }

  const all = [...watchdog.findings, ...doctor.findings]
  const errors = all.filter((f) => f.severity === 'error').length
  const warnings = all.filter((f) => f.severity === 'warn').length

  // The report the MANAGER drains — gitignored reports/, per the agent-reports rule.
  const dir = path.join(repoRoot, 'reports', 'trdd-watchdog')
  fs.mkdirSync(dir, { recursive: true })
  const ts = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+/, 'Z')
  const reportPath = path.join(dir, `${ts}-d4-sweep.md`)
  const lines = [
    `# §D4 sweep — ${new Date().toISOString()}`,
    '',
    `${scanned} card(s) linted · ${watchdog.scanned} in the watchdog scan set · ${errors} error · ${warnings} warn`,
    `blind spots: ${watchdog.supersedeUnattributed} supersede line(s) unattributable, ${watchdog.commitFloorUnresolved} citing sha(s) unresolvable`,
    '',
    ...all.map((f) => `- ${f.severity.toUpperCase()} ${f.rule} ${f.id} — ${f.message}`),
  ]
  fs.writeFileSync(reportPath, lines.join('\n') + '\n', 'utf8')
  return { ran: true, scanned, errors, warnings, reportPath }
}

function beat(log: (msg: string) => void): void {
  if (inFlight) return
  inFlight = true
  try {
    const r = runTrddWatchdogSweep()
    // Log EVERY run — the run line is the liveness evidence, not the findings.
    if (!r.ran) log(`[trdd-watchdog] sweep skipped — ${r.reason}`)
    else log(`[trdd-watchdog] sweep ran: ${r.scanned} scanned, ${r.errors} error(s), ${r.warnings} warn(s) → ${r.reportPath}`)
  } catch (err) {
    log(`[trdd-watchdog] beat threw (non-fatal): ${err instanceof Error ? err.message : err}`)
  } finally {
    inFlight = false
  }
}

/** Start the recurring sweep. Returns a stop function, or null when disabled. */
export function startTrddWatchdogScheduler(opts: { intervalMs?: number; log?: (msg: string) => void } = {}): (() => void) | null {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS
  if (!intervalMs || intervalMs <= 0) return null
  const log = opts.log ?? ((msg: string) => console.warn(msg))
  beat(log)
  const timer = setInterval(() => beat(log), intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}
