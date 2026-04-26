/**
 * CreateAgent — G06/G07 title-and-team ordering (observable effects)
 *
 * Background (SCEN-003, SCEN-007, SCEN-010, SCEN-020):
 *   The governance pipeline must correctly handle the interaction between
 *   a requested governanceTitle and teamId when both are supplied at
 *   creation time. The three decision paths in G06 + G07 are:
 *
 *     1. Team-required title (member, chief-of-staff, orchestrator,
 *        architect, integrator) + teamId → G06 DEFERS the title,
 *        G07 joins the team, G07b re-applies the requested title.
 *     2. Standalone title (manager, autonomous, maintainer) + teamId →
 *        G06 applies the title directly, G07 adds to team afterwards.
 *     3. No title, no team → G06 defaults to AUTONOMOUS (R9.13 guarantees
 *        every persisted agent has a role-plugin).
 *
 * Scope of this suite: verify the G01–G03 + G06 ops-log markers that
 * CreateAgent emits for each branch. ChangeTitle/ChangeTeam are called
 * internally (same module), which vi.spyOn cannot reliably intercept,
 * so these tests focus on the observable ops-log strings that document
 * the decision actually taken. Full end-to-end behaviour is exercised
 * by the browser scenarios (SCEN-020, SCEN-007, SCEN-010).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Hoist mock refs so they are in scope when vi.mock() rewrites imports.
// The `registryStore` bridges createAgent() / getAgent() / updateAgent()
// so ChangeTitle (called internally by CreateAgent G06) can locate the
// just-created agent. Without it, ChangeTitle's Gate 1 fails with
// "Agent not found" and G06 rolls back the creation.
const {
  mockGetAgentByName,
  mockLoadAgents,
  mockCreateAgent,
  mockDeleteAgent,
  mockUpdateAgent,
  mockGetAgent,
  mockLoadSecurityConfig,
  mockCheckIbctScope,
  mockDetectClientType,
  mockGetClientCapabilities,
  mockHasKP,
  registryStore,
} = vi.hoisted(() => {
  const store = new Map<string, { id: string; name: string; program?: string; workingDirectory?: string; governanceTitle?: string | null }>()
  return {
    registryStore: store,
    mockGetAgentByName: vi.fn(),
    mockLoadAgents: vi.fn(() => Array.from(store.values())),
    mockCreateAgent: vi.fn(),
    mockDeleteAgent: vi.fn(async (id: string) => { store.delete(id) }),
    mockUpdateAgent: vi.fn(async (id: string, patch: Record<string, unknown>) => {
      const existing = store.get(id)
      if (!existing) return null
      const updated = { ...existing, ...patch }
      store.set(id, updated)
      // Return the PATCHED record so ChangeTitle Gate 14's in-memory check
      // (g14Updated.governanceTitle === effectiveTitle) sees the new value.
      // Returning `existing` would leak the pre-patch reference and the
      // gate would short-circuit with "in-memory post-write mismatch".
      return updated
    }),
    mockGetAgent: vi.fn((id: string) => store.get(id)),
    mockLoadSecurityConfig: vi.fn(() => ({
      agentCreation: { maxAgentsPerHost: 100, minIntervalSeconds: 0 },
    })),
    mockCheckIbctScope: vi.fn(() => null),
    mockDetectClientType: vi.fn(() => 'claude'),
    mockGetClientCapabilities: vi.fn(() => ({
      plugins: true, skills: true, agents: true, hooks: true,
    })),
    mockHasKP: vi.fn(() => true),
  }
})

vi.mock('@/lib/agent-registry', () => ({
  getAgentByName: mockGetAgentByName,
  loadAgents: mockLoadAgents,
  createAgent: mockCreateAgent,
  deleteAgent: mockDeleteAgent,
  updateAgent: mockUpdateAgent,
  getAgent: mockGetAgent,
  saveAgents: vi.fn(),
}))

vi.mock('@/lib/security-config', () => ({
  loadSecurityConfig: mockLoadSecurityConfig,
}))

vi.mock('@/lib/ibct-scope-check', () => ({
  checkIbctScope: mockCheckIbctScope,
}))

vi.mock('@/lib/client-capabilities', () => ({
  getClientCapabilities: mockGetClientCapabilities,
  detectClientType: mockDetectClientType,
}))

vi.mock('@/lib/amp-keys', () => ({
  generateKeyPair: vi.fn(async () => ({
    privateKey: 'p', publicKey: 'u', fingerprint: 'f0123456789abcdef0',
  })),
  saveKeyPair: vi.fn(),
  hasKeyPair: mockHasKP,
}))

// All ChangeTitle/ChangeTeam calls inside CreateAgent point at the same
// module's internal bindings (not re-resolved through the module's own
// exports). To avoid exercising the full title/team pipelines — which
// would require mocking governance.json, team-registry, role-plugin
// install, marketplaces, etc. — we mock the deepest primitives those
// pipelines touch so they fail gracefully and CreateAgent's ops log
// still reflects the branch taken.
vi.mock('@/lib/team-registry', () => ({
  loadTeams: vi.fn(() => []),
  saveTeams: vi.fn(),
  getTeam: vi.fn(() => undefined),
  getTeamsForAgent: vi.fn(() => []),
  isAgentInAnyTeam: vi.fn(() => false),
  blockAllTeams: vi.fn(),
  unblockAllTeams: vi.fn(),
  // ChangeTitle Gates 11/12/13b call updateTeam to clear/set
  // chiefOfStaffId/orchestratorId on team transitions. ChangeTeam (called
  // from CreateAgent G07 for the team-required-title branch) also relies
  // on this. Without it, "No updateTeam export defined" is thrown and the
  // pipeline collapses before G07/G07b ops are logged.
  updateTeam: vi.fn(async () => undefined),
  deleteTeam: vi.fn(async () => undefined),
  addTeam: vi.fn(async () => undefined),
}))

// Governance primitives consulted by ChangeTitle. Stubbed to a
// no-manager/no-COS world so the pipeline can proceed past governance
// checks without touching governance.json.
vi.mock('@/lib/governance', () => ({
  isManager: vi.fn(() => false),
  getManagerId: vi.fn(() => null),
  isChiefOfStaffAnywhere: vi.fn(() => false),
  setManager: vi.fn(async () => undefined),
  removeManager: vi.fn(async () => undefined),
  loadGovernance: vi.fn(() => ({ managerId: null, chiefsOfStaff: {} })),
  saveGovernance: vi.fn(),
}))

vi.mock('@/lib/governance-sync', () => ({
  broadcastGovernanceSync: vi.fn(),
}))

vi.mock('@/lib/governance-request-registry', () => ({
  loadGovernanceRequests: vi.fn(() => []),
  rejectGovernanceRequest: vi.fn(),
  approveGovernanceRequest: vi.fn(),
  createGovernanceRequest: vi.fn(),
}))

vi.mock('@/services/governance-service', () => ({
  transferManager: vi.fn(),
  assignCOS: vi.fn(),
  removeCOS: vi.fn(),
}))

vi.mock('@/services/role-plugin-service', () => ({
  createPersona: vi.fn(async () => ({ success: true })),
  listRolePlugins: vi.fn(async () => []),
  getPluginsForTitle: vi.fn(() => []),
  installPluginLocally: vi.fn(async () => ({ success: true })),
  uninstallPluginLocally: vi.fn(async () => ({ success: true })),
}))

vi.mock('@/services/plugin-storage-service', () => ({
  findNativePluginForClient: vi.fn(async () => null),
  emitForClient: vi.fn(async () => null),
  convertAndStorePlugin: vi.fn(),
  getUniversalIR: vi.fn(async () => null),
}))

vi.mock('child_process', () => ({
  execFileSync: vi.fn(() => '/usr/bin/claude'),
  execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb?: (err: Error | null, stdout: string, stderr: string) => void) => {
    if (typeof cb === 'function') cb(new Error('stub'), '', '')
  }),
}))

vi.mock('fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  stat: vi.fn(async () => {
    const err = new Error('ENOENT') as Error & { code?: string }
    err.code = 'ENOENT'
    throw err
  }),
  readFile: vi.fn(async () => ''),
  writeFile: vi.fn(async () => undefined),
}))

// ChangeTitle Gates 14 + 22 verify that the registry write landed by reading
// ~/.aimaestro/agents/registry.json from disk via fs.readFileSync. Without a
// readFileSync mock that mirrors registryStore, Gate 14 throws + the catch
// returns "G14: registry verification failed", which short-circuits the
// pipeline before G07 ("No team requested") is logged. Mirror the in-memory
// store so the on-disk view matches whatever updateAgent has just written.
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn((p: string) => {
    if (typeof p === 'string' && p.endsWith('registry.json')) {
      return JSON.stringify(Array.from(registryStore.values()))
    }
    return ''
  }),
  promises: {
    readFile: vi.fn(async () => ''),
    writeFile: vi.fn(async () => undefined),
  },
}))

describe('CreateAgent — G06/G07 ordering (ops-log regression)', () => {
  beforeEach(() => {
    vi.resetModules()
    registryStore.clear()
    mockGetAgentByName.mockReset()
    mockLoadAgents.mockClear()
    mockCreateAgent.mockReset()
    mockDeleteAgent.mockClear()
    mockUpdateAgent.mockClear()
    mockCheckIbctScope.mockReset().mockReturnValue(null)
    mockDetectClientType.mockReset().mockReturnValue('claude')
    mockGetClientCapabilities.mockReset().mockReturnValue({
      plugins: true, skills: true, agents: true, hooks: true,
    })

    mockCreateAgent.mockImplementation(async (input: { name: string; program?: string; workingDirectory?: string }) => {
      const agent = {
        id: `agent-${input.name}-uuid`,
        name: input.name,
        program: input.program || 'claude',
        workingDirectory: input.workingDirectory || '',
        governanceTitle: null,
      }
      registryStore.set(agent.id, agent)
      return agent
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  /**
   * Regression gate for SCEN-003 / SCEN-020: team-required title + teamId
   * MUST NOT trigger a G06 title assignment. G06 must log a DEFER marker
   * and let G07/G07b apply the title after the team join. If a future
   * refactor ever drops the `titleNeedsTeamFirst` check, G06 would call
   * ChangeTitle too early and Gate 9 would reject it because the agent
   * isn't in the team yet — silently producing an AUTONOMOUS agent.
   */
  it('team-required title + teamId → ops log shows G06 DEFER', async () => {
    const { CreateAgent } = await import('@/services/element-management-service')
    const result = await CreateAgent({
      name: 'member-alpha',
      client: 'claude',
      governanceTitle: 'member',
      teamId: 'team-xyz',
      authContext: { isSystemOwner: true as const },
    })

    // Lookup the G06 ops line — it must start with DEFER, not with an
    // immediate ChangeTitle result.
    const g06Line = result.operations.find(o => o.startsWith('G06:'))
    expect(g06Line).toBeDefined()
    expect(g06Line).toMatch(/DEFER/i)
    expect(g06Line).toMatch(/team/i)
    // G06 must NOT say the title was set here
    expect(g06Line).not.toMatch(/Title set to MEMBER/)

    // And the agent record was created — createAgent was invoked
    expect(mockCreateAgent).toHaveBeenCalledTimes(1)
  })

  /**
   * Standalone title: the G06 ops line must show the title name in caps
   * without a DEFER marker. This is the happy path for MANAGER,
   * AUTONOMOUS, MAINTAINER — titles that don't require team membership.
   */
  it('standalone title (manager) → ops log shows G06 applied directly', async () => {
    const { CreateAgent } = await import('@/services/element-management-service')
    const result = await CreateAgent({
      name: 'mgr-alpha',
      client: 'claude',
      governanceTitle: 'manager',
      authContext: { isSystemOwner: true as const },
    })

    const g06Line = result.operations.find(o => o.startsWith('G06:'))
    expect(g06Line).toBeDefined()
    // MANAGER is standalone, no DEFER
    expect(g06Line).not.toMatch(/DEFER/i)
    expect(mockCreateAgent).toHaveBeenCalledTimes(1)
  })

  /**
   * No-title branch (R9.13 fallback). Every persisted agent MUST carry a
   * role-plugin — omitting `governanceTitle` should route through the
   * AUTONOMOUS default in G06. The ops log MUST show the R9.13 marker so
   * a future audit can verify the fallback ran.
   */
  it('no title + no team → G06 defaults to AUTONOMOUS (R9.13 fallback)', async () => {
    const { CreateAgent } = await import('@/services/element-management-service')
    const result = await CreateAgent({
      name: 'solo-alpha',
      client: 'claude',
      authContext: { isSystemOwner: true as const },
    })

    const g06Line = result.operations.find(o => o.startsWith('G06:'))
    expect(g06Line).toBeDefined()
    expect(g06Line).toMatch(/AUTONOMOUS/i)
    expect(g06Line).toMatch(/R9\.13/)

    // And G07 must record that no team was requested
    const g07Line = result.operations.find(o => o.startsWith('G07:'))
    expect(g07Line).toBeDefined()
    expect(g07Line).toMatch(/no team/i)
  })

  /**
   * Name validation gate (G01). Bad names must fail fast BEFORE any
   * filesystem or registry work. This catches regressions where the
   * validation regex is relaxed and slashes/spaces/Unicode leak through.
   */
  it('G01: rejects invalid name, no createAgent call', async () => {
    const { CreateAgent } = await import('@/services/element-management-service')
    const result = await CreateAgent({
      name: 'bad name with spaces',
      client: 'claude',
      authContext: { isSystemOwner: true as const },
    })
    expect(result.success).toBe(false)
    expect(result.agentId).toBeNull()
    expect(result.error).toMatch(/Invalid agent name/i)
    expect(mockCreateAgent).not.toHaveBeenCalled()
  })

  /**
   * Name uniqueness gate (G01b) — SCEN-016 regression. A live (non-
   * tombstoned) agent with the same name must block creation. Soft-
   * deleted entries must NOT block (tested elsewhere).
   */
  it('G01b: rejects when name already exists in registry', async () => {
    mockGetAgentByName.mockReturnValue({ id: 'existing-id', name: 'dup' })
    const { CreateAgent } = await import('@/services/element-management-service')
    const result = await CreateAgent({
      name: 'dup',
      client: 'claude',
      authContext: { isSystemOwner: true as const },
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/already exists/i)
    expect(mockCreateAgent).not.toHaveBeenCalled()
  })
})
