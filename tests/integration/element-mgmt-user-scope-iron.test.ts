/**
 * IRON-rule regression tests — "AI Maestro never installs user-scope" (TRDD-a6d93b9c).
 *
 * The plugin/skill/marketplace CLI verbs (agent-plugin.sh, agent-skill.sh) are
 * being routed through the server API so gate0Auth + R17/R20 apply. Once routed,
 * the caller is an AGENT token. This L2 belt enforces, at the SERVICE layer, that
 * an agent-token caller can NEVER perform a state-adding element mutation at
 * `--scope user` (host-wide `~/.claude`). Only the human system owner (Settings →
 * Plugins page) — or an internal buildSystemAuthContext() flow — may touch user
 * scope. A privileged agent (e.g. a MANAGER, which passes gate0Auth on OTHER
 * agents) is confined to local (per-agent) scope, closing the host-wide,
 * cross-project, cross-user persistence escalation.
 *
 * These tests exercise the REAL services (no mock of the SUT) so the guard is
 * checked against the actual runtime path. The guard runs AFTER gate0Auth, so a
 * refusal here proves the IRON gate fired (not gate0Auth): the caller is a MANAGER
 * acting on ANOTHER agent, which authorize() grants for 'manage-skills'.
 *
 * Authz-hole patterns verified: (1) service self-authorizes off the verified
 * AuthContext; (2) authority read from AuthContext.isSystemOwner, never a body
 * field; (3) the gate is in the service layer, so the headless-router inherits it;
 * (5) authority bound to op[state-adding action] + subject[user scope].
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================================
// Mocks — hoisted so vi.mock() resolves before the SUT imports them
// (identical shape to element-mgmt-gate0-required.test.ts)
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
  ChangePlugin,
  ChangeSkill,
  InstallElement,
} from '@/services/element-management-service'
import type { AuthContext } from '@/lib/agent-auth'

// A MANAGER agent token acting on ANOTHER agent — passes gate0Auth('manage-skills')
// (authorize(): title 'manager' → allowed on other agents), but is NOT the system
// owner, so the IRON gate must refuse user-scope state-adds.
const MANAGER_CTX: AuthContext = { agentId: 'manager-1', isSystemOwner: false, governanceTitle: 'manager' }
// The human system owner / internal system flow — the ONLY caller allowed at user scope.
const OWNER_CTX: AuthContext = { isSystemOwner: true }

const IRON_DENIED = /never-user-scope rule|reserved for the human system owner/i
const opHas = (ops: string[], re: RegExp) => ops.some(o => re.test(o))

beforeEach(() => {
  vi.clearAllMocks()
  mockFsExistsSync.mockReturnValue(false)
  mockFsReadFile.mockResolvedValue('{}')
})

// ============================================================================
describe('InstallElement — IRON rule (never user-scope for agents)', () => {
  it('REFUSES an agent-token install at user scope (before any shell/fs side effect)', async () => {
    const result = await InstallElement(
      { name: 'my-plugin', marketplace: 'ai-maestro-plugins', action: 'install', scope: 'user', agentId: 'agent-1' },
      MANAGER_CTX,
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(IRON_DENIED)
    expect(mockExecFileAsync).not.toHaveBeenCalled()
    expect(mockFsWriteFile).not.toHaveBeenCalled()
    expect(opHas(result.operations, /IRON: DENIED/)).toBe(true)
  })

  it('ALLOWS the human system owner to install at user scope (IRON gate passes through)', async () => {
    const result = await InstallElement(
      { name: 'my-plugin', marketplace: 'ai-maestro-plugins', action: 'install', scope: 'user' },
      OWNER_CTX,
    )
    // The mocked env may not fully complete the install, but the IRON gate must
    // have PERMITTED it (system owner) and never DENIED.
    expect(opHas(result.operations, /IRON: user-scope install permitted/)).toBe(true)
    expect(opHas(result.operations, /IRON: DENIED/)).toBe(false)
  })

  it('does NOT gate an agent-token LOCAL install (scope !== user)', async () => {
    const result = await InstallElement(
      { name: 'my-plugin', marketplace: 'ai-maestro-plugins', action: 'install', scope: 'local', agentDir: '/tmp/agents/test-agent', agentId: 'agent-1' },
      MANAGER_CTX,
    )
    expect(opHas(result.operations, /IRON: DENIED/)).toBe(false)
  })

  it('does NOT gate an agent-token user-scope UNINSTALL (removal reduces reach)', async () => {
    const result = await InstallElement(
      { name: 'my-plugin', marketplace: 'ai-maestro-plugins', action: 'uninstall', scope: 'user', agentId: 'agent-1' },
      MANAGER_CTX,
    )
    expect(opHas(result.operations, /IRON: DENIED/)).toBe(false)
  })
})

// ============================================================================
describe('ChangePlugin — IRON rule (never user-scope for agents)', () => {
  it('REFUSES an agent-token enable at user scope (before any shell/fs side effect)', async () => {
    const result = await ChangePlugin(
      'agent-1',
      { name: 'my-plugin', marketplace: 'some-mp', action: 'enable', scope: 'user' },
      MANAGER_CTX,
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(IRON_DENIED)
    expect(mockExecFileAsync).not.toHaveBeenCalled()
    expect(mockFsWriteFile).not.toHaveBeenCalled()
  })

  it('REFUSES an agent-token update at user scope', async () => {
    const result = await ChangePlugin(
      'agent-1',
      { name: 'my-plugin', marketplace: 'some-mp', action: 'update', scope: 'user' },
      MANAGER_CTX,
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(IRON_DENIED)
  })

  it('ALLOWS the human system owner to enable at user scope (matches the real global-plugins path)', async () => {
    const result = await ChangePlugin(
      null,
      { name: 'my-plugin', marketplace: 'some-mp', action: 'enable', scope: 'user' },
      OWNER_CTX,
    )
    expect(opHas(result.operations, /IRON: user-scope enable permitted/)).toBe(true)
    expect(opHas(result.operations, /IRON: DENIED/)).toBe(false)
  })

  // The argv shape, not just the permission. `claude plugin update --help` is
  // "Usage: claude plugin update [options] <plugin>" — ONE positional. This call used to pass
  // the marketplace as a SECOND positional, so the CLI resolved the plugin with no marketplace
  // context and answered `Plugin "X" not found` for every plugin on every cycle — 138 rows,
  // 100 % failed, including plugins enabled and present on disk (TRDD-PE54D95Q). Asserting only
  // that the update was PERMITTED passes over that completely, which is how it survived.
  it('updates at user scope with ONE `name@marketplace` positional, not two', async () => {
    mockExecFileAsync.mockClear()
    const result = await ChangePlugin(
      null,
      { name: 'my-plugin', marketplace: 'some-mp', action: 'update', scope: 'user' },
      OWNER_CTX,
    )
    expect(result.success).toBe(true)
    const call = mockExecFileAsync.mock.calls.find(
      (c: unknown[]) => Array.isArray(c[1]) && (c[1] as string[])[0] === 'plugin' && (c[1] as string[])[1] === 'update',
    )
    expect(call).toBeDefined()
    // toEqual on the whole array is what rejects a marketplace creeping back in as a second
    // positional — a length check or a "contains the name" check would not.
    expect(call![1]).toEqual(['plugin', 'update', 'my-plugin@some-mp', '--scope', 'user'])
  })
})

// ============================================================================
describe('ChangeSkill — IRON rule (never user-scope for agents)', () => {
  it('REFUSES an agent-token install at user scope (before any mkdir/copy/rm)', async () => {
    const result = await ChangeSkill(
      'agent-1',
      { name: 'my-skill', action: 'install', scope: 'user', sourcePath: '/tmp/source-skill' },
      MANAGER_CTX,
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(IRON_DENIED)
    expect(mockFsMkdir).not.toHaveBeenCalled()
    expect(mockFsRm).not.toHaveBeenCalled()
  })

  it('REFUSES an agent-token convert at user scope (host-wide skill emit)', async () => {
    const result = await ChangeSkill(
      'agent-1',
      { name: 'my-skill', action: 'convert', scope: 'user', targetClient: 'codex' },
      MANAGER_CTX,
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(IRON_DENIED)
  })

  it('does NOT gate an agent-token user-scope REMOVE (removal reduces reach)', async () => {
    const result = await ChangeSkill(
      'agent-1',
      { name: 'my-skill', action: 'remove', scope: 'user' },
      MANAGER_CTX,
    )
    expect(opHas(result.operations, /IRON: DENIED/)).toBe(false)
  })
})
