import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// The falsified guard for design/specs/baseline-github-rulesets-spec.md (TRDD-683C7H8E).
//
// Two invariants, each with the failure it exists to red on:
//   1. TRIO membership — the spec defines all THREE ratified ruleset names. A membership
//      list short by one member silently narrows every guard built from it, and a test
//      asserting the stale pair DEFENDS the drift (measured on the INTEGRATOR repo,
//      2026-08-15: a tag-protect-only repo read as UNBASELINED and the destructive
//      fallback would have run — the guard failed OPEN).
//   2. `required_linear_history` may appear ONLY inside its dated REMOVED-by-USER
//      annotation, never in a live rule list. The rule was struck by USER Tier-3 ruling
//      (2026-08-08, janitor#14); stale prose re-listing it was the propagation vector
//      that made a compliant agent re-add it in good faith (ai-maestro#140).

const SPEC = path.resolve(__dirname, '../../design/specs/baseline-github-rulesets-spec.md')

const TRIO = ['baseline-history-protect', 'baseline-pr-and-checks', 'baseline-tag-protect']

/** Lines naming the struck rule are legal ONLY when the same line carries its removal
 *  context. Line-scoped on purpose: a section-scoped exemption would let a rule list five
 *  lines under a REMOVED heading pass. */
function illegalLinearHistoryLines(text: string): string[] {
  return text
    .split('\n')
    .filter((l) => l.includes('required_linear_history'))
    .filter((l) => !/REMOVED|never re-add|names that rule|guard test pins/.test(l))
}

describe('baseline spec ratchet (TRDD-683C7H8E)', () => {
  const text = fs.readFileSync(SPEC, 'utf8')

  it('positive control: a live rule list naming the struck rule IS flagged', () => {
    // Without this, a broken filter and a clean spec are indistinguishable.
    expect(illegalLinearHistoryLines('- rules: deletion, non_fast_forward, required_linear_history'))
      .toHaveLength(1)
    expect(illegalLinearHistoryLines('`required_linear_history` is REMOVED — never re-add it'))
      .toHaveLength(0)
  })

  it('the spec exists and defines the TRIO — three names, never a pair', () => {
    for (const name of TRIO) {
      expect(text, `spec must define ${name} — a two-name membership is the fail-OPEN drift`)
        .toContain(name)
    }
  })

  it('required_linear_history appears only inside its dated REMOVED annotation', () => {
    expect(illegalLinearHistoryLines(text)).toEqual([])
    // Non-vacuity: the annotation itself must exist — a spec that never mentions the
    // struck rule cannot teach the next reader not to re-add it.
    expect(text).toMatch(/required_linear_history.*REMOVED|REMOVED.*required_linear_history/)
  })

  it('the spec cites the executable SSOT and never claims to be it', () => {
    expect(text).toContain('baseline_ruleset_payloads')
    expect(text).toMatch(/code beats this prose|NEVER from this document/i)
  })
})
