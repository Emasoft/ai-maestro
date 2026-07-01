/**
 * Regression test for TRDD-e1a79be0 (option b): the PSS lifeline must NOT surface an
 * always-null `installedAtIso` field.
 *
 * Background: `rowToComponent` used to read `installed_at` / `observed_at` from the PSS
 * `as-of` rows, but the verified `as-of` schema emits NEITHER (its fields are element_id,
 * element_name, element_type, scope, scope_path, path, content_hash, file_size, token_count,
 * enabled, event_type). The result was `installedAtIso: null` on every component — a silently
 * non-functional field presenting as available data. Option (b) omits the field locally rather
 * than depending on the PSS engine to emit synthetic migration-date timestamps
 * (Emasoft/perfect-skill-suggester#10).
 *
 * These are mock-free unit tests of the real, now-exported pure function `rowToComponent`.
 * The acceptance contract (TRDD derived task): `installedAtIso` is never a silently-null field
 * — under option (b) it must be ABSENT from the returned object entirely.
 */

import { describe, it, expect } from 'vitest'

import { rowToComponent } from '@/lib/pss-lifeline'

/** A row shaped exactly like the verified PSS `as-of` output (no timestamp fields). */
function realAsOfRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    element_id: 'el-123',
    element_name: 'parallel-tester-agent',
    element_type: 'agent',
    scope: 'user',
    scope_path: '',
    path: '/Users/x/.claude/agents/parallel-tester-agent.md',
    content_hash: 'abc123',
    file_size: 4096,
    token_count: 512,
    enabled: true,
    event_type: 'installed',
    ...overrides,
  }
}

describe('pss-lifeline rowToComponent — installedAtIso omission (TRDD-e1a79be0 option b)', () => {
  it('maps a real as-of row to name/type/scope only', () => {
    const c = rowToComponent(realAsOfRow())
    expect(c).toEqual({ name: 'parallel-tester-agent', type: 'agent', scope: 'user' })
  })

  it('never carries an installedAtIso key (no silent always-null field)', () => {
    const c = rowToComponent(realAsOfRow())
    expect(c).not.toBeNull()
    // The KEY itself must be absent — not merely null/undefined. This is the exact
    // "never a silently-null field masquerading as available data" acceptance.
    expect(Object.prototype.hasOwnProperty.call(c, 'installedAtIso')).toBe(false)
  })

  it('does NOT propagate a synthetic install/observed timestamp even if PSS ever emits one', () => {
    // Guards the WHY of option (b): a synthetic migration date (per PSS#10) is worse than
    // absent, so even a row that DOES carry installed_at/observed_at must not surface it.
    const c = rowToComponent(
      realAsOfRow({ installed_at: '2020-01-01T00:00:00Z', observed_at: '2020-01-01T00:00:00Z' }),
    )
    expect(c).not.toBeNull()
    expect(Object.prototype.hasOwnProperty.call(c, 'installedAtIso')).toBe(false)
  })

  it('omits scope when the row has none', () => {
    const c = rowToComponent(realAsOfRow({ scope: undefined }))
    expect(c).toEqual({ name: 'parallel-tester-agent', type: 'agent', scope: undefined })
    expect(Object.prototype.hasOwnProperty.call(c, 'installedAtIso')).toBe(false)
  })

  it('returns null when the row lacks a usable name or type', () => {
    expect(rowToComponent(realAsOfRow({ element_name: undefined }))).toBeNull()
    expect(rowToComponent(realAsOfRow({ element_type: undefined }))).toBeNull()
    expect(rowToComponent({})).toBeNull()
  })
})
