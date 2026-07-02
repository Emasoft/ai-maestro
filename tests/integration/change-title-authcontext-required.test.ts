/**
 * Regression tests for SCEN-001 P0-001 (part 2) — the gaps the existing
 * `governance-title-auth.test.ts` could not cover because it mocks
 * `@/services/element-management-service`:
 *
 *   1. ChangeTitle Gate 0 mandatory-authContext guard.
 *   2. ChangeTeam Gate 0 mandatory-authContext guard (THE BUG: the guard was
 *      missing on HEAD; recovered + restored as part of the worktree
 *      bug-recovery audit on 2026-05-04).
 *   3. Both guards must fire BEFORE any state-touching dependency is reached.
 *
 * History: this file was first written in commit `a07b0972` against an
 * earlier API draft that used `throw` for Gate 0 violations. The current
 * implementation uses Result-based error returns (`{success: false, error}`),
 * so the assertions here check `result.error` rather than `rejects.toThrow`.
 * The original commit message's intent — "the test suite verified the
 * caller-side surface but never the guard itself" — is preserved.
 *
 * This file deliberately does NOT mock element-management-service. It imports
 * the real ChangeTitle + ChangeTeam so Gate 0 is exercised against the
 * actual runtime guard. Lower-level dependencies that the guards don't
 * need to reach are stubbed just enough to let the flow run if Gate 0 is
 * accidentally absent — that way the test still fails loudly, instead of
 * silently passing on a function that has no guard.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================================
// Mocks — hoisted so vi.mock() resolves before the SUT imports them
// ============================================================================

const {
  mockAgentRegistry,
  mockGovernance,
  mockTeamRegistry,
  mockFileLock,
  mockElementScan,
  mockInstall,
  mockUninstall,
} = vi.hoisted(() => ({
  mockAgentRegistry: {
    getAgent: vi.fn(() => ({
      id: 'agent-1',
      name: 'test-agent',
      governanceTitle: null,
      program: 'claude',
      workingDirectory: '/tmp/agents/test-agent',
      config: {},
    })),
    loadAgents: vi.fn(() => []),
    updateAgent: vi.fn(),
    getAgentBySession: vi.fn(() => null),
  },
  mockGovernance: {
    loadGovernance: vi.fn(() => ({ managerId: null })),
    saveGovernance: vi.fn(),
    isManager: vi.fn(() => false),
    getManagerId: vi.fn(() => null),
  },
  mockTeamRegistry: {
    loadTeams: vi.fn(() => []),
    saveTeams: vi.fn(),
    blockAllTeams: vi.fn(),
    unblockAllTeams: vi.fn(),
    isAgentInAnyTeam: vi.fn(() => false),
    getTeam: vi.fn(() => null),
    updateTeam: vi.fn(),
  },
  mockFileLock: {
    acquireLock: vi.fn(() => Promise.resolve(() => {})),
    withLock: vi.fn((_name: string, fn: () => unknown) => Promise.resolve(fn())),
  },
  mockElementScan: {
    scanAgentLocalConfig: vi.fn(() =>
      Promise.resolve({ plugins: [], skills: [], agents: [], commands: [], rules: [], hooks: [], mcp: [], lsp: [], outputStyles: [], rolePlugin: null }),
    ),
  },
  mockInstall: vi.fn(),
  mockUninstall: vi.fn(),
}))

vi.mock('@/lib/agent-registry', () => mockAgentRegistry)
vi.mock('@/lib/governance', () => mockGovernance)
vi.mock('@/lib/team-registry', () => mockTeamRegistry)
vi.mock('@/lib/file-lock', () => mockFileLock)
vi.mock('@/services/agent-local-config-service', () => mockElementScan)
vi.mock('@/services/role-plugin-service', () => ({
  installPluginLocally: mockInstall,
  uninstallPluginLocally: mockUninstall,
  installPluginForAgent: mockInstall,
  uninstallPluginForAgent: mockUninstall,
}))

// ============================================================================
// Import modules under test (after mocks)
// ============================================================================

import { ChangeTitle, ChangeTeam } from '@/services/element-management-service'

// ============================================================================
// Tests
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ChangeTitle — Gate 0 mandatory authContext (SCEN-001 BUG-002 regression)', () => {
  it('returns error when authContext is undefined', async () => {
    const result = await ChangeTitle('agent-1', 'manager', undefined as unknown as never)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/authContext is mandatory/i)
  })

  it('returns error when authContext is null', async () => {
    const result = await ChangeTitle('agent-1', 'manager', null as unknown as never)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/authContext is mandatory/i)
  })

  it('rejects BEFORE touching any dependency (no agent lookup, no governance read, no plugin scan)', async () => {
    /** Gate 0 must fire before the pipeline begins. If a future refactor
     * splits the guard across dependency side effects, this assertion
     * catches it. */
    const result = await ChangeTitle('agent-1', 'manager', undefined as unknown as never)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/authContext is mandatory/i)
    expect(mockAgentRegistry.getAgent).not.toHaveBeenCalled()
    expect(mockAgentRegistry.loadAgents).not.toHaveBeenCalled()
    expect(mockGovernance.loadGovernance).not.toHaveBeenCalled()
    expect(mockTeamRegistry.loadTeams).not.toHaveBeenCalled()
    expect(mockElementScan.scanAgentLocalConfig).not.toHaveBeenCalled()
  })
})

describe('ChangeTeam — Gate 0 mandatory authContext (SCEN-001 BUG-002 regression — recovered 2026-05-04)', () => {
  it('returns error when authContext is undefined', async () => {
    /** ChangeTeam was the PRIMARY caller of ChangeTitle's auto-title cascade;
     * forgetting authContext here was the original BUG-002 surface in
     * PATCH /api/teams/{id}. The Gate 0 guard on ChangeTeam was missing on
     * HEAD until the worktree bug-recovery audit (2026-05-04) restored it. */
    const result = await ChangeTeam('agent-1', { teamId: 'team-1' }, undefined as unknown as never)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/authContext is mandatory for ChangeTeam/i)
  })

  it('returns error when authContext is null', async () => {
    const result = await ChangeTeam('agent-1', { teamId: 'team-1' }, null as unknown as never)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/authContext is mandatory for ChangeTeam/i)
  })

  it('rejects BEFORE modifying any state (no saveTeams, no updateAgent)', async () => {
    /** The pre-fix bug was "agent added to team.agentIds but never titled".
     * Gate 0 must fire BEFORE saveTeams / updateAgent — otherwise a future
     * refactor could split the failure across two writes again. */
    const result = await ChangeTeam('agent-1', { teamId: 'team-1' }, undefined as unknown as never)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/authContext is mandatory for ChangeTeam/i)
    expect(mockTeamRegistry.saveTeams).not.toHaveBeenCalled()
    expect(mockAgentRegistry.updateAgent).not.toHaveBeenCalled()
    // also assert no agent lookup happened (G01 must come AFTER Gate 0)
    expect(mockAgentRegistry.getAgent).not.toHaveBeenCalled()
  })
})
