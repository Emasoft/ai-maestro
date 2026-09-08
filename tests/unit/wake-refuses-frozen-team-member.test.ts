/**
 * TRDD-0KMDJVON (R31) — wakeAgent refuses to wake a non-COS member of a frozen team.
 *
 * freezeIncompleteTeam() hibernates every member of an incomplete team except the
 * CHIEF-OF-STAFF. Without a refusal at the wake boundary, that hibernation is
 * undone one agent at a time by any ordinary wake call — the freeze protects
 * nothing. This pins the refusal added at services/agents-core-service.ts's
 * wakeAgent (Gate 1c), UNCONDITIONALLY — no isSystemOwner exemption, because a
 * privileged bypass is exactly the surface R31 exists to close.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAgent, resetFixtureCounter } from '../test-utils/fixtures'

const {
  mockRuntime,
  mockAgentRegistry,
  mockHostsConfig,
  mockSessionPersistence,
  mockAmpInboxWriter,
  mockSharedState,
  mockAgentStartup,
  mockMessageQueue,
  mockFs,
  mockUuid,
  mockAuthorization,
  mockGovernance,
  mockTeamRegistry,
  mockWhitelist,
  mockInstallElement,
} = vi.hoisted(() => {
  return {
    mockRuntime: {
      listSessions: vi.fn().mockResolvedValue([]),
      sessionExists: vi.fn().mockResolvedValue(false),
      createSession: vi.fn().mockResolvedValue(undefined),
    },
    mockAgentRegistry: {
      getAgent: vi.fn(),
      loadAgents: vi.fn().mockReturnValue([]),
      updateAgent: vi.fn().mockResolvedValue(undefined),
      linkSession: vi.fn(),
      saveAgents: vi.fn(),
    },
    mockHostsConfig: {
      getSelfHost: vi.fn().mockReturnValue({ id: 'test-host', name: 'Test Host', url: 'http://localhost:23000' }),
      getHosts: vi.fn().mockReturnValue([]),
      getSelfHostId: vi.fn().mockReturnValue('test-host'),
      isSelf: vi.fn().mockReturnValue(true),
    },
    mockSessionPersistence: {
      persistSession: vi.fn(),
      unpersistSession: vi.fn(),
    },
    mockAmpInboxWriter: {
      initAgentAMPHome: vi.fn(),
      getAgentAMPDir: vi.fn().mockReturnValue('/tmp/amp'),
    },
    mockSharedState: {
      sessionActivity: new Map<string, number>(),
      injectedPrompts: new Map<string, number>(),
      broadcastAgentUpdate: vi.fn(),
    },
    mockAgentStartup: {
      initializeAllAgents: vi.fn().mockResolvedValue({ initialized: [], failed: [] }),
      getStartupStatus: vi.fn().mockReturnValue({ discoveredAgents: 0, activeAgents: 0, agents: [] }),
    },
    mockMessageQueue: {
      resolveAgentIdentifier: vi.fn(),
    },
    mockFs: (() => {
      const fns = {
        readFileSync: vi.fn().mockReturnValue('{}'),
        existsSync: vi.fn().mockReturnValue(false),
        readdirSync: vi.fn().mockReturnValue([]),
        mkdirSync: vi.fn(),
        writeFileSync: vi.fn(),
        unlinkSync: vi.fn(),
        copyFileSync: vi.fn(),
        renameSync: vi.fn(),
      }
      return { default: fns, ...fns }
    })(),
    mockUuid: { v4: vi.fn(() => 'uuid-1') },
    mockAuthorization: {
      authorize: vi.fn().mockReturnValue({ allowed: true }),
    },
    mockGovernance: {
      getManagerId: vi.fn().mockReturnValue('manager-1'),
      isManager: vi.fn().mockReturnValue(false),
      isChiefOfStaffAnywhere: vi.fn().mockReturnValue(false),
    },
    mockTeamRegistry: {
      isAgentInAnyTeam: vi.fn().mockReturnValue(false),
      loadTeams: vi.fn().mockReturnValue([]),
    },
    mockWhitelist: {
      enforceUserScopePluginWhitelist: vi.fn().mockResolvedValue({
        ok: true, disabled: [], alreadyDisabled: [], wrote: false,
      }),
    },
    // ensureCorePluginInstalled (R17) delegates its core-plugin invariant to the REAL
    // InstallElement pipeline, which shells out via execFile — mocking the whole service
    // to a clean success (as tests/services/agents-core-service.test.ts already does) avoids
    // dragging execFile/child_process wiring into a test that isn't about R17 at all.
    mockInstallElement: vi.fn().mockResolvedValue({ success: true, operations: [], stdout: '', stderr: '' }),
  }
})

vi.mock('@/lib/agent-runtime', () => ({
  getRuntime: vi.fn().mockReturnValue(mockRuntime),
}))
vi.mock('@/lib/agent-registry', () => mockAgentRegistry)
vi.mock('@/lib/hosts-config', () => mockHostsConfig)
vi.mock('@/lib/session-persistence', () => mockSessionPersistence)
vi.mock('@/lib/amp-inbox-writer', () => mockAmpInboxWriter)
vi.mock('@/services/shared-state', () => mockSharedState)
vi.mock('@/lib/agent-startup', () => mockAgentStartup)
vi.mock('@/lib/messageQueue', () => mockMessageQueue)
vi.mock('fs', () => mockFs)
vi.mock('uuid', () => mockUuid)
vi.mock('child_process', () => ({
  exec: vi.fn((_cmd: string, cb: Function) => cb(null, { stdout: '', stderr: '' })),
  execSync: vi.fn().mockReturnValue(''),
}))
vi.mock('@/lib/authorization', () => mockAuthorization)
vi.mock('@/lib/user-scope-plugin-whitelist', () => mockWhitelist)
vi.mock('@/lib/governance', () => mockGovernance)
vi.mock('@/lib/team-registry', () => mockTeamRegistry)
vi.mock('@/services/element-management-service', () => ({
  InstallElement: (...args: unknown[]) => mockInstallElement(...args),
}))

import { wakeAgent } from '@/services/agents-core-service'
import type { AuthContext } from '@/lib/agent-auth'

const SYS_CTX: AuthContext = { isSystemOwner: true }

function frozenTeam(overrides: Partial<{ id: string; name: string; agentIds: string[]; chiefOfStaffId: string | null; frozen: boolean }> = {}) {
  return {
    id: 'team-1',
    name: 'Alpha Team',
    type: 'default',
    agentIds: ['cos-1', 'member-1'],
    chiefOfStaffId: 'cos-1',
    frozen: true,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  resetFixtureCounter()
  mockRuntime.listSessions.mockResolvedValue([])
  mockRuntime.sessionExists.mockResolvedValue(false)
  mockRuntime.createSession.mockResolvedValue(undefined)
  mockAgentRegistry.loadAgents.mockReturnValue([])
  mockAgentRegistry.updateAgent.mockResolvedValue(undefined)
  mockAuthorization.authorize.mockReturnValue({ allowed: true })
  mockGovernance.getManagerId.mockReturnValue('manager-1')
  mockTeamRegistry.isAgentInAnyTeam.mockReturnValue(false)
  mockTeamRegistry.loadTeams.mockReturnValue([])
  mockInstallElement.mockResolvedValue({ success: true, operations: [], stdout: '', stderr: '' })
  mockWhitelist.enforceUserScopePluginWhitelist.mockResolvedValue({
    ok: true, disabled: [], alreadyDisabled: [], wrote: false,
  })
})

describe('TRDD-0KMDJVON (R31) — wakeAgent refuses a frozen team\'s non-COS member', () => {
  it('refuses to wake a non-COS member of a frozen team — 409, no session start', async () => {
    const agent = makeAgent({ id: 'member-1', name: 'member-one', workingDirectory: '/home' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockTeamRegistry.loadTeams.mockReturnValue([frozenTeam()])

    const result = await wakeAgent('member-1', { authContext: SYS_CTX, startProgram: false })

    expect(result.status).toBe(409)
    expect(result.error).toMatch(/team_frozen/i)
    expect(result.error).toMatch(/frozen/i)
    expect(mockRuntime.createSession).not.toHaveBeenCalled()
    expect(mockRuntime.sessionExists).not.toHaveBeenCalled()
  })

  it('allows waking the COS of the same frozen team — the check does not refuse it', async () => {
    const cos = makeAgent({ id: 'cos-1', name: 'cos-one', workingDirectory: '/home' })
    mockAgentRegistry.getAgent.mockReturnValue(cos)
    mockAgentRegistry.loadAgents.mockReturnValue([cos])
    mockTeamRegistry.loadTeams.mockReturnValue([frozenTeam()])

    const result = await wakeAgent('cos-1', { authContext: SYS_CTX, startProgram: false })

    expect(result.status).toBe(200)
    expect(result.data?.woken).toBe(true)
  })

  it('allows waking a member of an unfrozen team', async () => {
    const agent = makeAgent({ id: 'member-1', name: 'member-one', workingDirectory: '/home' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockAgentRegistry.loadAgents.mockReturnValue([agent])
    mockTeamRegistry.loadTeams.mockReturnValue([frozenTeam({ frozen: false })])

    const result = await wakeAgent('member-1', { authContext: SYS_CTX, startProgram: false })

    expect(result.status).toBe(200)
    expect(result.data?.woken).toBe(true)
  })

  it('the refusal is UNCONDITIONAL — isSystemOwner does not bypass it (R31\'s primary surface)', async () => {
    const agent = makeAgent({ id: 'member-1', name: 'member-one', workingDirectory: '/home' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockTeamRegistry.loadTeams.mockReturnValue([frozenTeam()])

    const result = await wakeAgent('member-1', { authContext: { isSystemOwner: true }, startProgram: false })

    expect(result.status).toBe(409)
    expect(result.error).toMatch(/team_frozen/i)
    expect(mockRuntime.createSession).not.toHaveBeenCalled()
  })
})
