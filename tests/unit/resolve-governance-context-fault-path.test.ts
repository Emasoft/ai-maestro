import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * TRDD-8E6XMDEX — FAULT path of the live title/team resolution authenticateAgent performs for a
 * session secret (mst_*). resolve-governance-context-live.test.ts pins the healthy paths; this pins
 * what a caller resolves to when a store READ throws. Behaviour is OBSERVED, not judged.
 *
 * Doubled (same module-boundary mocks as the live test): every store. Real: authenticateAgent,
 * resolveGovernanceContext and resolveTeamId in lib/agent-auth.ts. Nothing touches ~/.aimaestro.
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
const TEAMS_FILE_FAULT = new Error('EIO: teams.json unreadable')

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  mockLoadAgents.mockReturnValue([
    { id: AGENT, name: 'a', metadata: { sessionSecretHash: 'hash-of-' + SECRET } },
  ])
  mockGetAgent.mockReturnValue({ id: AGENT, governanceTitle: 'member' })
  mockIsManager.mockReturnValue(false)
  mockIsChiefOfStaffAnywhere.mockReturnValue(false)
  mockLoadTeams.mockReturnValue([{ id: 'team-y', agentIds: [], chiefOfStaffId: AGENT }])
})

afterEach(() => warn.mockRestore())

describe('authenticateAgent session secret — read faults in the governance context', () => {
  it('positive control: with no fault the chief of staff keeps its title and gets its team', () => {
    /** Guards the faulted cases below: the same fixture, minus the throw. */
    mockIsChiefOfStaffAnywhere.mockImplementation((id: string) => id === AGENT)
    const r = authenticateAgent('Bearer ' + SECRET, null)
    expect(r.governanceTitle).toBe('chief-of-staff')
    expect(r.teamId).toBe('team-y')
    expect(warn).not.toHaveBeenCalled()
  })

  it('an unreadable teams file keeps the registry title (member) and resolves to NO team, with a warning', () => {
    /** resolveTeamId swallows the loadTeams fault: title untouched, teamId null. */
    mockLoadTeams.mockImplementation(() => { throw TEAMS_FILE_FAULT })
    const r = authenticateAgent('Bearer ' + SECRET, null)
    expect(r.error).toBeUndefined()
    expect(r.governanceTitle).toBe('member')
    expect(r.teamId).toBeNull()
    expect(warn).toHaveBeenCalledWith('[agent-auth] resolveTeamId failed, treating as no team:', TEAMS_FILE_FAULT)
  })

  it('an unreadable teams file keeps the MANAGER title and resolves to no team', () => {
    /** The manager pointer comes from governance, not the teams file. */
    mockIsManager.mockImplementation((id: string) => id === AGENT)
    mockLoadTeams.mockImplementation(() => { throw TEAMS_FILE_FAULT })
    const r = authenticateAgent('Bearer ' + SECRET, null)
    expect(r.governanceTitle).toBe('manager')
    expect(r.teamId).toBeNull()
  })

  it('an unreadable teams file keeps the CHIEF-OF-STAFF title but loses its team', () => {
    /** COS status comes from governance; only the team id is lost. */
    mockIsChiefOfStaffAnywhere.mockImplementation((id: string) => id === AGENT)
    mockLoadTeams.mockImplementation(() => { throw TEAMS_FILE_FAULT })
    const r = authenticateAgent('Bearer ' + SECRET, null)
    expect(r.governanceTitle).toBe('chief-of-staff')
    expect(r.teamId).toBeNull()
  })

  it('a fault reading the governance store resolves even a MANAGER to autonomous with no team', () => {
    /** isManager throwing hits resolveGovernanceContext's own catch: everything becomes autonomous. */
    const fault = new Error('EIO: governance.json unreadable')
    mockIsManager.mockImplementation(() => { throw fault })
    const r = authenticateAgent('Bearer ' + SECRET, null)
    expect(r.error).toBeUndefined()
    expect(r.agentId).toBe(AGENT)
    expect(r.governanceTitle).toBe('autonomous')
    expect(r.teamId).toBeNull()
    expect(warn).toHaveBeenCalledWith(
      '[agent-auth] resolveGovernanceContext failed, falling back to autonomous:',
      { agentId: AGENT, err: fault },
    )
  })

  it('a fault reading the agent registry row resolves a member to autonomous with no team', () => {
    /** getAgent throwing (after the manager/COS checks pass over) lands in the same catch. */
    mockGetAgent.mockImplementation(() => { throw new Error('EIO: registry.json unreadable') })
    const r = authenticateAgent('Bearer ' + SECRET, null)
    expect(r.governanceTitle).toBe('autonomous')
    expect(r.teamId).toBeNull()
  })
})
