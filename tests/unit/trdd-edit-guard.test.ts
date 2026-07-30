/**
 * TRDD-SCMPWF6R — the validate-before-write gate refuses corruption, not merely
 * detects it after the fact.
 *
 * Two halves:
 *   1. UNIT — `validateTrddFieldEdits` exercised directly, one rule at a time,
 *      each with a NEGATIVE case (the rule fires) and a POSITIVE case (a legal
 *      edit still passes) so a rule that can never fire is never mistaken for
 *      coverage.
 *   2. WIRING — `editTrdd` (the real write funnel in `lib/trdd-store.ts`) is
 *      proven to call the gate BEFORE its first `fs.writeFileSync`: a refused
 *      write leaves the file on disk byte-identical.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { validateTrddFieldEdits } from '@/lib/trdd-edit-guard'
import { editTrdd, findTrdd } from '@/lib/trdd-store'

// Deliberately far in the PAST — several tests set `updated: ISO` while exercising an
// unrelated rule, and a future-dated ISO here would make the future-date check fire
// instead of (or alongside) the rule under test.
const ISO = '2026-01-15T08:00:00.000Z'

function baseFm(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const fm: Record<string, unknown> = {
    'trdd-id': 'AAAAAAAA',
    title: 'Some title',
    column: 'dev',
    created: '2026-01-01T00:00:00+0100',
    updated: '2026-01-01T00:00:00+0100',
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete fm[k]
    else fm[k] = v
  }
  return fm
}

const resolveAll = () => true
const resolveNone = () => false

describe('validateTrddFieldEdits — column vocabulary', () => {
  it('refuses an out-of-vocabulary column value, naming the value and the legal set', () => {
    const r = validateTrddFieldEdits({ column: 'not-started', updated: ISO }, baseFm(), resolveAll)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain('not-started')
      expect(r.error).toContain('column')
    }
  })

  it('accepts a ratified column value (positive control)', () => {
    const r = validateTrddFieldEdits({ column: 'testing', updated: ISO }, baseFm(), resolveAll)
    expect(r.ok).toBe(true)
  })
})

describe('validateTrddFieldEdits — column must never end up ABSENT', () => {
  it('refuses a write that explicitly blanks column', () => {
    const r = validateTrddFieldEdits({ column: '', updated: ISO }, baseFm(), resolveAll)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/ABSENT/)
  })

  it('refuses an edit of an unrelated field when the CURRENT card already has no column', () => {
    const current = baseFm({ column: undefined })
    const r = validateTrddFieldEdits({ severity: 'HIGH', updated: ISO }, current, resolveAll)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/ABSENT/)
  })

  it('accepts an edit that supplies the missing column (positive control)', () => {
    const current = baseFm({ column: undefined })
    const r = validateTrddFieldEdits({ column: 'todo', updated: ISO }, current, resolveAll)
    expect(r.ok).toBe(true)
  })
})

describe('validateTrddFieldEdits — blocked-by ⟺ column: blocked', () => {
  it('refuses non-empty blocked-by with a non-blocked resultant column', () => {
    const r = validateTrddFieldEdits(
      { 'blocked-by': '[ABCDEFGH]', updated: ISO },
      baseFm({ column: 'dev' }),
      resolveAll,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/blocked-by/)
  })

  it('refuses column: blocked with an empty resultant blocked-by', () => {
    const r = validateTrddFieldEdits(
      { column: 'blocked', updated: ISO },
      baseFm({ column: 'dev', 'blocked-by': [] }),
      resolveAll,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/blocked-by/)
  })

  it('accepts blocked-by + column: blocked set together (positive control)', () => {
    const r = validateTrddFieldEdits(
      { 'blocked-by': '[ABCDEFGH]', column: 'blocked', updated: ISO },
      baseFm({ column: 'dev' }),
      resolveAll,
    )
    expect(r.ok).toBe(true)
  })
})

describe('validateTrddFieldEdits — referenced TRDD ids must resolve', () => {
  it('refuses a dangling blocked-by id', () => {
    const r = validateTrddFieldEdits(
      { 'blocked-by': '[ZZZZZZZZ]', column: 'blocked', updated: ISO },
      baseFm(),
      resolveNone,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('ZZZZZZZZ')
  })

  it('accepts a resolvable blocked-by id (positive control)', () => {
    const r = validateTrddFieldEdits(
      { 'blocked-by': '[ZZZZZZZZ]', column: 'blocked', updated: ISO },
      baseFm(),
      resolveAll,
    )
    expect(r.ok).toBe(true)
  })

  it('refuses a dangling parent-trdd (bare-scalar reference shape)', () => {
    const r = validateTrddFieldEdits({ 'parent-trdd': 'ZZZZZZZZ', updated: ISO }, baseFm(), resolveNone)
    expect(r.ok).toBe(false)
  })

  it('accepts a resolvable superseded-by (flow-style single-element list shape)', () => {
    const r = validateTrddFieldEdits(
      { 'superseded-by': '[ZZZZZZZZ]', updated: ISO, column: 'superseded' },
      baseFm(),
      resolveAll,
    )
    expect(r.ok).toBe(true)
  })
})

describe('validateTrddFieldEdits — mandate authority', () => {
  it('refuses mandate: true issued below the floor (forged approval)', () => {
    const r = validateTrddFieldEdits(
      { mandate: 'true', 'mandated-by': 'orchestrator', 'min-approval-requirement': 'manager', updated: ISO },
      baseFm(),
      resolveAll,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/forged/)
  })

  it('accepts mandate: true issued at or above the floor (positive control)', () => {
    const r = validateTrddFieldEdits(
      { mandate: 'true', 'mandated-by': 'manager', 'min-approval-requirement': 'manager', updated: ISO },
      baseFm(),
      resolveAll,
    )
    expect(r.ok).toBe(true)
  })

  it('treats mandated-by: self as rank "none", not an unknown rung', () => {
    const r = validateTrddFieldEdits(
      { mandate: 'true', 'mandated-by': 'self', 'min-approval-requirement': 'none', updated: ISO },
      baseFm(),
      resolveAll,
    )
    expect(r.ok).toBe(true)
  })

  it('refuses an authority the ladder does not know', () => {
    const r = validateTrddFieldEdits(
      { mandate: 'true', 'mandated-by': 'nonsense-rank', updated: ISO },
      baseFm(),
      resolveAll,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/does not know/)
  })
})

describe('validateTrddFieldEdits — date fields', () => {
  it('refuses an unparseable updated value', () => {
    const r = validateTrddFieldEdits({ updated: 'not-a-date' }, baseFm(), resolveAll)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/ISO-8601/)
  })

  it('refuses an updated value in the future', () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    const r = validateTrddFieldEdits({ updated: future }, baseFm(), resolveAll)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/future/)
  })

  it('accepts a past ISO updated value (positive control)', () => {
    const r = validateTrddFieldEdits({ updated: '2026-01-02T00:00:00+0100' }, baseFm(), resolveAll)
    expect(r.ok).toBe(true)
  })
})

describe('validateTrddFieldEdits — terminal column freeze (IND base §12)', () => {
  it('refuses editing an unrelated field on a terminal (complete) card', () => {
    const r = validateTrddFieldEdits(
      { severity: 'HIGH', updated: ISO },
      baseFm({ column: 'complete' }),
      resolveAll,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/frozen/)
  })

  it('allows "updated" and "superseded-by" on a terminal card (the two carve-outs)', () => {
    const r = validateTrddFieldEdits(
      { updated: ISO, 'superseded-by': '[ZZZZZZZZ]' },
      baseFm({ column: 'complete' }),
      resolveAll,
    )
    expect(r.ok).toBe(true)
  })
})

// ── WIRING — the real write funnel calls the gate before the first write ──────

let designDir: string

function writeTask(id: string, slug: string, column = 'dev', extraFm = ''): string {
  const dir = path.join(designDir, 'tasks')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `TRDD-20260709_102705+0200-${id}-${slug}.md`)
  fs.writeFileSync(
    file,
    `---
trdd-id: ${id}
title: ${slug} title
column: ${column}
created: 2026-07-09T10:27:08+0200
updated: 2026-07-09T10:27:08+0200
${extraFm}---

# ${id} — body

## Approval log
`,
  )
  return file
}

describe('editTrdd wires the gate before its first write', () => {
  beforeEach(() => {
    designDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trdd-edit-guard-'))
  })
  afterEach(() => {
    fs.rmSync(designDir, { recursive: true, force: true })
  })

  it('refuses column=not-started and leaves the file BYTE-IDENTICAL', () => {
    const id = 'GRDX0001'
    const file = writeTask(id, 'edit-me', 'dev')
    const before = fs.readFileSync(file, 'utf-8')

    const r = editTrdd(designDir, id, { column: 'not-started' }, ISO)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe(400)
      expect(r.error).toContain('not-started')
    }

    const after = fs.readFileSync(file, 'utf-8')
    expect(after).toBe(before)
  })

  it('refuses a dangling blocked-by id and leaves the file BYTE-IDENTICAL', () => {
    const id = 'GRDX0002'
    const file = writeTask(id, 'edit-me-2', 'dev')
    const before = fs.readFileSync(file, 'utf-8')

    const r = editTrdd(designDir, id, { 'blocked-by': '[ZZZZZZZZ]', column: 'blocked' }, ISO)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe(400)
      expect(r.error).toContain('ZZZZZZZZ')
    }

    expect(fs.readFileSync(file, 'utf-8')).toBe(before)
  })

  it('accepts a resolvable blocked-by id against the real corpus (positive control)', () => {
    const blockerId = 'BLOCKER1'
    writeTask(blockerId, 'the-blocker', 'dev')
    const id = 'GRDX0003'
    writeTask(id, 'edit-me-3', 'dev')

    const r = editTrdd(designDir, id, { 'blocked-by': `[${blockerId}]`, column: 'blocked' }, ISO)
    expect(r.ok).toBe(true)
    const t = findTrdd(designDir, id)!
    expect(t.column).toBe('blocked')
  })

  it('still allows a legitimate field edit (severity) — the gate does not over-refuse', () => {
    const id = 'GRDX0004'
    writeTask(id, 'edit-me-4', 'dev')
    const r = editTrdd(designDir, id, { severity: 'HIGH' }, ISO)
    expect(r.ok).toBe(true)
    const t = findTrdd(designDir, id)!
    expect(t.frontmatter.severity).toBe('HIGH')
  })

  it('refuses editing a frozen terminal (complete) card and leaves it BYTE-IDENTICAL', () => {
    const id = 'GRDX0005'
    const file = writeTask(id, 'edit-me-5', 'complete')
    const before = fs.readFileSync(file, 'utf-8')

    const r = editTrdd(designDir, id, { severity: 'HIGH' }, ISO)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(400)
    expect(fs.readFileSync(file, 'utf-8')).toBe(before)
  })
})
