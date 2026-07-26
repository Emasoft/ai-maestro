/**
 * GOVERNANCE ENFORCEMENT COVERAGE — the ratchet.
 *
 * WHY THIS EXISTS
 * ---------------
 * A missing authorization guard does not produce an error. It produces a SUCCESS that should
 * never have happened. That single asymmetry is why this project's governance could be
 * comprehensively unenforced while every test, every scenario, and every day of real use looked
 * fine — and why 33 of 42 rules sat unaudited for months without anything going red.
 *
 * A rule document that nothing checks is a wish. This test turns `docs/GOVERNANCE-RULES.md` into
 * a FIXTURE: every sub-rule must declare, in `docs/GOVERNANCE-ENFORCEMENT-MAP.md`, what enforces
 * it and what proves it. The properties it buys, none of which existed before:
 *
 *   1. A NEW rule cannot be added without declaring its enforcement status. Write R43.1 and this
 *      test fails until someone says whether code enforces it and which test refuses the
 *      violation. Governance-by-prose stops being free.
 *   2. A guard citation cannot silently rot. Every ENFORCED row names `file:line`; if the file is
 *      deleted or shrinks past that line, this fails. (It cannot prove the line still CONTAINS the
 *      guard — only a human read can — but it catches the file being moved or gutted, which is how
 *      citations usually die.)
 *   3. Holes can only shrink. `UNAUDITED_RULES` and the known-hole counts are pinned. Closing a
 *      hole is a diff that lowers a number; introducing one turns the suite red. Drift becomes
 *      loud instead of invisible.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It does not prove a rule is CORRECTLY enforced — only that something claims to enforce it and
 * something claims to test it. The claim is verified by the adversarial suites (a test that
 * attempts the forbidden act and asserts the refusal); this file only guarantees such a claim
 * EXISTS for every rule. Coverage is not correctness. But zero coverage is guaranteed incorrectness,
 * and that is the state this test ends.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '../..')
const RULES_DOC = resolve(ROOT, 'docs/GOVERNANCE-RULES.md')
const MAP_DOC = resolve(ROOT, 'docs/GOVERNANCE-ENFORCEMENT-MAP.md')

/**
 * Top-level rules whose sub-rules have NOT yet been through an adversarial enforcement audit.
 *
 * THIS SET MAY ONLY SHRINK. It is the honest ledger of what we have not looked at. Removing a
 * number is a promise: every sub-rule of that rule now has a row in the enforcement map.
 */
const UNAUDITED_RULES = new Set<number>([
  // Empty: the 2026-07-14 adversarial audit covered all 42 rules (289 sub-rules).
  // A number here is a promise we have NOT looked; the audit removed the last of them.
])

/**
 * How many ENFORCED rules currently name a real guard but NO adversarial test.
 *
 * This is the honest first-pass reality: the audit cited guards far more often than it cited
 * a test that watches each guard refuse the violation. Requiring a test on EVERY enforced row
 * on day one would force ~100 genuinely-enforced rules to be mislabelled UNENFORCED — trading
 * one dishonesty (a guard nobody tests) for a worse one (claiming a real guard does not exist).
 *
 * So instead this is a RATCHET COUNTER: it MAY ONLY SHRINK. Add an adversarial test for an
 * enforced rule → lower this number. Add a NEW enforced-but-untested rule → the suite goes red
 * until you either write the test or lower nothing (you cannot). The pressure to prove every
 * guard is real and permanent, but it is applied as a monotone decrease, not a false cliff.
 *
 * Set from the 2026-07-14 audit: of 141 ENFORCED rules, 136 cited a real guard but no adversarial
 * test. The headless-parity fixes (commit 1f1a53f1) then added tests proving the team-update
 * manage-team gate (R3.6) and the strict-body / field-strip guard (R8.2) in the delegated headless
 * path, paying the debt down to 134 (7 ENFORCED rules now carry a refusal test). It may ONLY fall —
 * write a refusal test for an enforced rule, drop this number; the test prints the live count so
 * you always know the new floor.
 */
// 2026-07-26: batch 1 of TRDD-H4Y9F25J pinned 17 more (R11.2/3/4/5/11 + R17.1/2/5/6/8/9/13/15/19/
// 21/22/23) in tests/governance/r17-r11-core-plugin-binding.test.ts — 134 → 117. R17.17 and R17.20
// were NOT pinned and are deliberately still counted: both guards are real, but they sit inline in
// server.mjs's `startServer`, which binds sockets on import, so there is no seam to call. Counting
// them as debt is the honest record — extracting the seam is the work that clears them
// (TRDD-L42SKUBW).
//
// 2026-07-26: batch 2 pinned 16 more (R3.2/3/4/5/7/9/12 + R9.1/2/4/5/6/7/8/11/12) in
// tests/governance/r3-r9-team-governance.test.ts — 117 → 101. R9.9 is the batch's one non-pin, and
// it is the SAME defect as R17.17/R17.20: the guard is real (server.mjs:1750-1764) but lives inside
// the `server.listen` callback of the un-exported startServer() IIFE. Three rules now blocked on one
// missing seam is no longer a coincidence — it is a structural property of server.mjs, and
// TRDD-L42SKUBW is where it gets fixed.
//
// One nuance worth keeping, because it will recur: R9.12's "guard" is an ABSENCE (`listAgents`
// filters on `!a.deletedAt` and nothing else), so "delete the guard → the test fails" has nothing to
// delete. It is pinned in the inverse direction — ADD the forbidden governance filter and the test
// fails — and was proven that way. An absence-invariant is still pinnable; it just needs the proof
// run backwards, and saying so beats quietly counting it as though it were an ordinary guard.
const MAX_ENFORCED_WITHOUT_TEST = 101

/** Verdicts a map row may carry. */
const VERDICTS = [
  'ENFORCED', // a guard refuses the violation; file:line cited, adversarial test named
  'UNENFORCED', // the rule says X and nothing refuses not-X — a hole
  'INVENTED', // the code enforces a policy the rule never states — needs a ruling
  'CONTRADICTED', // the code does the opposite of the rule, or two rules conflict
  'RULING-NEEDED', // the rule is silent where the code must choose; a human must decide
  'BEHAVIOURAL', // binds an agent's conduct, not the server; no code surface can enforce it
] as const
type Verdict = (typeof VERDICTS)[number]

interface MapRow {
  subRule: string
  verdict: Verdict
  guard: string
  test: string
}

/** Sub-rule ids declared in the governance document, e.g. "R10.3", "R29.1a". */
function parseSubRules(): string[] {
  const doc = readFileSync(RULES_DOC, 'utf8')
  const ids = new Set<string>()
  for (const line of doc.split('\n')) {
    // Rule tables are `| R10.1 | <text> | <source> |`
    const m = /^\|\s*(R\d+\.\d+[a-z]?)\s*\|/.exec(line)
    if (m) ids.add(m[1])
  }
  return [...ids]
}

/** Rows of the enforcement map: `| R10.1 | ENFORCED | file.ts:526 | tests/foo.test.ts |`. */
function parseMap(): MapRow[] {
  if (!existsSync(MAP_DOC)) return []
  const doc = readFileSync(MAP_DOC, 'utf8')
  const rows: MapRow[] = []
  for (const line of doc.split('\n')) {
    const m = /^\|\s*(R\d+\.\d+[a-z]?)\s*\|\s*([A-Z-]+)\s*\|([^|]*)\|([^|]*)\|/.exec(line)
    if (!m) continue
    rows.push({
      subRule: m[1],
      verdict: m[2].trim() as Verdict,
      guard: m[3].trim().replace(/`/g, ''),
      test: m[4].trim().replace(/`/g, ''),
    })
  }
  return rows
}

const ruleNumberOf = (subRule: string): number => Number(/^R(\d+)\./.exec(subRule)![1])

describe('governance enforcement coverage — the ratchet', () => {
  const subRules = parseSubRules()
  const rows = parseMap()
  const mapped = new Map(rows.map(r => [r.subRule, r]))

  it('the governance document is parseable and non-trivial (guards the parser itself)', () => {
    // If a formatting change silently breaks the regex, every assertion below would pass
    // vacuously — a test that cannot fail. Pin the floor.
    expect(subRules.length).toBeGreaterThan(250)
  })

  it('every AUDITED sub-rule has an enforcement-map row', () => {
    const missing = subRules
      .filter(id => !UNAUDITED_RULES.has(ruleNumberOf(id)))
      .filter(id => !mapped.has(id))
    expect(
      missing,
      `These sub-rules are declared in GOVERNANCE-RULES.md but nothing says what enforces them.\n` +
        `Either add a row to docs/GOVERNANCE-ENFORCEMENT-MAP.md, or add the rule number to\n` +
        `UNAUDITED_RULES and be honest that we have not looked:\n  ${missing.join(', ')}`,
    ).toEqual([])
  })

  it('the enforcement map has no stale rows (every row names a rule that still exists)', () => {
    const known = new Set(subRules)
    const stale = rows.map(r => r.subRule).filter(id => !known.has(id))
    expect(
      stale,
      `The map cites sub-rules that no longer exist in GOVERNANCE-RULES.md — a renumbering or a\n` +
        `deletion left the map behind: ${stale.join(', ')}`,
    ).toEqual([])
  })

  it('every row carries a known verdict', () => {
    const bad = rows.filter(r => !VERDICTS.includes(r.verdict))
    expect(bad.map(r => `${r.subRule}=${r.verdict}`)).toEqual([])
  })

  it('every ENFORCED row cites a guard file that exists (and, if a line is given, one that exists)', () => {
    // A guard may be cited as `file.ts:NNN` (finest — catches a line-shift) or as a bare
    // `file.ts` (a whole-module guard, where pinning one line would be invented precision).
    // Both are real; both must at least point at a file that EXISTS. That is what catches the
    // failure mode this assertion is for: an ENFORCED rule whose guard was deleted or moved,
    // silently turning the rule unenforced with nothing else to tell you.
    const broken: string[] = []
    for (const r of rows.filter(r => r.verdict === 'ENFORCED')) {
      // A guard may be a bare `file`, a `file:line`, or a `file:start-end` range (the common
      // citation form). Take the first token before any comma (some rows cite two guards) and
      // split off an optional `:line` / `:start-end` suffix; validate the START line exists.
      const first = r.guard.split(',')[0].trim()
      const m = /^([^\s:]+?)(?::(\d+)(?:-\d+)?)?$/.exec(first)
      if (!m || !m[1] || !/[./]/.test(m[1])) {
        broken.push(`${r.subRule}: guard is not a file path ("${r.guard}")`)
        continue
      }
      const [, file, startStr] = m
      const abs = resolve(ROOT, file)
      if (!existsSync(abs)) {
        broken.push(`${r.subRule}: guard file is GONE — ${file}`)
        continue
      }
      if (startStr) {
        const lines = readFileSync(abs, 'utf8').split('\n').length
        if (Number(startStr) > lines) {
          broken.push(`${r.subRule}: ${file} has ${lines} lines, guard cited at :${startStr} (moved?)`)
        }
      }
    }
    expect(
      broken,
      `An ENFORCED rule cites a guard that has moved or vanished. The rule is now unenforced and\n` +
        `nothing else would have told you:\n  ${broken.join('\n  ')}`,
    ).toEqual([])
  })

  it('every ENFORCED row names an adversarial test that exists', () => {
    const broken = rows
      .filter(r => r.verdict === 'ENFORCED')
      .filter(r => r.test && r.test !== '—')
      .filter(r => !existsSync(resolve(ROOT, r.test.split(':')[0])))
      .map(r => `${r.subRule} → ${r.test}`)
    expect(
      broken,
      `An ENFORCED rule names a proof that does not exist:\n  ${broken.join('\n  ')}`,
    ).toEqual([])
  })

  it('ENFORCED-without-a-test is a shrinking ratchet — it may never grow', () => {
    // The lesson of this codebase, applied as a monotone decrease rather than a false cliff.
    // A guard nobody tests is a guard nobody has watched refuse anything — but downgrading every
    // such row to UNENFORCED on day one would claim real guards do not exist. So we COUNT them
    // and forbid the count from rising: every new enforced rule must arrive with its test, and
    // the backlog can only be paid down.
    const unproven = rows
      .filter(r => r.verdict === 'ENFORCED')
      .filter(r => !r.test || r.test === '—')
      .map(r => r.subRule)
    expect(
      unproven.length,
      `${unproven.length} ENFORCED rules name a guard but no adversarial test. This may only\n` +
        `SHRINK. If it grew, an enforced rule was added without a test — write one. If it shrank,\n` +
        `lower MAX_ENFORCED_WITHOUT_TEST to ${unproven.length} to lock the gain in.\n` +
        `Untested-but-enforced rules:\n  ${unproven.join(', ')}`,
    ).toBeLessThanOrEqual(MAX_ENFORCED_WITHOUT_TEST)
  })
})
