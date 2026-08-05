/**
 * `scripts/dev/absent` — the negative-claim prover.
 *
 * WHY THE TOOL EXISTS. "X does not exist" is the claim this repo gets wrong most often, and the
 * only class that has ever escaped the machine: a `find … | head -6` reported a route as missing
 * (it was eighth) and that absence was published to another repo as fact. A capped list and an
 * exhaustive one are byte-identical up to the cap, so nothing in the output reveals the
 * truncation. The fix is not "be careful" — it is refusing to certify absence unless a POSITIVE
 * CONTROL proved the same instrument can find anything at all.
 *
 * WHY THIS TEST EXISTS. The tool's whole value is its third verdict: COULD-NOT-RUN must be
 * distinguishable from ABSENT. A tool that collapsed them would be worse than no tool, because it
 * would launder a broken search into a confident negative — exactly the failure it is named for.
 * So the load-bearing case here is the BROKEN-INSTRUMENT one, not the happy path.
 *
 * The exit codes follow grep's trichotomy (0 clean / 1 findings / 2 could-not-run), which is the
 * convention every pillar CLI in this repo uses.
 *
 * NEUTER RUN (2026-08-05 — OBSERVED via scripts/dev/neuter, restore verified by blob hash):
 *   line 61, the control check `if [ "$CONTROL_HITS" = "0" ]` → `if false; then`
 *   → 1 red / 3 green: `a BROKEN instrument returns COULD-NOT-RUN, never ABSENT`.
 * The other three stay green and should: none of them supplies a broken control, so none can
 * see that guard. That split is the point — it shows the file pins the could-not-run verdict
 * specifically, rather than passing on the strength of the two easy verdicts.
 */
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'child_process'
import * as path from 'path'

const REPO = path.resolve(__dirname, '../..')
const ABSENT = path.join(REPO, 'scripts', 'dev', 'absent')

function run(args: string[]): { exit: number; out: string } {
  const r = spawnSync('bash', [ABSENT, ...args], { cwd: REPO, encoding: 'utf8', timeout: 120_000 })
  return { exit: r.status ?? -1, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

describe('scripts/dev/absent', () => {
  it('certifies a TRUE absence only alongside a proven control', () => {
    // `hibernatedAt` genuinely does not exist (this is the claim published on ai-maestro#113);
    // `isRunning` genuinely does, in the same paths.
    const r = run(['-p', 'hibernatedAt', '-c', 'isRunning', '--', 'lib', 'services', 'types'])
    expect(r.exit).toBe(0)
    expect(r.out).toMatch(/ABSENT/)
    // The control count is printed because an unproven instrument is the whole failure mode.
    expect(r.out).toMatch(/instrument proven: control 'isRunning' matched [1-9]/)
  })

  it('rejects a FALSE absence claim and shows the hits', () => {
    const r = run(['-p', 'requireIdle', '-c', 'sendCommand', '--', 'services'])
    expect(r.exit).toBe(1)
    expect(r.out).toMatch(/FOUND/)
    expect(r.out).toMatch(/agents-core-service\.ts/)
  })

  it('a BROKEN instrument returns COULD-NOT-RUN, never ABSENT', () => {
    // THE load-bearing case. The pattern really is absent, so a tool that ignored the control
    // would happily print ABSENT here — and that is precisely the false negative this exists to
    // prevent. Exit 2 must not collapse into either 0 or 1.
    const r = run(['-p', 'hibernatedAt', '-c', 'zzz-not-a-real-symbol-zzz', '--', 'lib'])
    expect(r.exit).toBe(2)
    expect(r.out).toMatch(/COULD NOT RUN/)
    expect(r.out).not.toMatch(/^ABSENT/m)
  })

  it('refuses to run at all without a control', () => {
    // The control cannot be optional: an optional guard is one every caller in a hurry omits,
    // which returns the tool to being a plain grep with a confident label.
    const r = run(['-p', 'hibernatedAt'])
    expect(r.exit).toBe(2)
    expect(r.out).toMatch(/the CONTROL is not optional/)
  })
})
