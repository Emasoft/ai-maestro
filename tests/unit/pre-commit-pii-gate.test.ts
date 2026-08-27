/**
 * TRDD-N83OXS8G — run `.claude/scripts/test-pre-commit-pii-gate.sh` as part of the suite.
 *
 * The hook this covers exists because the PII gate had no surface that fires before a commit: its
 * only two were a manual `yarn test` and a CI job triggered on main + PRs only, and the branch the
 * leak landed on had zero CI runs and zero PRs. Wiring the harness here rather than leaving it as
 * a script a human remembers to run is the same lesson one level up — an unrun check and a passing
 * one are indistinguishable, which is precisely what let the address through.
 *
 * This file is the wiring, not a second implementation: the harness owns the cases (it is what a
 * human runs while editing the hook) and the suite owns making them run.
 *
 * MIN_CASES is the non-vacuity floor. The harness's own exit condition is `FAIL -eq 0`, which a
 * harness that ran ZERO cases satisfies trivially — a `set -u` abort, a moved HOOK path, a mktemp
 * that failed. Asserting a minimum PASS count is what makes "exit 0" mean "it really drove the
 * hook". A FLOOR, not an equality: adding a case must not redden this file, losing a block must.
 */
import { spawnSync } from 'child_process'
import path from 'path'

import { describe, expect, it } from 'vitest'

const REPO = path.resolve(__dirname, '..', '..')
const HARNESS = path.join(REPO, '.claude', 'scripts', 'test-pre-commit-pii-gate.sh')

/** The count reported when this wiring landed. */
const MIN_CASES = 9

describe('pre-commit PII gate hook', { timeout: 60_000 }, () => {
  const run = spawnSync('bash', [HARNESS], { cwd: REPO, encoding: 'utf-8' })
  const out = `${run.stdout ?? ''}${run.stderr ?? ''}`

  it('every case passes', () => {
    expect(out).toContain('FAIL: 0')
    expect(run.status).toBe(0)
  })

  it('actually drove the hook (guards against a vacuous exit 0)', () => {
    const m = out.match(/PASS: (\d+) FAIL: (\d+)/)
    expect(m, `harness printed no summary line — it did not reach the end:\n${out.slice(-800)}`).not.toBeNull()
    expect(Number(m![1])).toBeGreaterThanOrEqual(MIN_CASES)
  })
})
