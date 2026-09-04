/**
 * TRDD-5MN01NO8 — `editTrdd` could still write a `column:` its ZONE contradicts
 * (e.g. `column: proposal` onto a card living in `design/tasks/`), producing the
 * same inert card TRDD-MWKCBLQN closed on the MINT path (`createTrdd`). The fix
 * cross-checks the resultant column's `expectedZone` against the card's own zone,
 * reusing the same arbiter `createTrdd`/`advanceColumn`/the doctor already share.
 */
import { describe, it, expect } from 'vitest'
import { validateTrddFieldEdits } from '@/lib/trdd-edit-guard'

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

describe('validateTrddFieldEdits — column must agree with the card\'s zone (TRDD-5MN01NO8)', () => {
  it('refuses column: proposal written onto a card whose zone is tasks — the bug', () => {
    const r = validateTrddFieldEdits({ column: 'proposal', updated: ISO }, baseFm(), resolveAll, 'tasks')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain('proposal')
      expect(r.error).toContain('design/proposals/')
      expect(r.error).toContain('design/tasks/')
    }
  })

  it('accepts an ordinary working-column edit (dev -> testing) on a tasks/ card (positive control)', () => {
    const r = validateTrddFieldEdits({ column: 'testing', updated: ISO }, baseFm(), resolveAll, 'tasks')
    expect(r.ok).toBe(true)
  })

  it('accepts column: complete with release-via: publish on a tasks/ card — expectedZone returns null', () => {
    const r = validateTrddFieldEdits(
      { column: 'complete', updated: ISO },
      baseFm({ 'release-via': 'publish' }),
      resolveAll,
      'tasks',
    )
    expect(r.ok).toBe(true)
  })

  it('does NOT lock an already-mismatched card: an UNCHANGED column re-write is allowed', () => {
    // The guard must stop an edit CREATING a contradiction, never freeze a card already
    // in one. A card sitting in tasks/ with column: proposal is a ZONE-MISMATCH the
    // doctor reports and repairs with `git mv` — if editing it required not touching
    // `column`, an ordinary repair edit that bundles the unchanged column with other
    // fields would 400, making the card HARDER to fix than before this guard existed.
    const r = validateTrddFieldEdits(
      { column: 'proposal', priority: '1', updated: ISO },
      baseFm({ column: 'proposal' }),
      resolveAll,
      'tasks',
    )
    expect(r.ok).toBe(true)
  })

  it('still refuses a changed column on a card whose CURRENT column is also mismatched', () => {
    // WHAT THIS PINS — both directions MEASURED, because neither neuter alone answers it
    // and my first two attempts at this comment each got it wrong in one direction.
    //
    //   REMOVE `!columnUnchanged` (exemption gone, guard back to its original form)
    //     -> 1 red: only "does NOT lock an already-mismatched card". This test stays
    //        GREEN, because `columnUnchanged` is false here either way.
    //   WIDEN to `columnUnchanged = true` (exemption swallows every column write)
    //     -> 2 red: the FIRST test in this file AND this one.
    //
    // So this test is NOT decorative — an earlier version of this comment demoted it on
    // the strength of the first neuter alone. It pins the exemption's NARROWNESS (a
    // too-wide exemption reds it); what it does not pin is the exemption's EXISTENCE,
    // which only the unchanged-re-write test above covers. Two mutations, two different
    // properties; one run would have told me half the story and did.
    const r = validateTrddFieldEdits(
      { column: 'refused', updated: ISO },
      baseFm({ column: 'proposal' }),
      resolveAll,
      'tasks',
    )
    expect(r.ok).toBe(false)
  })

  it('refuses a zone-contradicting column reached through the v1 status fallback', () => {
    // `effectiveColumn` derives the column from `status:` when `column:` is absent
    // (V1_STATUS_TO_COLUMN). A write that touches only `status:` must be checked
    // against the zone exactly like a `column:` write — keying the guard on the
    // FIELD NAME `column` let a status-only write skip this check entirely.
    const r = validateTrddFieldEdits(
      { status: 'cancelled', updated: ISO },
      baseFm({ column: undefined, status: 'in-progress' }),
      resolveAll,
      'tasks',
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain('archived')
    }
  })

  it('accepts an ordinary status-only edit that lands in an OPEN column (positive control)', () => {
    // 'in-progress' -> 'dev' via V1_STATUS_TO_COLUMN, an ordinary WORKING column
    // that belongs in tasks/ — must still be accepted through the fallback.
    const r = validateTrddFieldEdits(
      { status: 'in-progress', updated: ISO },
      baseFm({ column: undefined, status: 'not-started' }),
      resolveAll,
      'tasks',
    )
    expect(r.ok).toBe(true)
  })
})
