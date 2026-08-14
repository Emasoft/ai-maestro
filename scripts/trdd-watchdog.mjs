#!/usr/bin/env node
/**
 * trdd-watchdog — the consolidated §D4 approval-ladder sweep (TRDD-AYBAMFN2, ai-maestro#146).
 *
 *   node --import tsx scripts/trdd-watchdog.mjs                 # sweep, exit 1 on any error
 *   node --import tsx scripts/trdd-watchdog.mjs --design-dir X  # sweep another corpus
 *   yarn trdd:watchdog                                          # the idle-cadence entry point
 *
 * ONE report, TWO engines: `lib/trdd-doctor.ts::lintCorpus` already owns §D4 steps 3-6
 * (mandate-vs-declared, platelet invariants, completion gates, approval record), and
 * `lib/trdd-watchdog.ts::watchdogSweep` owns what nothing enforced — the D3 objective
 * floor (steps 1-2), mandate-vs-COMPUTED-floor (step 3's corrected-floor half), and
 * supersede authority (step 7). §D4 prescribes "a report the MANAGER drains" on idle
 * cadence, so this binary prints both engines' findings as one report and is wired as a
 * yarn task — never a per-creation hook.
 *
 * EXIT CODES — grep's trichotomy: 0 clean · 1 error findings · 2 THE SWEEP COULD NOT RUN.
 * Warns alone exit 0: they are the MANAGER queue's content, not a gate — an idle sweep
 * that reddens CI over an ambiguity nobody has judged yet is how a watchdog gets routed
 * around. Never write `trdd-watchdog || …`: that collapses could-not-run into findings.
 */
import path from 'path'
import process from 'process'

process.on('uncaughtException', (err) => {
  console.error(`trdd-watchdog: could not run — ${err?.message ?? err}`)
  if (process.env.TRDD_DEBUG) console.error(err?.stack ?? '')
  process.exit(2)
})

const { lintCorpus } = await import('../lib/trdd-doctor.ts')
const { watchdogSweep } = await import('../lib/trdd-watchdog.ts')
const { assertDesignDir } = await import('../lib/trdd-store.ts')

const args = process.argv.slice(2)
const flagValue = (f) => {
  const i = args.indexOf(f)
  return i >= 0 ? args[i + 1] : undefined
}
const designDir = path.resolve(flagValue('--design-dir') ?? path.join(process.cwd(), 'design'))
assertDesignDir(designDir)

const C = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
}

const doctor = lintCorpus(designDir)
const watchdog = watchdogSweep(designDir)

// Non-vacuity in the TOOL, not only in a test: zero scanned is never clean.
if (doctor.scanned === 0 && watchdog.scanned === 0) {
  console.error(`trdd-watchdog: scanned 0 TRDDs under ${designDir} — refusing to call a corpus clean that it never read`)
  process.exit(2)
}

const all = [
  ...watchdog.findings.map((f) => ({ ...f, engine: 'watchdog' })),
  ...doctor.findings.map((f) => ({ ...f, engine: 'doctor' })),
]
const errors = all.filter((f) => f.severity === 'error').length
const warnings = all.filter((f) => f.severity === 'warn').length

console.log(
  C.bold(
    `\n§D4 sweep — ${doctor.scanned} card(s) linted, ${watchdog.scanned} in the watchdog scan set · ` +
      `${C.red(`${errors} error`)} · ${C.yellow(`${warnings} warn`)}`,
  ),
)
if (watchdog.supersedeUnattributed > 0) {
  console.log(C.dim(`  (${watchdog.supersedeUnattributed} superseded card(s) unattributable — no Agent: trailer on the introducing commit; blind spot, counted not guessed)`))
}
console.log()

const byRule = new Map()
for (const f of all) {
  const key = `${f.engine}\x00${f.rule}\x00${f.severity}`
  if (!byRule.has(key)) byRule.set(key, [])
  byRule.get(key).push(f)
}
for (const [key, fs_] of [...byRule].sort((a, b) => b[1].length - a[1].length)) {
  const [engine, rule, sev] = key.split('\x00')
  const tag = sev === 'error' ? C.red('ERROR') : C.yellow('WARN ')
  console.log(`${tag} ${C.bold(rule)} ×${fs_.length} ${C.dim(`[${engine}]`)}`)
  console.log(`      ${C.dim(fs_[0].message.slice(0, 160))}`)
  for (const f of fs_.slice(0, 8)) console.log(`      · ${f.id.padEnd(9)} ${C.dim(path.relative(process.cwd(), f.filePath))}`)
  if (fs_.length > 8) console.log(C.dim(`      … and ${fs_.length - 8} more`))
  console.log()
}
if (all.length === 0) console.log(C.green('✓ nothing to drain — the ladder holds\n'))

process.exit(errors > 0 ? 1 : 0)
