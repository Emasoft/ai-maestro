#!/usr/bin/env node
/**
 * Generate a synthetic TRDD corpus, so the 10^5 claims in TRDD-CTEQX0ZA are
 * MEASURED rather than argued.
 *
 * The USER's design input is that the pillar tools must survive 100000+
 * documents. Every number in this repo so far was taken against 298 files, where
 * a full lint runs in 0.57 s — a measurement of today, not a budget. This script
 * builds the corpus those budgets are stated against.
 *
 * FIDELITY MATTERS MORE THAN SPEED HERE. A fixture of 100000 identical stubs
 * would measure file-system throughput and nothing else, so each card carries:
 *   - a unique, collision-free 8-char base36 id in the real filename grammar
 *   - the real frontmatter field set, including the overlay fields the linter
 *     reads (assignee / created-by / min-approval-requirement / derived / …)
 *   - real dependency edges (blocked-by / npt / eht) into OTHER generated cards,
 *     so the graph has genuine structure to traverse instead of 100000 roots
 *   - a body sized to the live corpus average (~10 KB), because the linter holds
 *     `raw` per card and the whole question is whether that survives the scale
 *
 * Usage:
 *   node --import tsx scripts/gen-trdd-fixture.mjs <outDir> <count> [bodyKB]
 *
 * The output directory is disposable by construction: it contains nothing but
 * generated cards, and every path is under <outDir>. It is NEVER the repo's own
 * design/ — the script refuses that explicitly.
 */
import fs from 'fs'
import path from 'path'

const [, , outDirArg, countArg, bodyKbArg] = process.argv
if (!outDirArg || !countArg) {
  console.error('usage: gen-trdd-fixture.mjs <outDir> <count> [bodyKB=10]')
  process.exit(2)
}
const outDir = path.resolve(outDirArg)
const count = Number(countArg)
const bodyKb = Number(bodyKbArg ?? 10)

if (!Number.isInteger(count) || count < 1) {
  console.error(`gen-trdd-fixture: count must be a positive integer, got ${countArg}`)
  process.exit(2)
}
// A generator that can overwrite the real corpus is a generator that will.
const realDesign = path.resolve(process.cwd(), 'design')
if (outDir === realDesign || outDir.startsWith(realDesign + path.sep)) {
  console.error(`gen-trdd-fixture: refusing to write inside the real corpus at ${realDesign}`)
  process.exit(2)
}

const ZONES = ['proposals', 'tasks', 'archived', 'refused']
// Zone mix mirrors the live corpus proportions (36 / 104 / 140 / 18 of 298).
const ZONE_MIX = [
  ['proposals', 0.12, 'proposal'],
  ['tasks', 0.35, 'dev'],
  ['archived', 0.47, 'completed'],
  ['refused', 0.06, 'refused'],
]

/** Deterministic 8-char base36 id from an index — unique by construction, no RNG, no collision scan. */
function idFor(n) {
  const s = n.toString(36).toUpperCase()
  return ('Z' + s.padStart(7, '0')).slice(-8)
}

function zoneFor(i) {
  const r = (i % 100) / 100
  let acc = 0
  for (const [zone, share, column] of ZONE_MIX) {
    acc += share
    if (r < acc) return [zone, column]
  }
  return ['tasks', 'dev']
}

const filler = 'Prose that exists to occupy the body so the measurement is honest. '
const body = filler.repeat(Math.ceil((bodyKb * 1024) / filler.length)).slice(0, bodyKb * 1024)

for (const z of ZONES) fs.mkdirSync(path.join(outDir, z), { recursive: true })

let written = 0
for (let i = 0; i < count; i++) {
  const id = idFor(i)
  const [zone, column] = zoneFor(i)
  // Real edges: every 3rd card depends on an earlier one, so the graph is a DAG
  // with genuine depth rather than a flat pile.
  const dep = i >= 3 && i % 3 === 0 ? idFor(i - 3) : null
  const isBlocked = dep !== null && zone === 'tasks' && i % 9 === 0
  const fm = [
    '---',
    `trdd-id: ${id}`,
    `title: Generated fixture card number ${i}`,
    `column: ${isBlocked ? 'blocked' : column}`,
    ...(isBlocked ? [`pre-block-column: ${column}`] : []),
    'scope: project',
    'project-id: fixture',
    'created: 2026-01-01T00:00:00+0100',
    'updated: 2026-01-01T00:00:00+0100',
    'current-owner: fixture',
    'created-by: fixture',
    'assignee: fixture',
    'task-type: infra',
    'min-approval-requirement: none',
    'derived: false',
    'release-via: none',
    'relevant-rules: []',
    `blocked-by: [${isBlocked && dep ? dep : ''}]`,
    'npt: []',
    'eht: []',
    '---',
    '',
    `# Generated fixture card number ${i}`,
    '',
    body,
    '',
    '## Approval log',
    '',
    '- 2026-01-01T00:00:00+0100 — MANDATE issued by USER (min-approval-requirement: none).',
    '',
  ].join('\n')
  const file = path.join(outDir, zone, `TRDD-20260101_000000+0100-${id}-fixture-${i}.md`)
  fs.writeFileSync(file, fm)
  written++
  if (written % 10000 === 0) console.error(`  … ${written}/${count}`)
}

console.log(`${written} cards in ${outDir} (~${Math.round((written * bodyKb) / 1024)} MB of body)`)
