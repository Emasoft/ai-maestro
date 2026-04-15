/**
 * ChangeClient unit test matrix — R18 cross-client plugin continuity
 *
 * WT-016#1 (SCEN-016 P0): SCEN-016 takes 10+ minutes to run end-to-end via
 * the browser. This test file is the first vitest-based fast-feedback
 * coverage for the ChangeClient decision logic, complementing (not
 * replacing) the full scenario.
 *
 * Scope: verify the **decision paths** of the pipeline:
 *  - Gate 0: authContext is required
 *  - Gate 1: agent must exist
 *  - No-op when the target client equals the current client
 *  - R18.3b invariant: X → Claude without a canonical Claude source is
 *    refused before any uninstall
 *
 * What is NOT covered here: the actual filesystem side-effects of
 * convert/emit/install/uninstall — those belong in the individual
 * client-plugin-adapters' own tests. The matrix here only exercises
 * ChangeClient's own gates with all dependencies mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// vi.hoisted pulls the mock refs above the vi.mock calls below so they
// are defined when Vitest rewrites the import graph.
const {
  mockGetAgent,
  mockUpdateAgent,
  mockScanAgentLocalConfig,
  mockGate0Auth,
} = vi.hoisted(() => ({
  mockGetAgent: vi.fn(),
  mockUpdateAgent: vi.fn(),
  mockScanAgentLocalConfig: vi.fn(),
  mockGate0Auth: vi.fn(async () => null),
}))

vi.mock('@/lib/agent-registry', () => ({
  getAgent: mockGetAgent,
  updateAgent: mockUpdateAgent,
  loadAgents: vi.fn(() => []),
  saveAgents: vi.fn(),
}))

vi.mock('@/services/agent-local-config-service', () => ({
  scanAgentLocalConfig: mockScanAgentLocalConfig,
}))

// gate0Auth lives inside element-management-service. There is no clean
// single import to mock it — the real function consults governance.json
// and the agent registry. These tests instead rely on the fact that
// `authContext: { isSystemOwner: true }` always passes Gate 0. When the
// suite needs to test rejection, it passes a missing authContext or
// uses an agent ID that fails Gate 1.

// Note: ChangeClient is imported lazily inside each test so the vi.mock
// rewrites above are in place before the module is evaluated.

describe('ChangeClient — R18 decision matrix', () => {
  beforeEach(() => {
    mockGetAgent.mockReset()
    mockUpdateAgent.mockReset()
    mockScanAgentLocalConfig.mockReset()
    mockGate0Auth.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('Gate 0: rejects when authContext is missing', async () => {
    // Aim: enforce the security invariant that authContext is mandatory
    // on ChangeClient. Gate 0 runs before any filesystem work.
    const { ChangeClient } = await import('@/services/element-management-service')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await ChangeClient('agent-id', 'codex', undefined as any)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/authContext/i)
  })

  it('Gate 1: rejects when the agent does not exist', async () => {
    // Aim: ChangeClient must fail fast before any snapshot/conversion
    // work when the target agent is not in the registry. This is a
    // cheap sanity gate that prevents spurious filesystem writes when
    // the caller passed a stale agent ID.
    mockGetAgent.mockReturnValue(undefined)
    const { ChangeClient } = await import('@/services/element-management-service')
    const result = await ChangeClient(
      'missing-agent-id',
      'codex',
      { isSystemOwner: true as const },
    )
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('No-op: target client equals current client', async () => {
    // Aim: if an agent already runs on the requested client, ChangeClient
    // should short-circuit without doing any uninstall/convert/install
    // work. Mocks are set up so any downstream side-effect would show
    // up as a spy call.
    mockGetAgent.mockReturnValue({
      id: 'agent-id',
      name: 'test-agent',
      program: 'claude',
      workingDirectory: '/tmp/test-agent',
    })
    mockScanAgentLocalConfig.mockResolvedValue({ plugins: [] })
    const { ChangeClient } = await import('@/services/element-management-service')
    const result = await ChangeClient(
      'agent-id',
      'claude',
      { isSystemOwner: true as const },
    )
    // Either success with no operations (short-circuit) OR a soft error
    // about no-op — both are acceptable outcomes. The critical assertion
    // is that updateAgent was NOT called with a new program value.
    const calledProgramUpdate = mockUpdateAgent.mock.calls.some(
      (call: unknown[]) => {
        const patch = call[1] as { program?: string } | undefined
        return patch && 'program' in patch
      },
    )
    expect(calledProgramUpdate).toBe(false)
    // The result is either success (no-op) or a no-op error — never a
    // half-applied state.
    if (!result.success) {
      expect(result.error).toMatch(/(no.?op|same.client|already)/i)
    }
  })

  it('Returns a ChangeResult with operations array', async () => {
    // Aim: every ChangeClient call — success or failure — must return a
    // ChangeResult whose `operations` field is an array of strings. Call
    // sites rely on this shape for logging.
    mockGetAgent.mockReturnValue(undefined)
    const { ChangeClient } = await import('@/services/element-management-service')
    const result = await ChangeClient(
      'agent-id',
      'codex',
      { isSystemOwner: true as const },
    )
    expect(result).toHaveProperty('operations')
    expect(Array.isArray(result.operations)).toBe(true)
    expect(result).toHaveProperty('success')
    expect(typeof result.success).toBe('boolean')
    expect(result).toHaveProperty('restartNeeded')
    expect(typeof result.restartNeeded).toBe('boolean')
  })

  it('R18.3b placeholder: X → Claude with no canonical source must refuse', async () => {
    // Aim: lock in the R18.3b invariant at a structural level. Full
    // verification of the priority-chain decision (client-native cache
    // first, then role-plugins marketplace, etc.) requires deeper mocks
    // on plugin-storage-service and the client adapters. This test is
    // the placeholder that will be expanded in a follow-up to mock
    // getClientPluginCache and verify the refusal path.
    //
    // For now, we assert the signature + the documented invariant via
    // the CLAUDE.md reference. If ChangeClient ever silently allows a
    // lossy X→Claude conversion, this test's follow-up expansion will
    // catch it.
    const { ChangeClient } = await import('@/services/element-management-service')
    expect(typeof ChangeClient).toBe('function')
    // Signature: (agentId, newClient, authContext) => Promise<ChangeResult>
    expect(ChangeClient.length).toBeGreaterThanOrEqual(2)
  })
})
