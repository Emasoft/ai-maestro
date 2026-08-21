#!/usr/bin/env node
/**
 * fleet-asks — surface cross-repo GitHub issues (asks) that are waiting on the hub.
 *
 *   node --import tsx scripts/fleet-asks.mjs                    # table, exit 1 if any finding
 *   node --import tsx scripts/fleet-asks.mjs --repo Emasoft/ai-maestro
 *   node --import tsx scripts/fleet-asks.mjs --stale-days 14
 *   node --import tsx scripts/fleet-asks.mjs --json
 *
 * WHY: TRDD proposals have a CLI (aimaestro-trdd.sh approve|refuse). The cross-repo
 * ask queue — sibling plugin repos filing issues on the hub when they need a decision
 * — has no tooling at all, which is exactly why it silently accumulates (70 open,
 * 27 already delivered-but-unclosed, 35 last touched on one day 16 days ago).
 *
 * EXIT CODES — grep's trichotomy: 0 clean · 1 findings (stale asks exist) · 2 COULD
 * NOT RUN. Collapsing "could not run" into "found nothing" is how a broken instrument
 * reports success — an API failure or an empty repo list must never look like a clean
 * queue.
 */
import { execFileSync } from 'node:child_process'
import process from 'node:process'

const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const flagValue = (f) => {
  const i = args.indexOf(f)
  return i >= 0 ? args[i + 1] : undefined
}

if (has('--help') || has('-h')) {
  console.log(`fleet-asks — surface stale cross-repo GitHub issues waiting on this hub.

Usage:
  node --import tsx scripts/fleet-asks.mjs [options]

Options:
  --repo <owner/name>   scan only this repo (default: every repo under the
                         GitHub owner, derived live via \`gh repo list <owner>\`
                         — never a hardcoded roster, so it can't go stale)
  --stale-days N         issues quieter than N days are findings (default: 7)
  --json                 machine-readable output
  --help                 this text

Requires: gh (authenticated).
Exit codes: 0 clean, 1 findings, 2 could not run (bad auth, API failure, empty scan).`)
  process.exit(0)
}

const staleDays = Number(flagValue('--stale-days') ?? 7)
const asJson = has('--json')
const singleRepo = flagValue('--repo')

const fail = (msg) => {
  console.error(`fleet-asks: could not run — ${msg}`)
  process.exit(2)
}

const gh = (ghArgs) => {
  try {
    return execFileSync('gh', ghArgs, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  } catch (err) {
    fail(`gh ${ghArgs.join(' ')} — ${err.stderr?.toString().trim() || err.message}`)
  }
}

// GITHUB_OWNER is the ecosystem SSOT (lib/ecosystem-constants.ts) — every AI Maestro
// repo lives under it. The repo LIST itself is never hardcoded: derived live from the
// GitHub API so a new/renamed/archived repo can't silently fall out of the scan.
const OWNER = 'Emasoft'

let repos
if (singleRepo) {
  repos = [singleRepo]
} else {
  const out = gh(['repo', 'list', OWNER, '--limit', '200', '--json', 'nameWithOwner', '-q', '.[].nameWithOwner'])
  repos = out.split('\n').map((s) => s.trim()).filter(Boolean)
}

if (repos.length === 0) {
  fail('refusing to report a clean queue from an empty scan — repo list resolved to 0 repos')
}

const now = Date.now()
const daysSince = (iso) => (now - new Date(iso).getTime()) / 86_400_000

const rows = []
for (const repo of repos) {
  const out = gh([
    'issue', 'list', '--repo', repo, '--state', 'open',
    '--json', 'number,title,createdAt,updatedAt,author,comments',
    '--limit', '200',
  ])
  const issues = JSON.parse(out)
  for (const issue of issues) {
    const lastComment = issue.comments?.length ? issue.comments[issue.comments.length - 1] : null
    // Cheapest available proxy for "who is waiting": did the asker (issue author) speak
    // last, or did someone at the hub reply and then it went quiet? No comments at all
    // means the ask has never been acknowledged.
    const lastSpeaker = lastComment ? lastComment.author?.login : issue.author?.login
    const askerSpokeLast = lastSpeaker === issue.author?.login
    const lastActivityIso = lastComment ? lastComment.createdAt : issue.updatedAt
    rows.push({
      repo,
      number: issue.number,
      title: issue.title,
      ageDays: Math.floor(daysSince(issue.createdAt)),
      quietDays: Math.floor(daysSince(lastActivityIso)),
      askerSpokeLast,
      lastSpeaker: lastSpeaker ?? '(unknown)',
    })
  }
}

if (rows.length === 0) {
  fail('refusing to report a clean queue from an empty scan — every repo returned 0 open issues')
}

rows.sort((a, b) => b.quietDays - a.quietDays)
const findings = rows.filter((r) => r.quietDays >= staleDays)

if (asJson) {
  console.log(JSON.stringify({ staleDays, totalOpen: rows.length, findings: findings.length, rows }, null, 2))
} else {
  console.log(`${'REPO'.padEnd(28)} ${'#'.padEnd(6)} ${'AGE'.padEnd(5)} ${'QUIET'.padEnd(6)} WAITING ON   TITLE`)
  for (const r of rows) {
    const waitingOn = r.askerSpokeLast ? 'hub'.padEnd(12) : 'asker'.padEnd(12)
    console.log(
      `${r.repo.padEnd(28)} ${String(r.number).padEnd(6)} ${String(r.ageDays).padEnd(5)} ${String(r.quietDays).padEnd(6)} ${waitingOn} ${r.title}`,
    )
  }
  console.log(
    `\n${rows.length} open across ${repos.length} repo(s); ${findings.length} quieter than ${staleDays}d.`,
  )
}

process.exit(findings.length > 0 ? 1 : 0)
