import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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
    // 38 line-anchored declarations, counted independently with grep before this
    // test was written. A fixture of my own making could not have caught a wrong
    // regex; the live corpus can.
    expect(threeP.length).toBe(38)
    expect(threeP.every((r) => /^3P-[A-Z]+-\d{2}$/.test(r.id))).toBe(true)
    // Every record carries the line it was declared on — that is what a lint reports.
    expect(threeP.every((r) => typeof r.line === 'number' && r.line! > 0)).toBe(true)
  })

  it('the whole specs corpus yields records from MORE than one file', () => {
    const recs = [...walkRecords(path.join(REPO, 'design/specs'), SPEC_KIND)]
    const files = new Set(recs.map((r) => path.basename(r.filePath)))
    expect(files.size).toBeGreaterThan(1)
    expect(recs.length).toBeGreaterThan(38)
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

  it('yields one record per rule line, with its line number', () => {
    fs.writeFileSync(path.join(tmp, 'PRRD.md'), PRRD)
    const recs = [...walkRecords(tmp, PRRD_KIND)]
    expect(recs.map((r) => r.id)).toEqual(['G1.2', 'S2.1', 'S64.134'])
    // Frontmatter is stripped by the parser, so line 1 of the body is `## GOLDEN`.
    expect(recs[0].line).toBe(3)
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
