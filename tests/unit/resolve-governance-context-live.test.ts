import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * TRDD-8E6XMDEX — pins the LIVE title/team resolution that authenticateAgent
 * performs for a session secret (mst_*). resolveGovernanceContext used to load
 * its stores with lazy require('./governance') etc., which does not resolve the
 * .ts under vitest nor see vi.mock, so it always fell into its catch and
 * returned 'autonomous': this path had no working test. The stores are mocked at
 * module boundary; nothing touches the real ~/.aimaestro.
 */

const mockLoadAgents = vi.fn()
const mockGetAgent = vi.fn()
const mockIsManager = vi.fn()
const mockIsChiefOfStaffAnywhere = vi.fn()
const mockLoadTeams = vi.fn()

vi.mock('@/lib/amp-auth', () => ({ authenticateRequest: vi.fn() }))
vi.mock('@/lib/aid-token', () => ({ validateGovernanceToken: vi.fn() }))
vi.mock('@/lib/session-auth', () => ({
  extractSessionFromCookie: vi.fn(() => null),
  validateSessionWithUser: vi.fn(() => ({ valid: false })),
}))
vi.mock('@/lib/session-secret', () => ({
  isSessionSecret: (t: string) => t?.startsWith('mst_'),
  validateSessionSecret: (secret: string, hash: string) => hash === 'hash-of-' + secret,
}))
vi.mock('@/lib/security-config', () => ({
  loadSecurityConfig: () => ({ ledger: { enforceAidAssociation: false } }),
}))
vi.mock('@/lib/aid-ledger-authority', () => ({ isAidAssociated: vi.fn() }))
vi.mock('@/lib/agent-registry', () => ({
  loadAgents: (...a: unknown[]) => mockLoadAgents(...a),
  getAgent: (...a: unknown[]) => mockGetAgent(...a),
}))
vi.mock('@/lib/governance', () => ({
  isManager: (...a: unknown[]) => mockIsManager(...a),
  isChiefOfStaffAnywhere: (...a: unknown[]) => mockIsChiefOfStaffAnywhere(...a),
}))
vi.mock('@/lib/team-registry', () => ({
  loadTeams: (...a: unknown[]) => mockLoadTeams(...a),
}))

import { authenticateAgent } from '@/lib/agent-auth'

const SECRET = 'mst_secret-a'
const AGENT = 'agent-a'

beforeEach(() => {
  vi.clearAllMocks()
  mockLoadAgents.mockReturnValue([
    { id: AGENT, name: 'a', metadata: { sessionSecretHash: 'hash-of-' + SECRET } },
  ])
  mockGetAgent.mockReturnValue({ id: AGENT, governanceTitle: 'member' })
  mockIsManager.mockReturnValue(false)
  mockIsChiefOfStaffAnywhere.mockReturnValue(false)
  mockLoadTeams.mockReturnValue([])
})

describe('authenticateAgent session secret — live governance context', () => {
  it('registry title member resolves to member', () => {
    /** The title comes from the live registry row. */
    const r = authenticateAgent('Bearer ' + SECRET, null)
    expect(r.error).toBeUndefined()
    expect(r.agentId).toBe(AGENT)
    expect(r.governanceTitle).toBe('member')
    expect(r.teamId).toBeNull()
  })

  it('the manager pointer resolves to manager, overriding the registry title', () => {
    /** isManager wins over the registry row. */
    mockIsManager.mockImplementation((id: string) => id === AGENT)
    const r = authenticateAgent('Bearer ' + SECRET, null)
    expect(r.governanceTitle).toBe('manager')
  })

  it('a team chief of staff resolves to chief-of-staff with that team', () => {
    /** COS anywhere → chief-of-staff, teamId from the team whose chair it is. */
    mockIsChiefOfStaffAnywhere.mockImplementation((id: string) => id === AGENT)
    mockLoadTeams.mockReturnValue([
      { id: 'team-x', agentIds: [], chiefOfStaffId: 'other' },
      { id: 'team-y', agentIds: [], chiefOfStaffId: AGENT },
    ])
    const r = authenticateAgent('Bearer ' + SECRET, null)
    expect(r.governanceTitle).toBe('chief-of-staff')
    expect(r.teamId).toBe('team-y')
  })

  it('no registry row resolves to autonomous', () => {
    /** Unknown / soft-deleted agent → least privilege. */
    mockGetAgent.mockReturnValue(null)
    const r = authenticateAgent('Bearer ' + SECRET, null)
    expect(r.governanceTitle).toBe('autonomous')
    expect(r.teamId).toBeNull()
  })
})
