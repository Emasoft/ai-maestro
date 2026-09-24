import { describe, it, expect } from 'vitest'
import {
  validateTrddCandidate,
  introducedViolations,
  protectedFieldViolations,
  archivedWriteRefusal,
} from '@/lib/pillar/trdd-candidate'

/**
 * The shared write-gate predicate (`set`, raw `edit`): the life-stage `status:` rules the
 * linter already reports (owner ruling 2026-09-24, TRDD-MQE5D28T), the #168 identity and
 * approval-record protections, and the D8 archived refusal.
 */

const fm = (over: Record<string, string> = {}): Record<string, string> => ({
  'trdd-id': 'AAAAAAAA',
  title: 'a title',
  column: 'dev',
  status: 'tasked',
  created: '2026-01-01T00:00:00+0100',
  updated: '2026-01-01T00:00:00+0100',
  'created-by': 'main-agent@fixture',
  ...over,
})

describe('validateTrddCandidate — status is the life stage', () => {
  it('accepts the folder-derived value (positive control)', () => {
    expect(validateTrddCandidate(fm(), 'tasks')).toEqual([])
  })

  it('refuses a value outside the three stages', () => {
    expect(validateTrddCandidate(fm({ status: 'normative' }), 'tasks').join(' ')).toMatch(/not a life stage/)
  })

  it('refuses a stage that disagrees with the folder, naming the folder it belongs in', () => {
    expect(validateTrddCandidate(fm({ status: 'proposed' }), 'tasks').join(' ')).toMatch(
      /status 'proposed' belongs in design\/proposals\/ but this file is in design\/tasks\//,
    )
  })

  it('an absent status is not a gate violation (the linter WARNs; the doctor fills it)', () => {
    const { status: _s, ...rest } = fm()
    expect(validateTrddCandidate(rest, 'tasks')).toEqual([])
  })
})

describe('protectedFieldViolations (#168)', () => {
  it('refuses changing or removing a write-once field', () => {
    expect(protectedFieldViolations(fm(), fm({ 'created-by': 'someone-else' })).join(' ')).toMatch(/created-by: is write-once/)
    const { created: _c, ...noCreated } = fm()
    expect(protectedFieldViolations(fm(), noCreated).join(' ')).toMatch(/created: is write-once/)
  })

  it('allows filling a write-once field that was missing (a repair)', () => {
    const { 'created-by': _cb, ...noAuthor } = fm()
    expect(protectedFieldViolations(noAuthor, fm())).toEqual([])
  })

  it('refuses adding, changing or removing a record-only field', () => {
    for (const field of ['approval-judge', 'approval-datetime', 'mandate', 'mandated-by']) {
      expect(protectedFieldViolations(fm(), fm({ [field]: 'x' })).join(' ')).toMatch(new RegExp(`${field}: is written only`))
      expect(protectedFieldViolations(fm({ [field]: 'x' }), fm()).join(' ')).toMatch(new RegExp(`${field}: is written only`))
    }
  })

  it('an unrelated edit introduces nothing (positive control)', () => {
    expect(protectedFieldViolations(fm({ mandate: 'true' }), fm({ mandate: 'true', severity: 'high' }))).toEqual([])
  })

  // The #168 SEAM: the future owner-approved identity-migration verb may rewrite a legacy
  // `created-by`, and nothing else — never `created`, never a record-only field.
  it('identityMigration exempts ONLY created-by', () => {
    const opts = { identityMigration: true }
    expect(protectedFieldViolations(fm({ 'created-by': 'ai-maestro-main-session' }), fm(), opts)).toEqual([])
    expect(protectedFieldViolations(fm(), fm({ created: '2026-02-02T00:00:00+0100' }), opts).join(' ')).toMatch(/created: is write-once/)
    expect(protectedFieldViolations(fm(), fm({ 'approval-judge': 'manager' }), opts).join(' ')).toMatch(/approval-judge/)
  })

  it('introducedViolations carries the protections and passes the seam through', () => {
    expect(introducedViolations(fm(), fm({ 'created-by': 'x' }), 'tasks').join(' ')).toMatch(/write-once/)
    expect(introducedViolations(fm(), fm({ 'created-by': 'x' }), 'tasks', { identityMigration: true })).toEqual([])
  })
})

describe('archivedWriteRefusal (D8)', () => {
  it('refuses the archived zone only', () => {
    expect(archivedWriteRefusal('archived', 'x')).toMatch(/archived cards are immutable/)
    expect(archivedWriteRefusal('tasks', 'x')).toBeNull()
    expect(archivedWriteRefusal('proposals', 'x')).toBeNull()
    expect(archivedWriteRefusal(null, 'x')).toBeNull()
  })
})
