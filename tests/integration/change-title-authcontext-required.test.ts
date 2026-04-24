/**
 * Regression tests for SCEN-001 P0-001 (part 2) — the gaps the existing
 * `governance-title-auth.test.ts` could not cover because it mocks
 * `@/services/element-management-service`:
 *
 *   1. ChangeTitle Gate 0 hard-throw when `authContext` is missing.
 *   2. ChangeTeam hard-throw when `authContext` is missing.
 *   3. ChangeTeam forwards `authContext` to the downstream ChangeTitle
 *      call site that was the original BUG-002 (auto-title after team add).
 *
 * This file deliberately does NOT mock element-management-service. It imports
 * the real ChangeTitle + ChangeTeam so the Gate 0 throws are exercised
 * against the actual runtime guard. Lower-level dependencies that the
 * guards don't need to reach (governance, plugin management, tmux) are
 * stubbed just enough to let the flow run to the first downstream call.
 *
 * See: tests/scenarios/reports/scenario_proposed-improvements_001_20260413T214617Z.md
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

describe('ChangeTitle — Gate 0 hard-throw (SCEN-001 BUG-002)', () => {
  it('throws synchronously when authContext is undefined', async () => {
    /** The whole point of P0-001 is that the guard HARD-THROWS instead of
     * soft-returning a result the caller's try/catch can swallow. If a
     * future refactor restores the soft-return behavior, this test fails. */
    await expect(
      ChangeTitle('agent-1', 'manager', undefined as unknown as never),
    ).rejects.toThrow(/authContext is required/i)
  })

  it('throws when authContext is null', async () => {
    await expect(
      ChangeTitle('agent-1', 'manager', null as unknown as never),
    ).rejects.toThrow(/authContext is required/i)
  })

  it('throws BEFORE touching any dependency (no side effects)', async () => {
    /** Gate 0 must fire before the pipeline begins. No agent lookup, no team
     * lookup, no governance read, no plugin scan. If the throw happens AFTER
     * a dependency call, a test-double side effect could mask the gate. */
    let thrown: Error | null = null
    try {
      await ChangeTitle('agent-1', 'manager', undefined as unknown as never)
    } catch (err) {
      thrown = err as Error
    }
    expect(thrown).toBeInstanceOf(Error)
    expect(thrown?.message).toMatch(/authContext is required/i)
    expect(mockAgentRegistry.getAgent).not.toHaveBeenCalled()
    expect(mockAgentRegistry.loadAgents).not.toHaveBeenCalled()
    expect(mockGovernance.loadGovernance).not.toHaveBeenCalled()
    expect(mockTeamRegistry.loadTeams).not.toHaveBeenCalled()
    expect(mockElementScan.scanAgentLocalConfig).not.toHaveBeenCalled()
  })
})

describe('ChangeTeam — Gate 0 hard-throw (SCEN-001 BUG-002)', () => {
  it('throws synchronously when authContext is undefined', async () => {
    /** Same contract as ChangeTitle — ChangeTeam is the PRIMARY caller of
     * ChangeTitle's auto-title cascade; forgetting authContext here was the
     * original BUG-002 surface in PATCH /api/teams/{id}. */
    await expect(
      ChangeTeam('agent-1', { teamId: 'team-1' }, undefined as unknown as never),
    ).rejects.toThrow(/authContext/i)
  })

  it('throws when authContext is null', async () => {
    await expect(
      ChangeTeam('agent-1', { teamId: 'team-1' }, null as unknown as never),
    ).rejects.toThrow(/authContext/i)
  })

  it('throws BEFORE modifying any state (no agent.json write, no team.json write)', async () => {
    /** The pre-fix bug was "agent added to team.agentIds but never titled".
     * Gate 0 must fire BEFORE saveTeams / updateAgent — otherwise a
     * future refactor could split the failure across two writes again. */
    let thrown: Error | null = null
    try {
      await ChangeTeam('agent-1', { teamId: 'team-1' }, undefined as unknown as never)
    } catch (err) {
      thrown = err as Error
    }
    expect(thrown).toBeInstanceOf(Error)
    expect(thrown?.message).toMatch(/authContext/i)
    expect(mockTeamRegistry.saveTeams).not.toHaveBeenCalled()
    expect(mockAgentRegistry.updateAgent).not.toHaveBeenCalled()
  })
})
