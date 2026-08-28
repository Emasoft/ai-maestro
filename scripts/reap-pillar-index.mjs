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
import { readdirSync, statSync, unlinkSync, existsSync, copyFileSync, mkdtempSync, rmSync } from 'fs'
import { homedir, tmpdir } from 'os'
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

// Every index is read from a COPY in a scratch dir, never in place. `readonly: true` is NOT
// enough: these indexes are in WAL mode (`applyPragmas`), and SQLite creates `-shm`/`-wal`
// sidecars on ANY open of a WAL db, read-only included. Measured 2026-08-28: one report-only
// run minted 147 `-shm` + 147 `-wal` beside the 147 indexes — the observer TRIPLED the inode
// count of the directory it exists to bound, and the "N files before and after" check was
// blind to it because it counted `*.sqlite` only. The card's own §2 said "read from a copy";
// the first cut did not. The scratch dir is removed at the end of the sweep.
const scratch = mkdtempSync(path.join(tmpdir(), 'pillar-index-reap-'))

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
    const copy = path.join(scratch, f)
    copyFileSync(file, copy)
    // fileMustExist: `new Database(p)` CREATES an empty db otherwise; belt-and-braces on the copy.
    const db = new Database(copy, { readonly: true, fileMustExist: true })
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
rmSync(scratch, { recursive: true, force: true })

const report = classifyIndexes(rows, existsSync)
console.log(formatReapReport(report))

if (doReap && report.orphans.length > 0) {
  let removed = 0
  for (const r of report.orphans) {
    try {
      unlinkSync(r.file)
      // The sidecars ride with their index; leaving them behind orphans the orphan's orphan.
      // `-shm`/`-wal` exist wherever an earlier (in-place) open touched a WAL-mode index.
      for (const s of ['.heal.json', '-shm', '-wal']) {
        if (existsSync(`${r.file}${s}`)) unlinkSync(`${r.file}${s}`)
      }
      removed++
    } catch (err) {
      console.error(`  FAILED to remove ${r.file}: ${err.message}`)
    }
  }
  console.log(`pillar-index-reap: removed ${removed} of ${report.orphans.length} orphan(s)`)
}

process.exit(reapExitCode(report))
