/**
 * 3P-TRDD-11 missing-column-fallback / PRRD G11.1 (USER 2026-08-23).
 *
 * A card with no `column:` used to be repaired to `todo`. That was right only while `design`
 * sat AFTER `todo`; since 3.0.0 `todo` asserts *approved AND designed*, so the fallback is
 * three-way. These drive the REAL helper and the REAL lint message — the message is what a
 * human reads before running `--fix`, so a fix that lands a column the report did not name is
 * the asymmetry the shared definition exists to prevent.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { defaultColumnForMissing, lintCorpus } from '@/lib/trdd-doctor'

describe('defaultColumnForMissing — the three-way rule', () => {
  it('lands an UNAPPROVED card in backburner', () => {
    expect(defaultColumnForMissing({})).toBe('backburner')
    expect(defaultColumnForMissing({ approved: false })).toBe('backburner')
    expect(defaultColumnForMissing({ approved: 'rejected' })).toBe('backburner')
  })

  it('lands an APPROVED card with no design body in design', () => {
    expect(defaultColumnForMissing({ approved: true })).toBe('design')
    expect(defaultColumnForMissing({ approved: 'true', 'design-included': 'false' })).toBe('design')
  })

  it('lands an APPROVED card that already carries a design body in design_ai_review', () => {
    expect(defaultColumnForMissing({ approved: true, 'design-included': 'true' })).toBe('design_ai_review')
    expect(defaultColumnForMissing({ approved: true, 'design-included': true })).toBe('design_ai_review')
  })

  it('design-included alone never promotes an UNAPPROVED card — approval gates the branch', () => {
    // The order of the two tests inside the helper is load-bearing: reading design-included
    // first would queue an unapproved card into a design-review column, which is a false
    // claim about approval, not merely an early move.
    expect(defaultColumnForMissing({ 'design-included': 'true' })).toBe('backburner')
    expect(defaultColumnForMissing({ approved: false, 'design-included': 'true' })).toBe('backburner')
  })

  it('accepts only a LITERAL true — a value it cannot parse means "cannot prove approval"', () => {
    for (const v of ['TRUE ', 'yes', '1', 'maybe', null, undefined, '']) {
      expect(defaultColumnForMissing({ approved: v as unknown })).toBe(
        String(v ?? '').trim().toLowerCase() === 'true' ? 'design' : 'backburner',
      )
    }
  })
})

describe('trdd-doctor COLUMN-MISSING — the message names the column --fix will insert', () => {
  let tmp: string
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trdd-fallback-'))
    for (const z of ['proposals', 'tasks', 'archived', 'refused']) {
      fs.mkdirSync(path.join(tmp, z), { recursive: true })
    }
  })
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

  function columnlessCard(id: string, extraFm: string): string {
    return `---\ntrdd-id: ${id}\ntitle: Title for ${id}\ncreated: 2026-01-01T00:00:00+0100\nupdated: 2026-01-01T00:00:00+0100\nassignee: someone\ncreated-by: someone\nmin-approval-requirement: none\n${extraFm}---\n\n# TRDD-${id} — Title for ${id}\n\nproblem statement\n`
  }

  const msgFor = (id: string, extraFm: string) => {
    fs.writeFileSync(path.join(tmp, 'tasks', `TRDD-20260101_000000+0100-${id}-x.md`), columnlessCard(id, extraFm), 'utf8')
    const f = lintCorpus(tmp).findings.filter((x) => x.rule === 'COLUMN-MISSING')
    expect(f).toHaveLength(1) // positive control: the rule fired at all
    return f[0].message
  }

  it('names backburner for an unapproved card', () => {
    expect(msgFor('AAAA0001', '')).toContain('`backburner`')
  })
  it('names design for an approved card with no design body', () => {
    expect(msgFor('AAAA0002', 'approved: true\n')).toContain('`design`')
  })
  it('names design_ai_review for an approved card that already has one', () => {
    expect(msgFor('AAAA0003', 'approved: true\ndesign-included: "true"\n')).toContain('`design_ai_review`')
  })
})
