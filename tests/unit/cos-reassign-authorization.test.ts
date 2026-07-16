/**
 * RIFM4UXN Option A — COS reassignment authorization.
 *
 * The route USED to gate on the governance password alone ("password IS the
 * authorization"), which made the shipped #64 verb (reassign-cos / `update
 * --cos`) un-callable by the very MANAGER agent it was built for: R29/R32 say an
 * agent authenticates by AID and NEVER faces a password gate. Option A aligns it:
 *   - MANAGER agent (AID)  → assigns a COS with NO password.
 *   - every other agent    → 403 (authorize('manage-team') denies).
 *   - self-assign          → 403 (an agent may not seize the sole team gateway —
 *                            a fleet-takeover primitive; CORE, ai-maestro#69).
 *   - human/UI             → keeps the governance-password confirmation, unchanged.
 *
 * '@/lib/authorization' is deliberately NOT mocked — the real manage-team matrix
 * runs, so this suite is the route wired to the actual RBAC, not a re-statement.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  authenticateFromRequest: vi.fn(),
  buildAuthContext: vi.fn(() => ({})),
  enforceAuth: vi.fn(() => null),
  verifyPassword: vi.fn(),
  loadGovernance: vi.fn(() => ({ passwordHash: 'hash' })),
  getManagerId: vi.fn(() => 'agent-manager-1'),
  isManager: vi.fn(() => false),
  isChiefOfStaffAnywhere: vi.fn(() => false),
  getTeam: vi.fn(),
  updateTeam: vi.fn(),
  loadTeams: vi.fn(() => []),
  getAgent: vi.fn(),
  checkRateLimit: vi.fn(() => ({ allowed: true, retryAfterMs: 0 })),
  recordAttempt: vi.fn(),
  resetRateLimit: vi.fn(),
  ChangeTitle: vi.fn(async () => ({})),
}))

vi.mock('@/lib/agent-auth', () => ({
  authenticateFromRequest: m.authenticateFromRequest,
  buildAuthContext: m.buildAuthContext,
}))
vi.mock('@/lib/route-auth', () => ({ enforceAuth: m.enforceAuth }))
vi.mock('@/lib/governance', () => ({
  verifyPassword: m.verifyPassword,
  loadGovernance: m.loadGovernance,
  getManagerId: m.getManagerId,
  isManager: m.isManager,
  isChiefOfStaffAnywhere: m.isChiefOfStaffAnywhere,
}))
vi.mock('@/lib/team-registry', () => ({
  getTeam: m.getTeam,
  updateTeam: m.updateTeam,
  loadTeams: m.loadTeams,
  TeamValidationException: class TeamValidationException extends Error {
    code = 400
  },
}))
vi.mock('@/lib/agent-registry', () => ({ getAgent: m.getAgent }))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: m.checkRateLimit,
  recordAttempt: m.recordAttempt,
  resetRateLimit: m.resetRateLimit,
}))
vi.mock('@/lib/validation', () => ({ isValidUuid: () => true }))
vi.mock('@/services/element-management-service', () => ({ ChangeTitle: m.ChangeTitle }))

import { POST } from '@/app/api/teams/[id]/chief-of-staff/route'

// Real UUIDs — the route's AssignCosSchema validates agentId with z.string().uuid(),
// so a non-UUID body is rejected with 400 before any auth logic runs.
const MANAGER = '11111111-1111-4111-8111-111111111111'
const MEMBER = '22222222-2222-4222-8222-222222222222'
const COS_TARGET = '33333333-3333-4333-8333-333333333333'
const TEAM = '44444444-4444-4444-8444-444444444444'

function req(body: unknown): NextRequest {
  return { method: 'POST', json: async () => body } as unknown as NextRequest
}
const ctx = { params: Promise.resolve({ id: TEAM }) }

beforeEach(() => {
  vi.clearAllMocks()
  m.enforceAuth.mockReturnValue(null)
  m.loadGovernance.mockReturnValue({ passwordHash: 'hash' })
  m.getManagerId.mockReturnValue(MANAGER)
  m.getTeam.mockReturnValue({ id: TEAM, name: 'T', agentIds: [], chiefOfStaffId: null })
  m.updateTeam.mockResolvedValue({ id: TEAM, chiefOfStaffId: COS_TARGET })
  m.getAgent.mockReturnValue({ id: COS_TARGET, name: 'CosBot' })
  m.checkRateLimit.mockReturnValue({ allowed: true, retryAfterMs: 0 })
  m.ChangeTitle.mockResolvedValue({})
})

describe('COS reassignment authorization (RIFM4UXN Option A)', () => {
  it('MANAGER by AID assigns a COS with NO password → 200 (R29/R32)', async () => {
    m.authenticateFromRequest.mockReturnValue({ agentId: MANAGER, governanceTitle: 'manager' })
    const res = await POST(req({ agentId: COS_TARGET }), ctx)
    expect(res.status).toBe(200)
    expect(m.verifyPassword).not.toHaveBeenCalled() // an agent never faces the password gate
    expect(m.updateTeam).toHaveBeenCalled()
  })

  it('non-MANAGER agent → 403 (authorize manage-team denies)', async () => {
    m.authenticateFromRequest.mockReturnValue({ agentId: MEMBER, governanceTitle: 'member' })
    const res = await POST(req({ agentId: COS_TARGET }), ctx)
    expect(res.status).toBe(403)
    expect(m.updateTeam).not.toHaveBeenCalled()
  })

  it('MANAGER cannot assign ITSELF as COS → 403 (self-assign ban)', async () => {
    m.authenticateFromRequest.mockReturnValue({ agentId: MANAGER, governanceTitle: 'manager' })
    const res = await POST(req({ agentId: MANAGER }), ctx)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/itself/i)
    expect(m.updateTeam).not.toHaveBeenCalled()
  })

  it('human/UI with NO password → 400 (the human confirmation is still required)', async () => {
    m.authenticateFromRequest.mockReturnValue({}) // system owner, no agentId
    const res = await POST(req({ agentId: COS_TARGET }), ctx)
    expect(res.status).toBe(400)
    expect(m.updateTeam).not.toHaveBeenCalled()
  })

  it('human/UI with WRONG password → 401', async () => {
    m.authenticateFromRequest.mockReturnValue({})
    m.verifyPassword.mockResolvedValue(false)
    const res = await POST(req({ agentId: COS_TARGET, password: 'wrong' }), ctx)
    expect(res.status).toBe(401)
    expect(m.recordAttempt).toHaveBeenCalled()
    expect(m.updateTeam).not.toHaveBeenCalled()
  })

  it('human/UI with CORRECT password → 200 (unchanged human path)', async () => {
    m.authenticateFromRequest.mockReturnValue({})
    m.verifyPassword.mockResolvedValue(true)
    const res = await POST(req({ agentId: COS_TARGET, password: 'right' }), ctx)
    expect(res.status).toBe(200)
    expect(m.verifyPassword).toHaveBeenCalledWith('right')
    expect(m.updateTeam).toHaveBeenCalled()
  })
})
