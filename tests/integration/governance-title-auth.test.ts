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
  it('passes authContext as positional arg 3 to ChangeTitle when promoting to MANAGER', async () => {
    /** Promoting a MANAGER MUST pass a system-owner authContext to ChangeTitle.
     * P0-001 (2026-04-14): authContext is now a REQUIRED positional argument
     * on ChangeTitle — not an options field. This prevents the silent bug
     * class where callers forget the options bag entirely. */
    const agent = makeAgent({ id: 'agent-1', name: 'jack-bot' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)

    const result = await setManagerRole({ agentId: 'agent-1', password: 'test-password' })

    expect(result.status).toBe(200)
    expect(result.data?.success).toBe(true)
    expect(result.data?.managerId).toBe('agent-1')

    // The core assertion: ChangeTitle was called with authContext as arg 3
    expect(mockChangeTitle).toHaveBeenCalledTimes(1)
    const [calledAgentId, calledNewTitle, calledAuthContext] = mockChangeTitle.mock.calls[0] as [
      string,
      string | null,
      { isSystemOwner?: boolean } | undefined,
    ]
    expect(calledAgentId).toBe('agent-1')
    expect(calledNewTitle).toBe('manager')
    expect(calledAuthContext).toBeDefined()
    expect(calledAuthContext?.isSystemOwner).toBe(true)
  })

  it('passes authContext as positional arg 3 to ChangeTitle when demoting the current MANAGER', async () => {
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

    // The core assertion: ChangeTitle was called with authContext as arg 3 on removal too
    expect(mockChangeTitle).toHaveBeenCalledTimes(1)
    const [calledAgentId, calledNewTitle, calledAuthContext] = mockChangeTitle.mock.calls[0] as [
      string,
      string | null,
      { isSystemOwner?: boolean } | undefined,
    ]
    expect(calledAgentId).toBe('jack-bot-id')
    expect(calledNewTitle).toBeNull()
    expect(calledAuthContext).toBeDefined()
    expect(calledAuthContext?.isSystemOwner).toBe(true)
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
})
