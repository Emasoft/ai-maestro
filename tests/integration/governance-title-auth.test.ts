/**
 * Regression test for SCEN-001 P0-001: authContext passed to ChangeTitle
 *
 * BUG (pre-fix): `setManagerRole` called `ChangeTitle(agentId, 'manager')`
 * without passing an `authContext`. Gate 0 of ChangeTitle rejected the call
 * with "authContext is mandatory for ChangeTitle (security invariant)", so
 * every "Assign MANAGER" click in the UI silently failed.
 *
 * This test locks the fix in place: `setManagerRole` MUST pass a
 * system-owner authContext to `ChangeTitle` on both promotion (assign) and
 * demotion (remove) paths. If a future refactor drops the authContext, this
 * test fails at the compile-time mock assertion.
 *
 * See: tests/scenarios/reports/scenario_proposed-improvements_001_20260413T214617Z.md § "P0: Commit & ship the authContext fixes"
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAgent } from '../test-utils/fixtures'

// ============================================================================
// Mocks — vi.hoisted() ensures availability before vi.mock() runs
// ============================================================================

const {
  mockGovernanceLib,
  mockAgentRegistry,
  mockRateLimit,
  mockChangeTitle,
  mockTeamRegistry,
  mockFileLock,
  mockManagerTrust,
  mockNotificationService,
  mockTransferRegistry,
  mockMessageFilter,
  mockValidation,
} = vi.hoisted(() => ({
  mockGovernanceLib: {
    loadGovernance: vi.fn(),
    verifyPassword: vi.fn(),
    setManager: vi.fn(),
    removeManager: vi.fn(),
    setPassword: vi.fn(),
    setUserName: vi.fn(),
    isManager: vi.fn(() => false),
    isChiefOfStaffAnywhere: vi.fn(() => false),
    getManagerId: vi.fn(() => null),
  },
  mockAgentRegistry: {
    getAgent: vi.fn(),
    loadAgents: vi.fn(() => []),
    updateAgent: vi.fn(),
  },
  mockRateLimit: {
    checkAndRecordAttempt: vi.fn(() => ({ allowed: true, retryAfterMs: 0 })),
    resetRateLimit: vi.fn(),
  },
  // Spy on ChangeTitle — this is the assertion surface for this regression test
  mockChangeTitle: vi.fn(),
  mockTeamRegistry: {
    loadTeams: vi.fn(() => []),
    saveTeams: vi.fn(),
    TeamValidationException: class extends Error {
      code: number
      constructor(message: string, code: number) {
        super(message)
        this.name = 'TeamValidationException'
        this.code = code
      }
    },
  },
  mockFileLock: {
    acquireLock: vi.fn(() => Promise.resolve(() => {})),
    withLock: vi.fn((_name: string, fn: () => unknown) => Promise.resolve(fn())),
  },
  mockManagerTrust: {
    addTrustedManager: vi.fn(),
    removeTrustedManager: vi.fn(),
    getTrustedManagers: vi.fn(() => []),
  },
  mockNotificationService: {
    notifyAgent: vi.fn(),
  },
  mockTransferRegistry: {
    loadTransfers: vi.fn(() => []),
    createTransferRequest: vi.fn(),
    getTransferRequest: vi.fn(),
    resolveTransferRequest: vi.fn(),
    revertTransferToPending: vi.fn(),
    getPendingTransfersForAgent: vi.fn(() => []),
  },
  mockMessageFilter: {
    checkMessageAllowed: vi.fn(() => true),
  },
  mockValidation: {
    isValidUuid: vi.fn(() => true),
  },
}))

vi.mock('@/lib/governance', () => mockGovernanceLib)
vi.mock('@/lib/agent-registry', () => mockAgentRegistry)
vi.mock('@/lib/rate-limit', () => mockRateLimit)
vi.mock('@/lib/team-registry', () => mockTeamRegistry)
vi.mock('@/lib/file-lock', () => mockFileLock)
vi.mock('@/lib/manager-trust', () => mockManagerTrust)
vi.mock('@/lib/notification-service', () => mockNotificationService)
vi.mock('@/lib/transfer-registry', () => mockTransferRegistry)
vi.mock('@/lib/message-filter', () => mockMessageFilter)
vi.mock('@/lib/validation', () => mockValidation)

// Mock element-management-service: setManagerRole dynamically imports ChangeTitle
// from this module. vi.mock intercepts dynamic imports the same as static ones.
vi.mock('@/services/element-management-service', () => ({
  ChangeTitle: (...args: unknown[]) => mockChangeTitle(...args),
}))

// ============================================================================
// Import module under test (after mocks)
// ============================================================================

import { setManagerRole } from '@/services/governance-service'

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks()
  // Default: password is set (caller can pass any non-empty password)
  mockGovernanceLib.loadGovernance.mockReturnValue({
    passwordHash: 'hashed:test-password',
    managerId: null,
  })
  mockGovernanceLib.verifyPassword.mockResolvedValue(true)
  // Default: rate limit allows
  mockRateLimit.checkAndRecordAttempt.mockReturnValue({ allowed: true, retryAfterMs: 0 })
  // Default: ChangeTitle succeeds
  mockChangeTitle.mockResolvedValue({
    success: true,
    agentId: 'agent-1',
    oldTitle: null,
    newTitle: 'manager',
    operations: [],
    installedPlugin: null,
    uninstalledPlugin: null,
    restartNeeded: false,
  })
})

// ============================================================================
// Tests — SCEN-001 P0 regression
// ============================================================================

describe('setManagerRole (regression: SCEN-001 P0 — authContext propagation)', () => {
  it('passes authContext to ChangeTitle when promoting an agent to MANAGER', async () => {
    /** Promoting a MANAGER MUST pass a system-owner authContext to ChangeTitle,
     * otherwise Gate 0 rejects the call with "authContext is mandatory". */
    const agent = makeAgent({ id: 'agent-1', name: 'jack-bot' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)

    const result = await setManagerRole({ agentId: 'agent-1', password: 'test-password' })

    expect(result.status).toBe(200)
    expect(result.data?.success).toBe(true)
    expect(result.data?.managerId).toBe('agent-1')

    // The core assertion: ChangeTitle was called with authContext
    expect(mockChangeTitle).toHaveBeenCalledTimes(1)
    const [calledAgentId, calledNewTitle, calledOptions] = mockChangeTitle.mock.calls[0] as [
      string,
      string | null,
      { authContext?: { isSystemOwner?: boolean } } | undefined,
    ]
    expect(calledAgentId).toBe('agent-1')
    expect(calledNewTitle).toBe('manager')
    expect(calledOptions).toBeDefined()
    expect(calledOptions?.authContext).toBeDefined()
    expect(calledOptions?.authContext?.isSystemOwner).toBe(true)
  })

  it('passes authContext to ChangeTitle when demoting the current MANAGER', async () => {
    /** Demoting a MANAGER (agentId === null) MUST also pass a system-owner
     * authContext — same Gate 0 invariant applies on removal. */
    const currentManager = makeAgent({ id: 'jack-bot-id', name: 'jack-bot' })
    mockGovernanceLib.loadGovernance.mockReturnValue({
      passwordHash: 'hashed:test-password',
      managerId: 'jack-bot-id',
    })
    mockAgentRegistry.getAgent.mockReturnValue(currentManager)

    const result = await setManagerRole({ agentId: null, password: 'test-password' })

    expect(result.status).toBe(200)
    expect(result.data?.success).toBe(true)
    expect(result.data?.managerId).toBeNull()

    // The core assertion: ChangeTitle was called with authContext on removal too
    expect(mockChangeTitle).toHaveBeenCalledTimes(1)
    const [calledAgentId, calledNewTitle, calledOptions] = mockChangeTitle.mock.calls[0] as [
      string,
      string | null,
      { authContext?: { isSystemOwner?: boolean } } | undefined,
    ]
    expect(calledAgentId).toBe('jack-bot-id')
    expect(calledNewTitle).toBeNull()
    expect(calledOptions).toBeDefined()
    expect(calledOptions?.authContext).toBeDefined()
    expect(calledOptions?.authContext?.isSystemOwner).toBe(true)
  })

  it('propagates ChangeTitle failure to the caller (no silent swallow)', async () => {
    /** If ChangeTitle fails on promotion, setManagerRole MUST return a 500
     * error — it cannot silently succeed. This protects against the
     * scenario where Gate 0 rejects the call and the UI shows "success". */
    const agent = makeAgent({ id: 'agent-2', name: 'bad-agent' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockChangeTitle.mockResolvedValue({
      success: false,
      agentId: 'agent-2',
      oldTitle: null,
      newTitle: 'manager',
      operations: [],
      installedPlugin: null,
      uninstalledPlugin: null,
      restartNeeded: false,
      error: 'some downstream failure',
    })

    const result = await setManagerRole({ agentId: 'agent-2', password: 'test-password' })

    expect(result.status).toBe(500)
    expect(result.error).toMatch(/downstream failure/i)
  })

  it('rejects when governance password is missing from the request', async () => {
    /** Sanity check: password is required. This path does NOT call ChangeTitle. */
    const result = await setManagerRole({ agentId: 'agent-1', password: '' })

    expect(result.status).toBe(400)
    expect(mockChangeTitle).not.toHaveBeenCalled()
  })

  it('rejects when governance password is wrong', async () => {
    /** Sanity check: bad password is rejected before ChangeTitle is invoked. */
    mockGovernanceLib.verifyPassword.mockResolvedValue(false)

    const result = await setManagerRole({ agentId: 'agent-1', password: 'wrong-password' })

    expect(result.status).toBe(401)
    expect(mockChangeTitle).not.toHaveBeenCalled()
  })

  it('rejects when target agent does not exist', async () => {
    /** Sanity check: missing agent short-circuits before ChangeTitle. */
    mockAgentRegistry.getAgent.mockReturnValue(undefined)

    const result = await setManagerRole({ agentId: 'ghost-agent', password: 'test-password' })

    expect(result.status).toBe(404)
    expect(mockChangeTitle).not.toHaveBeenCalled()
  })

  // ==========================================================================
  // Gap-fill tests added after PR #31 review (2026-04-25)
  // — close the security-relevant branch coverage gaps flagged by
  //   pr-test-analyzer report 20260425_111129+0200-pr31-test-analysis.md
  // ==========================================================================

  it('rejects with 400 when governance password has never been set (passwordHash empty)', async () => {
    /** B2: If `loadGovernance().passwordHash` is unset, setManagerRole MUST
     * refuse before any other check. A bypass here would let any caller assign
     * MANAGER on a freshly-installed system that hasn't been initialized. */
    mockGovernanceLib.loadGovernance.mockReturnValue({
      passwordHash: '',
      managerId: null,
    })

    const result = await setManagerRole({ agentId: 'agent-1', password: 'anything' })

    expect(result.status).toBe(400)
    expect(result.error).toMatch(/password.*not set/i)
    expect(mockChangeTitle).not.toHaveBeenCalled()
    expect(mockGovernanceLib.verifyPassword).not.toHaveBeenCalled()
  })

  it('rejects with 429 when rate limit blocks the request', async () => {
    /** B3 / EC2: Brute-force protection. checkAndRecordAttempt is the
     * gate; if it returns allowed=false, setManagerRole MUST return 429
     * BEFORE verifyPassword runs. Locks in the security invariant that
     * password verification cannot be reached when rate-limited — a future
     * refactor that moves verifyPassword above the rate check would silently
     * defeat brute-force protection. */
    mockRateLimit.checkAndRecordAttempt.mockReturnValue({ allowed: false, retryAfterMs: 30_000 })

    const result = await setManagerRole({ agentId: 'agent-1', password: 'test-password' })

    expect(result.status).toBe(429)
    expect(result.error).toMatch(/too many/i)
    expect(mockGovernanceLib.verifyPassword).not.toHaveBeenCalled()
    expect(mockChangeTitle).not.toHaveBeenCalled()
  })

  it('calls removeManager() and skips ChangeTitle when demoting with no current manager', async () => {
    /** B6: If agentId === null AND there is no existing managerId in
     * governance.json, setManagerRole takes the alternate code path:
     * `removeManager()` (idempotent no-op) instead of ChangeTitle. A
     * refactor that always called ChangeTitle here would pass `null` as
     * the agentId — an early gate of ChangeTitle treats `null`/empty
     * agentId as invalid and would return success=false, which is
     * silently warned. The 200 status would mask the regression. */
    mockGovernanceLib.loadGovernance.mockReturnValue({
      passwordHash: 'hashed:test-password',
      managerId: null, // no current manager
    })

    const result = await setManagerRole({ agentId: null, password: 'test-password' })

    expect(result.status).toBe(200)
    expect(result.data?.success).toBe(true)
    expect(result.data?.managerId).toBeNull()
    expect(mockChangeTitle).not.toHaveBeenCalled()
    expect(mockGovernanceLib.removeManager).toHaveBeenCalledTimes(1)
  })

  it('still returns 200 when demoting and ChangeTitle fails (silent-swallow demotion path)', async () => {
    /** B5-failure: setManagerRole INTENTIONALLY swallows ChangeTitle errors
     * on the demotion path — the manager-removal flow tolerates partial
     * failure (governance.json updates separately) and only logs a console
     * warning. This test locks in that behavior so a "fix" propagating the
     * demotion error as 500 would be caught by code review.
     *
     * Note: this is the OPPOSITE of the promotion-failure test (which
     * returns 500). The asymmetry is documented in the production code at
     * services/governance-service.ts:99-101. */
    const currentManager = makeAgent({ id: 'old-manager-id', name: 'old-bot' })
    mockGovernanceLib.loadGovernance.mockReturnValue({
      passwordHash: 'hashed:test-password',
      managerId: 'old-manager-id',
    })
    mockAgentRegistry.getAgent.mockReturnValue(currentManager)
    mockChangeTitle.mockResolvedValue({
      success: false,
      agentId: 'old-manager-id',
      oldTitle: 'manager',
      newTitle: null,
      operations: [],
      installedPlugin: null,
      uninstalledPlugin: null,
      restartNeeded: false,
      error: 'plugin uninstall failed',
    })

    const result = await setManagerRole({ agentId: null, password: 'test-password' })

    // Still 200 — the demotion path is tolerant of partial failure.
    expect(result.status).toBe(200)
    expect(result.data?.success).toBe(true)
    expect(result.data?.managerId).toBeNull()

    // ChangeTitle was still called with authContext — even though it failed.
    // This is the security invariant: authContext flows on EVERY ChangeTitle
    // invocation, regardless of whether the call succeeds or fails downstream.
    expect(mockChangeTitle).toHaveBeenCalledTimes(1)
    const calledOptions = mockChangeTitle.mock.calls[0]?.[2] as
      | { authContext?: { isSystemOwner?: boolean } }
      | undefined
    expect(calledOptions?.authContext?.isSystemOwner).toBe(true)
  })

  it('passes authContext to ChangeTitle even when promotion fails (failure-path invariant)', async () => {
    /** B9: The "propagates ChangeTitle failure" test above only asserts
     * the 500 status. This test asserts the OTHER half — that authContext
     * was correctly passed even on the failure branch. A refactor that
     * passed authContext only when ChangeTitle was expected to succeed
     * (e.g. via a feature-flag) would still pass the existing tests; this
     * one catches it. */
    const agent = makeAgent({ id: 'agent-3', name: 'failing-bot' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockChangeTitle.mockResolvedValue({
      success: false,
      agentId: 'agent-3',
      oldTitle: null,
      newTitle: 'manager',
      operations: [],
      installedPlugin: null,
      uninstalledPlugin: null,
      restartNeeded: false,
      error: 'gate failure',
    })

    const result = await setManagerRole({ agentId: 'agent-3', password: 'test-password' })

    expect(result.status).toBe(500)

    // authContext invariant: present on every ChangeTitle call, even failures.
    expect(mockChangeTitle).toHaveBeenCalledTimes(1)
    const calledOptions = mockChangeTitle.mock.calls[0]?.[2] as
      | { authContext?: { isSystemOwner?: boolean } }
      | undefined
    expect(calledOptions?.authContext?.isSystemOwner).toBe(true)
  })

  it('passes the stale oldManagerId straight to ChangeTitle without validating it (locks current behavior)', async () => {
    /** EC6: setManagerRole does NOT validate that governance.json's
     * managerId still corresponds to a real agent before passing it to
     * ChangeTitle on the demotion path. If the agent was deleted out of
     * band (registry corruption / manual edit), ChangeTitle receives a
     * non-existent agentId and is responsible for handling it.
     *
     * This test locks the boundary: setManagerRole's responsibility is to
     * forward the id; ChangeTitle owns the existence check. A future
     * refactor that adds a getAgent(oldManagerId) precondition here would
     * change setManagerRole's contract and should be a deliberate choice
     * caught by code review. */
    mockGovernanceLib.loadGovernance.mockReturnValue({
      passwordHash: 'hashed:test-password',
      managerId: 'stale-deleted-agent-id',
    })
    // Note: getAgent is NOT called on the demotion path with agentId=null
    // (only the promotion path calls getAgent). So the mock value is irrelevant
    // here — what matters is that ChangeTitle gets the stale id verbatim.

    const result = await setManagerRole({ agentId: null, password: 'test-password' })

    expect(result.status).toBe(200)
    expect(mockChangeTitle).toHaveBeenCalledTimes(1)
    const [calledAgentId] = mockChangeTitle.mock.calls[0] as [string, string | null, unknown]
    expect(calledAgentId).toBe('stale-deleted-agent-id')
  })

  it('propagates ChangeTitle rejection (current code path uses await without try/catch)', async () => {
    /** EC9: Production code at services/governance-service.ts:98 and
     * :119 awaits ChangeTitle without try/catch. If ChangeTitle rejects
     * (uncaught throw rather than {success:false}), the rejection bubbles
     * to the route handler, which surfaces as a 500 from Next.js's
     * default error handling.
     *
     * This test locks in that behavior. If a future refactor adds
     * try/catch and converts the rejection into a controlled
     * {success:false}, this test will fail and the developer will need
     * to consciously decide whether the new error semantics are correct. */
    const agent = makeAgent({ id: 'agent-4', name: 'thrower-bot' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockChangeTitle.mockRejectedValueOnce(new Error('boom: ChangeTitle threw'))

    await expect(
      setManagerRole({ agentId: 'agent-4', password: 'test-password' }),
    ).rejects.toThrow(/boom/i)

    // ChangeTitle WAS called once (and threw) — verify authContext was
    // still passed on the call that threw.
    expect(mockChangeTitle).toHaveBeenCalledTimes(1)
    const calledOptions = mockChangeTitle.mock.calls[0]?.[2] as
      | { authContext?: { isSystemOwner?: boolean } }
      | undefined
    expect(calledOptions?.authContext?.isSystemOwner).toBe(true)
  })
})
