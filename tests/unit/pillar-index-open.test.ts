/**
 * TRDD-216FTVC9 — `danglingTrddRefs` is the CALL SITE, and this pins the WIRING.
 *
 * `danglingRefs` itself was already tested (`pillar-index-build.test.ts`) and had ZERO
 * production callers, so `dag.ts:35`'s delegation of reference-EXISTENCE checking went
 * nowhere and `pillars-lint`'s "the reference DAG holds" was true about edge DIRECTION
 * alone. Measured before this file existed: neutering the wiring to `return []` reddened
 * **0 of 49** tests across the three pillar suites. A guard nothing pins is a guard that
 * the next edit removes silently, which is the very defect the wiring fixes.
 *
 * So the assertion that earns this file's keep is the SECOND one — a seeded dangling
 * reference must come back. `expect(clean).toEqual([])` alone passes under `return []`
 * and would pin nothing.
 *
 * CONTAINMENT, and it is not incidental. `danglingTrddRefs` resolves its index through
 * `statePath('pillar-index')` → `getStateDir()` → `join(homedir(), …)`, computed AT CALL
 * TIME, so a `process.env.HOME` swap genuinely redirects it (unlike a module-load
 * constant, which no in-process swap can reach). Without that swap this suite would
 * write a `.sqlite` into the DEVELOPER'S real `~/.aimaestro/pillar-index/` — measured
 * 2026-08-22, that directory already holds **45 such files** (`t-*`, `scratchpad-*`,
 * `otherproj2-*`, `plainrepo-*`) left by other suites. The last test here asserts the
 * containment held, because a leak that is merely intended is a leak.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readdirSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { danglingTrddRefs } from '@/lib/pillar/index-open'

let root: string
let fakeHome: string
let designDir: string
let realHome: string | undefined

const card = (id: string, blockedBy: string) =>
  [
    '---',
    `trdd-id: ${id}`,
    `title: Fixture card ${id}`,
    'column: todo',
    'created: 2026-08-22T03:00:00+0200',
    'updated: 2026-08-22T03:00:00+0200',
    'current-owner: fixture',
    'task-type: docs',
    'npt: []',
    'eht: []',
    `blocked-by: ${blockedBy}`,
    '---',
    '',
    `# ${id}`,
    '',
  ].join('\n')

/** ANCHOR exists; CITER points at whatever the caller says. */
function writeCorpus(citedId: string) {
  writeFileSync(join(designDir, 'tasks', 'TRDD-20260822_030000+0200-AAAA1111-anchor.md'), card('AAAA1111', '[]'), 'utf-8')
  writeFileSync(
    join(designDir, 'tasks', 'TRDD-20260822_030001+0200-BBBB2222-citer.md'),
    card('BBBB2222', `[${citedId}]`),
    'utf-8',
  )
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pillar-index-open-'))
  fakeHome = join(root, 'home')
  designDir = join(root, 'design')
  mkdirSync(join(designDir, 'tasks'), { recursive: true })
  mkdirSync(fakeHome, { recursive: true })
  realHome = process.env.HOME
  process.env.HOME = fakeHome
})

afterEach(() => {
  if (realHome === undefined) delete process.env.HOME
  else process.env.HOME = realHome
  rmSync(root, { recursive: true, force: true })
})

describe('danglingTrddRefs — the wiring dag.ts delegates to (TRDD-216FTVC9)', () => {
  it('returns nothing when every citation resolves', () => {
    writeCorpus('AAAA1111')
    expect(danglingTrddRefs(designDir)).toEqual([])
  })

  it('FLAGS a seeded dangling reference — this is the assertion the wiring rests on', () => {
    writeCorpus('ZZZZ9999')
    const found = danglingTrddRefs(designDir)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ srcId: 'BBBB2222', field: 'blocked-by', dstId: 'ZZZZ9999' })
    // The path matters as much as the ids: a finding a human cannot open is not actionable.
    expect(found[0].path).toContain('BBBB2222')
  })

  it('names the FIELD, so a card citing a bad id in two fields is two findings', () => {
    writeFileSync(
      join(designDir, 'tasks', 'TRDD-20260822_030002+0200-CCCC3333-two.md'),
      card('CCCC3333', '[ZZZZ9999]').replace('npt: []', 'npt: [YYYY8888]'),
      'utf-8',
    )
    writeCorpus('AAAA1111')
    const fields = danglingTrddRefs(designDir)
      .filter((d) => d.srcId === 'CCCC3333')
      .map((d) => d.field)
      .sort()
    expect(fields).toEqual(['blocked-by', 'npt'])
  })

  it('leaves the REAL state dir untouched — the containment held', () => {
    // Asserts the OUTCOME (no leak) rather than an internal path. An earlier draft
    // asserted the index appears at `<fakeHome>/.aimaestro/pillar-index/` and failed
    // while the real dir provably did NOT grow — i.e. the containment worked and the
    // assertion was about the wrong thing. Pinning "the real dir did not change" needs
    // no knowledge of where the index went, and it is the property that matters.
    // `homedir()` must be read from the PRE-SWAP value: called here it returns the FAKE
    // home, so comparing against it measures the swapped dir and always "passes" while
    // proving nothing. An earlier draft did exactly that (`expected 1 to be +0` — it had
    // measured the fake dir filling up and called it the real one).
    const realDir = join(realHome!, '.aimaestro', 'pillar-index')
    const fakeDir = join(fakeHome, '.aimaestro', 'pillar-index')
    const before = existsSync(realDir) ? readdirSync(realDir).length : 0
    writeCorpus('AAAA1111')
    danglingTrddRefs(designDir)
    expect(existsSync(realDir) ? readdirSync(realDir).length : 0).toBe(before)
    // Positive control: the index really was written SOMEWHERE, so the assertion above
    // is not passing merely because nothing ran.
    expect(readdirSync(fakeDir).some((f) => f.endsWith('.sqlite'))).toBe(true)
  })
})
