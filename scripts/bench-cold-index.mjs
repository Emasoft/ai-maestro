/**
 * bench-cold-index.mjs — measure a COLD pillar-index build.
 *
 * WHY THIS EXISTS. TRDD-7CHUK1AZ measured the cold build at 10^5 and found it did not
 * merely run slowly — it was KILLED at 1h32m with the WAL write rate still decaying, so
 * it had no bounded finish. Removing the readerless FTS write is supposed to have taken
 * the wall down with it, and a claim like that is worth exactly nothing until it is a
 * NUMBER. This produces the number, and it is reusable so the next change to the build
 * can be held to the same bar rather than re-deriving a harness.
 *
 * It reports peak RSS as well as wall time on purpose: at 10^5 the original failure was
 * a MEMORY wall (2.36 GB against a 1.2 GB corpus, retained by `pending`) that presented
 * as a time wall. Reporting only the wall time would hide half of what is being fixed.
 *
 *   node --import tsx scripts/bench-cold-index.mjs <corpusDir> [dbPath]
 *
 * Writes a FRESH db (deleting any prior one at that path, plus its -wal/-shm) so the
 * build really is cold — reusing a warm index would measure an incremental sync and
 * silently report a great number for the wrong operation.
 */
import fs from 'fs'
import path from 'path'

// DYNAMIC import with the EXPLICIT `.ts` extension — the pattern every other .mjs in
// scripts/ uses (see greptrdd.mjs). A static extensionless `from '../lib/pillar/kinds'`
// fails under `node --import tsx` with "does not provide an export named TRDD_KIND",
// which reads like a missing export and is really a resolution failure.
const { openIndex, validate } = await import('../lib/pillar/index-db.ts')
const { syncIndex } = await import('../lib/pillar/index-build.ts')
const { TRDD_KIND } = await import('../lib/pillar/kinds.ts')

const [, , corpusArg, dbArg] = process.argv
if (!corpusArg) {
  console.error('usage: bench-cold-index.mjs <corpusDir> [dbPath]')
  process.exit(2)
}
const corpus = path.resolve(corpusArg)
if (!fs.existsSync(corpus)) {
  console.error(`bench-cold-index: corpus not found: ${corpus}`)
  process.exit(2)
}
const dbPath = path.resolve(dbArg ?? path.join(corpus, '..', 'bench-index.db'))

// A cold build means NO prior index. The -wal/-shm siblings must go too: leaving them
// behind would let SQLite recover state from a previous run.
for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
  try { fs.rmSync(f) } catch { /* absent is the normal case */ }
}

const files = fs.existsSync(corpus)
  ? fs.readdirSync(corpus, { recursive: true }).filter((f) => String(f).endsWith('.md')).length
  : 0
console.log(`corpus : ${corpus}`)
console.log(`cards  : ${files}`)
console.log(`db     : ${dbPath}`)

const t0 = Date.now()
const db = openIndex(dbPath)
const openMs = Date.now() - t0

const t1 = Date.now()
const stats = syncIndex(db, corpus, TRDD_KIND)
const syncMs = Date.now() - t1

const t2 = Date.now()
const v = validate(db)
const validateMs = Date.now() - t2

db.close()

const dbBytes = (() => { try { return fs.statSync(dbPath).size } catch { return 0 } })()
const mb = (n) => (n / 1024 / 1024).toFixed(1)
const s = (ms) => (ms / 1000).toFixed(2)

console.log('')
console.log(`open      : ${s(openMs)} s`)
console.log(`sync      : ${s(syncMs)} s   <- the cold build`)
console.log(`validate  : ${s(validateMs)} s`)
console.log(`TOTAL     : ${s(openMs + syncMs + validateMs)} s`)
console.log('')
console.log(`records   : ${stats.records}`)
console.log(`edges     : ${stats.edges}`)
console.log(`db size   : ${mb(dbBytes)} MB`)
console.log(`peak RSS  : ${mb(process.memoryUsage().rss)} MB (in-process; /usr/bin/time -l is authoritative)`)
console.log(`validate  : ${v.ok ? 'ok' : 'FAULTS ' + JSON.stringify(v.faults)}`)

// A build that indexed nothing would print a wonderful wall time. Fail loudly instead —
// a benchmark that cannot fail is as useless as a gate that cannot fail.
if (stats.records === 0) {
  console.error('bench-cold-index: indexed ZERO records — the number above measures nothing')
  process.exit(1)
}
if (!v.ok) process.exit(1)
