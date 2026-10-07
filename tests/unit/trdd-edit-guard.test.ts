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
 *
 * This file is the conformance proof for `3P-TRDD-12` (validate-before-write,
 * 3-pillars spec 1.4.0). The clause's three MUSTs map onto the WIRING half: the
 * check runs before the write lands, it refuses rather than warns, and the file
 * is byte-identical after a refusal. The clause's "same vocabulary as the linter"
 * MUST is proven one level up, in `lib/trdd-vocabulary.ts` — a single edit to
 * `types/task.ts::DEFAULT_STATUSES` reddens BOTH this file's ratified-column
 * positive control AND the doctor's live-corpus gate, which is what "one
 * definition, not two that drift" means operationally.
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
    const r = validateTrddFieldEdits({ column: 'not-started', updated: ISO }, baseFm(), resolveAll, 'tasks')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain('not-started')
      expect(r.error).toContain('column')
    }
  })

  it('accepts a ratified column value (positive control)', () => {
    const r = validateTrddFieldEdits({ column: 'testing', updated: ISO }, baseFm(), resolveAll, 'tasks')
    expect(r.ok).toBe(true)
  })
})

describe('validateTrddFieldEdits — column must never end up ABSENT', () => {
  it('refuses a write that explicitly blanks column', () => {
    const r = validateTrddFieldEdits({ column: '', updated: ISO }, baseFm(), resolveAll, 'tasks')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/ABSENT/)
  })

  it('refuses an edit of an unrelated field when the CURRENT card already has no column', () => {
    const current = baseFm({ column: undefined })
    const r = validateTrddFieldEdits({ severity: 'HIGH', updated: ISO }, current, resolveAll, 'tasks')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/ABSENT/)
  })

  it('accepts an edit that supplies the missing column (positive control)', () => {
    const current = baseFm({ column: undefined })
    const r = validateTrddFieldEdits({ column: 'todo', updated: ISO }, current, resolveAll, 'tasks')
    expect(r.ok).toBe(true)
  })
})

describe('validateTrddFieldEdits — blocked-by ⟺ column: blocked', () => {
  it('refuses non-empty blocked-by with a non-blocked resultant column', () => {
    const r = validateTrddFieldEdits(
      { 'blocked-by': '[ABCDEFGH]', updated: ISO },
      baseFm({ column: 'dev' }),
      resolveAll,
      'tasks',
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/blocked-by/)
  })

  it('refuses column: blocked with an empty resultant blocked-by', () => {
    const r = validateTrddFieldEdits(
      { column: 'blocked', updated: ISO },
      baseFm({ column: 'dev', 'blocked-by': [] }),
      resolveAll,
      'tasks',
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/blocked-by/)
  })

  it('accepts blocked-by + column: blocked set together (positive control)', () => {
    const r = validateTrddFieldEdits(
      { 'blocked-by': '[ABCDEFGH]', column: 'blocked', updated: ISO },
      baseFm({ column: 'dev' }),
      resolveAll,
      'tasks',
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
      'tasks',
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('ZZZZZZZZ')
  })

  it('accepts a resolvable blocked-by id (positive control)', () => {
    const r = validateTrddFieldEdits(
      { 'blocked-by': '[ZZZZZZZZ]', column: 'blocked', updated: ISO },
      baseFm(),
      resolveAll,
      'tasks',
    )
    expect(r.ok).toBe(true)
  })

  it('refuses a dangling parent-trdd (bare-scalar reference shape)', () => {
    const r = validateTrddFieldEdits({ 'parent-trdd': 'ZZZZZZZZ', updated: ISO }, baseFm(), resolveNone, 'tasks')
    expect(r.ok).toBe(false)
  })

  it('accepts a resolvable superseded-by (flow-style single-element list shape)', () => {
    // Deliberately does NOT also move `column` to 'superseded' here: `baseFm()`'s
    // CURRENT column is 'dev', which only ever legitimately sits in the `tasks`
    // zone — `isDefinitiveCard` now checks the CURRENT zone too, so pairing 'dev'
    // with an `archived` zone would trip the freeze on an unrelated (unrealistic)
    // zone-mismatch before this test's own rule (ref-list resolution) ever ran.
    const r = validateTrddFieldEdits(
      { 'superseded-by': '[ZZZZZZZZ]', updated: ISO },
      baseFm(),
      resolveAll,
      'tasks',
    )
    expect(r.ok).toBe(true)
  })
})

// The mandate is written only at mint (`createTrdd`), so a field edit may no longer WRITE
// `mandate`/`mandated-by` (#168, record-only fields). The forged-authority rule still guards
// the edits it can see: an edit to an EXISTING mandate's floor, judged on the merged card.
describe('validateTrddFieldEdits — mandate authority', () => {
  it.each(['mandate', 'mandated-by'])('refuses writing %s through a field edit (record-only)', (field) => {
    const r = validateTrddFieldEdits({ [field]: field === 'mandate' ? 'true' : 'manager', updated: ISO }, baseFm(), resolveAll, 'tasks')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/written only by the create\/approve code paths/)
  })

  it('refuses raising the floor above an existing mandate (forged approval)', () => {
    const r = validateTrddFieldEdits(
      { 'min-approval-requirement': 'manager', updated: ISO },
      baseFm({ mandate: true, 'mandated-by': 'orchestrator', 'min-approval-requirement': 'none' }),
      resolveAll,
      'tasks',
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/forged/)
  })

  it('accepts an unrelated edit on a card whose mandate is at or above the floor (positive control)', () => {
    const r = validateTrddFieldEdits(
      { severity: 'HIGH', updated: ISO },
      baseFm({ mandate: true, 'mandated-by': 'manager', 'min-approval-requirement': 'manager' }),
      resolveAll,
      'tasks',
    )
    expect(r.ok).toBe(true)
  })

  it('treats mandated-by: self as rank "none", not an unknown rung', () => {
    const r = validateTrddFieldEdits(
      { severity: 'HIGH', updated: ISO },
      baseFm({ mandate: true, 'mandated-by': 'self', 'min-approval-requirement': 'none' }),
      resolveAll,
      'tasks',
    )
    expect(r.ok).toBe(true)
  })

  it('refuses an authority the ladder does not know', () => {
    const r = validateTrddFieldEdits(
      { severity: 'HIGH', updated: ISO },
      baseFm({ mandate: true, 'mandated-by': 'nonsense-rank' }),
      resolveAll,
      'tasks',
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/does not know/)
  })
})

describe('validateTrddFieldEdits — identity and approval-record fields (#168)', () => {
  it.each(['created-by', 'created'])('refuses changing an existing %s (write-once)', (field) => {
    const r = validateTrddFieldEdits(
      { [field]: field === 'created' ? '2026-01-02T00:00:00+0100' : 'someone-else', updated: ISO },
      baseFm({ 'created-by': 'main-agent@x' }),
      resolveAll,
      'tasks',
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/write-once/)
  })

  it('allows filling a MISSING created-by (a repair, not a rewrite)', () => {
    const r = validateTrddFieldEdits({ 'created-by': 'main-agent@x', updated: ISO }, baseFm(), resolveAll, 'tasks')
    expect(r.ok).toBe(true)
  })

  it.each(['approval-judge', 'approval-datetime', 'verdict-token', 'approval-token'])('refuses writing %s through a field edit (record-only)', (field) => {
    const r = validateTrddFieldEdits(
      { [field]: field === 'approval-datetime' ? '2026-01-02T00:00:00+0100' : 'manager', updated: ISO },
      baseFm(),
      resolveAll,
      'tasks',
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/create\/approve/)
  })
})

describe('validateTrddFieldEdits — status is the life stage', () => {
  it('refuses a status that disagrees with the folder', () => {
    const r = validateTrddFieldEdits({ status: 'proposed', updated: ISO }, baseFm(), resolveAll, 'tasks')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/carries status: tasked/)
  })

  it('refuses a value outside the three stages', () => {
    const r = validateTrddFieldEdits({ status: 'normative', updated: ISO }, baseFm(), resolveAll, 'tasks')
    expect(r.ok).toBe(false)
  })

  it('accepts the folder-derived value (positive control)', () => {
    const r = validateTrddFieldEdits({ status: 'tasked', updated: ISO }, baseFm(), resolveAll, 'tasks')
    expect(r.ok).toBe(true)
  })
})

describe('validateTrddFieldEdits — date fields', () => {
  it('refuses an unparseable updated value', () => {
    const r = validateTrddFieldEdits({ updated: 'not-a-date' }, baseFm(), resolveAll, 'tasks')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/ISO-8601/)
  })

  it('refuses an updated value in the future', () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    const r = validateTrddFieldEdits({ updated: future }, baseFm(), resolveAll, 'tasks')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/future/)
  })

  it('accepts a past ISO updated value (positive control)', () => {
    const r = validateTrddFieldEdits({ updated: '2026-01-02T00:00:00+0100' }, baseFm(), resolveAll, 'tasks')
    expect(r.ok).toBe(true)
  })
})

describe('validateTrddFieldEdits — definitive column freeze (IND base §12)', () => {
  it('refuses editing an unrelated field on a definitive (complete) card', () => {
    const r = validateTrddFieldEdits(
      { severity: 'HIGH', updated: ISO },
      baseFm({ column: 'complete' }),
      resolveAll,
      'archived',
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/definitive/)
  })

  // D8 INVERTED this test (was: the carve-outs allowed on an ARCHIVED complete card). The two
  // carve-outs belong to a finished card NOT yet archived (D5) — here a `complete` card with
  // release-via publish, which legitimately stays in tasks/. On an archived card they are refused.
  it('allows "updated" and "superseded-by" on a finished card still in tasks/ (the D5 carve-outs)', () => {
    const r = validateTrddFieldEdits(
      { updated: ISO, 'superseded-by': '[ZZZZZZZZ]' },
      baseFm({ column: 'complete', 'release-via': 'publish' }),
      resolveAll,
      'tasks',
    )
    expect(r.ok).toBe(true)
  })

  it('refuses even "updated" and "superseded-by" on an ARCHIVED card (D8 — no carve-out)', () => {
    const r = validateTrddFieldEdits(
      { updated: ISO, 'superseded-by': '[ZZZZZZZZ]' },
      baseFm({ column: 'complete' }),
      resolveAll,
      'archived',
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/design\/archived\/ — archived cards are immutable/)
  })

  // #167 follow-up: the guard used to check the narrower flock-done TERMINAL_DONE set
  // instead of the freeze rule's own DEFINITIVE_COLUMNS (IND base step 12), so
  // `cancelled` and `refused` cards could still have an unrelated field edited —
  // two definitive columns TERMINAL_DONE does not cover. `failed` is deliberately
  // excluded here: it is definitive only in the `archived` zone (owner ruling
  // 2026-09-24) — see the `failed`-in-`tasks`-is-open tests below.
  it.each(['cancelled', 'refused'])('refuses editing an unrelated field on a %s card', (column) => {
    const r = validateTrddFieldEdits(
      { severity: 'HIGH', updated: ISO },
      baseFm({ column }),
      resolveAll,
      'archived',
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/definitive/)
  })

  // D8 INVERTED this test (was: allowed on these columns in archived/). A `cancelled` card in
  // archived/ takes no edit at all; the carve-outs survive only for a finished card outside it.
  it.each(['cancelled', 'refused'])('refuses even "updated" and "superseded-by" on an archived %s card (D8)', (column) => {
    const r = validateTrddFieldEdits(
      { updated: ISO, 'superseded-by': '[ZZZZZZZZ]' },
      baseFm({ column }),
      resolveAll,
      'archived',
    )
    expect(r.ok).toBe(false)
  })

  // Owner ruling (2026-09-24): "of course they stays open for retry" — a `failed`
  // card in design/tasks/ is OPEN, not definitive, so an unrelated field edit is
  // allowed there (subject to every other guard in this file).
  it('allows editing an unrelated field on a failed card in tasks/ (open for retry)', () => {
    const r = validateTrddFieldEdits(
      { severity: 'HIGH', updated: ISO },
      baseFm({ column: 'failed' }),
      resolveAll,
      'tasks',
    )
    expect(r.ok).toBe(true)
  })

  // Owner ruling (2026-09-24): "failed in archived -> definitive (wrong road, never
  // try again, lesson learned)" — the same column becomes definitive once archived.
  it('refuses editing an unrelated field on a failed card in archived/ (definitive)', () => {
    const r = validateTrddFieldEdits(
      { severity: 'HIGH', updated: ISO },
      baseFm({ column: 'failed' }),
      resolveAll,
      'archived',
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/definitive/)
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

  it('refuses column=not-started and leaves the file BYTE-IDENTICAL', async () => {
    const id = 'GRDX0001'
    const file = writeTask(id, 'edit-me', 'dev')
    const before = fs.readFileSync(file, 'utf-8')

    const r = await editTrdd(designDir, id, { column: 'not-started' }, ISO)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe(400)
      expect(r.error).toContain('not-started')
    }

    const after = fs.readFileSync(file, 'utf-8')
    expect(after).toBe(before)
  })

  it('refuses a dangling blocked-by id and leaves the file BYTE-IDENTICAL', async () => {
    const id = 'GRDX0002'
    const file = writeTask(id, 'edit-me-2', 'dev')
    const before = fs.readFileSync(file, 'utf-8')

    const r = await editTrdd(designDir, id, { 'blocked-by': '[ZZZZZZZZ]', column: 'blocked' }, ISO)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe(400)
      expect(r.error).toContain('ZZZZZZZZ')
    }

    expect(fs.readFileSync(file, 'utf-8')).toBe(before)
  })

  it('accepts a resolvable blocked-by id against the real corpus (positive control)', async () => {
    const blockerId = 'BLOCKER1'
    writeTask(blockerId, 'the-blocker', 'dev')
    const id = 'GRDX0003'
    writeTask(id, 'edit-me-3', 'dev')

    const r = await editTrdd(designDir, id, { 'blocked-by': `[${blockerId}]`, column: 'blocked' }, ISO)
    expect(r.ok).toBe(true)
    const t = findTrdd(designDir, id)!
    expect(t.column).toBe('blocked')
  })

  it('still allows a legitimate field edit (severity) — the gate does not over-refuse', async () => {
    const id = 'GRDX0004'
    writeTask(id, 'edit-me-4', 'dev')
    const r = await editTrdd(designDir, id, { severity: 'HIGH' }, ISO)
    expect(r.ok).toBe(true)
    const t = findTrdd(designDir, id)!
    expect(t.frontmatter.severity).toBe('HIGH')
  })

  it('refuses editing a frozen terminal (complete) card and leaves it BYTE-IDENTICAL', async () => {
    const id = 'GRDX0005'
    const file = writeTask(id, 'edit-me-5', 'complete')
    const before = fs.readFileSync(file, 'utf-8')

    const r = await editTrdd(designDir, id, { severity: 'HIGH' }, ISO)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(400)
    expect(fs.readFileSync(file, 'utf-8')).toBe(before)
  })
})
