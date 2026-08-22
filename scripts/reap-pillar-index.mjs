/**
 * `yarn pillar:reap` — which host-global pillar indexes point at a corpus that no longer exists?
 * TRDD-IMCEYV9F.
 *
 * REPORT-ONLY unless `--reap` is passed. `~/.claude/rules/never_free_space.md` reserves
 * deleting-to-free-space to the owner, and the sibling detector `check-script-drift.mjs` sets
 * the house pattern: report, never remediate, remediation stays an explicit act.
 *
 * Exit: 0 clean · 1 findings · 2 could-not-run.
 */
import { readdirSync, statSync, unlinkSync, existsSync } from 'fs'
import { homedir } from 'os'
import path from 'path'
import Database from 'better-sqlite3'

const { classifyIndexes, reapExitCode, formatReapReport } = await import(
  '../lib/pillar/index-orphans.ts'
)

const dir = process.env.AIM_PILLAR_INDEX_DIR || path.join(homedir(), '.aimaestro', 'pillar-index')
const doReap = process.argv.includes('--reap')

let files = []
try {
  files = readdirSync(dir).filter((f) => f.endsWith('.sqlite')).sort()
} catch (err) {
  console.error(`pillar-index-reap: COULD NOT RUN — cannot read ${dir}: ${err.message}`)
  process.exit(2)
}

const rows = files.map((f) => {
  const file = path.join(dir, f)
  let bytes = 0
  try {
    bytes = statSync(file).size
  } catch {
    /* size is cosmetic; a missing size must not change the verdict */
  }
  let targets = []
  let readFailed = false
  try {
    // readonly: never take the WAL pragma write on a file we are only inspecting.
    // fileMustExist: `new Database(p)` CREATES an empty db otherwise, so a typo'd path would
    // have this observer LITTER the very directory it audits.
    const db = new Database(file, { readonly: true, fileMustExist: true })
    try {
      // A handful is enough: one surviving target keeps the index, and reading every row of a
      // 70 MB corpus to answer a yes/no would cost more than the whole sweep.
      targets = db.prepare('SELECT path FROM files LIMIT 25').all().map((r) => r.path)
    } finally {
      db.close()
    }
  } catch {
    // Flag the THROW explicitly. Leaving `targets` empty is not enough to say what happened:
    // an index that opens fine and holds zero rows is also empty, and reporting that as
    // "unreadable" was wrong about 26 of 102 files on this host. Both are kept; only the
    // stated reason differs, and a false reason sends the next reader at a non-existent bug.
    readFailed = true
  }
  return { file, targets, readFailed, bytes }
})

const report = classifyIndexes(rows, existsSync)
console.log(formatReapReport(report))

if (doReap && report.orphans.length > 0) {
  let removed = 0
  for (const r of report.orphans) {
    try {
      unlinkSync(r.file)
      // The heal sidecar rides with its index; leaving it behind orphans the orphan's orphan.
      if (existsSync(`${r.file}.heal.json`)) unlinkSync(`${r.file}.heal.json`)
      removed++
    } catch (err) {
      console.error(`  FAILED to remove ${r.file}: ${err.message}`)
    }
  }
  console.log(`pillar-index-reap: removed ${removed} of ${report.orphans.length} orphan(s)`)
}

process.exit(reapExitCode(report))
