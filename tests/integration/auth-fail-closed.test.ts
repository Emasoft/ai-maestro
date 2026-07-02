/**
 * Regression tests for AUTH-CRIT-01 (2026-05-04 audit): authorize() must
 * fail closed on errored auth results.
 *
 * The bug: previous version of `authorize()` checked only `!auth.agentId`
 * to grant system-owner access. An `AgentAuthResult` from a failed
 * authentication (e.g. `{ error: 'token_invalid', agentId: undefined }`)
 * has `!auth.agentId === true` and slipped into the system-owner branch,
 * granting unrestricted access to anyone whose token failed verification.
 *
 * The fix (commit pending): explicit `if (auth.error) return { allowed: false }`
 * MUST run before the system-owner check.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Hoisted mocks: the authorize() module imports lookup helpers that read
// the file-based registry. Stub them so the test is hermetic.
const { mockAgentRegistry, mockTeams, mockGovernance } = vi.hoisted(() => ({
  mockAgentRegistry: {
    getAgent: vi.fn(() => null),
    loadAgents: vi.fn(() => []),
  },
  mockTeams: {
    loadTeams: vi.fn(() => []),
  },
  mockGovernance: {
    loadGovernance: vi.fn(() => ({ version: 1, managerId: null, passwordHash: null, passwordSetAt: null })),
  },
}))

vi.mock('@/lib/agent-registry', () => mockAgentRegistry)
vi.mock('@/lib/team-registry', () => mockTeams)
vi.mock('@/lib/governance', () => mockGovernance)

import { authorize } from '@/lib/authorization'
import type { AgentAuthResult } from '@/lib/agent-auth'

describe('authorize() — fail-closed on errored auth result (AUTH-CRIT-01)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects an auth result with an error string', () => {
    /** A failed authentication that left agentId undefined must NOT be
     * treated as system-owner. The fix's whole point. */
    const failedAuth: AgentAuthResult = {
      error: 'token_invalid',
      status: 401,
      agentId: undefined,
    }
    const result = authorize(failedAuth, 'modify-agent', 'some-target')
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('token_invalid')
  })

  it('rejects an auth result with a generic error string', () => {
    const failedAuth: AgentAuthResult = {
      error: 'forged_signature',
      agentId: undefined,
    }
    const result = authorize(failedAuth, 'delete-agent', 'some-target')
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('forged_signature')
  })

  it('rejects errored auth even on change-title (the most-restricted action)', () => {
    /** change-title has the strictest rules. An errored auth must not even
     * reach the change-title path, let alone the self-check. */
    const failedAuth: AgentAuthResult = {
      error: 'replay_detected',
      agentId: undefined,
    }
    const result = authorize(failedAuth, 'change-title', 'some-target')
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('replay_detected')
  })

  it('still grants system-owner for a clean (no error, no agentId) auth result', () => {
    /** The legitimate web-UI path: authenticate() returns {} when there's
     * no agent identity but no error either. Web UI is the user (system
     * owner). This must remain allowed. */
    const cleanWebUI: AgentAuthResult = {} // no error, no agentId
    const result = authorize(cleanWebUI, 'modify-agent', 'any-target')
    expect(result.allowed).toBe(true)
  })

  it('still allows a real agent caller with a valid agentId', () => {
    /** Sanity: agent auth path still works after the fix. */
    const agentAuth: AgentAuthResult = {
      agentId: 'manager-bot',
      governanceTitle: 'manager',
    }
    const result = authorize(agentAuth, 'modify-agent', 'some-other-agent')
    expect(result.allowed).toBe(true)
  })
})

describe('authorize() — deny-by-default for a model-ON non-system-owner USER (M1/U1, R26-R40 audit)', () => {
  /**
   * Under the user-authority model (R36/R37), a non-maestro web/AID user
   * resolves to { userId, userTitle:'user' } with NO agentId. Before the M1
   * fix, that principal fell into the legacy `!agentId ⇒ system-owner` grant
   * and could delete agents / teams / kill sessions. authorize() must now DENY
   * any userId-bearing principal whose title is not maestro/maestro-delegate,
   * WITHOUT regressing the flag-OFF web session ({}) or the maestro user.
   */
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('denies a model-ON normal user (userTitle:user, no agentId) on delete-agent', () => {
    const normalUser: AgentAuthResult = {
      userId: 'user-uuid-1',
      userTitle: 'user',
      agentId: undefined,
    }
    const result = authorize(normalUser, 'delete-agent', 'victim-agent')
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/not authorized/i)
  })

  it('denies a model-ON normal user on manage-team (the team-deletion authz)', () => {
    /** DELETE /api/teams/[id] → DeleteTeam → gate0Auth('manage-team') → authorize(). */
    const normalUser: AgentAuthResult = {
      userId: 'user-uuid-2',
      userTitle: 'user',
      agentId: undefined,
    }
    const result = authorize(normalUser, 'manage-team', 'some-team-id')
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/not authorized/i)
  })

  it('denies a model-ON normal user on session control (delete-session)', () => {
    const normalUser: AgentAuthResult = {
      userId: 'user-uuid-3',
      userTitle: 'user',
      agentId: undefined,
    }
    const result = authorize(normalUser, 'delete-session', 'some-agent')
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/not authorized/i)
  })

  it('ZERO-REGRESSION: flag-OFF system-owner web session ({}) is still allowed on delete-agent', () => {
    /** Model OFF → authenticateAgent returns {} (no userId). The new deny must
     * NOT trigger (it keys on the presence of userId, not on !agentId), so the
     * legacy system-owner grant still applies. This is the sacred invariant. */
    const flagOffWebUI: AgentAuthResult = {} // no error, no userId, no agentId
    const result = authorize(flagOffWebUI, 'delete-agent', 'any-agent')
    expect(result.allowed).toBe(true)
  })

  it('ZERO-REGRESSION: flag-OFF system-owner web session ({}) is still allowed on manage-team', () => {
    const flagOffWebUI: AgentAuthResult = {}
    const result = authorize(flagOffWebUI, 'manage-team', 'any-team')
    expect(result.allowed).toBe(true)
  })

  it('still allows a model-ON MAESTRO user (the active system owner) on delete-agent', () => {
    /** A userId-bearing principal whose title IS maestro is the active system
     * owner — it must skip the deny branch and keep the system-owner grant. */
    const maestroUser: AgentAuthResult = {
      userId: 'maestro-uuid',
      userTitle: 'maestro',
      agentId: undefined,
    }
    const result = authorize(maestroUser, 'delete-agent', 'any-agent')
    expect(result.allowed).toBe(true)
  })

  it('still allows a model-ON maestro-delegate on manage-team', () => {
    const delegateUser: AgentAuthResult = {
      userId: 'delegate-uuid',
      userTitle: 'maestro-delegate',
      agentId: undefined,
    }
    const result = authorize(delegateUser, 'manage-team', 'any-team')
    expect(result.allowed).toBe(true)
  })
})
