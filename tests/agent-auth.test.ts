import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================================
// Mock dependencies before importing agent-auth
// ============================================================================

const mockAuthenticateRequest = vi.fn()
const mockValidateGovernanceToken = vi.fn()
const mockExtractSessionFromCookie = vi.fn()
const mockValidateSession = vi.fn()

vi.mock('@/lib/amp-auth', () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}))

vi.mock('@/lib/aid-token', () => ({
  validateGovernanceToken: (...args: unknown[]) => mockValidateGovernanceToken(...args),
}))

vi.mock('@/lib/session-auth', () => ({
  extractSessionFromCookie: (...args: unknown[]) => mockExtractSessionFromCookie(...args),
  validateSession: (...args: unknown[]) => mockValidateSession(...args),
}))

// ============================================================================
// Import module under test (after mocks)
// ============================================================================

import { authenticateAgent } from '@/lib/agent-auth'

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks()
  mockExtractSessionFromCookie.mockReturnValue(null)
  mockValidateSession.mockReturnValue(false)
})

// ============================================================================
// Tests
// ============================================================================

describe('authenticateAgent', () => {
  describe('SF-058: no credentials → reject', () => {
    it('returns 401 when no headers and no session cookie', () => {
      /** SF-058 closed: no auth at all → rejected (was: system-owner) */
      const result = authenticateAgent(null, null, null)

      expect(result.error).toBeDefined()
      expect(result.status).toBe(401)
      expect(result.agentId).toBeUndefined()
      expect(mockAuthenticateRequest).not.toHaveBeenCalled()
    })
  })

  describe('session cookie auth (web UI user)', () => {
    it('returns system-owner when valid session cookie present', () => {
      /** Valid session cookie → system owner / web UI — full access with no agentId */
      mockExtractSessionFromCookie.mockReturnValue('valid-session-token')
      mockValidateSession.mockReturnValue(true)

      const result = authenticateAgent(null, null, 'aim_session=valid-session-token')

      expect(result).toEqual({})
      expect(result.agentId).toBeUndefined()
      expect(result.error).toBeUndefined()
      expect(mockAuthenticateRequest).not.toHaveBeenCalled()
    })

    it('returns 401 when session cookie is expired', () => {
      /** Expired session cookie → rejected */
      mockExtractSessionFromCookie.mockReturnValue('expired-token')
      mockValidateSession.mockReturnValue(false)

      const result = authenticateAgent(null, null, 'aim_session=expired-token')

      expect(result.error).toBeDefined()
      expect(result.status).toBe(401)
    })
  })

  describe('X-Agent-Id without Bearer', () => {
    it('returns 401 when X-Agent-Id is present without Authorization header', () => {
      /** X-Agent-Id without Bearer token is identity spoofing — must reject */
      const result = authenticateAgent(null, 'agent-123')

      expect(result.error).toBeDefined()
      expect(result.status).toBe(401)
      expect(result.agentId).toBeUndefined()
      expect(result.error).toContain('authentication')
      expect(mockAuthenticateRequest).not.toHaveBeenCalled()
    })
  })

  describe('AID governance token (aim_tk_*)', () => {
    it('returns agentId + title + team from valid AID token', () => {
      /** AID token includes governance context — no registry lookup needed */
      mockValidateGovernanceToken.mockReturnValue({
        agent_id: 'agent-uuid-123',
        governance_title: 'architect',
        team_id: 'team-uuid-456',
      })

      const result = authenticateAgent('Bearer aim_tk_validtoken', null)

      expect(result.agentId).toBe('agent-uuid-123')
      expect(result.governanceTitle).toBe('architect')
      expect(result.teamId).toBe('team-uuid-456')
      expect(result.error).toBeUndefined()
    })

    it('returns 401 for invalid AID token', () => {
      /** Expired or revoked AID token → rejected */
      mockValidateGovernanceToken.mockReturnValue(null)

      const result = authenticateAgent('Bearer aim_tk_badtoken', null)

      expect(result.error).toBeDefined()
      expect(result.status).toBe(401)
    })

    it('returns 403 when AID token agentId does not match X-Agent-Id', () => {
      /** AID token proves one identity, X-Agent-Id claims another → reject */
      mockValidateGovernanceToken.mockReturnValue({
        agent_id: 'agent-real',
        governance_title: 'member',
        team_id: null,
      })

      const result = authenticateAgent('Bearer aim_tk_validtoken', 'agent-impersonator')

      expect(result.error).toBeDefined()
      expect(result.status).toBe(403)
    })
  })

  describe('legacy AMP API key (amp_live_sk_*)', () => {
    it('returns authenticated agentId when valid Authorization with matching X-Agent-Id', () => {
      /** Valid Bearer token with matching X-Agent-Id — agent is authenticated */
      mockAuthenticateRequest.mockReturnValue({
        authenticated: true,
        agentId: 'agent-uuid-123',
        tenantId: 'tenant-1',
        address: 'agent@local',
      })

      const result = authenticateAgent('Bearer amp_live_sk_validkey', 'agent-uuid-123')

      expect(result.agentId).toBe('agent-uuid-123')
      expect(result.error).toBeUndefined()
      expect(result.governanceTitle).toBeUndefined() // legacy path has no title
    })

    it('returns authenticated agentId when valid Authorization without X-Agent-Id', () => {
      /** Valid Bearer token without X-Agent-Id — agent is authenticated from token alone */
      mockAuthenticateRequest.mockReturnValue({
        authenticated: true,
        agentId: 'agent-uuid-456',
        tenantId: 'tenant-1',
        address: 'agent@local',
      })

      const result = authenticateAgent('Bearer amp_live_sk_validkey', null)

      expect(result.agentId).toBe('agent-uuid-456')
      expect(result.error).toBeUndefined()
    })

    it('returns 401 when Authorization header contains invalid API key', () => {
      /** Invalid or expired API key in Bearer token — reject with 401 */
      mockAuthenticateRequest.mockReturnValue({
        authenticated: false,
        error: 'unauthorized',
        message: 'Invalid or expired API key',
      })

      const result = authenticateAgent('Bearer amp_live_sk_badkey', null)

      expect(result.error).toBeDefined()
      expect(result.status).toBe(401)
    })

    it('returns 403 when X-Agent-Id does not match authenticated agent identity', () => {
      /** X-Agent-Id claims to be a different agent than the Bearer token proves */
      mockAuthenticateRequest.mockReturnValue({
        authenticated: true,
        agentId: 'agent-real',
        tenantId: 'tenant-1',
        address: 'agent@local',
      })

      const result = authenticateAgent('Bearer amp_live_sk_validkey', 'agent-impersonator')

      expect(result.error).toBeDefined()
      expect(result.status).toBe(403)
      expect(result.error).toContain('does not match')
    })
  })
})
