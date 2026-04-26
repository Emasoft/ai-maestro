/**
 * CreateAgent G11 — R17 core plugin install ops-log
 *
 * Background (R17 + SCEN-008 P0):
 *   Every agent that participates in the ecosystem MUST carry the
 *   `ai-maestro-plugin` at local scope. G11 delegates this install to
 *   the shared InstallElement pipeline. The gate has three behaviours:
 *
 *     A. plugin-capable client (claude, codex, etc.) + workDir set →
 *        G11 runs InstallElement for ai-maestro-plugin, ops log shows
 *        a non-skip G11 marker.
 *     B. plugin-incapable client (aider has `plugins: false`) →
 *        install is skipped, ops log contains "no plugin support".
 *        Writing .claude/settings.local.json for such a client would
 *        create an orphan config — the SCEN-008 regression gate
 *        prevents that.
 *     C. workDir always populated by G03 → the "No workDir" skip
 *        branch is dead-code in the happy path and must never appear
 *        in normal flow.
 *
 * Scope: verify the G11 ops-log markers for each branch. The actual
 * InstallElement call runs within the same module; since vi.spyOn
 * cannot intercept intra-module calls, we rely on ops-log strings and
 * on the observable absence of InstallElement-adjacent mock calls
 * (e.g. createPersona, which G11 doesn't invoke directly).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const {
  mockGetAgentByName,
  mockLoadAgents,
  mockCreateAgent,
  mockGetAgent,
  mockUpdateAgent,
  mockLoadSecurityConfig,
  mockCheckIbctScope,
  mockDetectClientType,
  mockGetClientCapabilities,
  mockHasKP,
  // Shared mutable registry backing for this test file. CreateAgent
  // calls createAgent() then ChangeTitle() which calls getAgent() —
  // without this bridging, ChangeTitle fails with "Agent not found".
  registryStore,
} = vi.hoisted(() => {
  const store = new Map<string, { id: string; name: string; program?: string; workingDirectory?: string; governanceTitle?: string | null }>()
  return {
    registryStore: store,
    mockGetAgentByName: vi.fn(),
    mockLoadAgents: vi.fn(() => Array.from(store.values())),
    mockCreateAgent: vi.fn(),
    mockGetAgent: vi.fn((id: string) => store.get(id)),
    // Returns the POST-patch object so ChangeTitle's Gate 14
     // ("in-memory post-write mismatch") can see the new title.
     // Returning the pre-patch reference (the previous bug) made
     // Gate 14 fail with `expected "autonomous", got "null"`, which
     // rolled the agent back at G06 in CreateAgent — G11 never ran.
    mockUpdateAgent: vi.fn(async (id: string, patch: Record<string, unknown>) => {
      const existing = store.get(id)
      if (!existing) return null
      const updated = { ...existing, ...patch }
      store.set(id, updated)
      return updated
    }),
    mockLoadSecurityConfig: vi.fn(() => ({
      agentCreation: { maxAgentsPerHost: 100, minIntervalSeconds: 0 },
    })),
    mockCheckIbctScope: vi.fn(() => null),
    mockDetectClientType: vi.fn(),
    mockGetClientCapabilities: vi.fn(),
    mockHasKP: vi.fn(() => true),
  }
})

vi.mock('@/lib/agent-registry', () => ({
  getAgentByName: mockGetAgentByName,
  loadAgents: mockLoadAgents,
  createAgent: mockCreateAgent,
  deleteAgent: vi.fn(async (id: string) => { registryStore.delete(id) }),
  updateAgent: mockUpdateAgent,
  getAgent: mockGetAgent,
  saveAgents: vi.fn(),
  // ChangeTitle Gate 14c emits per-op ledger entries via
  // lib/ledger-emit.ts which imports `registryLedger` from this
  // module and chains `.append(...).catch(...)`. The emit is
  // fire-and-forget and only WARNs on failure, but exporting a
  // resolving-promise stub here keeps the test stderr clean.
  registryLedger: { append: vi.fn(async () => undefined) },
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

vi.mock('@/services/plugin-storage-service', () => ({
  findNativePluginForClient: vi.fn(async () => null),
  emitForClient: vi.fn(async () => null),
  convertAndStorePlugin: vi.fn(),
  getUniversalIR: vi.fn(async () => null),
}))

vi.mock('@/services/role-plugin-service', () => ({
  createPersona: vi.fn(async () => ({ success: true })),
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

// Governance primitives that ChangeTitle consults at Gate 6-8. We stub
// them to a minimal no-manager, no-COS world so the pipeline can
// proceed past governance checks without touching governance.json.
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

// fs mock — ChangeTitle's Gate 14 and Gate 22 do a synchronous
// re-read of ~/.aimaestro/agents/registry.json via `readFileSync`
// to verify that the in-memory write was flushed to disk. Since the
// real registry never gets touched in this unit test, we serve a
// synthetic JSON document derived from the in-memory `registryStore`
// so the disk re-read sees exactly what `mockUpdateAgent` just wrote.
// Without this, Gate 14/22 would throw on JSON.parse and the
// pipeline would abort BEFORE reaching G11.
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

describe('CreateAgent G11 — R17 core plugin install', () => {
  beforeEach(() => {
    vi.resetModules()
    registryStore.clear()
    mockCreateAgent.mockReset().mockImplementation(async (input: { name: string; program?: string; workingDirectory?: string }) => {
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
    mockDetectClientType.mockReset()
    mockGetClientCapabilities.mockReset()
    // loadAgents derives from the store; reset the mock but keep impl
    mockLoadAgents.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  /**
   * Branch A: plugin-capable client → G11 runs InstallElement.
   * The ops log must contain a G11: line that is NOT the skip variant.
   */
  it('plugin-capable client (claude) → G11 runs (no skip marker)', async () => {
    mockDetectClientType.mockReturnValue('claude')
    mockGetClientCapabilities.mockReturnValue({
      plugins: true, skills: true, agents: true, hooks: true,
    })

    const { CreateAgent } = await import('@/services/element-management-service')
    const result = await CreateAgent({
      name: 'caps-ok',
      client: 'claude',
      governanceTitle: 'autonomous',
      authContext: { isSystemOwner: true as const },
    })

    const g11Line = result.operations.find(o => o.startsWith('G11:'))
    expect(g11Line).toBeDefined()
    // NOT the skip branches
    expect(g11Line).not.toMatch(/has no plugin support/i)
    expect(g11Line).not.toMatch(/No workDir/)
  })

  /**
   * Branch B: plugin-incapable client → G11 skipped.
   * The SCEN-008 regression gate: aider, opencode, etc. must NOT
   * receive a phantom ai-maestro-plugin install.
   */
  it('plugin-incapable client → G11 skipped with "no plugin support"', async () => {
    mockDetectClientType.mockReturnValue('aider')
    mockGetClientCapabilities.mockReturnValue({
      plugins: false, skills: true, agents: false, hooks: false,
    })

    const { CreateAgent } = await import('@/services/element-management-service')
    const result = await CreateAgent({
      name: 'caps-nope',
      // Pass an explicit program — G02 would otherwise rewrite
      // deprecated 'aider' clients.
      program: 'some-custom-binary',
      governanceTitle: 'autonomous',
      authContext: { isSystemOwner: true as const },
    })

    const g11Line = result.operations.find(o => o.startsWith('G11:'))
    expect(g11Line).toBeDefined()
    expect(g11Line).toMatch(/no plugin support/i)
  })

  /**
   * Branch C: workDir always populated by G03. The "No workDir" skip
   * branch must never appear in normal flow. If it ever does, G03 is
   * silently failing to create ~/agents/<name>/.
   */
  it('workDir populated by G03 → "No workDir" skip NEVER appears', async () => {
    mockDetectClientType.mockReturnValue('claude')
    mockGetClientCapabilities.mockReturnValue({
      plugins: true, skills: true, agents: true, hooks: true,
    })

    const { CreateAgent } = await import('@/services/element-management-service')
    const result = await CreateAgent({
      name: 'wd-set',
      client: 'claude',
      governanceTitle: 'autonomous',
      authContext: { isSystemOwner: true as const },
    })

    const ops = result.operations.join('\n')
    expect(ops).not.toMatch(/G11: No workDir/)
    // And G03 must log a workdir resolution op
    const g03Line = result.operations.find(o => o.startsWith('G03:'))
    expect(g03Line).toBeDefined()
  })
})
