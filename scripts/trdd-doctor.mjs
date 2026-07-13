#!/usr/bin/env node
/**
 * trdd-doctor — lint (and safely repair) the TRDD corpus.
 *
 *   node --import tsx scripts/trdd-doctor.mjs                # lint, exit 1 on any error
 *   node --import tsx scripts/trdd-doctor.mjs --fix --dry-run
 *   node --import tsx scripts/trdd-doctor.mjs --fix          # write the mechanical repairs
 *   node --import tsx scripts/trdd-doctor.mjs --board        # render the kanban
 *
 * The board render exists because "show me the board" was, until now, a bespoke shell
 * pipeline every time — and one of those pipelines silently dropped every card whose
 * `column:` was missing, which is exactly how ten TRDDs stayed hidden for three months.
 * A card the doctor cannot place is printed under (NO COLUMN), loudly, not omitted.
 */
import path from 'path'
import process from 'process'

const { lintCorpus, fixCorpus } = await import('../lib/trdd-doctor.ts')
const { TRDD_ZONES, listTrddFiles, parseTrddFile } = await import('../lib/trdd-store.ts')

const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const designDir = path.join(process.cwd(), 'design')

const C = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
}

if (has('--board')) {
  const byColumn = new Map()
  let total = 0
  for (const zone of TRDD_ZONES) {
    if (zone !== 'tasks' && !has('--all')) continue
    for (const file of listTrddFiles(designDir, zone)) {
      const t = parseTrddFile(file, zone)
      if (!t) continue
      total++
      const col = String(t.column ?? '').trim() || '(NO COLUMN — INVISIBLE)'
      if (!byColumn.has(col)) byColumn.set(col, [])
      byColumn.get(col).push(t)
    }
  }
  console.log(C.bold(`\n${total} cards${has('--all') ? ' (all zones)' : ' (design/tasks — OPEN work)'}\n`))
  for (const [col, cards] of [...byColumn].sort((a, b) => b[1].length - a[1].length)) {
    const head = col.startsWith('(NO COLUMN') ? C.red(col) : C.bold(col.toUpperCase())
    console.log(`═══ ${head} (${cards.length})`)
    for (const t of cards.sort((a, b) => String(a.frontmatter?.priority ?? 9).localeCompare(String(b.frontmatter?.priority ?? 9)))) {
      const p = t.frontmatter?.priority
      console.log(`  ${t.id.padEnd(9)} ${C.dim(`P${p ?? '?'}`)}  ${String(t.title).slice(0, 74)}`)
    }
    console.log()
  }
  process.exit(0)
}

if (has('--fix')) {
  const dryRun = has('--dry-run')
  const results = fixCorpus(designDir, { dryRun })
  if (results.length === 0) {
    console.log(C.green('nothing to repair — every TRDD already carries a valid frontmatter'))
    process.exit(0)
  }
  console.log(C.bold(`\n${dryRun ? 'WOULD REPAIR' : 'REPAIRED'} ${results.length} file(s):\n`))
  for (const r of results) {
    console.log(`  ${C.bold(r.id)}  ${C.dim(path.relative(process.cwd(), r.filePath))}`)
    for (const c of r.changes) console.log(`      • ${c}`)
  }
  if (dryRun) console.log(C.dim('\n(dry run — nothing written)'))
  else console.log(C.yellow('\nReview the diff, then COMMIT THE CONTENT BEFORE any `git mv`.'))
  console.log()
  process.exit(0)
}

const report = lintCorpus(designDir)
if (report.findings.length === 0) {
  console.log(C.green(`✓ ${report.scanned} TRDDs — corpus is clean`))
  process.exit(0)
}

const byRule = new Map()
for (const f of report.findings) {
  if (!byRule.has(f.rule)) byRule.set(f.rule, [])
  byRule.get(f.rule).push(f)
}

console.log(C.bold(`\nTRDD doctor — ${report.scanned} scanned · ${C.red(`${report.errors} error`)} · ${C.yellow(`${report.warnings} warn`)}\n`))
for (const [rule, fs_] of [...byRule].sort((a, b) => b[1].length - a[1].length)) {
  const sev = fs_[0].severity
  const tag = sev === 'error' ? C.red('ERROR') : C.yellow('WARN ')
  const fixable = fs_[0].autofixable ? C.green(' [--fix]') : ''
  console.log(`${tag} ${C.bold(rule)} ×${fs_.length}${fixable}`)
  console.log(`      ${C.dim(fs_[0].message.slice(0, 150))}`)
  for (const f of fs_.slice(0, 8)) console.log(`      · ${f.id.padEnd(9)} ${C.dim(path.relative(process.cwd(), f.filePath))}`)
  if (fs_.length > 8) console.log(C.dim(`      … and ${fs_.length - 8} more`))
  console.log()
}

process.exit(report.errors > 0 ? 1 : 0)
