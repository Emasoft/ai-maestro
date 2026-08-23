/**
 * 3P-TRDD-13 design-lives-in-the-card — the divider + its four state fields.
 *
 * All four fields (`design-included`, `design-approved`, `first-design-draft`,
 * `last-design-revision`) are OPTIONAL: a card with none of them and no divider is
 * CONFORMANT and must raise nothing here.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { lintCorpus } from '@/lib/trdd-doctor'

let tmp: string

function write(zone: string, name: string, content: string) {
  const dir = path.join(tmp, zone)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, name), content, 'utf8')
}

function card(id: string, over: Record<string, string> = {}, extraBody = ''): string {
  const fm: Record<string, string> = {
    'trdd-id': id,
    title: `Title for ${id}`,
    column: 'dev',
    created: '2026-01-01T00:00:00+0100',
    updated: '2026-01-01T00:00:00+0100',
    assignee: 'someone',
    'created-by': 'someone',
    'min-approval-requirement': 'none',
    ...over,
  }
  const lines = Object.entries(fm).map(([k, v]) => `${k}: ${v}`)
  return `---\n${lines.join('\n')}\n---\n\n# TRDD-${id} — Title for ${id}\n\nproblem statement\n${extraBody}`
}

const idsOf = (r: ReturnType<typeof lintCorpus>, rule: string) =>
  r.findings.filter((f) => f.rule === rule).map((f) => f.id)

describe('trdd-doctor — 3P-TRDD-13 design fields', () => {
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trdd-doctor-design-'))
    for (const z of ['proposals', 'tasks', 'archived', 'refused']) {
      fs.mkdirSync(path.join(tmp, z), { recursive: true })
    }
  })
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

  it('a card with none of the four fields and no divider is CONFORMANT — zero findings', () => {
    write('tasks', 'TRDD-20260101_000000+0100-AAAAAAAA-x.md', card('AAAAAAAA'))
    expect(lintCorpus(tmp).findings).toEqual([])
  })

  it('DESIGN-INCLUDED-MISMATCH — divider present, `design-included:` not true', () => {
    write(
      'tasks',
      'TRDD-20260101_000000+0100-BBBBBBBB-x.md',
      card('BBBBBBBB', {}, '\n<!-- @trdd:design-body -->\ndesign text\n'),
    )
    expect(idsOf(lintCorpus(tmp), 'DESIGN-INCLUDED-MISMATCH')).toContain('BBBBBBBB')
  })

  it('DESIGN-INCLUDED-MISMATCH — `design-included: true` but no divider in the body', () => {
    write(
      'tasks',
      'TRDD-20260101_000000+0100-CCCCCCCC-x.md',
      card('CCCCCCCC', { 'design-included': 'true' }),
    )
    expect(idsOf(lintCorpus(tmp), 'DESIGN-INCLUDED-MISMATCH')).toContain('CCCCCCCC')
  })

  it('divider + `design-included: true` agree — no DESIGN-INCLUDED-MISMATCH', () => {
    write(
      'tasks',
      'TRDD-20260101_000000+0100-DDDDDDDD-x.md',
      card('DDDDDDDD', { 'design-included': 'true' }, '\n<!-- @trdd:design-body -->\ndesign text\n'),
    )
    expect(idsOf(lintCorpus(tmp), 'DESIGN-INCLUDED-MISMATCH')).not.toContain('DDDDDDDD')
  })

  it('DESIGN-BODY-DIVIDER-DUPLICATE — a second divider is ambiguous', () => {
    write(
      'tasks',
      'TRDD-20260101_000000+0100-EEEEEEEE-x.md',
      card(
        'EEEEEEEE',
        { 'design-included': 'true' },
        '\n<!-- @trdd:design-body -->\ndesign text\n<!-- @trdd:design-body -->\nmore\n',
      ),
    )
    expect(idsOf(lintCorpus(tmp), 'DESIGN-BODY-DIVIDER-DUPLICATE')).toContain('EEEEEEEE')
  })

  it('DESIGN-APPROVED-WITHOUT-INCLUDED — approved before it exists', () => {
    write(
      'tasks',
      'TRDD-20260101_000000+0100-FFFFFFFF-x.md',
      card('FFFFFFFF', { 'design-approved': 'true' }),
    )
    expect(idsOf(lintCorpus(tmp), 'DESIGN-APPROVED-WITHOUT-INCLUDED')).toContain('FFFFFFFF')
  })

  it('DESIGN-DRAFT-WITHOUT-INCLUDED — a draft timestamp naming a design that is not declared', () => {
    write(
      'tasks',
      'TRDD-20260101_000000+0100-GGGGGGGG-x.md',
      card('GGGGGGGG', { 'first-design-draft': '2026-01-01T00:00:00+0100' }),
    )
    expect(idsOf(lintCorpus(tmp), 'DESIGN-DRAFT-WITHOUT-INCLUDED')).toContain('GGGGGGGG')
  })

  it('DESIGN-REVISION-BEFORE-DRAFT — a revision cannot precede the draft it revises', () => {
    write(
      'tasks',
      'TRDD-20260101_000000+0100-HHHHHHHH-x.md',
      card(
        'HHHHHHHH',
        {
          'design-included': 'true',
          'first-design-draft': '2026-01-02T00:00:00+0100',
          'last-design-revision': '2026-01-01T00:00:00+0100',
        },
        '\n<!-- @trdd:design-body -->\ndesign text\n',
      ),
    )
    expect(idsOf(lintCorpus(tmp), 'DESIGN-REVISION-BEFORE-DRAFT')).toContain('HHHHHHHH')
  })

  it('a fully-populated, internally-consistent design card is clean', () => {
    write(
      'tasks',
      'TRDD-20260101_000000+0100-IIIIIIII-x.md',
      card(
        'IIIIIIII',
        {
          'design-included': 'true',
          'design-approved': 'true',
          'first-design-draft': '2026-01-01T00:00:00+0100',
          'last-design-revision': '2026-01-02T00:00:00+0100',
        },
        '\n<!-- @trdd:design-body -->\ndesign text\n',
      ),
    )
    expect(lintCorpus(tmp).findings).toEqual([])
  })
})
