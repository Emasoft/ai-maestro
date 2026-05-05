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
