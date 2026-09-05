/**
 * `frontmatterDay` and `isParkedByOtherForm` — the shared park predicate (TRDD-4P798U6P).
 *
 * These two functions used to be private, byte-identical copies in `lib/trdd-doctor.ts`
 * and `lib/trdd-store.ts` (the doctor's PARKED predicate for LINTING, the store's entry
 * gate for `advanceColumn` moving a card into `blocked`). Pinning them here, imported
 * from the single leaf module both files now share, is what stops the two decisions from
 * silently drifting apart again the way a linter and its own `--fix` once did.
 */
import { describe, it, expect } from 'vitest'
import { frontmatterDay, isParkedByOtherForm, parkReason } from '@/lib/trdd-vocabulary'

describe('frontmatterDay', () => {
  it('reads an ISO string', () => {
    expect(frontmatterDay('2026-08-02T15:37:19+0200')).toBe('2026-08-02')
  })

  it('reads a parsed Date', () => {
    expect(frontmatterDay(new Date('2026-08-02T13:37:19Z'))).toBe('2026-08-02')
  })

  it('returns empty for absent, malformed, and invalid input', () => {
    expect(frontmatterDay(undefined)).toBe('')
    expect(frontmatterDay('soon')).toBe('')
    expect(frontmatterDay(new Date('nonsense'))).toBe('')
  })
})

describe('isParkedByOtherForm', () => {
  const TODAY = '2026-09-05'

  it('is true for a FUTURE review-after', () => {
    expect(isParkedByOtherForm({ 'review-after': '2026-09-06' }, TODAY)).toBe(true)
  })

  it('is false for a PAST review-after (an expired park is not a park)', () => {
    expect(isParkedByOtherForm({ 'review-after': '2026-09-04' }, TODAY)).toBe(false)
  })

  it('is false for a review-after equal to today (the boundary is strictly after)', () => {
    expect(isParkedByOtherForm({ 'review-after': TODAY }, TODAY)).toBe(false)
  })

  it('is true for a hub-blocked label', () => {
    expect(isParkedByOtherForm({ labels: ['governance', 'hub-blocked'] }, TODAY)).toBe(true)
  })

  it('is true for a fleet-ask label', () => {
    expect(isParkedByOtherForm({ labels: ['fleet-ask'] }, TODAY)).toBe(true)
  })

  it('reads a scalar bracketed labels string the same as an array', () => {
    expect(isParkedByOtherForm({ labels: '[governance, fleet-ask]' }, TODAY)).toBe(true)
  })

  it('is false when none of the other park forms hold', () => {
    expect(isParkedByOtherForm({ labels: ['governance'] }, TODAY)).toBe(false)
    expect(isParkedByOtherForm({}, TODAY)).toBe(false)
  })
})

describe('parkReason — the form the predicate decided on, so a message never re-derives it', () => {
  const TODAY = '2026-09-05'

  it('names review-after first when a future review-after and a label both hold', () => {
    expect(parkReason({ 'review-after': '2026-09-06', labels: ['fleet-ask'] }, TODAY)).toBe('review-after')
  })

  it('names the label when only a label holds, and null when nothing does', () => {
    expect(parkReason({ labels: ['hub-blocked'] }, TODAY)).toBe('hub-blocked')
    expect(parkReason({ labels: ['fleet-ask'] }, TODAY)).toBe('fleet-ask')
    expect(parkReason({ 'review-after': '2026-09-04', labels: ['governance'] }, TODAY)).toBeNull()
  })
})
