#!/usr/bin/env node
/**
 * trdd-extrefs — re-check the GitHub issues that open TRDD cards cite, and surface the
 * cards whose cited issues have ALL closed.
 *
 *   node --import tsx scripts/trdd-extrefs.mjs           # table, exit 1 if any finding
 *   node --import tsx scripts/trdd-extrefs.mjs --json
 *   node --import tsx scripts/trdd-extrefs.mjs --all     # also list partially-closed cards
 *
 * WHY (TRDD-8GBIQMEP): `blocked-by:` takes TRDD ids only, so a card waiting on a GitHub
 * issue cannot say so there. The board's answer has been `external-refs:` — and NOTHING
 * EVER READ IT BACK. Measured by this tool on 2026-08-21: **45 open cards cite 70
 * resolvable issues across 14 repos, 48 of them already CLOSED, and 17 cards cite ONLY
 * closed issues** — two of those sitting in `column: blocked` for reasons that had
 * entirely evaporated (`JT3U4ZVM` alone cites 10 closed refs).
 *
 * Re-derive rather than trust that paragraph — it has a silent timestamp, and an earlier
 * draft of this very comment quoted 37/79/14 from a hand-rolled bash pass that never
 * scanned `design/proposals`. The command IS the tool: `yarn trdd:extrefs`.
 *
 * So the gap was never a missing FIELD (which would be a shared-schema change needing
 * janitor coordination and a MANAGER floor). It was a missing CONSUMER — repo-local
 * tooling, floor `none`. An external blocker was checked once, at authoring time, and
 * never again; a card therefore could not be NOTICED as unblocked. This is that check.
 *
 * EXIT CODES — grep's trichotomy: 0 clean · 1 findings · 2 COULD NOT RUN. Collapsing
 * "could not run" into "found nothing" is how a broken instrument reports success: an
 * unreachable API or an empty card walk must never render as a clean board.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const args = process.argv.slice(2)
const has = (f) => args.includes(f)

// Open zones only. A terminal card in archived/ citing a closed issue is not a finding —
// it is a correctly finished card, and flagging those is how a linter earns its mute.
const ZONES = ['design/tasks', 'design/proposals']

const die = (msg) => {
  console.error(`trdd-extrefs: COULD NOT RUN — ${msg}`)
  process.exit(2)
}

/** Frontmatter `external-refs:` line, or '' — deliberately not a YAML parse: the field is
 *  a one-line flow list by the grep-first convention, and a body line that merely mentions
 *  an issue is NOT a citation. Anchoring on the line start is what keeps mention out. */
function extRefsLine(text) {
  for (const line of text.split('\n')) {
    if (line.startsWith('---') && line.trim() === '---') continue
    if (line.startsWith('external-refs:')) return line
    if (line.startsWith('# ')) break // past the frontmatter
  }
  return ''
}

const QUALIFIED = /(?:gh:)?([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)/g
// A bare `janitor#167` cannot be resolved without a prefix→repo map, and GUESSING one
// would silently attribute an issue to the wrong repo. Counted and reported, never guessed.
const BARE = /(?:^|[^\w/:])([A-Za-z][A-Za-z0-9_-]*)#(\d+)/g
// A NAKED `#46` — no owner, no repo, not even a prefix — is the worst citation shape on the
// board and was INVISIBLE to this tool until 2026-08-21: `BARE` requires a leading word, so a
// naked number matched neither pattern and was silently uncounted. Found by running
// `scripts_dev/sweep-external-blockers.sh` (TRDD-8GBIQMEP's own acceptance check), which scored
// 5 unresolved where this tool reported none — a needle that cannot see a shape reports clean,
// which is the exact failure this tool exists to prevent, committed by the tool itself.
// It is counted and reported, never resolved: `#46` resolves in 4 of 6 known trackers, so any
// mapping is a guess that would attribute an issue to the wrong repo.
const NAKED = /(?:^|[^\w/#])#(\d+)/g

function parseRefs(line) {
  const qualified = new Set()
  for (const m of line.matchAll(QUALIFIED)) qualified.add(`${m[1]}#${m[2]}`)
  const withoutQualified = line.replace(QUALIFIED, ' ')
  const bare = new Set()
  for (const m of withoutQualified.matchAll(BARE)) bare.add(`${m[1]}#${m[2]}`)
  const naked = new Set()
  const withoutPrefixed = withoutQualified.replace(BARE, ' ')
  for (const m of withoutPrefixed.matchAll(NAKED)) naked.add(`#${m[1]}`)
  return { qualified: [...qualified], bare: [...bare], naked: [...naked] }
}

function field(text, name) {
  const m = text.match(new RegExp(`^${name}:\\s*(.*)$`, 'm'))
  return m ? m[1].trim() : ''
}

// ---- walk the open zones -------------------------------------------------------------
const cards = []
// THE BLIND SPOT, COUNTED. This detector reads the `external-refs:` FIELD, so a card that
// cites its issues only in body prose is invisible to it BY CONSTRUCTION — and a clean run
// would then read as "the board's citations are current" while saying nothing at all about
// those cards. That is not hypothetical: TRDD-903B7A20 carried no `external-refs:` line, its
// sole blocker (ai-maestro#132) sat in prose, and it stayed CLOSED for 8 days while still
// gating a descoped gate. Nothing here could have seen it. So count them and PRINT the
// number: a reported blind spot is a different thing from a silent one.
// Deliberately NOT scanned for findings — a prose ref is ambiguous (a bare "#35" matches
// ordinary text), and filing off it manufactures false positives. Counting is safe; the
// count is a floor on what this tool cannot answer, not a finding.
let fieldlessWithProseRefs = 0
let fieldlessNoRefs = 0
for (const zone of ZONES) {
  let names
  try {
    names = readdirSync(zone)
  } catch {
    continue // a zone may legitimately not exist in a fresh checkout
  }
  for (const n of names) {
    if (!n.endsWith('.md')) continue
    const text = readFileSync(join(zone, n), 'utf8')
    const line = extRefsLine(text)
    if (!line) {
      const body = parseRefs(text)
      if (body.qualified.length || body.bare.length || body.naked.length) fieldlessWithProseRefs++
      else fieldlessNoRefs++
      continue
    }
    const { qualified, bare, naked } = parseRefs(line)
    if (qualified.length === 0 && bare.length === 0 && naked.length === 0) continue
    cards.push({
      id: field(text, 'trdd-id') || n,
      column: field(text, 'column') || '?',
      title: (field(text, 'title') || '').slice(0, 58),
      qualified,
      bare,
      naked,
    })
  }
}

if (cards.length === 0) {
  die(`walked ${ZONES.join(', ')} and found no card with an external-refs: line — ` +
      `either the zones are missing or the parse is broken. Refusing to report "clean".`)
}

// ---- resolve issue states, one call per repo ------------------------------------------
const repos = [...new Set(cards.flatMap((c) => c.qualified).map((r) => r.split('#')[0]))]
const state = new Map()
let queryFailures = 0

for (const repo of repos) {
  try {
    const out = execFileSync(
      'gh',
      ['issue', 'list', '--repo', repo, '--state', 'all', '--limit', '300',
       '--json', 'number,state'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
    for (const it of JSON.parse(out)) state.set(`${repo}#${it.number}`, it.state)
  } catch {
    queryFailures++
  }
}

// A ref past the 300 window (or on a repo whose list call failed) is UNRESOLVED, never
// silently "closed". Fall back to a direct lookup so the unresolved set stays honest.
for (const ref of new Set(cards.flatMap((c) => c.qualified))) {
  if (state.has(ref)) continue
  const [repo, num] = ref.split('#')
  try {
    const out = execFileSync('gh', ['api', `repos/${repo}/issues/${num}`, '--jq', '.state'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    state.set(ref, out.trim().toUpperCase())
  } catch {
    /* stays unresolved — reported as such below */
  }
}

if (state.size === 0) {
  die(`resolved 0 of ${new Set(cards.flatMap((c) => c.qualified)).size} cited refs across ` +
      `${repos.length} repos (${queryFailures} repo queries failed). A zero here means the ` +
      `instrument is blind, not that the board is clean.`)
}

// ---- classify -------------------------------------------------------------------------
const findings = []
const partial = []
for (const c of cards) {
  const resolved = c.qualified.filter((r) => state.has(r))
  if (resolved.length === 0) continue
  const closed = resolved.filter((r) => state.get(r) === 'CLOSED')
  if (closed.length === resolved.length) findings.push({ ...c, resolved, closed })
  else if (closed.length > 0) partial.push({ ...c, resolved, closed })
}

const totalRefs = new Set(cards.flatMap((c) => c.qualified)).size
const unresolved = totalRefs - [...state.keys()].filter((k) =>
  cards.some((c) => c.qualified.includes(k))).length
const bareCount = new Set(cards.flatMap((c) => c.bare)).size
const nakedCount = new Set(cards.flatMap((c) => c.naked)).size

if (has('--json')) {
  console.log(JSON.stringify(
    { findings, partial, totalRefs, unresolved, bareCount, nakedCount,
      notScanned: { fieldlessWithProseRefs, fieldlessNoRefs } }, null, 2))
} else {
  console.log(`trdd-extrefs — ${cards.length} open cards cite ${totalRefs} distinct issues ` +
              `across ${repos.length} repos`)
  console.log(`  resolved=${totalRefs - unresolved}  unresolved=${unresolved}  ` +
              `repo-query-failures=${queryFailures}  prefixed-refs=${bareCount}  naked-refs=${nakedCount}`)
  if (nakedCount > 0) {
    console.log(`  NOTE: ${nakedCount} refs are NAKED (e.g. "#46") — no owner, no repo, no prefix. ` +
                `Unresolvable BY CONSTRUCTION: "#46" resolves in 4 of 6 known trackers, so any ` +
                `mapping is a guess. Reported so they cannot be mistaken for "none found".`)
  }
  if (bareCount > 0) {
    console.log(`  NOTE: ${bareCount} refs are bare (e.g. "janitor#167") and carry no owner/repo. ` +
                `They are NOT resolved and NOT guessed — a guessed mapping would attribute an ` +
                `issue to the wrong repo silently.`)
  }
  if (fieldlessWithProseRefs > 0) {
    console.log(`  NOT SCANNED: ${fieldlessWithProseRefs} open cards carry NO external-refs: ` +
                `line yet cite an issue in body prose (plus ${fieldlessNoRefs} with neither). ` +
                `This tool reads the FIELD, so those citations are invisible to it — a clean ` +
                `run above is clean of what it can see, NOT of the board. TRDD-903B7A20 was ` +
                `one of them: its only blocker sat in prose, closed 8 days, still gating.`)
  }
  console.log()
  if (findings.length === 0) {
    console.log('  no open card cites an all-closed set of issues.')
  } else {
    console.log(`  ALL CITED ISSUES CLOSED — these cards may be unblocked and nobody noticed:`)
    for (const f of findings.sort((a, b) => a.column.localeCompare(b.column))) {
      console.log(`    ${f.column.padEnd(14)} ${f.id.padEnd(10)} ${f.closed.length} closed  ${f.title}`)
    }
  }
  if (has('--all') && partial.length > 0) {
    console.log(`\n  partially closed (informational):`)
    for (const p of partial) {
      console.log(`    ${p.column.padEnd(14)} ${p.id.padEnd(10)} ${p.closed.length}/${p.resolved.length} closed`)
    }
  }
}

process.exit(findings.length > 0 ? 1 : 0)
