#!/usr/bin/env node
/**
 * pillars-lint — enforce the cross-pillar reference DAG (TRDD-LXLK7XGX, Phase 4).
 *
 *     PRRD  ←────  SPECS  ←────  TRDD        references point only UP
 *
 * It reads a fixed ALLOWLIST of dependency fields (`blocked-by`, `npt`, `eht`,
 * `parent-trdd`, `superseded-by`, `relevant-rules`) and nothing else — no bodies, and
 * no free-text frontmatter field. See `lib/pillar/dag.ts` for why that scope is
 * structural rather than positional (the 18 provenance mentions, and the 3 prose-valued
 * frontmatter fields the naive narrowing still flags).
 *
 * A SEPARATE TOOL rather than a `trdd-doctor` rule, and NOT for the reason the plan
 * gave. The plan's rationale was "the rule requires scanning SPECS/PRRD bodies, which
 * is outside the doctor's contract" — LXLK7XGX then proved the lint must NOT scan
 * bodies at all, so that rationale is void. It stays separate because the doctor's
 * contract is "every TRDD in every zone" and this must also read the SPEC and PRRD
 * corpora, which is still outside it.
 *
 *   yarn pillars:lint                     lint every pillar present
 *   yarn pillars:lint --design-dir <p>    point at another corpus
 *   yarn pillars:lint --json              machine-readable
 *
 * EXIT CODES — 0 clean · 1 findings · 2 THE CHECK COULD NOT RUN. Zero documents
 * scanned is "could not run", never "clean": a gate that cannot read its corpus must
 * not certify it.
 */
import path from 'path'
import process from 'process'

const { lintDag, DEPENDENCY_FIELDS } = await import('../lib/pillar/dag.ts')

const C = {
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  d: (s) => `\x1b[2m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  y: (s) => `\x1b[33m${s}\x1b[0m`,
  c: (s) => `\x1b[36m${s}\x1b[0m`,
}

process.on('uncaughtException', (err) => {
  console.error(`pillars-lint: could not run — ${err?.message ?? err}`)
  if (process.env.TRDD_DEBUG) console.error(err?.stack ?? '')
  process.exit(2)
})

const argv = process.argv.slice(2)
const takeFlagValue = (name) => {
  const i = argv.indexOf(name)
  if (i === -1) return null
  const v = argv[i + 1]
  if (!v || v.startsWith('--')) throw new Error(`${name} requires a path`)
  argv.splice(i, 2)
  return v
}
const designDir = path.resolve(takeFlagValue('--design-dir') ?? path.join(process.cwd(), 'design'))
const asJson = argv.includes('--json')

// Each pillar's root, and its own existence check. A pillar whose root is ABSENT is
// skipped rather than fatal — this repo has no `design/requirements/PRRD.md` yet, and
// refusing to run until it does would make the lint unusable in exactly the project
// that needs it. The skip is REPORTED, so an omission is never implied by silence.
const fs = await import('fs')
// The kind→root mapping lives on the PillarKind (`corpusSubdir`), not here. It used to
// be this literal, and the moment prrdgrep/specgrep needed the same answer that literal
// became one of two copies — where a CLI pointed at the wrong root does not fail, it
// reports a confident "0 records" about a corpus it never read.
const { PILLAR_KINDS, corpusRootFor, TRDD_KIND } = await import('../lib/pillar/kinds.ts')
const { danglingTrddRefs } = await import('../lib/pillar/index-open.ts')
const TRDD_NAME = TRDD_KIND.name
const candidateRoots = Object.fromEntries(
  Object.values(PILLAR_KINDS).map((k) => [k.name, corpusRootFor(designDir, k)]),
)
const roots = {}
const skipped = []
for (const [name, root] of Object.entries(candidateRoots)) {
  if (fs.existsSync(root)) roots[name] = root
  else skipped.push(`${name} (no ${path.relative(designDir, root) || '.'}/)`)
}

if (Object.keys(roots).length === 0) {
  console.error(
    `pillars-lint: no pillar corpus under ${designDir} — wrong working directory, or pass --design-dir`,
  )
  process.exit(2)
}

const report = lintDag(roots)

if (report.scanned === 0) {
  console.error(
    `pillars-lint: scanned 0 documents under ${designDir} — refusing to certify a corpus it never read`,
  )
  process.exit(2)
}

// Reference EXISTENCE — the half `dag.ts` delegates away and nothing used to run
// (TRDD-216FTVC9). `danglingTrddRefs` THROWS on any fault rather than returning [],
// and that throw is deliberately NOT caught here: the `uncaughtException` handler above
// maps it to exit 2 (could not run). Swallowing it would print "the reference DAG
// holds" over a check that never executed, which is the exact shape of defect this
// call site exists to remove.
//
// FAIL on findings, not advisory: measured 2026-08-22 the corpus is CLEAN (0 dangling
// across 252 edges / 140 targets / 501 cards), so there is no pre-existing backlog for
// a failing lint to redden against — it can only ever fire on NEW breakage. A lint that
// reddens on day one against a large legacy set is the one that gets routed around.
const dangling = roots[TRDD_NAME] ? danglingTrddRefs(designDir) : []

if (asJson) {
  console.log(JSON.stringify({ ...report, dangling, designDir, skipped }, null, 2))
  process.exit(report.findings.length > 0 || dangling.length > 0 ? 1 : 0)
}

const counts = Object.entries(report.perPillar)
  .filter(([, n]) => n > 0)
  .map(([k, n]) => `${n} ${k}`)
  .join(' · ')

for (const f of report.findings) {
  console.log(`${C.r('ERROR')}\t${f.rule}\t${path.relative(process.cwd(), f.filePath)}`)
  console.log(`      ${f.detail}`)
}

for (const d of dangling) {
  console.log(`${C.r('ERROR')}\tDANGLING-REF\t${path.relative(process.cwd(), d.path)}`)
  console.log(`      ${d.srcId} \`${d.field}\` cites ${d.dstId}, which resolves to no TRDD`)
}

if (report.findings.length === 0 && dangling.length === 0) {
  console.log(
    C.g(`✓ ${report.scanned} documents (${counts}) — the reference DAG holds, and every citation resolves`),
  )
  console.log(
    C.d(`  fields checked: ${DEPENDENCY_FIELDS.join(', ')}` + (skipped.length ? `\n  not scanned: ${skipped.join(', ')}` : '')),
  )
  process.exit(0)
}

const parts = []
if (report.findings.length) parts.push(C.r(`${report.findings.length} illegal edge(s)`))
if (dangling.length) parts.push(C.r(`${dangling.length} dangling reference(s)`))
console.log(C.b(`\n${report.scanned} scanned (${counts}) · ${parts.join(' · ')}\n`))
process.exit(1)
