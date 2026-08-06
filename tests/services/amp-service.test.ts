/**
 * amp-service getAgentSelf auth tests (ai-maestro#46, GET-scoped widening — ae3414f4).
 *
 * GET /api/v1/agents/me must accept the credentials the SERVER ITSELF hands a
 * session (the mst_* session secret / an aim_tk_ AID token, resolved by
 * lib/agent-auth::authenticateAgent) as a FALLBACK when AMP api-key auth fails —
 * while a USER-scope credential (no agent behind it) stays 401, and the primary
 * AMP-key path is unchanged. The auth stacks and the registry are mocked (they
 * are getAgentSelf's DATA SOURCES, not the logic under test); getAgentSelf runs
 * REAL.
 *
 * NEUTER RUN (2026-08-06 — OBSERVED via scripts/dev/neuter, restore verified by blob hash):
 *   s/if \(!selfAgentId\) \{/if (false) {/ if $. == 1582   (the fallback ENTRY, not the 401 below)
 *   → 2 red / 2 green:
 *       a fallback identity that is not in the registry is 404, not 401 (the fallback RAN)
 *       accepts the server-issued mst_* credential via the authenticateAgent fallback (200, self identity)
 * The USER-401 and AMP-key-primary tests stayed green — which is what
 * discriminates "fallback removed" from "everything broken".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mocks: every export amp-service destructures from these modules must be
// --- defined, or the import itself throws (module-mock destructure trap).
const { mockAmpAuth, mockAgentAuth, mockRegistry, mockKeys } = vi.hoisted(() => ({
  mockAmpAuth: {
    authenticateRequest: vi.fn(),
    createApiKey: vi.fn(),
    hashApiKey: vi.fn(),
    extractApiKeyFromHeader: vi.fn(),
    revokeApiKey: vi.fn(),
    rotateApiKey: vi.fn(),
    revokeAllKeysForAgent: vi.fn(),
  },
  mockAgentAuth: {
    authenticateAgent: vi.fn(),
  },
  mockRegistry: {
    loadAgents: vi.fn(() => []),
    createAgent: vi.fn(),
    getAgent: vi.fn(),
    getAgentByName: vi.fn(),
    getAgentByNameAnyHost: vi.fn(),
    updateAgent: vi.fn(),
    deleteAgent: vi.fn(),
    markAgentAsAMPRegistered: vi.fn(),
    checkMeshAgentExists: vi.fn(),
    getAMPRegisteredAgents: vi.fn(() => []),
  },
  mockKeys: {
    saveKeyPair: vi.fn(),
    loadKeyPair: vi.fn(),
    calculateFingerprint: vi.fn(),
    verifySignature: vi.fn(),
    generateKeyPair: vi.fn(),
  },
}))

vi.mock('@/lib/amp-auth', () => mockAmpAuth)
vi.mock('@/lib/agent-auth', () => mockAgentAuth)
vi.mock('@/lib/agent-registry', () => mockRegistry)
vi.mock('@/lib/amp-keys', () => mockKeys)
vi.mock('@/lib/messageQueue', () => ({ resolveAgentIdentifier: vi.fn() }))
vi.mock('@/lib/hosts-config-server.mjs', () => ({
  getSelfHostId: vi.fn(() => 'local'),
  getSelfHost: vi.fn(() => ({ id: 'local', name: 'local', url: 'http://localhost:23000' })),
  getHostById: vi.fn(),
  isSelf: vi.fn(() => true),
  getOrganization: vi.fn(() => 'test-org'),
}))

import { getAgentSelf } from '@/services/amp-service'

const AGENT = {
  id: 'agent-1',
  name: 'probe-agent',
  alias: 'Probe',
  label: 'probe',
  createdAt: '2026-01-01T00:00:00Z',
  lastActive: '2026-08-01T00:00:00Z',
  metadata: { amp: { address: 'amp:probe@local', registeredAt: '2026-02-02T00:00:00Z', delivery: { mode: 'push' } } },
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default world: AMP-key auth FAILS, main-auth resolves no agent, registry has AGENT.
  mockAmpAuth.authenticateRequest.mockReturnValue({
    authenticated: false,
    error: 'unauthorized',
    message: 'Invalid or expired API key',
  })
  mockAgentAuth.authenticateAgent.mockReturnValue({})
  mockRegistry.getAgent.mockImplementation((id: string) => (id === 'agent-1' ? AGENT : null))
  mockKeys.loadKeyPair.mockReturnValue({ fingerprint: 'fp-probe' })
})

describe('getAgentSelf — GET /api/v1/agents/me auth widening (ai-maestro#46)', () => {
  it('accepts the server-issued mst_* credential via the authenticateAgent fallback (200, self identity)', () => {
    /** THE owed pin for ae3414f4: AMP-key auth fails, main auth resolves the agent -> 200. */
    mockAgentAuth.authenticateAgent.mockReturnValue({ agentId: 'agent-1' })

    const res = getAgentSelf('Bearer mst_session_secret')

    expect(res.status).toBe(200)
    // The fallback consulted the MAIN auth stack with the same header, no agent-id/cookie hints.
    expect(mockAgentAuth.authenticateAgent).toHaveBeenCalledWith('Bearer mst_session_secret', null, null)
    // No AMP-layer address on this path -> the registration metadata is the record of one.
    expect(res.data.address).toBe('amp:probe@local')
    expect(res.data.fingerprint).toBe('fp-probe')
    expect(mockRegistry.getAgent).toHaveBeenCalledWith('agent-1')
  })

  it('a fallback identity that is not in the registry is 404, not 401 (the fallback RAN)', () => {
    /** Drives the fallback through the not-found branch — also red under the fallback neuter. */
    mockAgentAuth.authenticateAgent.mockReturnValue({ agentId: 'ghost-agent' })

    const res = getAgentSelf('Bearer mst_session_secret')

    expect(res.status).toBe(404)
    expect(res.data.error).toBe('not_found')
  })

  it('a USER-scope credential (no agent behind it) is still 401 — this is agent self-identity', () => {
    /** authenticateAgent returning {} (system owner / user token, no agentId) must NOT pass. */
    mockAgentAuth.authenticateAgent.mockReturnValue({ isSystemOwner: true })

    const res = getAgentSelf('Bearer aim_tk_user_token')

    expect(res.status).toBe(401)
    // Pin the REASON: the AMP-layer error is what surfaces, not a generic throw.
    expect(res.data.error).toBe('unauthorized')
    expect(res.data.message).toBe('Invalid or expired API key')
  })

  it('the primary AMP api-key path is unchanged and never consults the main auth stack', () => {
    /** Positive control for the pre-#46 behavior: AMP address wins, fallback not called. */
    mockAmpAuth.authenticateRequest.mockReturnValue({
      authenticated: true,
      agentId: 'agent-1',
      address: 'amp:direct@local',
    })

    const res = getAgentSelf('Bearer amp_live_key')

    expect(res.status).toBe(200)
    expect(res.data.address).toBe('amp:direct@local')
    expect(mockAgentAuth.authenticateAgent).not.toHaveBeenCalled()
  })
})
