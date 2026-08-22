/**
 * `DATE-NOT-LOCAL-OFFSET` — the guard for TRDD-S13L6R9R.
 *
 * Five TRDD write routes stamped `toISOString()` for weeks, so the corpus grew a second,
 * UTC-`Z` dialect of its own mandated date format. The write side is fixed (`isoLocal()`
 * is now the single stamp); this is what stops a SIXTH path repeating it in silence.
 *
 * The first test is a POSITIVE CONTROL ON THE DETECTOR ITSELF, and it is the load-bearing
 * one. The rule detects an off-format date by a measured property of the parser — the
 * mandated `%z` offset is colon-less, which YAML 1.1's timestamp grammar rejects, so a
 * conforming value survives as a `string` and a non-conforming one is coerced to a `Date`.
 * That is structural, not incidental, but it is still a property of a dependency: if a
 * gray-matter upgrade ever parsed `+0200`, the detector would report CLEAN forever and
 * nothing else in this file could tell. The control reddens instead.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import matter from 'gray-matter'
import { lintCorpus, fixCorpus } from '@/lib/trdd-doctor'

let tmp: string

function card(name: string, fm: string[]): void {
  const dir = path.join(tmp, 'tasks')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, name),
    ['---', ...fm, '---', '', '# A card', '', '## Acceptance', '', '- [x] done', ''].join('\n'),
    'utf8',
  )
}

const BASE = (id: string) => [
  `trdd-id: ${id}`,
  `title: Title for ${id}`,
  'column: dev',
  'created: 2026-01-01T09:00:00+0100',
  'current-owner: main',
  'task-type: feature',
  'npt: []',
  'eht: []',
]

const dateFindings = (dir: string) =>
  lintCorpus(dir).findings.filter((f) => f.rule === 'DATE-NOT-LOCAL-OFFSET')

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trdd-datefmt-'))
})
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('DATE-NOT-LOCAL-OFFSET', () => {
  it('POSITIVE CONTROL — the parser still types conforming and off-format dates differently', () => {
    const typeOf = (line: string) => {
      const v = matter(`---\n${line}\n---\n`).data[line.split(':')[0]]
      return v instanceof Date ? 'Date' : typeof v
    }
    // Conforming (colon-less offset) — YAML 1.1 cannot parse it as a timestamp, so it
    // reaches the rule as a raw string and is invisible to `instanceof Date`.
    expect(typeOf('updated: 2026-08-22T17:31:23+0200')).toBe('string')
    expect(typeOf('updated: 2026-08-22T15:31:23+0000')).toBe('string')
    // Off-format — coerced to a Date, which is exactly what the rule keys on.
    expect(typeOf('updated: 2026-08-22T15:31:24.411Z')).toBe('Date')
    expect(typeOf('updated: 2026-08-22T15:31:24Z')).toBe('Date')
    expect(typeOf('updated: 2026-08-22T17:31:23+02:00')).toBe('Date')
  })

  it('flags a UTC-Z frontmatter datetime, naming the field', () => {
    card('TRDD-20260101_090000+0100-AAAA1111-z-form.md', [
      ...BASE('AAAA1111'),
      'updated: 2026-08-22T15:31:24.411Z',
    ])
    const found = dateFindings(tmp)
    expect(found).toHaveLength(1)
    expect(found[0].message).toContain('`updated:`')
    expect(found[0].autofixable).toBe(true)
  })

  it('does NOT flag a conforming local-offset datetime', () => {
    card('TRDD-20260101_090000+0100-BBBB2222-conforming.md', [
      ...BASE('BBBB2222'),
      'updated: 2026-08-22T17:31:23+0200',
    ])
    expect(dateFindings(tmp)).toHaveLength(0)
  })

  it('does NOT flag `review-after:`, which is a DATE and not a datetime', () => {
    // YAML coerces a bare `YYYY-MM-DD` to a Date too. Flagging it would let `--fix` rewrite
    // a park field into a datetime and corrupt a grammar the IND rule requires to fail OPEN.
    // Guarded by scope (no time-of-day ⇒ not a datetime), so this must stay silent even
    // though the value IS a Date — which is why the assertion is here and not assumed.
    card('TRDD-20260101_090000+0100-CCCC3333-parked.md', [
      ...BASE('CCCC3333'),
      'updated: 2026-08-22T17:31:23+0200',
      'review-after: 2026-09-01',
    ])
    expect(dateFindings(tmp)).toHaveLength(0)
  })

  it('--fix CONVERTS the instant and leaves the sort key alone (mechanical, no bump)', () => {
    const file = 'TRDD-20260101_090000+0100-DDDD4444-convert.md'
    card(file, [...BASE('DDDD4444'), 'updated: 2026-08-22T15:31:24.411Z'])
    const results = fixCorpus(tmp)
    expect(results).toHaveLength(1)

    // MECHANICAL — a mechanical repair must NOT bump `updated:`, or a format pass silently
    // reorders the board (TRDD-R6R9XHZI, the damage this fixer already caused once).
    expect(results[0].bumped).toBe(false)

    const after = fs.readFileSync(path.join(tmp, 'tasks', file), 'utf8')
    const line = after.match(/^updated: (.+)$/m)![1]
    expect(line).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{4}$/)
    // The SAME instant, truncated to the second — never `now`. This is the property the
    // whole repair rests on: a fixer that stamped the clock would pass every assertion
    // above and destroy the ordering it claims to preserve.
    expect(Date.parse(line)).toBe(Date.parse('2026-08-22T15:31:24Z'))
    expect(dateFindings(tmp)).toHaveLength(0)
  })

  it('ONE FORMATTER — every TRDD write route takes its instant from isoLocal', () => {
    // TRDD-ZRRDCQ52's actual ask: "one formatter, used by every writer... so a rename or a
    // new verb cannot reintroduce a third". Three spellings existed (the local-offset stamp
    // in trdd-create, `toISOString()` in trdd-store, and a `.replace(/\.\d+Z$/, '+0000')` in
    // trdd-doctor) and the write path picked the wrong one.
    //
    // This is a CALL-SITE test on purpose. Every store verb takes `iso` as a REQUIRED
    // parameter, so the store never chooses a format and a test driving those verbs would
    // pin nothing — it would assert the value the test itself passed in. The decision lives
    // entirely at the routes, so that is where the invariant has to be checked.
    //
    // Asserted POSITIVELY (this file DOES reach isoLocal), which fails safe: rename or delete
    // `isoLocal` and this reddens. A negative "contains no toISOString" alone would go blind
    // the moment someone spelled the drift a fourth way.
    const routes = fs
      .readdirSync(path.join(process.cwd(), 'app/api/trdd/[id]'), { withFileTypes: true })
      .flatMap((e) =>
        e.isDirectory()
          ? [path.join('app/api/trdd/[id]', e.name, 'route.ts')]
          : e.name === 'route.ts'
            ? [path.join('app/api/trdd/[id]', e.name)]
            : [],
      )
      .filter((p) => fs.existsSync(path.join(process.cwd(), p)))

    const WRITE_VERB = /\b(editTrdd|promoteTrdd|refuseTrdd|archiveTrdd|advanceColumn)\b/
    const writers = routes.filter((p) => WRITE_VERB.test(fs.readFileSync(path.join(process.cwd(), p), 'utf8')))
    // Non-vacuity: a glob that matched nothing would make every assertion below `[] === []`.
    expect(writers.length).toBeGreaterThanOrEqual(5)

    const offenders = writers.filter((p) => {
      const src = fs.readFileSync(path.join(process.cwd(), p), 'utf8')
      return !/isoLocal\s*\(/.test(src) || /new Date\(\)\.toISOString\(\)/.test(src)
    })
    expect(offenders).toEqual([])
  })

  it('CORPUS — design/ carries no off-format frontmatter datetime', () => {
    const report = lintCorpus(path.join(process.cwd(), 'design'))
    // Non-vacuity first: an empty corpus would make the assertion below `[] === []`.
    expect(report.scanned).toBeGreaterThan(100)
    const found = report.findings.filter((f) => f.rule === 'DATE-NOT-LOCAL-OFFSET')
    expect(found.map((f) => `${path.basename(f.filePath)} — ${f.message}`)).toEqual([])
  })
})
