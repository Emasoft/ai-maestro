/**
 * Regression tests for the 2026-05-04 element-management Gate 0 expansion
 * (CRIT-01 .. CRIT-07 fixes from MASTER_REVIEW.md).
 *
 * Background: a deep audit found that ChangeMCP, ChangeLSP, ChangeHook,
 * ChangePlugin, ChangeMarketplace, ChangeSkill, and InstallElement all
 * lacked an explicit Gate 0 authContext check. ChangePlugin had a
 * conditional `if (authContext) { ibctScopeCheck }` but it silently
 * skipped the check when authContext was missing. ChangeSkill and the
 * marketplace family carried `_authContext` (underscore-prefixed,
 * "ignored") and literally never authenticated the caller. InstallElement
 * had no authContext parameter at all — the widest hole in the surface.
 *
 * Each Change* function is now required to:
 *   1. Hard-reject if authContext is missing (return Result with error,
 *      do NOT throw).
 *   2. Run gate0Auth() against the supplied AuthContext.
 *   3. Reject BEFORE touching any external state (no shell, no fs writes,
 *      no settings.json mutation, no plugin install).
 *
 * These tests exercise the real services (no mock of
 * `@/services/element-management-service`) so the guards are checked
 * against the actual runtime code path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================================
// Mocks — hoisted so vi.mock() resolves before the SUT imports them
// ============================================================================

const {
  mockAgentRegistry,
  mockGovernance,
  mockTeamRegistry,
  mockExecFileAsync,
  mockFsExistsSync,
  mockFsReadFile,
  mockFsWriteFile,
  mockFsMkdir,
  mockFsRm,
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
  mockExecFileAsync: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
  mockFsExistsSync: vi.fn().mockReturnValue(false),
  mockFsReadFile: vi.fn().mockResolvedValue('{}'),
  mockFsWriteFile: vi.fn().mockResolvedValue(undefined),
  mockFsMkdir: vi.fn().mockResolvedValue(undefined),
  mockFsRm: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/agent-registry', () => mockAgentRegistry)
vi.mock('@/lib/governance', () => mockGovernance)
vi.mock('@/lib/team-registry', () => mockTeamRegistry)

vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => {
    const cb = args[args.length - 1] as (
      err: Error | null,
      result: { stdout: string; stderr: string },
    ) => void
    mockExecFileAsync(args[0], args[1], args[2])
      .then((r: { stdout: string; stderr: string }) => cb(null, r))
      .catch((err: Error) => cb(err, { stdout: '', stderr: '' }))
  },
}))

vi.mock('fs', () => ({
  existsSync: mockFsExistsSync,
}))

vi.mock('fs/promises', () => ({
  readFile: mockFsReadFile,
  writeFile: mockFsWriteFile,
  mkdir: mockFsMkdir,
  rm: mockFsRm,
  readdir: vi.fn().mockResolvedValue([]),
  stat: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
  copyFile: vi.fn().mockResolvedValue(undefined),
}))

// ============================================================================
// Import modules under test (after mocks)
// ============================================================================

import {
  ChangeMCP,
  ChangeLSP,
  ChangeHook,
  ChangePlugin,
  ChangeMarketplace,
  ChangeSkill,
  InstallElement,
} from '@/services/element-management-service'

// ============================================================================
// Tests
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks()
  mockFsExistsSync.mockReturnValue(false)
  mockFsReadFile.mockResolvedValue('{}')
})

describe('ChangeMCP — Gate 0 mandatory authContext (CRIT-01)', () => {
  /** MCP servers run code in agent context. The previous version had no
   * authContext parameter at all, so any caller could swap an MCP under
   * any agent. */
  it('returns error when authContext is undefined', async () => {
    const result = await ChangeMCP(
      'agent-1',
      { name: 'my-mcp', action: 'add', scope: 'local', config: {} },
      undefined as unknown as never,
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/authContext is mandatory for ChangeMCP/i)
  })

  it('rejects BEFORE shelling out (no claude CLI invocation)', async () => {
    await ChangeMCP(
      'agent-1',
      { name: 'my-mcp', action: 'add', scope: 'local', config: {} },
      undefined as unknown as never,
    )
    expect(mockExecFileAsync).not.toHaveBeenCalled()
  })
})

describe('ChangeLSP — Gate 0 mandatory authContext (CRIT-02)', () => {
  /** LSP servers run as child processes in agent context. Same threat
   * model as MCP. */
  it('returns error when authContext is undefined', async () => {
    const result = await ChangeLSP(
      'agent-1',
      { name: 'pyright', action: 'add', config: {} },
      undefined as unknown as never,
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/authContext is mandatory for ChangeLSP/i)
  })

  it('rejects BEFORE writing .lsp.json (no fs.writeFile invocation)', async () => {
    await ChangeLSP(
      'agent-1',
      { name: 'pyright', action: 'add', config: {} },
      undefined as unknown as never,
    )
    expect(mockFsWriteFile).not.toHaveBeenCalled()
  })
})

describe('ChangeHook — Gate 0 mandatory authContext (CRIT-03 — code injection)', () => {
  /** Hooks run arbitrary shell commands when matched events fire. Anyone
   * who can call ChangeHook without auth can land a Bash command that
   * runs whenever the agent uses any tool. This is the highest-impact
   * code-injection vector in the entire pipeline. */
  it('returns error when authContext is undefined', async () => {
    const result = await ChangeHook(
      'agent-1',
      {
        event: 'PreToolUse',
        action: 'add',
        scope: 'local',
        hookConfig: { command: 'echo pwned' },
      },
      undefined as unknown as never,
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/authContext is mandatory for ChangeHook/i)
  })

  it('rejects BEFORE writing settings.local.json (no hook landed)', async () => {
    await ChangeHook(
      'agent-1',
      {
        event: 'PreToolUse',
        action: 'add',
        scope: 'local',
        hookConfig: { command: 'echo pwned' },
      },
      undefined as unknown as never,
    )
    expect(mockFsWriteFile).not.toHaveBeenCalled()
  })
})

describe('ChangePlugin — Gate 0 mandatory authContext (CRIT-04)', () => {
  /** The previous version had a conditional `if (authContext) { ibctScopeCheck }`
   * — internal callers that forgot to pass authContext bypassed the check
   * entirely. Now hard-rejects. */
  it('returns error when authContext is undefined', async () => {
    const result = await ChangePlugin(
      'agent-1',
      { name: 'my-plugin', marketplace: 'some-mp', action: 'install', scope: 'local' },
      undefined as unknown as never,
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/authContext is mandatory for ChangePlugin/i)
  })

  it('rejects BEFORE shelling out to claude plugin install', async () => {
    await ChangePlugin(
      'agent-1',
      { name: 'my-plugin', marketplace: 'some-mp', action: 'install', scope: 'local' },
      undefined as unknown as never,
    )
    expect(mockExecFileAsync).not.toHaveBeenCalled()
  })
})

describe('ChangeMarketplace — Gate 0 mandatory authContext (CRIT-05)', () => {
  /** Marketplace add/remove changes which plugins are installable on this
   * host. Every agent that later installs a plugin from this marketplace
   * inherits anything in it. The previous parameter was prefixed
   * `_authContext` — literally ignored. */
  it('returns error when authContext is undefined', async () => {
    const result = await ChangeMarketplace(
      { action: 'add', name: 'my-mp', source: { repo: 'foo/bar' } },
      undefined as unknown as never,
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/authContext is mandatory for ChangeMarketplace/i)
  })

  it('rejects BEFORE shelling out to claude plugin marketplace add', async () => {
    await ChangeMarketplace(
      { action: 'add', name: 'my-mp', source: { repo: 'foo/bar' } },
      undefined as unknown as never,
    )
    expect(mockExecFileAsync).not.toHaveBeenCalled()
  })
})

describe('ChangeSkill — Gate 0 mandatory authContext (CRIT-06)', () => {
  /** Skills ship code that runs in agent context. The previous parameter
   * was prefixed `_authContext` and the function never authenticated the
   * caller. */
  it('returns error when authContext is undefined', async () => {
    const result = await ChangeSkill(
      'agent-1',
      {
        name: 'my-skill',
        action: 'install',
        scope: 'local',
        sourcePath: '/tmp/source-skill',
      },
      undefined as unknown as never,
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/authContext is mandatory for ChangeSkill/i)
  })

  it('rejects BEFORE filesystem mutation (no mkdir, no copy)', async () => {
    await ChangeSkill(
      'agent-1',
      {
        name: 'my-skill',
        action: 'install',
        scope: 'local',
        sourcePath: '/tmp/source-skill',
      },
      undefined as unknown as never,
    )
    expect(mockFsMkdir).not.toHaveBeenCalled()
    expect(mockFsRm).not.toHaveBeenCalled()
  })
})

describe('InstallElement — Gate 0 mandatory authContext (CRIT-07 — widest hole)', () => {
  /** InstallElement was previously the WIDEST hole in the auth surface:
   * it had no authContext parameter at all, so any caller could install
   * any plugin (including the role-plugin) on any agent. */
  it('returns error when authContext is undefined', async () => {
    const result = await InstallElement(
      {
        name: 'ai-maestro-plugin',
        marketplace: 'ai-maestro-plugins',
        action: 'install',
        scope: 'local',
        agentDir: '/tmp/agents/test-agent',
      },
      undefined as unknown as never,
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/authContext is mandatory for InstallElement/i)
  })

  it('rejects BEFORE shelling out to claude plugin install', async () => {
    await InstallElement(
      {
        name: 'ai-maestro-plugin',
        marketplace: 'ai-maestro-plugins',
        action: 'install',
        scope: 'local',
        agentDir: '/tmp/agents/test-agent',
      },
      undefined as unknown as never,
    )
    expect(mockExecFileAsync).not.toHaveBeenCalled()
  })

  it('rejects BEFORE settings.local.json writes (no agent state poisoned)', async () => {
    await InstallElement(
      {
        name: 'ai-maestro-plugin',
        marketplace: 'ai-maestro-plugins',
        action: 'install',
        scope: 'local',
        agentDir: '/tmp/agents/test-agent',
      },
      undefined as unknown as never,
    )
    expect(mockFsWriteFile).not.toHaveBeenCalled()
  })
})
