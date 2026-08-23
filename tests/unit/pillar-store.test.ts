import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import matter from 'gray-matter'
import { PRRD_KIND, SPEC_KIND, TRDD_KIND } from '@/lib/pillar/kinds'
import {
  assertCorpusRoot,
  listDocuments,
  readDocument,
  recordsOf,
  walkRecords,
  findRecord,
} from '@/lib/pillar/store'

/**
 * TRDD-L55IYKL4 — the shared pillar seam.
 *
 * `tests/unit/trdd-store.test.ts` already covers the TRDD path end-to-end (it is
 * the acceptance proof that the seam fits: those tests pass UNCHANGED through the
 * refactor). What it cannot cover is the half of the seam TRDD never uses — the
 * `per-line` record mode that PRRD and SPEC need, where one document yields N
 * records and the id lives in the body rather than the filename.
 *
 * That half is why the seam exists at all (finding F2: the three pillars have three
 * document models), so shipping it unexercised would mean the generalization is
 * asserted rather than demonstrated.
 */

const REPO = process.cwd()
let tmp: string

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pillar-'))
})
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('SPEC — N clauses per document, id in the body', () => {
  it('finds every clause the live 3-pillars spec declares (positive control on real data)', () => {
    const recs = [...walkRecords(path.join(REPO, 'design/specs'), SPEC_KIND)]
    const threeP = recs.filter((r) => r.filePath.endsWith('3-pillars-spec.md'))
    // 68 line-anchored declarations, counted independently with grep (NOT copied from
    // this test's own failure output) each time the spec gains a family. A fixture of my
    // own making could not have caught a wrong regex; the live corpus can. Was 38 until
    // spec 1.2.0 added 3P-DAG (+3) and 3P-IDX (+14) — TRDD-LXLK7XGX / EHT MUYRIKN3; then
    // 1.3.0 added 3P-TRDD-09/10/11 (+3) for the `status:`-is-not-`column:` ruling and
    // 3P-IDX-15 (+1) for TRDD-C4YJAUD9's unwired-pass clause, batched into the SAME bump;
    // then 1.4.0 added 3P-TRDD-12 (+1), the validate-before-write mandate (TRDD-SCMPWF6R);
    // then 1.5.0 added 3P-KAN-10..16 (+7), the USER-ratified PIPELINE INVARIANT — the board
    // must DRAIN, `blocked-by:` is the only licence to sit still, WIP matches capacity;
    // then 1.6.0 added 3P-VER-05 (+1), the change-signal clause (ai-maestro#97 — poll the
    // per-FILE blob sha, never the branch commit sha, which moves on every unrelated commit
    // and so reports "current" over a 13-day-stale document)
    // (`grep -cE '^\`3P-[A-Z]+-[0-9]{2}\`' design/specs/3-pillars-spec.md` → 68).
    // 80 re-derived 2026-08-06 with the grep above (spec 1.5.0→1.7.0 added
    // 3P-KAN-10..16, 3P-VER-05, and the 3P-ZON family) — never copy the number
    // from a failure output; run the grep.
    // 84 re-derived 2026-08-23 with the grep above: spec 3.0.0 added 3P-KAN-17/18/19
    // (spelling, design-columns, verify-and-plan) and 3P-TRDD-13 (design-lives-in-the-card).
    // This test EARNED its keep on that bump: the three KAN clauses were first written as
    // `3P-KAN-04a/b/c`, and the census moved only 80→81 instead of 80→84 — because the id
    // grammar below is `\d{2}` and a letter suffix matches NOTHING, so three ratified
    // clauses were invisible to every pillar tool AND to `grep 3P-KAN`. Renumbered to the
    // next free ids per 3P-MNT-03. A malformed clause id is not a cosmetic slip: an
    // unfindable clause is an ungoverned one.
    // 86 re-derived the same day: +3P-KAN-20 (the bracket values are legal `column:` values and
    // are NOT board columns — the spec said "EXACTLY one of the N, no others" while the code has
    // always accepted 27, so it forbade 70 of 176 live cards) and +3P-KAN-21 (pre-3.0.0 cards at
    // `todo` are grandfathered, with the boundary stated). Both were found by PEER SESSIONS
    // cross-reading the amendment against the corpus — no test compares the spec's prose to
    // VALID_COLUMNS, which is why the older of the two survived every version bump.
    // 87 the same day: +3P-KAN-22, which resolves a MUST added hours earlier in 3P-KAN-10 ("name
    // the approver") that no card satisfied and no detector could check. The approver turned out
    // to be already derivable — from the COLUMN for the two human ones, and from
    // `min-approval-requirement:` for `approval` (166 of 176 cards carry it) — so the fix was to
    // NOT mint a field. Raised by the ORCHESTRATOR session.
    expect(threeP.length).toBe(87)
    expect(threeP.every((r) => /^3P-[A-Z]+-\d{2}$/.test(r.id))).toBe(true)
    // Every record carries the line it was declared on — that is what a lint reports.
    expect(threeP.every((r) => typeof r.line === 'number' && r.line! > 0)).toBe(true)
  })

  it('the whole specs corpus yields records from MORE than one file', () => {
    const recs = [...walkRecords(path.join(REPO, 'design/specs'), SPEC_KIND)]
    const files = new Set(recs.map((r) => path.basename(r.filePath)))
    expect(files.size).toBeGreaterThan(1)
    // Floor = the ONE biggest file's own clause count, so the corpus total must exceed
    // what a single-file read could return. Track it with that count, or the assertion
    // quietly stops meaning "more than one file's worth" — which is exactly what had
    // happened: the floor still read 55 while the biggest file had grown past it, so a
    // single-file read would have satisfied it. Re-derive it through THIS extractor, not
    // by grepping the specs: a hand regex counts a different set, so a floor taken from
    // grep would be a number about a different population. Per file, biggest-first,
    // re-derived 2026-08-15 after TRDD-IG1MMYFA widened the declaration grammar (the
    // old shape under-matched 44+ live clauses — TERM/COMM two-segment, RP long/4-segment,
    // STS-Rn.n dotted, RP-TOML word-tail) and the bold-preferred pick stopped line-leading
    // citations double-counting:
    //   3-pillars 80, all-in-one 59, governance 48, scenario-tests 43, role-plugins 33
    //   (total 263). Biggest = 80.
    // Re-derived 2026-08-23: spec 3.0.0 took 3-pillars to 84, so the floor moved with it.
    // It was ALREADY stale in the direction this comment warns about — at 80 a single-file
    // read of the 84-clause spec would have satisfied `> 80`, i.e. the assertion had quietly
    // stopped meaning "more than one file's worth" again, for the second time.
    // 86 the same day (3P-KAN-20, 3P-KAN-21) — the floor tracks the biggest file or it stops
    // meaning anything, which is exactly the failure this comment already records twice.
    expect(recs.length).toBeGreaterThan(87)
  })

  it('DECLARATION is line-anchored — a citation inside prose is NOT a record', () => {
    // This is the distinction NPT LXLK7XGX turns on. If a mere mention counted as a
    // declaration, the Phase-4 DAG lint would flag every provenance reference in the
    // specs on day one — a wall of false positives, which is how a linter gets
    // routed around rather than fixed.
    fs.writeFileSync(
      path.join(tmp, 'x-spec.md'),
      [
        '---',
        'spec: x',
        '---',
        '`3P-KAN-01` **declared** — this one is a declaration.',
        'Prose that merely cites `3P-KAN-99` and AIO-TXN-10 mid-sentence.',
        '  `3P-KAN-98` indented, so not line-anchored either.',
      ].join('\n'),
    )
    const ids = [...walkRecords(tmp, SPEC_KIND, [''])].map((r) => r.id)
    expect(ids).toEqual(['3P-KAN-01'])
  })

  it('skips README.md, which is documentation about the specs rather than a spec', () => {
    fs.writeFileSync(path.join(tmp, 'README.md'), '`3P-KAN-01` not a real clause\n')
    expect(listDocuments(tmp, SPEC_KIND, '')).toEqual([])
  })
})

describe('SPEC — the widened declaration grammar + the declaration-vs-citation pick (TRDD-IG1MMYFA)', () => {
  function specRecordsOf(body: string) {
    const file = path.join(tmp, 'x-spec.md')
    fs.writeFileSync(file, body, 'utf-8')
    const doc = readDocument(file, SPEC_KIND, '')!
    return [...recordsOf(doc, SPEC_KIND)]
  }

  it('yields a record for EVERY measured id family the old grammar under-matched', () => {
    // One line per family from the 2026-08-15 full-corpus inventory. The old
    // `{2,4}-{2,8}-\d{2}` shape matched only the 3P control.
    const recs = specRecordsOf(
      [
        '`3P-KAN-06` **control** — the shape the old grammar already matched.',
        '`TERM-01` **two-segment** — governance-spec terminology family.',
        '`RP-SKILL-MENU-01` four segments, no bold name in the live corpus.',
        '`RP-ASSISTANT-01` nine-char middle segment.',
        '`STS-R0.1` **dotted-tail** — scenario-tests rule family.',
        '`RP-TOML-SHAPE` word tail, no digits at all.',
      ].join('\n') + '\n',
    )
    expect(recs.map((r) => r.id)).toEqual([
      '3P-KAN-06',
      'TERM-01',
      'RP-SKILL-MENU-01',
      'RP-ASSISTANT-01',
      'STS-R0.1',
      'RP-TOML-SHAPE',
    ])
  })

  it('still EXCLUDES the measured non-clause shapes', () => {
    const recs = specRecordsOf(
      [
        '`R17.1` a GOVERNANCE-RULES id — a different namespace, cited not declared.',
        '`STS-<FAMILY>-NN` the template meta-token.',
        '`yarn build` ordinary prose in backticks.',
        '`3-pillars-spec.md` a filename.',
        'prose citing `3P-KAN-06` mid-line yields nothing.',
      ].join('\n') + '\n',
    )
    expect(recs).toEqual([])
  })

  it('the bold-named declaration WINS over an EARLIER line-leading citation (the GOV-INV-16 case)', () => {
    const recs = specRecordsOf(
      [
        '`GOV-INV-16` core-plugin-currency and others are upheld through the sweep.',
        '',
        '`GOV-INV-16` **core-plugin-currency** — the real declaration, later in the file.',
      ].join('\n') + '\n',
    )
    expect(recs).toHaveLength(1)
    expect(recs[0].line).toBe(3)
  })

  it('the bold-named declaration wins over a LATER citation (the AIO-RULE-01 case)', () => {
    const recs = specRecordsOf(
      [
        '`AIO-RULE-01` **one-function** — the declaration.',
        '`AIO-RULE-01` is the only path.',
      ].join('\n') + '\n',
    )
    expect(recs).toHaveLength(1)
    expect(recs[0].line).toBe(1)
  })

  it('with no bold form anywhere, the FIRST match is the record (single and multiple)', () => {
    const recs = specRecordsOf(
      [
        '`RP-SKILL-MENU-01` an unnamed single-occurrence declaration.',
        '`AIO-CHK-01` first unnamed occurrence.',
        '`AIO-CHK-01` second unnamed occurrence — the lint reports this as ambiguous.',
      ].join('\n') + '\n',
    )
    expect(recs.map((r) => [r.id, r.line])).toEqual([
      ['RP-SKILL-MENU-01', 1],
      ['AIO-CHK-01', 2],
    ])
  })
})

describe('PRRD — N rules in ONE file, id in the bullet line', () => {
  const PRRD = [
    '---',
    'prrd-version: 2.0',
    '---',
    '## GOLDEN',
    '',
    '- **G1.2** — the golden rule text.',
    '',
    '## SILVER',
    '',
    '- **S2.1** — the first silver rule.',
    '- **S64.134** — a rule with a large number and version.',
    '',
    'Prose that cites PRRD G1.2 without declaring it.',
  ].join('\n')

  it('yields one record per rule line, with its FILE line number', () => {
    fs.writeFileSync(path.join(tmp, 'PRRD.md'), PRRD)
    const recs = [...walkRecords(tmp, PRRD_KIND)]
    expect(recs.map((r) => r.id)).toEqual(['G1.2', 'S2.1', 'S64.134'])

    // CORRECTED 2026-08-04 (TRDD-D7KVF4HQ). This asserted `3` — the BODY line — with a
    // comment explaining that frontmatter is stripped by the parser. That is true of
    // the parser and wrong for every consumer: `index-build.ts` stores this number to
    // jump to a declaration, and `prrdgrep edit` hands it to `replaceAtLines`, whose
    // compare-and-swap reads the FILE. A body-relative value there does not misprint a
    // line, it aims a WRITE three lines off. Do not "restore" the old expectation.
    expect(recs[0].line).toBe(6)
    // Derived from the FILE rather than from a constant, so this cannot silently drift
    // back: the assertion above pins the number, this one pins that it MEANS something.
    const raw = fs.readFileSync(path.join(tmp, 'PRRD.md'), 'utf-8').split('\n')
    for (const rec of recs) expect(raw[rec.line! - 1]).toBe(rec.text)

    expect(recs.every((r) => r.filePath.endsWith('PRRD.md'))).toBe(true)
  })

  it('every record carries the ONE document frontmatter — the PRRD has no per-rule frontmatter', () => {
    fs.writeFileSync(path.join(tmp, 'PRRD.md'), PRRD)
    const recs = [...walkRecords(tmp, PRRD_KIND)]
    expect(recs).toHaveLength(3)
    expect(recs.every((r) => r.frontmatter['prrd-version'] === 2.0)).toBe(true)
  })

  it('normalizeId drops the tier letter, because promote/demote flips it and the NUMBER is the id', () => {
    // The IND base makes this load-bearing: "promote/demote flips ONLY the letter;
    // the number and version are unchanged", so a citation by number must resolve
    // regardless of the tier the rule currently sits in. G7 and S7 CANNOT coexist.
    expect(PRRD_KIND.normalizeId('G64.134')).toBe(PRRD_KIND.normalizeId('S64.134'))
    expect(PRRD_KIND.normalizeId('PRRD G1.2')).toBe('1.2')
  })

  it('a file that is not PRRD.md is not a PRRD document', () => {
    fs.writeFileSync(path.join(tmp, 'NOTES.md'), PRRD)
    expect(listDocuments(tmp, PRRD_KIND, '')).toEqual([])
  })
})

describe('TRDD — the 1:1 case goes through the same code path', () => {
  it('a per-document kind yields exactly one record, with no line number', () => {
    const zone = path.join(tmp, 'tasks')
    fs.mkdirSync(zone)
    const name = 'TRDD-20260101_000000+0100-ABCD1234-x.md'
    fs.writeFileSync(path.join(zone, name), '---\ncolumn: dev\n---\n\nbody\n')
    const doc = readDocument(path.join(zone, name), TRDD_KIND, 'tasks')!
    const recs = [...recordsOf(doc, TRDD_KIND)]
    expect(recs).toHaveLength(1)
    expect(recs[0].id).toBe('ABCD1234')
    expect(recs[0].line).toBeNull()
  })
})

describe('fail-loud parity holds for EVERY kind, not just TRDD', () => {
  it('names the KIND in the missing-corpus error, so the message is actionable', () => {
    expect(() => assertCorpusRoot(path.join(tmp, 'nope'), PRRD_KIND)).toThrow(/no PRRD corpus at/)
    expect(() => assertCorpusRoot(path.join(tmp, 'nope'), SPEC_KIND)).toThrow(/no spec corpus at/)
    expect(() => assertCorpusRoot(path.join(tmp, 'nope'), TRDD_KIND)).toThrow(/no TRDD corpus at/)
  })

  it('a missing zone is legal and yields [] — a fresh project has no refused/', () => {
    fs.mkdirSync(path.join(tmp, 'tasks'))
    expect(listDocuments(tmp, TRDD_KIND, 'refused')).toEqual([])
  })

  it('an UNREADABLE zone THROWS rather than reading as empty', () => {
    // ENOTDIR rather than chmod: a chmod-based fixture passes vacuously when the
    // suite runs as root, so it would prove nothing on CI.
    fs.writeFileSync(path.join(tmp, 'tasks'), 'I am a file, not a directory')
    expect(() => listDocuments(tmp, TRDD_KIND, 'tasks')).toThrow(/cannot read TRDD zone/)
  })

  it('positive control: the same call SUCCEEDS on a real directory', () => {
    // Without this, every throw above could be passing for the wrong reason.
    fs.mkdirSync(path.join(tmp, 'tasks'))
    expect(listDocuments(tmp, TRDD_KIND, 'tasks')).toEqual([])
    expect(() => assertCorpusRoot(tmp, TRDD_KIND)).not.toThrow()
  })
})

describe('findRecord', () => {
  it('resolves a per-line id (PRRD) through the body', () => {
    fs.writeFileSync(path.join(tmp, 'PRRD.md'), '---\nx: 1\n---\n- **S2.1** — text.\n')
    expect(findRecord(tmp, PRRD_KIND, 'S2.1')?.id).toBe('S2.1')
    // And by bare number, since the letter is not part of the identity.
    expect(findRecord(tmp, PRRD_KIND, '2.1')?.id).toBe('S2.1')
  })

  it('returns null for an id that is absent, rather than throwing', () => {
    fs.writeFileSync(path.join(tmp, 'PRRD.md'), '---\nx: 1\n---\n- **S2.1** — text.\n')
    expect(findRecord(tmp, PRRD_KIND, 'S9.9')).toBeNull()
  })
})

describe('the reader must not accumulate the corpus (TRDD-BQC8NQSW)', () => {
  // gray-matter keeps a MODULE-LEVEL cache keyed by the whole file text and stores the
  // parsed file including `orig`, so every document ever parsed is retained for the life
  // of the process — process memory then tracks TOTAL CORPUS BYTES no matter how little
  // the caller keeps. It skips the cache whenever an options object is passed, which is
  // why `readDocument` passes one.
  //
  // Asserting the cache is EMPTY (white-box) rather than measuring memory is deliberate:
  // a heap assertion is flaky and would be tuned until it passed, whereas this fails the
  // instant someone "simplifies" the options argument away — which is the only way this
  // defect comes back.
  const cacheOf = () =>
    Object.keys((matter as unknown as { cache: Record<string, unknown> }).cache ?? {})

  beforeEach(() => {
    ;(matter as unknown as { clearCache(): void }).clearCache()
  })

  it('reading a document leaves gray-matter’s module cache EMPTY', () => {
    const f = path.join(tmp, 'TRDD-20260101_000000+0100-AAAAAAAA-x.md')
    fs.writeFileSync(f, `---\ntrdd-id: AAAAAAAA\ncolumn: dev\n---\n${'body '.repeat(4000)}`)
    expect(readDocument(f, TRDD_KIND, 'tasks')?.frontmatter.column).toBe('dev')
    expect(cacheOf()).toHaveLength(0)
  })

  it('positive control: gray-matter DOES cache when called the ordinary way', () => {
    // Without this the test above passes on any gray-matter that simply has no cache,
    // and would keep passing if the dependency changed under us — proving nothing.
    matter('---\ntrdd-id: BBBBBBBB\n---\nbody')
    expect(cacheOf()).toHaveLength(1)
  })

  it('parsing N documents keeps the cache at zero, not at N', () => {
    // The failure mode is proportional to corpus SIZE, so one document cannot show it.
    for (let i = 0; i < 25; i++) {
      const f = path.join(tmp, `TRDD-20260101_000000+0100-AAAAAA${String(i).padStart(2, '0')}-x.md`)
      fs.writeFileSync(f, `---\ntrdd-id: AAAAAA${String(i).padStart(2, '0')}\ncolumn: dev\n---\nbody\n`)
    }
    expect([...walkRecords(tmp, TRDD_KIND, [''])].length).toBe(25)
    expect(cacheOf()).toHaveLength(0)
  })
})

describe('listDocuments returns a STABLE order (TRDD-L55IYKL4)', () => {
  /**
   * The OS will not hand back an unsorted directory on demand — APFS happens to
   * return sorted names, so a test that merely asserts `got === got.sort()` on a
   * real temp dir PASSES WITH THE SORT REMOVED. That is the decorative guard this
   * repo has been bitten by before, so the unsorted input is INJECTED instead: it
   * is the one input the filesystem refuses to vary, and ext4's hash order is the
   * real-world case being defended against.
   */
  const UNSORTED = [
    'TRDD-20260101_000000+0000-ZZZZZZZZ-zulu.md',
    'TRDD-20260101_000000+0000-AAAAAAAA-alpha.md',
    'TRDD-20260101_000000+0000-MMMMMMMM-mike.md',
  ]

  it('sorts names the filesystem handed back out of order', () => {
    const spy = vi.spyOn(fs, 'readdirSync').mockReturnValue(UNSORTED as never)
    try {
      const got = listDocuments('/corpus', TRDD_KIND, 'tasks').map((p) => path.basename(p))
      expect(got).toEqual([...UNSORTED].sort())
      // Spelled out, so the assertion cannot be satisfied by an already-sorted input:
      // the FIRST name must be the alpha one, which the fixture handed back SECOND.
      expect(got[0]).toMatch(/AAAAAAAA/)
    } finally {
      spy.mockRestore()
    }
  })

  it('still filters non-documents while sorting — the sort must not widen the set', () => {
    const spy = vi
      .spyOn(fs, 'readdirSync')
      .mockReturnValue([...UNSORTED, 'README.md', 'notes.txt'] as never)
    try {
      const got = listDocuments('/corpus', TRDD_KIND, 'tasks').map((p) => path.basename(p))
      expect(got).toHaveLength(3)
      expect(got.join()).not.toMatch(/README|notes/)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('a record line is FILE-relative, not body-relative (TRDD-D7KVF4HQ)', () => {
  /**
   * `doc.body` is gray-matter's `content`, which has the frontmatter STRIPPED — so a
   * line counted in it is NOT the line the file has. Every per-line pillar document
   * carries frontmatter, so the two ALWAYS disagree.
   *
   * This shipped as a body-relative number and nothing caught it, because both
   * consumers only ever PRINTED it: the CLI in a `file:line` string and
   * `index-build.ts` into a column nobody had jumped from yet. It surfaced the moment
   * a third consumer ACTED on it — `prrdgrep edit` aims `replaceAtLines` at that line,
   * and the CAS refused an edit whose expected text sat three lines up.
   *
   * A refusal was the lucky outcome. Had line N+offset happened to contain the
   * expected substring — trivially likely in a corpus of similarly-shaped bullets —
   * the edit would have SILENTLY REWRITTEN THE WRONG RULE.
   */
  const PRRD_WITH_FRONTMATTER = [
    '---', // 1
    'project-id: fixture', // 2
    '---', // 3
    '', // 4
    '# PRRD', // 5
    '', // 6
    '- **G1.1** — the golden rule.', // 7
    '- **S7.4** — the silver rule.', // 8
    '', // 9
  ].join('\n')

  it('reports the line the FILE has, verified against the raw file rather than a constant', () => {
    const root = path.join(tmp, 'requirements')
    fs.mkdirSync(root, { recursive: true })
    const file = path.join(root, 'PRRD.md')
    fs.writeFileSync(file, PRRD_WITH_FRONTMATTER, 'utf-8')

    const raw = fs.readFileSync(file, 'utf-8').split('\n')
    const recs = [...walkRecords(root, PRRD_KIND)]
    expect(recs.map((r) => r.id)).toEqual(['G1.1', 'S7.4'])

    // Derived from the FILE, never from the implementation under test — an expectation
    // computed by calling the same code cannot detect that code changing.
    for (const rec of recs) {
      expect(raw[rec.line! - 1]).toBe(rec.text)
    }
    expect(recs.map((r) => r.line)).toEqual([7, 8])
  })

  it('POSITIVE CONTROL — a document with NO frontmatter gets offset 0, so the fix is not a constant fudge', () => {
    // Without this, `line + 3` would satisfy the test above just as well.
    const root = path.join(tmp, 'specs')
    fs.mkdirSync(root, { recursive: true })
    const file = path.join(root, 'x-spec.md')
    fs.writeFileSync(file, ['`3P-AAA-01` **first** — no frontmatter here.', ''].join('\n'), 'utf-8')

    const [rec] = [...walkRecords(root, SPEC_KIND)]
    expect(rec.line).toBe(1)
    expect(readDocument(file, SPEC_KIND, '')!.bodyLineOffset).toBe(0)
  })

  it('the offset equals the frontmatter block height', () => {
    const root = path.join(tmp, 'requirements')
    fs.mkdirSync(root, { recursive: true })
    const file = path.join(root, 'PRRD.md')
    fs.writeFileSync(file, PRRD_WITH_FRONTMATTER, 'utf-8')
    // `---`, `project-id:`, `---` — and gray-matter also consumes the newline that
    // ends the closing delimiter, so body line 1 is file line 4.
    expect(readDocument(file, PRRD_KIND, '')!.bodyLineOffset).toBe(3)
  })
})
