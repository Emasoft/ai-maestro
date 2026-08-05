/**
 * `scripts/aimaestro-check-decoupling.sh` — a CLEAN tree must report CLEAN (exit 0).
 *
 * THE BUG. The scanner's filter stage ended `print("\n".join(out))`. With `out` empty that emits
 * **one empty line**, which then survives the third-party-exclusion `grep -v` (a blank line matches
 * no exclusion, so `-v` keeps it), so `wc -l` returned **1** and the script announced
 * `FINDINGS: 1 direct API call site(s)` and **exited 1** — on a tree with zero violations.
 *
 * WHY IT SURVIVED. This script self-tests its own needle on every run and aborts if the needle
 * fails to fire, which is a genuinely good guard — and it is blind to this, because **the needle
 * was never wrong. The COUNT was.** A detector can be simultaneously proven-to-fire and unable to
 * count what it found. That gap is the whole reason this file exists.
 *
 * WHY IT MATTERS MORE THAN A MISCOUNT. This is the fleet's R23 compliance gate, and its documented
 * contract is grep's trichotomy — `0` clean · `1` findings · `2` could-not-run. A false `1` on a
 * clean tree fails any CI wired to it, with a headline count and **no `file:line` to chase**,
 * because there is nothing to chase. It was found by running the scanner against
 * `ai-maestro-autonomous-agent` v1.5.3 while answering ai-maestro#107 — a plugin that had reported
 * itself as having zero direct API calls, and was telling the truth.
 *
 * THE ASSERTIONS ARE A PAIR, and neither alone is worth anything. "Clean reports clean" passes
 * against a scanner that has been broken to report clean for EVERYTHING — which would be a far
 * worse bug than the one being fixed. So the seeded-violation case is a mandatory positive control,
 * and it asserts the emitted `file:line`, not merely a non-zero exit.
 *
 * NEUTER RUNS (2026-08-05 — OBSERVED, and they corrected what this comment first predicted).
 * The two halves of the fix are **REDUNDANT, not complementary**, and that is only visible by
 * running all three mutations:
 *
 *   - `if out:` → `if True:` alone .................... **0 red.** `grep -c .` still drops the blank.
 *   - `grep -c .` → `wc -l` alone ..................... **0 red.** `if out:` means the file is empty.
 *   - **both together** ............................... **1 red** — and exactly the clean case,
 *     with both positive controls green.
 *
 * So neither half is individually pinned: each masks the other. The first draft of this comment
 * asserted each would redden the clean case on its own, which is the intuitive reading of
 * "belt-and-braces" and is simply false here. Stated plainly because it changes what a future
 * editor may safely delete: **removing EITHER half alone will not redden this file**, so the
 * redundancy has to be defended in prose rather than by the suite.
 *
 * (A fourth mutation was discarded rather than reported: an unescaped perl replacement interpolated
 * `$(` and `$TMP` and left the script syntactically broken, reddening all 3. That measured the
 * instrument, not the tests.)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const REPO = path.resolve(__dirname, '../..')
const SCANNER = path.join(REPO, 'scripts', 'aimaestro-check-decoupling.sh')

let root = ''
let cleanDir = ''
let dirtyDir = ''

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'decoupling-test-'))

  // A tree that is clean but NOT empty — an empty dir would pass for the wrong reason.
  cleanDir = path.join(root, 'clean-plugin')
  fs.mkdirSync(path.join(cleanDir, 'skills', 'ok'), { recursive: true })
  fs.writeFileSync(
    path.join(cleanDir, 'skills', 'ok', 'run.sh'),
    '#!/usr/bin/env bash\n# Uses the frozen CLI, which is the only allowed caller.\namp-send.sh --to manager --subject hi\n',
  )
  fs.writeFileSync(
    path.join(cleanDir, 'skills', 'ok', 'SKILL.md'),
    '# ok\n\nNever call the server API directly; use the frozen CLI layer.\n',
  )

  dirtyDir = path.join(root, 'dirty-plugin')
  fs.mkdirSync(path.join(dirtyDir, 'skills', 'bad'), { recursive: true })
  fs.writeFileSync(
    path.join(dirtyDir, 'skills', 'bad', 'run.sh'),
    '#!/usr/bin/env bash\ncurl -s http://localhost:23000/api/agents\n',
  )
})

afterAll(() => {
  if (root && root.startsWith(os.tmpdir())) fs.rmSync(root, { recursive: true, force: true })
})

function scan(dir: string): { exit: number; out: string } {
  const r = spawnSync('bash', [SCANNER, dir], { encoding: 'utf8', timeout: 120_000 })
  return { exit: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

describe('a clean tree reports CLEAN', () => {
  it('exits 0 and does not announce a phantom finding', () => {
    const r = scan(cleanDir)
    expect(r.exit).toBe(0)
    expect(r.out).toMatch(/CLEAN/)
    // The exact shape of the bug: a headline count with nothing behind it.
    expect(r.out).not.toMatch(/FINDINGS:/)
  })
})

describe('positive control — the scanner still catches a real violation', () => {
  it('exits 1 on a seeded direct API call', () => {
    // Without this, the fix could have been "always report clean", which is strictly worse
    // than the bug it replaces.
    const r = scan(dirtyDir)
    expect(r.exit).toBe(1)
    expect(r.out).toMatch(/FINDINGS: 1/)
  })

  it('names the offending file and line, not just a count', () => {
    const r = scan(dirtyDir)
    // A count with no location is what the bug produced; the fix must keep the location.
    expect(r.out).toMatch(/run\.sh:2:/)
    expect(r.out).toMatch(/\/api\/agents/)
  })
})
