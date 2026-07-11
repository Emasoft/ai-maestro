/**
 * CreateAgent G05c + G03-CLAMP / allowExternalFolder threading (TRDD-57EBNB72)
 *
 * Covers the folder-adoption fixes:
 *   A. G05c runs for every created agent and calls the workdir gitignore
 *      seeder with the resolved workDir (git-repo pollution protection).
 *   B. allowExternalFolder=true + a folder under ~/agents (or $HOME) is
 *      HONORED — G03-ENFORCE must not force the workdir back.
 *   C. flag absent + external folder → forced back to ~/agents/<name>/.
 *   D. flag present but folder outside $HOME → G03-CLAMP ignores the flag
 *      (ops line) and the workdir is forced back.
 *
 * Mock scaffold cloned from createagent-g11-r17-core.test.ts — the shared
 * registryStore bridges createAgent → ChangeTitle → getAgent.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import os from 'os'
import { join } from 'path'

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
  mockEnsureWorkdirGitignore,
  registryStore,
} = vi.hoisted(() => {
  const store = new Map<string, { id: string; name: string; program?: string; workingDirectory?: string; governanceTitle?: string | null }>()
  return {
    registryStore: store,
    mockGetAgentByName: vi.fn(),
    mockLoadAgents: vi.fn(() => Array.from(store.values())),
    mockCreateAgent: vi.fn(),
    mockGetAgent: vi.fn((id: string) => store.get(id)),
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
    mockEnsureWorkdirGitignore: vi.fn(async () => ({
      created: true, updated: false, unchanged: false, skipped: false,
    })),
  }
})

vi.mock('@/lib/workdir-gitignore-seed', () => ({
  ensureWorkdirGitignore: mockEnsureWorkdirGitignore,
}))

vi.mock('@/lib/agent-registry', () => ({
  getAgentByName: mockGetAgentByName,
  loadAgents: mockLoadAgents,
  createAgent: mockCreateAgent,
  deleteAgent: vi.fn(async (id: string) => { registryStore.delete(id) }),
  updateAgent: mockUpdateAgent,
  getAgent: mockGetAgent,
  saveAgents: vi.fn(),
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

const HOME = os.homedir()

function setupClaudeClient() {
  mockDetectClientType.mockReturnValue('claude')
  mockGetClientCapabilities.mockReturnValue({
    plugins: true, skills: true, agents: true, hooks: true,
  })
}

describe('CreateAgent G05c gitignore seeding + allowExternalFolder (TRDD-57EBNB72)', () => {
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
    mockLoadAgents.mockClear()
    mockEnsureWorkdirGitignore.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('A: G05c calls the gitignore seeder with the resolved workDir and logs the op', async () => {
    setupClaudeClient()
    const { CreateAgent } = await import('@/services/element-management-service')
    const result = await CreateAgent({
      name: 'gi-default',
      client: 'claude',
      governanceTitle: 'autonomous',
      authContext: { isSystemOwner: true as const },
    })

    const g05cLine = result.operations.find(o => o.startsWith('G05c:'))
    expect(g05cLine).toBeDefined()
    // TRDD-VYQ8N4KR: G05c is now the `git-exclude` row of the invariant list
    // rather than a hand-rolled gate. The G05c op LABEL is deliberately
    // preserved (it is the AIO's per-gate contract); only the prose moved.
    expect(g05cLine).toMatch(/git-exclude=repaired \(created\)/)
    expect(mockEnsureWorkdirGitignore).toHaveBeenCalledWith(join(HOME, 'agents', 'gi-default'))
  })

  it('A2: a non-repo workdir logs the skip variant instead', async () => {
    setupClaudeClient()
    mockEnsureWorkdirGitignore.mockResolvedValueOnce({
      created: false, updated: false, unchanged: false, skipped: true,
    })
    const { CreateAgent } = await import('@/services/element-management-service')
    const result = await CreateAgent({
      name: 'gi-skip',
      client: 'claude',
      governanceTitle: 'autonomous',
      authContext: { isSystemOwner: true as const },
    })
    const g05cLine = result.operations.find(o => o.startsWith('G05c:'))
    expect(g05cLine).toMatch(/not a git repo/)
  })

  it('B: allowExternalFolder=true honors a folder under ~/agents with a foreign name', async () => {
    setupClaudeClient()
    const adopted = join(HOME, 'agents', 'adopted-plugin-repo')
    const { CreateAgent } = await import('@/services/element-management-service')
    const result = await CreateAgent({
      name: 'gi-adopt',
      client: 'claude',
      governanceTitle: 'autonomous',
      workingDirectory: adopted,
      allowExternalFolder: true,
      authContext: { isSystemOwner: true as const },
    })

    expect(result.success).toBe(true)
    const created = mockCreateAgent.mock.calls[0][0] as { workingDirectory?: string }
    expect(created.workingDirectory).toBe(adopted)
    expect(mockEnsureWorkdirGitignore).toHaveBeenCalledWith(adopted)
    expect(result.operations.join('\n')).not.toContain('G03-CLAMP')
  })

  it('C: flag ABSENT + external folder → G03-ENFORCE forces ~/agents/<name>/', async () => {
    setupClaudeClient()
    const { CreateAgent } = await import('@/services/element-management-service')
    await CreateAgent({
      name: 'gi-forced',
      client: 'claude',
      governanceTitle: 'autonomous',
      workingDirectory: join(HOME, 'Code', 'some-repo'),
      authContext: { isSystemOwner: true as const },
    })
    const created = mockCreateAgent.mock.calls[0][0] as { workingDirectory?: string }
    expect(created.workingDirectory).toBe(join(HOME, 'agents', 'gi-forced'))
  })

  it('D: flag present but folder OUTSIDE $HOME → G03-CLAMP ignores the flag and forces back', async () => {
    setupClaudeClient()
    const { CreateAgent } = await import('@/services/element-management-service')
    const result = await CreateAgent({
      name: 'gi-clamped',
      client: 'claude',
      governanceTitle: 'autonomous',
      workingDirectory: '/Volumes/external-disk/some-repo',
      allowExternalFolder: true,
      authContext: { isSystemOwner: true as const },
    })
    expect(result.operations.join('\n')).toContain('G03-CLAMP')
    const created = mockCreateAgent.mock.calls[0][0] as { workingDirectory?: string }
    expect(created.workingDirectory).toBe(join(HOME, 'agents', 'gi-clamped'))
  })
})
