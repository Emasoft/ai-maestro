/**
 * TRDD-BL0W6LGY — `lint`/`validate` for PRRD and SPEC: the guard's predicates, corpus-at-rest.
 *
 * The library half drives `lintPillarLines`/`lintPillarCorpus` on real files in a tmpdir;
 * the CLI half drives `runPillarCli` with `process.exit` mocked to a RECORDING no-op (a
 * throwing mock would be re-caught by the CLI's own catch and re-exit as 2, misreporting
 * every code). False-positive controls matter as much as the seeds: a linter that flags
 * ordinary prose is a wall of warnings, which is how a linter gets routed around.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { lintPillarCorpus, lintPillarLines } from '@/lib/pillar/edit-guard'
import { PRRD_KIND, SPEC_KIND, corpusRootFor } from '@/lib/pillar/kinds'
import { walkRecords } from '@/lib/pillar/store'
import { runPillarCli } from '@/lib/pillar/cli'

let dir: string
let designDir: string

const CLEAN_PRRD = [
  '# Project rules',
  '',
  '- **G1.1** — golden rule one.',
  '- **S2.3** — silver rule two.',
  '- **Note** — a prose bullet with a bold token and no digits.',
].join('\n') + '\n'

const CLEAN_SPEC_A = [
  '---',
  'status: normative',
  '---',
  '',
  '`3P-AAA-01` **alpha** — first clause.',
  'Run `yarn build` before testing — a backtick token that is not a clause.',
  'Body prose mentioning status: dev outside the frontmatter.',
].join('\n') + '\n'

const CLEAN_SPEC_B = '`3P-BBB-01` **gamma** — a clause in another document.\n'

function writeCorpus(overrides: { prrd?: string; specA?: string; specB?: string } = {}) {
  writeFileSync(join(designDir, 'requirements', 'PRRD.md'), overrides.prrd ?? CLEAN_PRRD, 'utf-8')
  writeFileSync(join(designDir, 'specs', 'a-spec.md'), overrides.specA ?? CLEAN_SPEC_A, 'utf-8')
  writeFileSync(join(designDir, 'specs', 'b-spec.md'), overrides.specB ?? CLEAN_SPEC_B, 'utf-8')
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pillar-lint-'))
  designDir = join(dir, 'design')
  mkdirSync(join(designDir, 'requirements'), { recursive: true })
  mkdirSync(join(designDir, 'specs'), { recursive: true })
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

describe('lintPillarCorpus — PRRD', () => {
  it('POSITIVE CONTROL — a clean corpus yields zero findings and a real document count', () => {
    writeCorpus()
    const res = lintPillarCorpus(corpusRootFor(designDir, PRRD_KIND), PRRD_KIND)
    expect(res.findings).toEqual([])
    expect(res.documents).toBe(1)
    expect(res.records).toBe(2)
  })

  it('flags the digit-bearing near-miss (G7,4) and NOT the digit-free prose bullet', () => {
    writeCorpus({ prrd: CLEAN_PRRD + '- **G7,4** — a botched declaration.\n' })
    const res = lintPillarCorpus(corpusRootFor(designDir, PRRD_KIND), PRRD_KIND)
    expect(res.findings).toHaveLength(1)
    expect(res.findings[0].line).toBe(6)
    expect(res.findings[0].message).toContain('malformed rule declaration')
  })

  it('flags a duplicate NUMBER across tiers, at the second declaration, naming the first', () => {
    writeCorpus({ prrd: CLEAN_PRRD + '- **S1.0** — same number as G1.1.\n' })
    const res = lintPillarCorpus(corpusRootFor(designDir, PRRD_KIND), PRRD_KIND)
    expect(res.findings).toHaveLength(1)
    expect(res.findings[0].line).toBe(6)
    expect(res.findings[0].message).toContain('rule number 1 already declared at line 3')
  })
})

describe('lintPillarCorpus — SPEC', () => {
  it('POSITIVE CONTROL — clean: no findings; `yarn build` and body-prose status: stay unflagged', () => {
    writeCorpus()
    const res = lintPillarCorpus(corpusRootFor(designDir, SPEC_KIND), SPEC_KIND)
    expect(res.findings).toEqual([])
    expect(res.documents).toBe(2)
    expect(res.records).toBe(2)
  })

  it('flags the lowercase near-miss clause token', () => {
    writeCorpus({ specB: CLEAN_SPEC_B + '`3p-kan-06` **broken** — lowercase id.\n' })
    const res = lintPillarCorpus(corpusRootFor(designDir, SPEC_KIND), SPEC_KIND)
    expect(res.findings).toHaveLength(1)
    expect(res.findings[0].message).toContain('malformed clause declaration')
  })

  it('flags an in-file duplicate clause id at the second declaration', () => {
    writeCorpus({ specB: CLEAN_SPEC_B + '`3P-BBB-01` **gamma-again** — duplicate.\n' })
    const res = lintPillarCorpus(corpusRootFor(designDir, SPEC_KIND), SPEC_KIND)
    expect(res.findings).toHaveLength(1)
    expect(res.findings[0].line).toBe(2)
    expect(res.findings[0].message).toContain('already declared at line 1')
  })

  it('flags a cross-file duplicate clause id (both documents report it)', () => {
    writeCorpus({ specA: CLEAN_SPEC_A + '`3P-BBB-01` **stolen** — clashes with b-spec.\n' })
    const res = lintPillarCorpus(corpusRootFor(designDir, SPEC_KIND), SPEC_KIND)
    const messages = res.findings.map((f) => f.message)
    expect(messages.some((m) => m.includes('also declared in'))).toBe(true)
  })

  it('flags status: holding a pipeline column value in the frontmatter', () => {
    writeCorpus({ specA: CLEAN_SPEC_A.replace('status: normative', 'status: dev') })
    const res = lintPillarCorpus(corpusRootFor(designDir, SPEC_KIND), SPEC_KIND)
    expect(res.findings).toHaveLength(1)
    expect(res.findings[0].line).toBe(2)
    expect(res.findings[0].message).toContain('pipeline value')
  })
})

describe('lintPillarLines — shares the guard\'s predicates (per-document kinds are out of scope)', () => {
  it('returns [] for a per-document pillar regardless of content', async () => {
    const { TRDD_KIND } = await import('@/lib/pillar/kinds')
    expect(
      lintPillarLines(TRDD_KIND, ['- **G1,1** — junk'], { filePath: 'x.md', corpusRecords: [] }),
    ).toEqual([])
  })
})

describe('the CLI verb — exit trichotomy with non-vacuity in the tool', () => {
  function spyCli() {
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never) // RECORDING no-op — see the header
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    return exit
  }

  it('clean corpus → exit 0', async () => {
    writeCorpus()
    const exit = spyCli()
    await runPillarCli(PRRD_KIND, ['lint', '--design-dir', designDir])
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('findings → exit 1 (and `validate` is the same verb)', async () => {
    writeCorpus({ prrd: CLEAN_PRRD + '- **S1.0** — duplicate number.\n' })
    const exit = spyCli()
    await runPillarCli(PRRD_KIND, ['validate', '--design-dir', designDir])
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('EMPTY corpus → exit 2, never a clean 0 — zero documents means no rule looked', async () => {
    // The corpus ROOT exists (assertCorpusRoot passes) but holds no PRRD.md.
    const exit = spyCli()
    await runPillarCli(PRRD_KIND, ['lint', '--design-dir', designDir])
    expect(exit).toHaveBeenCalledWith(2)
    expect(exit).not.toHaveBeenCalledWith(0)
  })

  it('cross-check: the guard and the lint agree on the same seeded violation', async () => {
    // One predicate set, two call sites — the fixer-vs-linter drift lesson. The same
    // duplicate number the lint reports above must also be REFUSED by the write gate.
    writeCorpus()
    const { replaceAtLines } = await import('@/lib/pillar/edit')
    const { pillarPreWriteCheck, GuardedEditError } = await import('@/lib/pillar/edit-guard')
    const root = corpusRootFor(designDir, PRRD_KIND)
    const prrdPath = join(root, 'PRRD.md')
    await expect(
      replaceAtLines(
        prrdPath,
        [{ line: 5, expect: '- **Note** — a prose bullet with a bold token and no digits.', replace: '- **S1.0** — duplicate number.' }],
        {
          preWriteCheck: pillarPreWriteCheck(PRRD_KIND, {
            filePath: prrdPath,
            corpusRecords: [...walkRecords(root, PRRD_KIND)],
          }),
        },
      ),
    ).rejects.toThrow(GuardedEditError)
  })
})
