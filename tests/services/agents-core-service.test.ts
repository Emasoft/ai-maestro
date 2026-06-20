/**
 * Agents Core Service Tests
 *
 * Tests the pure business logic in services/agents-core-service.ts.
 * This is the largest/most complex service — agent CRUD, wake/hibernate,
 * session linking, unified multi-host queries.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAgent, makeAgentSession, resetFixtureCounter } from '../test-utils/fixtures'

// ============================================================================
// Mocks — vi.hoisted() ensures availability before vi.mock() runs
// ============================================================================

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
} = vi.hoisted(() => {
  const mockRuntime = {
    listSessions: vi.fn().mockResolvedValue([]),
    sessionExists: vi.fn().mockResolvedValue(false),
    createSession: vi.fn().mockResolvedValue(undefined),
    killSession: vi.fn().mockResolvedValue(undefined),
    renameSession: vi.fn().mockResolvedValue(undefined),
    sendKeys: vi.fn().mockResolvedValue(undefined),
    cancelCopyMode: vi.fn().mockResolvedValue(undefined),
    setEnvironment: vi.fn().mockResolvedValue(undefined),
    unsetEnvironment: vi.fn().mockResolvedValue(undefined),
  }

  let uuidCounter = 0

  return {
    mockRuntime,
    mockAgentRegistry: {
      loadAgents: vi.fn().mockReturnValue([]),
      saveAgents: vi.fn(),
      createAgent: vi.fn(),
      getAgent: vi.fn(),
      getAgentByName: vi.fn(),
      getAgentBySession: vi.fn(),
      updateAgent: vi.fn(),
      deleteAgent: vi.fn(),
      searchAgents: vi.fn().mockReturnValue([]),
      linkSession: vi.fn(),
      unlinkSession: vi.fn(),
    },
    mockHostsConfig: {
      getHosts: vi.fn().mockReturnValue([{ id: 'test-host', name: 'Test Host', url: 'http://localhost:23000' }]),
      getSelfHost: vi.fn().mockReturnValue({ id: 'test-host', name: 'Test Host', url: 'http://localhost:23000' }),
      getSelfHostId: vi.fn().mockReturnValue('test-host'),
      isSelf: vi.fn().mockReturnValue(true),
    },
    mockSessionPersistence: {
      persistSession: vi.fn(),
      unpersistSession: vi.fn(),
    },
    mockAmpInboxWriter: {
      initAgentAMPHome: vi.fn().mockResolvedValue(undefined),
      getAgentAMPDir: vi.fn().mockReturnValue('/tmp/amp/test'),
    },
    mockSharedState: {
      sessionActivity: new Map<string, number>(),
      broadcastAgentUpdate: vi.fn(),
    },
    mockAgentStartup: {
      initializeAllAgents: vi.fn().mockResolvedValue({ initialized: [], failed: [] }),
      getStartupStatus: vi.fn().mockReturnValue({ discoveredAgents: 5, activeAgents: 3, agents: [] }),
    },
    mockMessageQueue: {
      resolveAgentIdentifier: vi.fn(),
    },
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
    mockUuid: {
      v4: vi.fn(() => `uuid-${++uuidCounter}`),
    },
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
vi.mock('@/lib/governance', () => mockGovernance)
vi.mock('@/lib/team-registry', () => mockTeamRegistry)

// Mock element-management-service: pipelines that agents-core-service delegates to
const mockDeleteAgentPipeline = vi.fn()
const mockCreateAgentPipeline = vi.fn()
const mockInstallElement = vi.fn()
const mockChangeTitle = vi.fn()
const mockChangeName = vi.fn()
const mockChangeFolder = vi.fn()
const mockChangeAvatar = vi.fn()
const mockChangeCLIArgs = vi.fn()
const mockChangeClient = vi.fn()
vi.mock('@/services/element-management-service', () => ({
  DeleteAgent: (...args: unknown[]) => mockDeleteAgentPipeline(...args),
  CreateAgent: (...args: unknown[]) => mockCreateAgentPipeline(...args),
  InstallElement: (...args: unknown[]) => mockInstallElement(...args),
  ChangeTitle: (...args: unknown[]) => mockChangeTitle(...args),
  ChangeName: (...args: unknown[]) => mockChangeName(...args),
  ChangeFolder: (...args: unknown[]) => mockChangeFolder(...args),
  ChangeAvatar: (...args: unknown[]) => mockChangeAvatar(...args),
  ChangeCLIArgs: (...args: unknown[]) => mockChangeCLIArgs(...args),
  ChangeClient: (...args: unknown[]) => mockChangeClient(...args),
}))

// ============================================================================
// Import module under test (after mocks)
// ============================================================================

import {
  listAgents,
  searchAgentsByQuery,
  getAgentById,
  updateAgentById,
  registerAgent,
  lookupAgentByName,
  wakeAgent,
  hibernateAgent,
  sendAgentSessionCommand,
  linkAgentSession,
  unlinkOrDeleteAgentSession,
  getAgentSessionStatus,
  initializeStartup,
  getStartupInfo,
  proxyHealthCheck,
} from '@/services/agents-core-service'
import type { AuthContext } from '@/lib/agent-auth'

// SVC2-CRIT-* (2026-05-06): every Change* / register / link / send-command
// service now requires an AuthContext. Tests use a typed system-owner ctx.
const SYSTEM_OWNER_CTX: AuthContext = {
  isSystemOwner: true,
  governanceTitle: 'system',
}

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks()
  resetFixtureCounter()
  mockSharedState.sessionActivity.clear()
  mockRuntime.listSessions.mockResolvedValue([])
  mockRuntime.sessionExists.mockResolvedValue(false)
  mockRuntime.createSession.mockResolvedValue(undefined)
  mockAgentRegistry.loadAgents.mockReturnValue([])
  // updateAgent is async in production (returns a Promise). registerAgent's R9.13
  // roleMissing flag uses `.catch`, so the mock must resolve a Promise — a bare
  // vi.fn() returns undefined and `undefined.catch()` would throw.
  mockAgentRegistry.updateAgent.mockResolvedValue(undefined)
  mockHostsConfig.getSelfHost.mockReturnValue({ id: 'test-host', name: 'Test Host', url: 'http://localhost:23000' })
  mockHostsConfig.getHosts.mockReturnValue([{ id: 'test-host', name: 'Test Host', url: 'http://localhost:23000' }])
  mockHostsConfig.isSelf.mockReturnValue(true)
  // Default: DeleteAgent pipeline succeeds
  mockDeleteAgentPipeline.mockResolvedValue({ success: true, agentId: 'agent-1', hard: false, operations: [] })
  // Default: CreateAgent pipeline succeeds
  mockCreateAgentPipeline.mockResolvedValue({ success: true, agentId: 'uuid-1', operations: [], restartNeeded: false })
  // Default: InstallElement (R17 gate) succeeds
  mockInstallElement.mockResolvedValue({ success: true, operations: [], stdout: '', stderr: '' })
  // Default: Change* pipelines succeed
  mockChangeTitle.mockResolvedValue({ success: true, operations: [] })
  mockChangeName.mockResolvedValue({ success: true, operations: [] })
  mockChangeFolder.mockResolvedValue({ success: true, operations: [] })
  mockChangeAvatar.mockResolvedValue({ success: true, operations: [] })
  mockChangeCLIArgs.mockResolvedValue({ success: true, operations: [] })
  mockChangeClient.mockResolvedValue({ success: true, operations: [], restartNeeded: false })
  // Default: authorization allows all
  mockAuthorization.authorize.mockReturnValue({ allowed: true })
  // Default: MANAGER exists
  mockGovernance.getManagerId.mockReturnValue('manager-1')
  mockGovernance.isManager.mockReturnValue(false)
  mockGovernance.isChiefOfStaffAnywhere.mockReturnValue(false)
  // Default: agent is not in any team
  mockTeamRegistry.isAgentInAnyTeam.mockReturnValue(false)
})

// ============================================================================
// listAgents
// ============================================================================

describe('listAgents', () => {
  it('returns empty list when no agents and no sessions', async () => {
    const result = await listAgents()

    expect(result.status).toBe(200)
    expect(result.data?.agents).toEqual([])
    expect(result.data?.stats.total).toBe(0)
  })

  it('returns agents from registry with session status', async () => {
    const agent = makeAgent({ name: 'my-agent' })
    mockAgentRegistry.loadAgents.mockReturnValue([agent])
    mockRuntime.listSessions.mockResolvedValue([
      { name: 'my-agent', workingDirectory: '/home', createdAt: '2025-01-01T00:00:00Z', windows: 1 },
    ])

    const result = await listAgents()

    expect(result.status).toBe(200)
    expect(result.data?.agents).toHaveLength(1)
    expect(result.data?.agents[0].name).toBe('my-agent')
  })

  it('collects unregistered sessions instead of creating orphan agents', async () => {
    mockAgentRegistry.loadAgents.mockReturnValue([])
    mockRuntime.listSessions.mockResolvedValue([
      { name: 'orphan-session', workingDirectory: '/home', createdAt: '2025-01-01T00:00:00Z', windows: 1 },
    ])

    const result = await listAgents()

    // No agents created from unregistered sessions
    expect(result.data?.agents).toHaveLength(0)
    // Unregistered sessions collected separately
    expect(result.data?.unregisteredSessions).toHaveLength(1)
    expect(result.data?.unregisteredSessions[0].tmuxSessionName).toBe('orphan-session')
    expect(result.data?.stats.unregistered).toBe(1)
    // Registry NOT modified
    expect(mockAgentRegistry.saveAgents).not.toHaveBeenCalled()
  })

  it('marks agents offline when no matching tmux session', async () => {
    const agent = makeAgent({ name: 'offline-agent', sessions: [makeAgentSession()] })
    mockAgentRegistry.loadAgents.mockReturnValue([agent])
    mockRuntime.listSessions.mockResolvedValue([])

    const result = await listAgents()

    expect(result.data?.agents[0].status).toBe('offline')
    expect(result.data?.agents[0].session?.status).toBe('offline')
  })

  it('marks agents active when matching tmux session exists', async () => {
    const agent = makeAgent({ name: 'active-agent' })
    mockAgentRegistry.loadAgents.mockReturnValue([agent])
    mockRuntime.listSessions.mockResolvedValue([
      { name: 'active-agent', workingDirectory: '/home', createdAt: '2025-01-01T00:00:00Z', windows: 1 },
    ])

    const result = await listAgents()

    expect(result.data?.agents[0].status).toBe('active')
    expect(result.data?.agents[0].session?.status).toBe('online')
  })

  it('sorts online agents before offline', async () => {
    const offlineAgent = makeAgent({ name: 'aaa-offline' })
    const onlineAgent = makeAgent({ name: 'zzz-online' })
    mockAgentRegistry.loadAgents.mockReturnValue([offlineAgent, onlineAgent])
    mockRuntime.listSessions.mockResolvedValue([
      { name: 'zzz-online', workingDirectory: '/home', createdAt: '2025-01-01T00:00:00Z', windows: 1 },
    ])

    const result = await listAgents()

    expect(result.data?.agents[0].name).toBe('zzz-online')
    expect(result.data?.agents[1].name).toBe('aaa-offline')
  })

  it('includes host info in response', async () => {
    const result = await listAgents()

    expect(result.data?.hostInfo).toEqual({
      id: 'test-host',
      name: 'Test Host',
      url: 'http://localhost:23000',
      isSelf: true,
    })
  })

  it('returns 500 on unexpected error', async () => {
    mockAgentRegistry.loadAgents.mockImplementation(() => { throw new Error('disk error') })

    const result = await listAgents()

    expect(result.status).toBe(500)
  })
})

// ============================================================================
// searchAgentsByQuery
// ============================================================================

describe('searchAgentsByQuery', () => {
  it('returns matching agents', () => {
    const agents = [makeAgent({ name: 'backend-api' })]
    mockAgentRegistry.searchAgents.mockReturnValue(agents)

    const result = searchAgentsByQuery('backend')

    expect(result.status).toBe(200)
    expect(result.data?.agents).toHaveLength(1)
    expect(mockAgentRegistry.searchAgents).toHaveBeenCalledWith('backend')
  })

  it('returns empty list when no matches', () => {
    mockAgentRegistry.searchAgents.mockReturnValue([])

    const result = searchAgentsByQuery('nonexistent')

    expect(result.status).toBe(200)
    expect(result.data?.agents).toEqual([])
  })
})

// ============================================================================
// getAgentById
// ============================================================================

describe('getAgentById', () => {
  it('returns agent when found', () => {
    const agent = makeAgent({ id: 'agent-1', name: 'found' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)

    const result = getAgentById('agent-1')

    expect(result.status).toBe(200)
    expect(result.data?.agent.name).toBe('found')
  })

  it('returns 404 when agent not found', () => {
    mockAgentRegistry.getAgent.mockReturnValue(null)

    const result = getAgentById('nonexistent')

    expect(result.status).toBe(404)
  })

  it('returns 500 on unexpected error', () => {
    mockAgentRegistry.getAgent.mockImplementation(() => { throw new Error('read error') })

    const result = getAgentById('agent-1')

    expect(result.status).toBe(500)
  })
})

// ============================================================================
// updateAgentById
// ============================================================================

describe('updateAgentById', () => {
  it('updates agent successfully', async () => {
    const agent = makeAgent({ id: 'agent-1' })
    const updated = { ...agent, taskDescription: 'Updated task' }
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockAgentRegistry.updateAgent.mockReturnValue(updated)

    const result = await updateAgentById('agent-1', { taskDescription: 'Updated task' })

    expect(result.status).toBe(200)
    expect(result.data?.agent.taskDescription).toBe('Updated task')
  })

  it('returns 404 when agent not found', async () => {
    mockAgentRegistry.getAgent.mockReturnValue(null)

    const result = await updateAgentById('nonexistent', { taskDescription: 'X' })

    expect(result.status).toBe(404)
  })

  it('returns 410 when agent is soft-deleted', async () => {
    const deleted = makeAgent({ id: 'agent-1', deletedAt: '2025-01-01T00:00:00Z' })
    mockAgentRegistry.getAgent.mockReturnValue(deleted)

    const result = await updateAgentById('agent-1', { taskDescription: 'X' })

    expect(result.status).toBe(410)
    expect(result.error).toMatch(/deleted/i)
  })

  it('returns 400 when updateAgent throws (e.g., duplicate name)', async () => {
    const agent = makeAgent({ id: 'agent-1' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockAgentRegistry.updateAgent.mockImplementation(() => { throw new Error('Name taken') })

    const result = await updateAgentById('agent-1', { name: 'taken' })

    expect(result.status).toBe(400)
    expect(result.error).toBe('Name taken')
  })
})

// ============================================================================
// registerAgent
// ============================================================================

describe('registerAgent', () => {
  it('registers agent from session name', async () => {
    mockAgentRegistry.getAgentBySession.mockReturnValue(null)
    mockAgentRegistry.createAgent.mockReturnValue(makeAgent({ id: 'new-id', name: 'my-agent' }))
    mockFs.default.existsSync.mockReturnValue(false)

    const result = await registerAgent({ sessionName: 'my-agent', workingDirectory: '/home', authContext: SYSTEM_OWNER_CTX })

    expect(result.status).toBe(200)
    expect(result.data?.success).toBe(true)
    // agentId comes from createAgent's returned agent.id, not from sessionName
    expect(result.data?.agentId).toBe('new-id')
  })

  it('R9.13: flags roleMissing=true on an agent CREATED from a session (raw createAgent bypasses the role-installing AIO)', async () => {
    mockAgentRegistry.getAgentBySession.mockReturnValue(null)
    mockAgentRegistry.createAgent.mockReturnValue(makeAgent({ id: 'new-id', name: 'my-agent' }))
    mockFs.default.existsSync.mockReturnValue(false)

    const result = await registerAgent({ sessionName: 'my-agent', workingDirectory: '/home', authContext: SYSTEM_OWNER_CTX })

    expect(result.status).toBe(200)
    // The new agent has no role-plugin (createAgent installs none; the workdir does
    // not exist at register time) → it MUST be flagged so the wake route's R9.13 gate
    // (role_plugin_required, 409) blocks it until a role is assigned. Mirrors G17/PG04.
    expect(mockAgentRegistry.updateAgent).toHaveBeenCalledWith('new-id', { roleMissing: true })
  })

  it('does NOT flag roleMissing when LINKING an existing agent (it owns its own role state)', async () => {
    const existing = makeAgent({ id: 'existing-id', name: 'my-agent' })
    mockAgentRegistry.getAgentBySession.mockReturnValue(existing)
    mockFs.default.existsSync.mockReturnValue(false)

    await registerAgent({ sessionName: 'my-agent', authContext: SYSTEM_OWNER_CTX })

    expect(mockAgentRegistry.updateAgent).not.toHaveBeenCalledWith('existing-id', { roleMissing: true })
  })

  it('links existing agent when found by session', async () => {
    const existing = makeAgent({ id: 'existing-id', name: 'my-agent' })
    mockAgentRegistry.getAgentBySession.mockReturnValue(existing)
    mockFs.default.existsSync.mockReturnValue(false)

    const result = await registerAgent({ sessionName: 'my-agent', authContext: SYSTEM_OWNER_CTX })

    expect(result.status).toBe(200)
    expect(mockAgentRegistry.linkSession).toHaveBeenCalledWith('existing-id', 'my-agent', expect.any(String))
    expect(result.data?.registryAgent?.id).toBe('existing-id')
  })

  it('registers cloud agent with websocket URL', async () => {
    mockFs.default.existsSync.mockReturnValue(false)

    const result = await registerAgent({
      id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      deployment: { cloud: { websocketUrl: 'wss://agent.cloud.com/term' } },
      authContext: SYSTEM_OWNER_CTX,
    })

    expect(result.status).toBe(200)
    expect(result.data?.agentId).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890')
  })

  it('returns 400 when session name is missing (worktree format)', async () => {
    const result = await registerAgent({ sessionName: '', authContext: SYSTEM_OWNER_CTX })

    // The code checks `!body.sessionName` which is falsy for empty string
    // It falls through to the cloud path and fails there
    expect(result.status).toBe(400)
  })

  it('returns 400 when cloud agent missing required fields', async () => {
    const result = await registerAgent({ id: 'cloud', deployment: {} as any, authContext: SYSTEM_OWNER_CTX })

    expect(result.status).toBe(400)
    expect(result.error).toMatch(/missing/i)
  })

  it('saves agent config to file', async () => {
    mockAgentRegistry.getAgentBySession.mockReturnValue(null)
    mockAgentRegistry.createAgent.mockReturnValue(makeAgent())
    mockFs.default.existsSync.mockReturnValue(false)

    await registerAgent({ sessionName: 'agent', authContext: SYSTEM_OWNER_CTX })

    expect(mockFs.default.writeFileSync).toHaveBeenCalled()
  })
})

// ============================================================================
// lookupAgentByName
// ============================================================================

describe('lookupAgentByName', () => {
  it('returns agent when resolved and found', () => {
    mockMessageQueue.resolveAgentIdentifier.mockReturnValue({ agentId: 'agent-1' })
    mockAgentRegistry.getAgent.mockReturnValue(makeAgent({ id: 'agent-1', name: 'my-agent' }))

    const result = lookupAgentByName('my-agent')

    expect(result.status).toBe(200)
    expect(result.data?.exists).toBe(true)
    expect(result.data?.agent?.name).toBe('my-agent')
  })

  it('returns exists=false when agent not resolved', () => {
    mockMessageQueue.resolveAgentIdentifier.mockReturnValue(null)

    const result = lookupAgentByName('unknown')

    expect(result.status).toBe(200)
    expect(result.data?.exists).toBe(false)
  })

  it('returns exists=false when resolved but not in registry', () => {
    mockMessageQueue.resolveAgentIdentifier.mockReturnValue({ agentId: 'gone' })
    mockAgentRegistry.getAgent.mockReturnValue(null)

    const result = lookupAgentByName('gone-agent')

    expect(result.status).toBe(200)
    expect(result.data?.exists).toBe(false)
  })
})

// ============================================================================
// wakeAgent
// ============================================================================

describe('wakeAgent', () => {
  it('wakes a hibernated agent', async () => {
    const agent = makeAgent({ id: 'agent-1', name: 'my-agent', workingDirectory: '/home' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockRuntime.sessionExists.mockResolvedValue(false)
    // loadAgents for updateAgentSessionInRegistry
    mockAgentRegistry.loadAgents.mockReturnValue([agent])

    const result = await wakeAgent('agent-1', { startProgram: false })

    expect(result.status).toBe(200)
    expect(result.data?.woken).toBe(true)
    expect(result.data?.sessionName).toBe('my-agent')
    // R17 fix (TRDD-WT022#1): wakeAgent passes an atomic env bag as the 3rd
    // arg to runtime.createSession (AGENT_WORK_DIR, AIM_AGENT_NAME,
    // AIM_AGENT_ID, AMP_DIR) to avoid the post-create env-injection race.
    expect(mockRuntime.createSession).toHaveBeenCalledWith(
      'my-agent',
      '/home',
      expect.objectContaining({
        AGENT_WORK_DIR: '/home',
        AIM_AGENT_NAME: 'my-agent',
        AIM_AGENT_ID: 'agent-1',
      })
    )
  })

  it('returns already running when session exists', async () => {
    const agent = makeAgent({ id: 'agent-1', name: 'my-agent' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockRuntime.sessionExists.mockResolvedValue(true)
    mockAgentRegistry.loadAgents.mockReturnValue([agent])

    const result = await wakeAgent('agent-1', {})

    expect(result.status).toBe(200)
    expect(result.data?.alreadyRunning).toBe(true)
    expect(mockRuntime.createSession).not.toHaveBeenCalled()
  })

  it('returns 404 when agent not found', async () => {
    mockAgentRegistry.getAgent.mockReturnValue(null)

    const result = await wakeAgent('nonexistent', {})

    expect(result.status).toBe(404)
  })

  it('returns 400 when agent has no name', async () => {
    const agent = makeAgent({ id: 'agent-1', name: '' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)

    const result = await wakeAgent('agent-1', {})

    expect(result.status).toBe(400)
  })

  it('persists session metadata on wake', async () => {
    const agent = makeAgent({ id: 'agent-1', name: 'my-agent' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockRuntime.sessionExists.mockResolvedValue(false)
    mockAgentRegistry.loadAgents.mockReturnValue([agent])

    await wakeAgent('agent-1', { startProgram: false })

    expect(mockSessionPersistence.persistSession).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'my-agent', agentId: 'agent-1' })
    )
  })

  it('sets up AMP for the session', async () => {
    const agent = makeAgent({ id: 'agent-1', name: 'my-agent' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockRuntime.sessionExists.mockResolvedValue(false)
    mockAgentRegistry.loadAgents.mockReturnValue([agent])

    await wakeAgent('agent-1', { startProgram: false })

    expect(mockAmpInboxWriter.initAgentAMPHome).toHaveBeenCalledWith('my-agent', 'agent-1')
  })

  it('uses session index for multi-brain sessions', async () => {
    const agent = makeAgent({ id: 'agent-1', name: 'my-agent' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockRuntime.sessionExists.mockResolvedValue(false)
    mockAgentRegistry.loadAgents.mockReturnValue([agent])

    const result = await wakeAgent('agent-1', { sessionIndex: 2, startProgram: false })

    expect(result.data?.sessionName).toBe('my-agent_2')
    expect(result.data?.sessionIndex).toBe(2)
  })

  it('returns 500 when tmux session creation fails', async () => {
    const agent = makeAgent({ id: 'agent-1', name: 'my-agent' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockRuntime.sessionExists.mockResolvedValue(false)
    mockRuntime.createSession.mockRejectedValue(new Error('tmux error'))

    const result = await wakeAgent('agent-1', { startProgram: false })

    expect(result.status).toBe(500)
  })

  // Gate 0: Authorization tests
  it('allows system-owner (no agentId) to wake any agent', async () => {
    /** System-owner auth context bypasses all governance checks */
    const agent = makeAgent({ id: 'agent-1', name: 'my-agent', workingDirectory: '/home' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockRuntime.sessionExists.mockResolvedValue(false)
    mockAgentRegistry.loadAgents.mockReturnValue([agent])

    const result = await wakeAgent('agent-1', {
      startProgram: false,
      authContext: { isSystemOwner: true },
    })

    expect(result.status).toBe(200)
    expect(result.data?.woken).toBe(true)
  })

  it('returns 403 when authorize() denies agent-initiated wake', async () => {
    /** Regular agent (not MANAGER/COS) cannot wake other agents */
    mockAuthorization.authorize.mockReturnValue({ allowed: false, reason: 'member cannot wake-agent other agents' })
    const agent = makeAgent({ id: 'agent-1', name: 'my-agent' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)

    const result = await wakeAgent('agent-1', {
      startProgram: false,
      authContext: { isSystemOwner: false, agentId: 'member-agent-1', governanceTitle: 'member' },
    })

    expect(result.status).toBe(403)
    expect(result.error).toMatch(/cannot wake/)
  })

  it('allows MANAGER agent to wake any agent', async () => {
    /** MANAGER can wake any agent on the host */
    mockAuthorization.authorize.mockReturnValue({ allowed: true })
    const agent = makeAgent({ id: 'agent-1', name: 'my-agent', workingDirectory: '/home' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockRuntime.sessionExists.mockResolvedValue(false)
    mockAgentRegistry.loadAgents.mockReturnValue([agent])

    const result = await wakeAgent('agent-1', {
      startProgram: false,
      authContext: { isSystemOwner: false, agentId: 'manager-1', governanceTitle: 'manager' },
    })

    expect(result.status).toBe(200)
    expect(result.data?.woken).toBe(true)
  })

  it('blocks wake of team agent when no MANAGER exists', async () => {
    /** Team agents cannot be woken without a MANAGER on the host */
    mockAuthorization.authorize.mockReturnValue({ allowed: true })
    mockGovernance.getManagerId.mockReturnValue(null)
    mockTeamRegistry.isAgentInAnyTeam.mockReturnValue(true)
    const agent = makeAgent({ id: 'agent-1', name: 'my-agent', workingDirectory: '/home' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)

    const result = await wakeAgent('agent-1', {
      startProgram: false,
      authContext: { isSystemOwner: true },
    })

    expect(result.status).toBe(403)
    expect(result.error).toMatch(/no MANAGER/i)
  })

  it('skips auth when no authContext is provided (internal call)', async () => {
    /** Internal calls without authContext bypass Gate 0 entirely */
    const agent = makeAgent({ id: 'agent-1', name: 'my-agent', workingDirectory: '/home' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockRuntime.sessionExists.mockResolvedValue(false)
    mockAgentRegistry.loadAgents.mockReturnValue([agent])

    const result = await wakeAgent('agent-1', { startProgram: false })

    expect(result.status).toBe(200)
    expect(mockAuthorization.authorize).not.toHaveBeenCalled()
  })

  // SCEN-013 013.05: per-client wake-gate behaviour
  it('returns 501 when waking an unsupported client (gemini)', async () => {
    /** R17 wake-gate refuses unsupported clients up-front because they
     * have no validated InstallElement adapter coverage. */
    const agent = makeAgent({ id: 'agent-1', name: 'my-agent', program: 'gemini', workingDirectory: '/home' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockRuntime.sessionExists.mockResolvedValue(false)

    const result = await wakeAgent('agent-1', { startProgram: false })

    expect(result.status).toBe(501)
    expect(result.error).toMatch(/not yet implemented for client "gemini"/i)
    expect(mockInstallElement).not.toHaveBeenCalled()
    expect(mockRuntime.createSession).not.toHaveBeenCalled()
  })

  it('returns 400 with role_missing_core when InstallElement fails', async () => {
    /** When the R17 gate's auto-install attempt fails, wakeAgent returns
     * the role_missing_core sentinel so the route can render a unified
     * "core dependency missing" alert (parity with R9.13's role_plugin_required). */
    const agent = makeAgent({ id: 'agent-1', name: 'my-agent', program: 'codex', workingDirectory: '/nonexistent-path' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockRuntime.sessionExists.mockResolvedValue(false)
    mockInstallElement.mockResolvedValueOnce({
      success: false,
      operations: ['G07: failed to create dir'],
      stdout: '',
      stderr: 'permission denied',
    })

    const result = await wakeAgent('agent-1', { startProgram: false })

    expect(result.status).toBe(400)
    expect(result.error).toBe('role_missing_core')
    expect(mockRuntime.createSession).not.toHaveBeenCalled()
  })
})

// ============================================================================
// hibernateAgent
// ============================================================================

describe('hibernateAgent', () => {
  it('hibernates an active agent', async () => {
    const agent = makeAgent({ id: 'agent-1', name: 'my-agent' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockRuntime.sessionExists.mockResolvedValue(true)
    mockAgentRegistry.loadAgents.mockReturnValue([agent])

    const result = await hibernateAgent('agent-1', {})

    expect(result.status).toBe(200)
    expect(result.data?.hibernated).toBe(true)
    expect(mockRuntime.killSession).toHaveBeenCalledWith('my-agent')
  })

  it('handles agent with no active session gracefully', async () => {
    const agent = makeAgent({ id: 'agent-1', name: 'my-agent' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockRuntime.sessionExists.mockResolvedValue(false)
    mockAgentRegistry.loadAgents.mockReturnValue([agent])

    const result = await hibernateAgent('agent-1', {})

    expect(result.status).toBe(200)
    expect(result.data?.hibernated).toBe(true)
    expect(result.data?.message).toMatch(/already terminated/i)
  })

  it('returns 404 when agent not found', async () => {
    mockAgentRegistry.getAgent.mockReturnValue(null)

    const result = await hibernateAgent('nonexistent', {})

    expect(result.status).toBe(404)
  })

  it('returns 400 when agent has no name', async () => {
    const agent = makeAgent({ id: 'agent-1', name: '' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)

    const result = await hibernateAgent('agent-1', {})

    expect(result.status).toBe(400)
  })

  it('unpersists session after hibernate', async () => {
    const agent = makeAgent({ id: 'agent-1', name: 'my-agent' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockRuntime.sessionExists.mockResolvedValue(true)
    mockAgentRegistry.loadAgents.mockReturnValue([agent])

    await hibernateAgent('agent-1', {})

    expect(mockSessionPersistence.unpersistSession).toHaveBeenCalledWith('my-agent')
  })

  it('attempts graceful shutdown before kill', async () => {
    const agent = makeAgent({ id: 'agent-1', name: 'my-agent' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockRuntime.sessionExists.mockResolvedValue(true)
    mockAgentRegistry.loadAgents.mockReturnValue([agent])

    await hibernateAgent('agent-1', {})

    // SCEN-013 013.03: hibernate now uses per-client cancel + exit verbs
    // from client-capabilities.ts. For Claude (the test fixture default):
    //   1. C-c   — cancel any in-flight turn (key name, non-literal)
    //   2. /exit — typed in literal mode + Enter, the proper Claude slash
    //              command to leave the client cleanly
    // The previous behaviour sent literal '"exit"' (with quotes) in
    // non-literal mode, which only worked by accident: C-c left Claude
    // running, then '"exit"' rendered as keystrokes Claude treated as
    // user input, and the killSession at the bottom did the actual work.
    expect(mockRuntime.sendKeys).toHaveBeenCalledWith('my-agent', 'C-c')
    expect(mockRuntime.sendKeys).toHaveBeenCalledWith('my-agent', '/exit', { literal: true, enter: true })
  })

  // Gate 0: Authorization tests
  it('allows system-owner to hibernate any agent', async () => {
    /** System-owner auth context bypasses all governance checks */
    const agent = makeAgent({ id: 'agent-1', name: 'my-agent' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockRuntime.sessionExists.mockResolvedValue(true)
    mockAgentRegistry.loadAgents.mockReturnValue([agent])

    const result = await hibernateAgent('agent-1', {
      authContext: { isSystemOwner: true },
    })

    expect(result.status).toBe(200)
    expect(result.data?.hibernated).toBe(true)
  })

  it('returns 403 when authorize() denies agent-initiated hibernate', async () => {
    /** Regular agent (not MANAGER/COS) cannot hibernate other agents */
    mockAuthorization.authorize.mockReturnValue({ allowed: false, reason: 'member cannot hibernate-agent other agents' })

    const result = await hibernateAgent('agent-1', {
      authContext: { isSystemOwner: false, agentId: 'member-agent-1', governanceTitle: 'member' },
    })

    expect(result.status).toBe(403)
    expect(result.error).toMatch(/cannot hibernate/)
  })

  it('skips auth when no authContext is provided (internal call)', async () => {
    /** Internal calls without authContext bypass Gate 0 entirely */
    const agent = makeAgent({ id: 'agent-1', name: 'my-agent' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockRuntime.sessionExists.mockResolvedValue(true)
    mockAgentRegistry.loadAgents.mockReturnValue([agent])

    await hibernateAgent('agent-1', {})

    expect(mockAuthorization.authorize).not.toHaveBeenCalled()
  })

  // SCEN-013 013.03: per-client hibernate behaviour
  it('hibernates a Codex agent gracefully (parity with Claude)', async () => {
    /** Codex agents must hibernate using the same C-c + /exit + killSession
     * sequence Claude uses. Codex has no hooks to tear down so the path is
     * identical apart from being routed through client-capabilities. */
    const agent = makeAgent({ id: 'agent-1', name: 'my-agent', program: 'codex' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockRuntime.sessionExists.mockResolvedValue(true)
    mockAgentRegistry.loadAgents.mockReturnValue([agent])

    const result = await hibernateAgent('agent-1', {})

    expect(result.status).toBe(200)
    expect(result.data?.hibernated).toBe(true)
    expect(mockRuntime.sendKeys).toHaveBeenCalledWith('my-agent', 'C-c')
    expect(mockRuntime.sendKeys).toHaveBeenCalledWith('my-agent', '/exit', { literal: true, enter: true })
    expect(mockRuntime.killSession).toHaveBeenCalledWith('my-agent')
  })

  it('returns 501 when hibernating an unsupported client (gemini)', async () => {
    /** Hibernate refuses to silently produce a half-baked offline state for
     * clients that have no validated graceful-exit path yet. */
    const agent = makeAgent({ id: 'agent-1', name: 'my-agent', program: 'gemini' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)

    const result = await hibernateAgent('agent-1', {})

    expect(result.status).toBe(501)
    expect(result.error).toMatch(/not yet implemented for client "gemini"/i)
    expect(mockRuntime.sendKeys).not.toHaveBeenCalled()
    expect(mockRuntime.killSession).not.toHaveBeenCalled()
  })

  it('returns 501 when hibernating an unknown client', async () => {
    /** detectClientType returns "unknown" for empty/unrecognised program
     * names. Hibernate must refuse rather than guess. */
    const agent = makeAgent({ id: 'agent-1', name: 'my-agent', program: '' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)

    const result = await hibernateAgent('agent-1', {})

    expect(result.status).toBe(501)
    expect(result.error).toMatch(/not yet implemented for client "unknown"/i)
  })
})

// ============================================================================
// sendAgentSessionCommand
// ============================================================================

describe('sendAgentSessionCommand', () => {
  it('sends command to idle session', async () => {
    const agent = makeAgent({ id: 'agent-1', name: 'my-agent' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockRuntime.sessionExists.mockResolvedValue(true)

    const result = await sendAgentSessionCommand('agent-1', { command: 'ls -la' }, SYSTEM_OWNER_CTX)

    expect(result.status).toBe(200)
    expect(result.data?.success).toBe(true)
    expect(result.data?.commandSent).toBe('ls -la')
    expect(result.data?.sessionName).toBe('my-agent')
  })

  it('returns 409 when session is busy', async () => {
    const agent = makeAgent({ id: 'agent-1', name: 'my-agent' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockRuntime.sessionExists.mockResolvedValue(true)
    mockSharedState.sessionActivity.set('my-agent', Date.now())

    const result = await sendAgentSessionCommand('agent-1', { command: 'ls' }, SYSTEM_OWNER_CTX)

    expect(result.status).toBe(409)
    expect(result.error).toMatch(/not idle/i)
  })

  it('allows command when requireIdle is false', async () => {
    const agent = makeAgent({ id: 'agent-1', name: 'my-agent' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockRuntime.sessionExists.mockResolvedValue(true)
    mockSharedState.sessionActivity.set('my-agent', Date.now())

    const result = await sendAgentSessionCommand('agent-1', { command: 'ls', requireIdle: false }, SYSTEM_OWNER_CTX)

    expect(result.status).toBe(200)
  })

  it('returns 404 when agent not found', async () => {
    mockAgentRegistry.getAgent.mockReturnValue(null)

    const result = await sendAgentSessionCommand('nonexistent', { command: 'ls' }, SYSTEM_OWNER_CTX)

    expect(result.status).toBe(404)
  })

  it('returns 400 when command is missing', async () => {
    const agent = makeAgent({ id: 'agent-1', name: 'my-agent' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)

    const result = await sendAgentSessionCommand('agent-1', { command: '' }, SYSTEM_OWNER_CTX)

    expect(result.status).toBe(400)
  })

  it('returns 404 when tmux session not found', async () => {
    const agent = makeAgent({ id: 'agent-1', name: 'my-agent' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockRuntime.sessionExists.mockResolvedValue(false)

    const result = await sendAgentSessionCommand('agent-1', { command: 'ls' }, SYSTEM_OWNER_CTX)

    expect(result.status).toBe(404)
  })

  it('cancels copy mode before sending command', async () => {
    const agent = makeAgent({ id: 'agent-1', name: 'my-agent' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockRuntime.sessionExists.mockResolvedValue(true)

    await sendAgentSessionCommand('agent-1', { command: 'ls' }, SYSTEM_OWNER_CTX)

    expect(mockRuntime.cancelCopyMode).toHaveBeenCalledWith('my-agent')
  })

  it('updates activity timestamp', async () => {
    const agent = makeAgent({ id: 'agent-1', name: 'my-agent' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockRuntime.sessionExists.mockResolvedValue(true)

    await sendAgentSessionCommand('agent-1', { command: 'ls' }, SYSTEM_OWNER_CTX)

    expect(mockSharedState.sessionActivity.get('my-agent')).toBeDefined()
  })

  it('returns 400 when agent has no name', async () => {
    const agent = makeAgent({ id: 'agent-1', name: '' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)

    const result = await sendAgentSessionCommand('agent-1', { command: 'ls' }, SYSTEM_OWNER_CTX)

    expect(result.status).toBe(400)
    expect(result.error).toMatch(/no name/i)
  })
})

// ============================================================================
// linkAgentSession
// ============================================================================

describe('linkAgentSession', () => {
  it('links session to agent', async () => {
    mockAgentRegistry.linkSession.mockReturnValue(true)

    const result = await linkAgentSession('agent-1', { sessionName: 'my-session' }, SYSTEM_OWNER_CTX)

    expect(result.status).toBe(200)
    expect(result.data?.success).toBe(true)
  })

  it('returns 400 when sessionName is missing', async () => {
    const result = await linkAgentSession('agent-1', { sessionName: '' }, SYSTEM_OWNER_CTX)

    expect(result.status).toBe(400)
  })

  it('returns 404 when agent not found', async () => {
    mockAgentRegistry.linkSession.mockReturnValue(false)

    const result = await linkAgentSession('nonexistent', { sessionName: 'my-session' }, SYSTEM_OWNER_CTX)

    expect(result.status).toBe(404)
  })
})

// ============================================================================
// unlinkOrDeleteAgentSession
// ============================================================================

describe('unlinkOrDeleteAgentSession', () => {
  it('unlinks session from agent', async () => {
    const agent = makeAgent({ id: 'agent-1', name: 'my-agent' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockAgentRegistry.unlinkSession.mockReturnValue(true)

    const result = await unlinkOrDeleteAgentSession('agent-1', {}, SYSTEM_OWNER_CTX)

    expect(result.status).toBe(200)
    expect(result.data?.sessionUnlinked).toBe(true)
  })

  it('kills session and unlinks when kill=true', async () => {
    const agent = makeAgent({ id: 'agent-1', name: 'my-agent' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockAgentRegistry.unlinkSession.mockReturnValue(true)
    mockRuntime.sessionExists.mockResolvedValue(true)

    const result = await unlinkOrDeleteAgentSession('agent-1', { kill: true }, SYSTEM_OWNER_CTX)

    expect(result.status).toBe(200)
    expect(result.data?.sessionKilled).toBe(true)
    expect(mockRuntime.killSession).toHaveBeenCalledWith('my-agent')
  })

  it('deletes agent when deleteAgent=true', async () => {
    const agent = makeAgent({ id: 'agent-1', name: 'my-agent' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockAgentRegistry.deleteAgent.mockReturnValue(true)

    const result = await unlinkOrDeleteAgentSession('agent-1', { deleteAgent: true }, SYSTEM_OWNER_CTX)

    expect(result.status).toBe(200)
    expect(result.data?.deleted).toBe(true)
    expect(mockAgentRegistry.deleteAgent).toHaveBeenCalledWith('agent-1', true)
  })

  it('returns 404 when agent not found', async () => {
    mockAgentRegistry.getAgent.mockReturnValue(null)

    const result = await unlinkOrDeleteAgentSession('nonexistent', {}, SYSTEM_OWNER_CTX)

    expect(result.status).toBe(404)
  })

  it('returns 404 when unlink fails', async () => {
    const agent = makeAgent({ id: 'agent-1', name: 'my-agent' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockAgentRegistry.unlinkSession.mockReturnValue(false)

    const result = await unlinkOrDeleteAgentSession('agent-1', {}, SYSTEM_OWNER_CTX)

    expect(result.status).toBe(404)
  })
})

// ============================================================================
// getAgentSessionStatus
// ============================================================================

describe('getAgentSessionStatus', () => {
  it('returns session status for agent with tmux session', async () => {
    const agent = makeAgent({ id: 'agent-1', name: 'my-agent' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockRuntime.sessionExists.mockResolvedValue(true)

    const result = await getAgentSessionStatus('agent-1')

    expect(result.status).toBe(200)
    expect(result.data?.hasSession).toBe(true)
    expect(result.data?.exists).toBe(true)
  })

  it('returns hasSession=false when agent has no name', async () => {
    const agent = makeAgent({ id: 'agent-1', name: '' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)

    const result = await getAgentSessionStatus('agent-1')

    expect(result.status).toBe(200)
    expect(result.data?.hasSession).toBe(false)
  })

  it('returns 404 when agent not found', async () => {
    mockAgentRegistry.getAgent.mockReturnValue(null)

    const result = await getAgentSessionStatus('nonexistent')

    expect(result.status).toBe(404)
  })

  it('returns idle status based on activity', async () => {
    const agent = makeAgent({ id: 'agent-1', name: 'my-agent' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockRuntime.sessionExists.mockResolvedValue(true)
    // No activity = idle

    const result = await getAgentSessionStatus('agent-1')

    expect(result.data?.idle).toBe(true)
  })
})

// ============================================================================
// initializeStartup
// ============================================================================

describe('initializeStartup', () => {
  it('initializes all agents', async () => {
    mockAgentStartup.initializeAllAgents.mockResolvedValue({
      initialized: ['agent-1', 'agent-2'],
      failed: [],
    })

    const result = await initializeStartup()

    expect(result.status).toBe(200)
    expect(result.data?.initialized).toHaveLength(2)
    expect(result.data?.failed).toHaveLength(0)
  })

  it('reports partial failures', async () => {
    mockAgentStartup.initializeAllAgents.mockResolvedValue({
      initialized: ['agent-1'],
      failed: [{ agentId: 'agent-2', error: 'no session' }],
    })

    const result = await initializeStartup()

    expect(result.status).toBe(200)
    expect(result.data?.failed).toHaveLength(1)
  })

  it('returns 500 on unexpected error', async () => {
    mockAgentStartup.initializeAllAgents.mockRejectedValue(new Error('init failed'))

    const result = await initializeStartup()

    expect(result.status).toBe(500)
  })
})

// ============================================================================
// getStartupInfo
// ============================================================================

describe('getStartupInfo', () => {
  it('returns startup status', () => {
    mockAgentStartup.getStartupStatus.mockReturnValue({ discoveredAgents: 5, activeAgents: 3, agents: [] })

    const result = getStartupInfo()

    expect(result.status).toBe(200)
    expect(result.data?.success).toBe(true)
    expect(result.data?.discoveredAgents).toBe(5)
  })

  it('returns 500 on error', () => {
    mockAgentStartup.getStartupStatus.mockImplementation(() => { throw new Error('fail') })

    const result = getStartupInfo()

    expect(result.status).toBe(500)
  })
})

// ============================================================================
// proxyHealthCheck
// ============================================================================

describe('proxyHealthCheck', () => {
  it('returns 400 when URL is missing', async () => {
    const result = await proxyHealthCheck('')

    expect(result.status).toBe(400)
  })

  it('returns 400 when URL is not a string', async () => {
    const result = await proxyHealthCheck(null as any)

    expect(result.status).toBe(400)
  })
})
