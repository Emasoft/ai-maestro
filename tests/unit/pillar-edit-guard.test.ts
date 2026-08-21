/**
 * TRDD-2R34M8FA — `lib/pillar/edit-guard.ts`, the PRRD/SPEC validate-before-write gate.
 *
 * Every refusal test drives the REAL write seam (`replaceAtLines` with the guard as its
 * `preWriteCheck`, exactly as `runPillarEdit` wires it) against a REAL file in a tmpdir,
 * and asserts BOTH halves: the batch is refused with `GuardedEditError`, AND the file is
 * byte-identical — a refusal that half-wrote would be the corruption this gate exists to
 * prevent. Each fixture seeds exactly ONE illegal thing (isolated-producer), so a
 * whole-guard neuter attributes every red to its own branch. Positive controls prove the
 * gate is not a wall: the legal edit in each family lands.
 *
 * The wiring test at the bottom drives `runPillarEdit` itself — without it, deleting the
 * `preWriteCheck:` line from cli.ts would redden nothing (the unpinned-wiring lesson).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { replaceAtLines } from '@/lib/pillar/edit'
import { GuardedEditError, pillarPreWriteCheck } from '@/lib/pillar/edit-guard'
import { PRRD_KIND, SPEC_KIND, TRDD_KIND, corpusRootFor } from '@/lib/pillar/kinds'
import { walkRecords } from '@/lib/pillar/store'
import { palette, runPillarEdit } from '@/lib/pillar/cli'

let dir: string
let designDir: string
let prrdPath: string
let specAPath: string
let specBPath: string

const PRRD_DOC = [
  '# Project rules',
  '',
  '- **G1.1** — golden rule one.',
  '- **S2.3** — silver rule two.',
  '- **G7.4** — golden rule seven.',
  'Plain prose line.',
].join('\n') + '\n'

const SPEC_A = [
  '---',
  'status: normative',
  '---',
  '',
  '`3P-AAA-01` **alpha** — first clause.',
  '`3P-AAA-02` **beta** — second clause.',
  'Body prose that merely mentions status: dev without being frontmatter.',
].join('\n') + '\n'

const SPEC_B = '`3P-BBB-01` **gamma** — a clause in another document.\n'

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pillar-guard-'))
  designDir = join(dir, 'design')
  mkdirSync(join(designDir, 'requirements'), { recursive: true })
  mkdirSync(join(designDir, 'specs'), { recursive: true })
  prrdPath = join(designDir, 'requirements', 'PRRD.md')
  specAPath = join(designDir, 'specs', 'a-spec.md')
  specBPath = join(designDir, 'specs', 'b-spec.md')
  writeFileSync(prrdPath, PRRD_DOC, 'utf-8')
  writeFileSync(specAPath, SPEC_A, 'utf-8')
  writeFileSync(specBPath, SPEC_B, 'utf-8')
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

/** The guard exactly as runPillarEdit builds it, for a direct library-level drive. */
function guardFor(kind: typeof PRRD_KIND | typeof SPEC_KIND, filePath: string) {
  const root = corpusRootFor(designDir, kind)
  return pillarPreWriteCheck(kind, { filePath, corpusRecords: [...walkRecords(root, kind)] })
}

async function expectRefusedByteIdentical(
  filePath: string,
  kind: typeof PRRD_KIND | typeof SPEC_KIND,
  edit: { line: number; expect: string; replace: string },
): Promise<void> {
  const before = readFileSync(filePath, 'utf-8')
  await expect(
    replaceAtLines(filePath, [edit], { preWriteCheck: guardFor(kind, filePath) }),
  ).rejects.toThrow(GuardedEditError)
  expect(readFileSync(filePath, 'utf-8')).toBe(before)
}

describe('PRRD guard — rule-id grammar, tier-wide numbers, forward-only versions', () => {
  // TRDD-DXQNUJII. This test previously ran the OPPOSITE assertion, under the name
  // "POSITIVE CONTROL — a legal text edit (id unchanged) lands": it pinned the very
  // behaviour the card calls the defect, so leaving it green after the fix would have
  // silently re-documented the hole. The edit below is byte-for-byte the one it used to
  // assert lands; only the verdict is inverted.
  it('refuses a TEXT change under an UNCHANGED version (G7.4 text edited, still .4)', async () => {
    await expectRefusedByteIdentical(prrdPath, PRRD_KIND, {
      line: 5, expect: 'rule seven', replace: 'rule SEVEN, clarified',
    })
  })

  it('POSITIVE CONTROL — text AND version changed together lands (G7.4 -> G7.5, the correct edit)', async () => {
    await replaceAtLines(
      prrdPath,
      [{ line: 5, expect: '- **G7.4** — golden rule seven.', replace: '- **G7.5** — golden rule SEVEN, clarified.' }],
      { preWriteCheck: guardFor(PRRD_KIND, prrdPath) },
    )
    expect(readFileSync(prrdPath, 'utf-8')).toContain('- **G7.5** — golden rule SEVEN, clarified.')
  })

  // The mandatory complementary half (TRDD-DXQNUJII): without it, a guard that refuses
  // whenever the TARGETED line carries an unchanged version passes the test above while
  // rejecting edits that change nothing. It is reachable because `changedLines` carries
  // the lines the caller AIMED AT, not the ones that moved — so a no-op reaches the guard.
  it('ALLOWS a NO-OP edit on a rule line (expect === replace does not trip the bump gate)', async () => {
    const before = readFileSync(prrdPath, 'utf-8')
    await replaceAtLines(prrdPath, [{ line: 5, expect: 'rule seven', replace: 'rule seven' }], {
      preWriteCheck: guardFor(PRRD_KIND, prrdPath),
    })
    expect(readFileSync(prrdPath, 'utf-8')).toBe(before)
  })

  it('POSITIVE CONTROL — a forward version bump lands (G7.4 -> G7.5)', async () => {
    await replaceAtLines(prrdPath, [{ line: 5, expect: '**G7.4**', replace: '**G7.5**' }], {
      preWriteCheck: guardFor(PRRD_KIND, prrdPath),
    })
    expect(readFileSync(prrdPath, 'utf-8')).toContain('- **G7.5** —')
  })

  it('POSITIVE CONTROL — a tier flip with number+version unchanged lands (S2.3 -> G2.3, the promote shape)', async () => {
    await replaceAtLines(prrdPath, [{ line: 4, expect: '**S2.3**', replace: '**G2.3**' }], {
      preWriteCheck: guardFor(PRRD_KIND, prrdPath),
    })
    expect(readFileSync(prrdPath, 'utf-8')).toContain('- **G2.3** —')
  })

  it('refuses a version REGRESSION (G7.4 -> G7.3)', async () => {
    await expectRefusedByteIdentical(prrdPath, PRRD_KIND, {
      line: 5, expect: '**G7.4**', replace: '**G7.3**',
    })
  })

  it('refuses a NUMBER rewrite on an existing rule (G7.4 -> G9.4 — numbers are immutable)', async () => {
    await expectRefusedByteIdentical(prrdPath, PRRD_KIND, {
      line: 5, expect: '**G7.4**', replace: '**G9.4**',
    })
  })

  it('refuses a new declaration whose NUMBER already exists in the other tier (S1.0 beside G1.1)', async () => {
    await expectRefusedByteIdentical(prrdPath, PRRD_KIND, {
      line: 6, expect: 'Plain prose line.', replace: '- **S1.0** — a duplicate number.',
    })
  })

  it('refuses the NEAR-MISS — a declaration edited into a bullet that no longer parses (G7,4)', async () => {
    await expectRefusedByteIdentical(prrdPath, PRRD_KIND, {
      line: 5, expect: '**G7.4**', replace: '**G7,4**',
    })
  })

  it('ALLOWS rewriting a declaration line to plain prose (the deliberate-removal shape)', async () => {
    await replaceAtLines(
      prrdPath,
      [{ line: 5, expect: '- **G7.4** — golden rule seven.', replace: 'Rule seven retired 2026-08-15.' }],
      { preWriteCheck: guardFor(PRRD_KIND, prrdPath) },
    )
    expect(readFileSync(prrdPath, 'utf-8')).toContain('Rule seven retired 2026-08-15.')
  })
})

describe('SPEC guard — stable clause ids, corpus-wide uniqueness, status: legality', () => {
  it('POSITIVE CONTROL — a legal text edit after the clause id lands', async () => {
    await replaceAtLines(specAPath, [{ line: 5, expect: 'first clause', replace: 'first clause, clarified' }], {
      preWriteCheck: guardFor(SPEC_KIND, specAPath),
    })
    expect(readFileSync(specAPath, 'utf-8')).toContain('first clause, clarified')
  })

  it('refuses a clause-id RENAME (3P-AAA-01 -> 3P-AAA-99 — ids are stable)', async () => {
    await expectRefusedByteIdentical(specAPath, SPEC_KIND, {
      line: 5, expect: '`3P-AAA-01`', replace: '`3P-AAA-99`',
    })
  })

  it('refuses a new declaration duplicating an id in the SAME document', async () => {
    await expectRefusedByteIdentical(specAPath, SPEC_KIND, {
      line: 7,
      expect: 'Body prose that merely mentions status: dev without being frontmatter.',
      replace: '`3P-AAA-02` **beta-again** — duplicate in file.',
    })
  })

  it('refuses a new declaration duplicating an id from ANOTHER corpus document', async () => {
    await expectRefusedByteIdentical(specAPath, SPEC_KIND, {
      line: 7,
      expect: 'Body prose that merely mentions status: dev without being frontmatter.',
      replace: '`3P-BBB-01` **gamma-copy** — clashes with b-spec.md.',
    })
  })

  it('refuses the NEAR-MISS — a declaration edited into a backtick token that no longer parses', async () => {
    await expectRefusedByteIdentical(specAPath, SPEC_KIND, {
      line: 5, expect: '`3P-AAA-01`', replace: '`3p-broken`',
    })
  })

  it('refuses status: set to a PIPELINE column value in the frontmatter (status: dev)', async () => {
    await expectRefusedByteIdentical(specAPath, SPEC_KIND, {
      line: 2, expect: 'status: normative', replace: 'status: dev',
    })
  })

  it('ALLOWS status: set to a bare non-pipeline token (status: draft)', async () => {
    await replaceAtLines(specAPath, [{ line: 2, expect: 'status: normative', replace: 'status: draft' }], {
      preWriteCheck: guardFor(SPEC_KIND, specAPath),
    })
    expect(readFileSync(specAPath, 'utf-8')).toContain('status: draft')
  })

  it('does NOT police a status:-looking line in the BODY (below the frontmatter)', async () => {
    await replaceAtLines(
      specAPath,
      [{ line: 7, expect: 'status: dev', replace: 'status: dev (a prose mention, not frontmatter)' }],
      { preWriteCheck: guardFor(SPEC_KIND, specAPath) },
    )
    expect(readFileSync(specAPath, 'utf-8')).toContain('a prose mention, not frontmatter')
  })
})

describe('scope — per-document pillars are not this gate\'s job', () => {
  it('the TRDD kind gets a no-op check (its funnel is editTrdd + lib/trdd-edit-guard)', () => {
    const check = pillarPreWriteCheck(TRDD_KIND, { filePath: prrdPath, corpusRecords: [] })
    // Content that would be wildly illegal for a per-line pillar passes untouched.
    expect(() =>
      check({ prevLines: ['- **G1.1** — x'], nextLines: ['- **G1,1** — x'], changedLines: [1] }),
    ).not.toThrow()
  })
})

describe('wiring — runPillarEdit passes the guard (deleting the preWriteCheck would unhook it)', () => {
  it('an illegal edit through the CLI edit path is refused with GuardedEditError', async () => {
    // If the wiring is removed, runPillarEdit proceeds to a successful write and
    // calls process.exit(0) — turn that into a loud, distinct failure instead of
    // killing the test runner.
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code}) reached — the guard did not refuse`)
    }) as never)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})

    const root = corpusRootFor(designDir, PRRD_KIND)
    await expect(
      runPillarEdit(
        PRRD_KIND,
        root,
        'G7.4',
        [{ line: 5, expect: '**G7.4**', replace: '**G7.3**' }],
        palette(false),
        'prrdgrep',
      ),
    ).rejects.toThrow(GuardedEditError)
    expect(readFileSync(prrdPath, 'utf-8')).toBe(PRRD_DOC)
  })
})
