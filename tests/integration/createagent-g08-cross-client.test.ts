/**
 * CreateAgent G08 — R18.3d cross-client plugin resolution (ops-log)
 *
 * Background (SCEN-007 P0-001):
 *   When CreateAgent is given `pluginName` on a non-Claude client, Gate
 *   G08 must follow the R18.3d decision chain:
 *
 *     1. findNativePluginForClient(name, clientType)   — reuse cache
 *     2. emitForClient(name, clientType)               — emit from IR
 *     3. convertAndStorePlugin(name, 'claude', [ct])   — fresh convert
 *
 *   Each hop is only reached when the previous one returns `null` (or
 *   throws for emitForClient). A silent regression here would either
 *   re-convert a plugin that already has a native cache entry (wasting
 *   seconds per agent creation) or re-emit when an IR already exists
 *   (lossy round-trip). The legacy code path used `convertElements`
 *   before R18 was adopted — that entrypoint must NEVER be called.
 *
 * Scope: verify the G08 ops-log markers AND that the plugin-storage
 * helpers are/aren't invoked for each state. ChangeTitle/ChangeTeam/
 * InstallElement run internally (same module); we observe their
 * downstream effect via the storage-service mocks, not via spies on
 * the re-exported functions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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
  mockFindNative,
  mockEmitForClient,
  mockConvertAndStore,
  mockCreatePersona,
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
      if (existing) store.set(id, { ...existing, ...patch })
      return existing
    }),
    mockGetAgent: vi.fn((id: string) => store.get(id)),
    mockLoadSecurityConfig: vi.fn(() => ({
      agentCreation: { maxAgentsPerHost: 100, minIntervalSeconds: 0 },
    })),
    mockCheckIbctScope: vi.fn(() => null),
    mockDetectClientType: vi.fn(),
    mockGetClientCapabilities: vi.fn(),
    mockFindNative: vi.fn(),
    mockEmitForClient: vi.fn(),
    mockConvertAndStore: vi.fn(),
    mockCreatePersona: vi.fn(async () => ({ success: true })),
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

vi.mock('@/services/plugin-storage-service', () => ({
  findNativePluginForClient: mockFindNative,
  emitForClient: mockEmitForClient,
  convertAndStorePlugin: mockConvertAndStore,
  getUniversalIR: vi.fn(async () => null),
}))

vi.mock('@/services/role-plugin-service', () => ({
  createPersona: mockCreatePersona,
  listRolePlugins: vi.fn(async () => []),
  getPluginsForTitle: vi.fn(() => []),
  installPluginLocally: vi.fn(async () => ({ success: true })),
  uninstallPluginLocally: vi.fn(async () => ({ success: true })),
}))

vi.mock('@/lib/team-registry', () => ({
  loadTeams: vi.fn(() => []),
  saveTeams: vi.fn(),
  getTeam: vi.fn(() => undefined),
  getTeamsForAgent: vi.fn(() => []),
  isAgentInAnyTeam: vi.fn(() => false),
  blockAllTeams: vi.fn(),
  unblockAllTeams: vi.fn(),
}))

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

vi.mock('@/lib/amp-keys', () => ({
  generateKeyPair: vi.fn(async () => ({
    privateKey: 'p', publicKey: 'u', fingerprint: 'f0123456789abcdef0',
  })),
  saveKeyPair: vi.fn(),
  hasKeyPair: mockHasKP,
}))

vi.mock('child_process', () => ({
  execFileSync: vi.fn(() => '/usr/bin/stub'),
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

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  promises: {
    readFile: vi.fn(async () => ''),
    writeFile: vi.fn(async () => undefined),
  },
}))

describe('CreateAgent G08 — R18.3d priority chain', () => {
  beforeEach(() => {
    vi.resetModules()
    registryStore.clear()
    mockCreateAgent.mockReset().mockImplementation(async (input: { name: string; program?: string; workingDirectory?: string }) => {
      const agent = {
        id: `agent-${input.name}-uuid`,
        name: input.name,
        program: input.program || 'codex',
        workingDirectory: input.workingDirectory || '',
        governanceTitle: null,
      }
      registryStore.set(agent.id, agent)
      return agent
    })
    mockDetectClientType.mockReset()
    mockGetClientCapabilities.mockReset()
    mockFindNative.mockReset()
    mockEmitForClient.mockReset()
    mockConvertAndStore.mockReset()
    mockCreatePersona.mockReset().mockResolvedValue({ success: true })
    mockLoadAgents.mockClear()
    // Default capabilities for a plugin-capable non-Claude client.
    mockGetClientCapabilities.mockReturnValue({
      plugins: true, skills: true, agents: true, hooks: false,
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // NOTE ON CALL FILTERS: ChangeTitle('autonomous') at G06 also drives
  // plugin conversion for the role-plugin `ai-maestro-autonomous-agent`
  // in its own G17. The G08 tests therefore filter mock calls by the
  // user-supplied plugin name ('my-plugin') to isolate the G08 branch
  // from the title's auto-install. Without this filter the counts
  // include the autonomous-role-plugin conversion too.
  const callsFor = <T>(
    spy: import('vitest').MockInstance,
    pluginName: string,
  ): T[][] => spy.mock.calls.filter(
    (c: unknown[]) => typeof c[0] === 'string' && c[0] === pluginName,
  ) as T[][]

  /**
   * Step 1 of R18.3d: native cache hit.
   * The observable signal is the G08 ops-log message — "reused native".
   * We do NOT count `convertAndStorePlugin` calls because the
   * downstream InstallElement recursion in the adapter install path
   * (InstallElement G13) ALWAYS runs convertAndStore for non-Claude
   * clients regardless of G08's decision. The test locks in the
   * ops-log contract instead: G08's OWN message must say "reused
   * native", proving the R18.3d step 1 branch was taken BEFORE the
   * downstream install.
   */
  it('R18.3d step 1: native cache hit → G08 ops shows "reused native"', async () => {
    mockDetectClientType.mockReturnValue('codex')
    mockFindNative.mockImplementation(async (name: string) => {
      if (name === 'my-plugin') return '/tmp/cache/codex/my-plugin'
      return null
    })

    const { CreateAgent } = await import('@/services/element-management-service')
    const result = await CreateAgent({
      name: 'codex-native',
      client: 'codex',
      pluginName: 'my-plugin',
      governanceTitle: 'autonomous',
      authContext: { isSystemOwner: true as const },
    })

    const g08Lines = result.operations.filter(o => o.startsWith('G08:'))
    const nativeLine = g08Lines.find(l => /my-plugin/.test(l) && /(reused native|native)/i.test(l))
    expect(nativeLine).toBeDefined()
    // The G08 ops line must NOT say "converted Claude → codex" — that
    // is the step 5 marker, which would mean the native hit was
    // ignored.
    const conversionLine = g08Lines.find(l => /my-plugin/.test(l) && /converted Claude/i.test(l))
    expect(conversionLine).toBeUndefined()
  })

  /**
   * Step 2-4 of R18.3d: no native cache for the user plugin;
   * emitForClient succeeds. The G08 ops line must indicate the
   * "reused emitted" branch (step 2-4), not the "converted" branch
   * (step 5). Downstream InstallElement recursion may still run
   * convertAndStorePlugin — that's independent of G08's decision.
   */
  it('R18.3d step 2-4: no native, IR exists → G08 ops shows emitted reuse', async () => {
    mockDetectClientType.mockReturnValue('codex')
    mockFindNative.mockResolvedValue(null)
    mockEmitForClient.mockImplementation(async (name: string) => {
      if (name === 'my-plugin') return '/tmp/custom-plugins/codex/my-plugin'
      throw new Error('no IR for ' + name)
    })

    const { CreateAgent } = await import('@/services/element-management-service')
    const result = await CreateAgent({
      name: 'codex-emit',
      client: 'codex',
      pluginName: 'my-plugin',
      governanceTitle: 'autonomous',
      authContext: { isSystemOwner: true as const },
    })

    // emitForClient must have been called for the user plugin
    const userEmitCalls = callsFor(mockEmitForClient, 'my-plugin')
    expect(userEmitCalls.length).toBeGreaterThanOrEqual(1)
    expect(userEmitCalls[0]).toEqual(['my-plugin', 'codex'])

    // G08 ops line marks the emitted-reuse branch, NOT the conversion
    const g08Lines = result.operations.filter(o => o.startsWith('G08:'))
    const reuseLine = g08Lines.find(l => /my-plugin/.test(l) && /reused native|emitted/i.test(l))
    expect(reuseLine).toBeDefined()
    // And it must NOT mention step-5 conversion for this plugin
    const convertLine = g08Lines.find(l => /my-plugin/.test(l) && /converted Claude/i.test(l))
    expect(convertLine).toBeUndefined()
  })

  /**
   * Step 5 of R18.3d: no native, no IR for user plugin →
   * convertAndStorePlugin('my-plugin', 'claude', ['codex']) runs.
   */
  it('R18.3d step 5: no native, no IR → convertAndStorePlugin runs for user plugin', async () => {
    mockDetectClientType.mockReturnValue('codex')
    // findNative: user plugin in target cache = null; user plugin in
    // Claude cache = truthy (so the "canonical Claude source missing"
    // refusal branch isn't tripped).
    mockFindNative.mockImplementation(async (name: string, clientType: string) => {
      if (name === 'my-plugin' && clientType === 'codex') return null
      if (name === 'my-plugin' && clientType === 'claude') return '/tmp/cache/claude/my-plugin'
      return null
    })
    mockEmitForClient.mockRejectedValue(new Error('no IR'))
    mockConvertAndStore.mockResolvedValue(undefined)

    const { CreateAgent } = await import('@/services/element-management-service')
    const result = await CreateAgent({
      name: 'codex-convert',
      client: 'codex',
      pluginName: 'my-plugin',
      governanceTitle: 'autonomous',
      authContext: { isSystemOwner: true as const },
    })

    // Filter calls to user plugin only — role-plugin conversion is
    // driven by ChangeTitle's G17 and is not part of G08. G08 itself
    // may also trigger follow-up InstallElement recursion that re-
    // attempts conversion; we only require that at least one
    // convertAndStorePlugin call was made for the user plugin with the
    // exact (name, 'claude', [clientType]) R18 signature.
    const userConvertCalls = callsFor(mockConvertAndStore, 'my-plugin')
    expect(userConvertCalls.length).toBeGreaterThanOrEqual(1)
    expect(userConvertCalls[0]).toEqual(['my-plugin', 'claude', ['codex']])

    const g08Lines = result.operations.filter(o => o.startsWith('G08:'))
    const convertLine = g08Lines.find(l => /converted Claude → codex/i.test(l))
    expect(convertLine).toBeDefined()
  })

  /**
   * Claude client path: createPersona wraps the install directly; the
   * R18 conversion chain must not be consulted.
   */
  it('Claude client: createPersona runs, R18 helpers bypassed', async () => {
    mockDetectClientType.mockReturnValue('claude')

    const { CreateAgent } = await import('@/services/element-management-service')
    const result = await CreateAgent({
      name: 'claude-native',
      client: 'claude',
      pluginName: 'my-plugin',
      label: 'Claude Persona',
      governanceTitle: 'autonomous',
      authContext: { isSystemOwner: true as const },
    })

    expect(mockCreatePersona).toHaveBeenCalledWith({
      personaName: 'Claude Persona',
      pluginName: 'my-plugin',
    })
    expect(mockFindNative).not.toHaveBeenCalled()
    expect(mockEmitForClient).not.toHaveBeenCalled()
    expect(mockConvertAndStore).not.toHaveBeenCalled()

    const g08Lines = result.operations.filter(o => o.startsWith('G08:'))
    const claudeLine = g08Lines.find(l => /my-plugin/.test(l) && /Claude/.test(l))
    expect(claudeLine).toBeDefined()
  })
})
