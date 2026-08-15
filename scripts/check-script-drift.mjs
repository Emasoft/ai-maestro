/**
 * `yarn scripts:drift` — is the code agents actually RUN the code we committed? (TRDD-GADPGOIR)
 *
 * Agents execute `amp-*` / `aimaestro-*` from `~/.local/bin`; `scripts/` is only the source.
 * This compares them byte-for-byte and reports. It NEVER installs: remediation changes identity
 * resolution underneath live agents, and a PARTIAL refresh silently drops every affected agent's
 * uuid (see lib/installed-script-drift.ts for the incident and the hazard).
 *
 * Exit: 0 clean · 1 findings · 2 could-not-run.
 */
import { readdirSync, readFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import path from 'path'
// DYNAMIC import, matching pillars-lint.mjs / trdd-doctor.mjs: a static named import of a `.ts`
// module does not resolve under the tsx loader ("does not provide an export named …").
const { compareInstalledScripts, driftExitCode, formatDriftReport } = await import(
  '../lib/installed-script-drift.ts'
)

const repoRoot = path.resolve(import.meta.dirname, '..')
const sourceDir = path.join(repoRoot, 'scripts')
const installDir = process.env.AIM_INSTALL_BIN || path.join(homedir(), '.local', 'bin')

let names = []
try {
  names = readdirSync(sourceDir).filter((f) => /^(amp|aimaestro)-.*\.sh$/.test(f)).sort()
} catch (err) {
  console.error(`script-drift: COULD NOT RUN — cannot read ${sourceDir}: ${err.message}`)
  process.exit(2)
}

const report = compareInstalledScripts({
  names,
  readSource: (n) => readFileSync(path.join(sourceDir, n)),
  readInstalled: (n) => {
    const p = path.join(installDir, n)
    return existsSync(p) ? readFileSync(p) : null
  },
})

console.log(formatDriftReport(report))
process.exit(driftExitCode(report))
