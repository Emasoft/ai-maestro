/**
 * ACTIVE_GOVERNANCE_TITLES — the 3-role finalization (TRDD-H18PO5YJ) restricts
 * which titles are OFFERED for new selection to manager/maintainer/autonomous,
 * while VALID_GOVERNANCE_TITLES keeps the full 9-title set intact so existing
 * dormant-title agents remain valid and resolvable.
 */
import { describe, it, expect } from 'vitest'
import { ACTIVE_GOVERNANCE_TITLES, VALID_GOVERNANCE_TITLES, isActiveGovernanceTitle } from '@/types/agent'

describe('ACTIVE_GOVERNANCE_TITLES', () => {
  it('is exactly manager, maintainer, autonomous', () => {
    expect(ACTIVE_GOVERNANCE_TITLES).toEqual(['manager', 'maintainer', 'autonomous'])
  })

  it('every active title is a member of VALID_GOVERNANCE_TITLES', () => {
    for (const title of ACTIVE_GOVERNANCE_TITLES) {
      expect(VALID_GOVERNANCE_TITLES).toContain(title)
    }
  })
})

describe('isActiveGovernanceTitle', () => {
  it.each(['manager', 'MANAGER', 'Manager', 'maintainer', 'autonomous'])(
    'returns true for %s',
    (title) => {
      expect(isActiveGovernanceTitle(title)).toBe(true)
    }
  )

  it.each([
    'architect',
    'member',
    'chief-of-staff',
    'assistant',
    'integrator',
    'orchestrator',
    '',
    ' ',
    'bogus',
  ])('returns false for %s', (title) => {
    expect(isActiveGovernanceTitle(title)).toBe(false)
  })
})
