/**
 * TRDD-YR4G2CZH — run `.claude/scripts/test-subagent-write-guard.sh` as part of the suite.
 *
 * The harness has existed since 2026-04-14 and **nothing ran it**: measured 2026-08-04, its only
 * references anywhere in the repo were a README and an archived TRDD. So the guard enforcing an
 * IRON rule (`.claude/rules/prevent-subagents-to-write-outside.md`) was covered by a test that no
 * gate executed — which is indistinguishable from no coverage the moment the guard changes.
 *
 * This file is the wiring, not a second implementation: the harness owns the cases (it is the
 * artifact a human runs while editing the guard), and the suite owns making them run. Porting the
 * 28 cases into TS would create two case lists to keep in sync, and the shell one would lose.
 *
 * The floor assertion is the point of the "no vacuous pass" pair below. `[ $FAIL -eq 0 ]` is the
 * harness's own exit condition and it is trivially satisfied by a harness that ran zero cases —
 * a `set -u` abort before the first case, a moved GUARD path, a missing `jq`. Asserting a minimum
 * PASS count means "exit 0" can only mean "it really evaluated the guard".
 */
import { spawnSync } from 'child_process'
import path from 'path'

import { describe, expect, it } from 'vitest'

const REPO = path.resolve(__dirname, '..', '..')
const HARNESS = path.join(REPO, '.claude', 'scripts', 'test-subagent-write-guard.sh')

/**
 * The count the harness reported when this wiring landed. A FLOOR, not an equality: adding a case
 * is normal and must not redden this file, while losing a whole block silently must.
 */
const MIN_CASES = 24

function runHarness() {
  const r = spawnSync('bash', [HARNESS], { cwd: REPO, encoding: 'utf8', timeout: 120_000 })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  // Strip the harness's colour codes before parsing — its result line is ANSI-wrapped.
  const plain = out.replace(/\[[0-9;]*m/g, '')
  const summary = plain.match(/Results:\s*(\d+)\s*pass,\s*(\d+)\s*fail/)
  return {
    status: r.status,
    plain,
    passed: summary ? Number(summary[1]) : -1,
    failed: summary ? Number(summary[2]) : -1,
  }
}

describe('subagent write-guard — the project-scoped PreToolUse hook', () => {
  it('passes its own harness, and the harness actually ran its cases', () => {
    const r = runHarness()

    expect(r.plain, 'the harness printed no Results line — it aborted before finishing').toMatch(
      /Results:\s*\d+\s*pass/,
    )
    expect(r.failed).toBe(0)
    expect(r.status).toBe(0)
    expect(
      r.passed,
      `only ${r.passed} cases ran; a green harness that evaluated almost nothing is the failure this floor exists to catch`,
    ).toBeGreaterThanOrEqual(MIN_CASES)
  })

  it('refuses rather than allows when it cannot resolve a project root', () => {
    // Named separately from the harness run because this is the specific claim TRDD-YR4G2CZH
    // decided, and it is the one a future reader will come looking for. The guard used to `exit 0`
    // here — allowing every write anywhere — so an unenforceable state read as permission.
    const r = runHarness()

    expect(r.plain).toMatch(/no CLAUDE_PROJECT_DIR, no \.cwd, not in a repo → BLOCK\s+\(BLOCK\)/)
    // Its positive control, in the same run: a resolved fallback root must still ALLOW an
    // in-project write, or "BLOCK" above is satisfied by a guard that blocks unconditionally.
    expect(r.plain).toMatch(/fallback root still ALLOWS an in-project write .*\(ALLOW\)/)
  })
})
