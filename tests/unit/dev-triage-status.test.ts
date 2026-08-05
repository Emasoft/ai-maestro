/**
 * `scripts/dev/triage-status` — return the row that SUPERSEDES the others.
 *
 * WHY THE TOOL EXISTS. `reports/github-issue-triage/TRIAGE.md` has two layers a grep cannot tell
 * apart: a PROGRESS LEDGER at the top (revised as work happens) and the Batch A–E tables below
 * `## Classification key` (the original triage, written once). `grep '#112'` returns BOTH and says
 * nothing about which supersedes which.
 *
 * Measured 2026-08-05: I read #112's BATCH row, wrote "the cheapest — a verify-and-close" into a
 * handoff, and its LEDGER row said it had already been answered that morning and what remained was
 * a BUILD. A false claim in the one artifact whose job is to orient the next session. The
 * instrument was fine; the reader could not distinguish the layers. So the tool distinguishes them.
 *
 * WHY THESE TESTS USE A FIXTURE AND NOT THE REAL DOCUMENT. The real one is gitignored evidence, so
 * a test bound to it would exit 2 for everything in a fresh clone or CI and pass vacuously — a test
 * that silently stops testing. `--doc` exists for exactly this, and the fixture below is built to
 * contain BOTH layers for one issue, which is the only shape that discriminates.
 *
 * THE LOAD-BEARING CASE is `a historical-only row is labelled, never returned as current`. A tool
 * that returned the batch row unlabelled would be indistinguishable from the grep it replaces.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const TOOL = path.join(path.resolve(__dirname, '../..'), 'scripts', 'dev', 'triage-status')

let doc: string
let dir: string

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-triage-'))
  doc = path.join(dir, 'TRIAGE.md')
  fs.writeFileSync(
    doc,
    [
      '# triage fixture',
      '',
      '## PROGRESS LEDGER',
      '',
      '| **#112** | answered; the panel it asked for is absent — left OPEN for that | `123` |',
      '',
      '## Classification key',
      '',
      '## Batch E',
      '',
      '| **#112** | DONE? | S | almost certainly shipped — VERIFY, then reply/close | — |',
      '| **#3** | FIX | M | archive Haephestos v1 | — |',
      '',
    ].join('\n'),
  )
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

function run(n: string): { exit: number; out: string } {
  const r = spawnSync('bash', [TOOL, n, '--doc', doc], { encoding: 'utf8', timeout: 60_000 })
  return { exit: r.status ?? -1, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

describe('scripts/dev/triage-status', () => {
  it('returns the LEDGER row when both layers carry the issue', () => {
    const r = run('112')
    expect(r.exit).toBe(0)
    expect(r.out).toMatch(/CURRENT/)
    expect(r.out).toMatch(/left OPEN for that/)
    // And it must SAY the batch row is superseded — silence there is how the wrong row gets quoted.
    expect(r.out).toMatch(/SUPERSEDED/)
    expect(r.out).not.toMatch(/verify, then reply\/close/i)
  })

  it('a historical-only row is LABELLED, never returned as current', () => {
    // THE load-bearing case: an unlabelled batch row is indistinguishable from the grep this
    // replaces, and exit 1 is what stops a caller treating it as settled.
    const r = run('3')
    expect(r.exit).toBe(1)
    expect(r.out).toMatch(/HISTORICAL ONLY/)
    expect(r.out).toMatch(/VERIFY against the code/)
    expect(r.out).not.toMatch(/CURRENT/)
  })

  it('an unknown issue is COULD-NOT-RUN, not "nothing to do"', () => {
    const r = run('99999')
    expect(r.exit).toBe(2)
    expect(r.out).toMatch(/COULD NOT RUN/)
  })

  it('a missing document is COULD-NOT-RUN, never an empty answer', () => {
    // The clone-independence case: absent evidence must not read as "the issue is untriaged".
    const r = spawnSync('bash', [TOOL, '112', '--doc', path.join(dir, 'nope.md')], {
      encoding: 'utf8',
      timeout: 60_000,
    })
    expect(r.status).toBe(2)
    expect((r.stdout ?? '') + (r.stderr ?? '')).toMatch(/COULD NOT RUN/)
  })
})
