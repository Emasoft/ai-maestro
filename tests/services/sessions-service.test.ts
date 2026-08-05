/**
 * Sessions Service Tests
 *
 * Tests the pure business logic in services/sessions-service.ts.
 * Mocks all lib/ dependencies and runtime integration points.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resetFixtureCounter } from '../test-utils/fixtures'

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
  mockFs,
  mockLaunchArgs,
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

  return {
    mockRuntime,
    mockAgentRegistry: {
      getAgentBySession: vi.fn(),
      getAgentByName: vi.fn(),
      createAgent: vi.fn(),
      deleteAgentBySession: vi.fn(),
      renameAgentSession: vi.fn(),
      loadAgents: vi.fn().mockReturnValue([]),
      linkSession: vi.fn(),
      unlinkSession: vi.fn(),
    },
    mockHostsConfig: {
      getHosts: vi.fn().mockReturnValue([{ id: 'test-host', name: 'Test Host', url: 'http://localhost:23000' }]),
      getSelfHost: vi.fn().mockReturnValue({ id: 'test-host', name: 'Test Host', url: 'http://localhost:23000' }),
      getSelfHostId: vi.fn().mockReturnValue('test-host'),
      isSelf: vi.fn().mockReturnValue(true),
      getHostById: vi.fn().mockReturnValue(null),
    },
    mockSessionPersistence: {
      persistSession: vi.fn(),
      loadPersistedSessions: vi.fn().mockReturnValue([]),
      unpersistSession: vi.fn().mockReturnValue(true),
    },
    mockAmpInboxWriter: {
      initAgentAMPHome: vi.fn().mockResolvedValue(undefined),
      getAgentAMPDir: vi.fn().mockReturnValue('/tmp/amp/test'),
    },
    mockSharedState: {
      sessionActivity: new Map<string, number>(),
      // ai-maestro#117 — `sendCommand` marks here after a SUCCESSFUL send. This mock lists its
      // exports explicitly, so a new export the code imports must be added or every test that
      // reaches the marking line dies on "No X export is defined on the mock".
      injectedPrompts: new Map<string, number>(),
      broadcastStatusUpdate: vi.fn(),
    },
    mockFs: (() => {
      const fns = {
        readFileSync: vi.fn().mockReturnValue(JSON.stringify({ version: '0.24.2' })),
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
    // TRDD-GZ1KOHNR: default passthrough so the launch/keychain tests reach the
    // launch path unchanged. Individual tests flip it to `refuse` to exercise
    // createSession's --agent-enforcement wiring.
    mockLaunchArgs: {
      resolveLaunchArgs: vi.fn(
        async (
          _agentId: string | undefined,
          _program: string,
          args: string,
        ): Promise<{ kind: 'ok'; args: string } | { kind: 'refuse'; reason: string }> => ({ kind: 'ok', args }),
      ),
    },
  }
})

vi.mock('@/lib/agent-runtime', () => ({
  getRuntime: vi.fn().mockReturnValue(mockRuntime),
  // The launch path awaits these before typing anything (SCEN-015 +
  // TRDD-CNF1X3J7). Happy-path defaults so the pre-existing createSession
  // tests exercise the launch path unchanged. The mock previously lacked
  // prepareShellForLaunch entirely, which failed every createSession test
  // the moment the service started calling it.
  prepareShellForLaunch: vi.fn(async () => ({ ready: true, interrupted: false })),
  preflightPaneKeychain: vi.fn(async () => ({ status: 'ok' as const })),
  SHELL_READY_TIMEOUT_MS: 15000,
}))
// TRDD-CNF1X3J7: keep the probe-script installer off the real filesystem.
vi.mock('@/lib/agent-keychain-probe', () => ({
  ensureKeychainProbeInstalled: vi.fn(async () => {}),
  KEYCHAIN_PROBE_INSTALL_PATH: '/tmp/keychain-probe-test.sh',
}))
vi.mock('@/lib/agent-registry', () => mockAgentRegistry)
vi.mock('@/lib/hosts-config', () => mockHostsConfig)
vi.mock('@/lib/session-persistence', () => mockSessionPersistence)
vi.mock('@/lib/amp-inbox-writer', () => mockAmpInboxWriter)
vi.mock('@/services/shared-state', () => mockSharedState)
vi.mock('@/services/agent-launch-args', () => mockLaunchArgs)
vi.mock('fs', () => mockFs)
vi.mock('child_process', () => ({
  // exec/execFile must be callback-style for promisify to work
  exec: vi.fn((_cmd: string, cb: Function) => cb(null, { stdout: '', stderr: '' })),
  execFile: vi.fn((_file: string, _args: string[], _opts: any, cb: Function) => cb(null, { stdout: '', stderr: '' })),
  execSync: vi.fn().mockReturnValue(''),
}))

// ============================================================================
// Import module under test (after mocks)
// ============================================================================

import {
  listSessions,
  listLocalSessions,
  createSession,
  deleteSession,
  renameSession,
  sendCommand,
  checkIdleStatus,
  listRestorableSessions,
  restoreSessions,
  broadcastActivityUpdate,
  deletePersistedSession,
  getActivity,
} from '@/services/sessions-service'
import type { AuthContext } from '@/lib/agent-auth'

// SVC2-CRIT-01 (2026-05-06): sendCommand now requires AuthContext.
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
  mockSharedState.injectedPrompts.clear()
  // Reset runtime mock defaults
  mockRuntime.listSessions.mockResolvedValue([])
  mockRuntime.sessionExists.mockResolvedValue(false)
  mockRuntime.createSession.mockResolvedValue(undefined)
  mockHostsConfig.getSelfHost.mockReturnValue({ id: 'test-host', name: 'Test Host', url: 'http://localhost:23000' })
  mockHostsConfig.getHosts.mockReturnValue([{ id: 'test-host', name: 'Test Host', url: 'http://localhost:23000' }])
  mockHostsConfig.isSelf.mockReturnValue(true)
  mockAgentRegistry.loadAgents.mockReturnValue([])
})

// ============================================================================
// listSessions
// ============================================================================

describe('listSessions', () => {
  // NOTE: listSessions has a module-level 3s cache that persists across tests.
  // We test caching in a single test. For session data behavior, use listLocalSessions.

  it('returns sessions and caches subsequent calls', async () => {
    mockRuntime.listSessions.mockResolvedValue([
      { name: 'agent-1', workingDirectory: '/home/test', createdAt: '2025-01-01T00:00:00Z', windows: 1 },
    ])

    const first = await listSessions()
    expect(first.sessions).toHaveLength(1)
    expect(first.sessions[0].name).toBe('agent-1')
    expect(first.sessions[0].hostId).toBe('test-host')

    // Second call within 3s should be cached
    const second = await listSessions()
    expect(second.fromCache).toBe(true)
    expect(second.sessions).toHaveLength(1)
  })
})

// ============================================================================
// listLocalSessions
// ============================================================================

describe('listLocalSessions', () => {
  it('returns local sessions', async () => {
    mockRuntime.listSessions.mockResolvedValue([
      { name: 'local-agent', workingDirectory: '/home', createdAt: '2025-01-01T00:00:00Z', windows: 1 },
    ])

    const result = await listLocalSessions()

    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0].name).toBe('local-agent')
  })

  it('returns empty when no self host configured', async () => {
    mockHostsConfig.getSelfHost.mockReturnValue(null)

    const result = await listLocalSessions()

    expect(result.sessions).toEqual([])
  })

  it('returns empty when no sessions found', async () => {
    mockRuntime.listSessions.mockResolvedValue([])

    const result = await listLocalSessions()

    expect(result.sessions).toEqual([])
  })

  it('marks session as active when recently active', async () => {
    mockRuntime.listSessions.mockResolvedValue([
      { name: 'active-agent', workingDirectory: '/home', createdAt: '2025-01-01T00:00:00Z', windows: 1 },
    ])
    mockSharedState.sessionActivity.set('active-agent', Date.now())

    const result = await listLocalSessions()

    expect(result.sessions[0].status).toBe('active')
  })

  it('marks session as disconnected when no activity recorded', async () => {
    mockRuntime.listSessions.mockResolvedValue([
      { name: 'quiet-agent', workingDirectory: '/home', createdAt: '2025-01-01T00:00:00Z', windows: 1 },
    ])

    const result = await listLocalSessions()

    expect(result.sessions[0].status).toBe('disconnected')
  })

  it('marks session as idle when activity is old', async () => {
    mockRuntime.listSessions.mockResolvedValue([
      { name: 'old-agent', workingDirectory: '/home', createdAt: '2025-01-01T00:00:00Z', windows: 1 },
    ])
    mockSharedState.sessionActivity.set('old-agent', Date.now() - 10000) // 10s ago > 3s threshold

    const result = await listLocalSessions()

    expect(result.sessions[0].status).toBe('idle')
  })

  it('links agentId from registry', async () => {
    mockRuntime.listSessions.mockResolvedValue([
      { name: 'known-agent', workingDirectory: '/home', createdAt: '2025-01-01T00:00:00Z', windows: 1 },
    ])
    mockAgentRegistry.getAgentBySession.mockReturnValue({ id: 'uuid-123' })

    const result = await listLocalSessions()

    expect(result.sessions[0].agentId).toBe('uuid-123')
  })
})

// ============================================================================
// createSession
// ============================================================================

describe('createSession', () => {
  it('creates a local session successfully', async () => {
    mockRuntime.sessionExists.mockResolvedValue(false)
    mockAgentRegistry.getAgentByName.mockReturnValue(null)
    mockAgentRegistry.createAgent.mockReturnValue({ id: 'new-agent-id', name: 'my-agent' })

    const result = await createSession({ name: 'my-agent' })

    expect(result.status).toBe(200)
    expect(result.data?.success).toBe(true)
    expect(result.data?.name).toBe('my-agent')
    expect(mockRuntime.createSession).toHaveBeenCalled()
  })

  // TRDD-CNF1X3J7 Gate 1 wiring: a pane that cannot read the login keychain
  // must never receive the client command — kill the pane, undo link+persist,
  // return 503 naming the remedy. A refused launch is strictly better than a
  // zombie agent that shows green while `claude` prints "Not logged in".
  it('refuses the launch when the keychain preflight refuses — no client injection, pane killed, link undone', async () => {
    const { preflightPaneKeychain } = await import('@/lib/agent-runtime')
    mockRuntime.sessionExists.mockResolvedValue(false)
    mockAgentRegistry.getAgentByName.mockReturnValue({ id: 'agent-1', name: 'my-agent', launchCount: 1 })
    vi.mocked(preflightPaneKeychain).mockResolvedValueOnce({ status: 'refuse', reason: 'keychain_unreadable' } as never)

    const result = await createSession({ name: 'my-agent', agentId: 'agent-1' })

    expect(result.status).toBe(503)
    expect(result.error).toContain('keychain')
    // The client command was never typed into the pane...
    expect(mockRuntime.sendKeys).not.toHaveBeenCalledWith('my-agent', expect.stringContaining('claude'), expect.anything())
    // ...the doomed pane is gone, and the agent is not left green-but-dead.
    expect(mockRuntime.killSession).toHaveBeenCalledWith('my-agent')
    expect(mockSessionPersistence.unpersistSession).toHaveBeenCalledWith('my-agent')
    expect(mockAgentRegistry.unlinkSession).toHaveBeenCalledWith('agent-1')
  })

  // TRDD-GZ1KOHNR: a titled Claude agent whose role-plugin main-agent cannot be
  // resolved must NOT launch generic claude (its persona would never load — the
  // SCEN-031 MANAGER-builds-solo failure). resolveLaunchArgs refuses; createSession
  // then kills the pane and undoes link+persist, exactly like the keychain refuse.
  it('refuses the launch when --agent enforcement refuses — no client injection, pane killed, link undone', async () => {
    mockRuntime.sessionExists.mockResolvedValue(false)
    mockAgentRegistry.getAgentByName.mockReturnValue({ id: 'agent-1', name: 'my-agent', launchCount: 1 })
    mockLaunchArgs.resolveLaunchArgs.mockResolvedValueOnce({
      kind: 'refuse',
      reason: 'Claude agent has no resolvable role-plugin main-agent',
    })

    const result = await createSession({ name: 'my-agent', agentId: 'agent-1' })

    expect(result.status).toBe(409)
    expect(result.error).toContain('role-plugin')
    expect(mockRuntime.sendKeys).not.toHaveBeenCalledWith('my-agent', expect.stringContaining('claude'), expect.anything())
    expect(mockRuntime.killSession).toHaveBeenCalledWith('my-agent')
    expect(mockSessionPersistence.unpersistSession).toHaveBeenCalledWith('my-agent')
    expect(mockAgentRegistry.unlinkSession).toHaveBeenCalledWith('agent-1')
  })

  // TRDD-YOS36TZI: createSession spawns the tmux session but used to leave the
  // registry saying `status: offline, sessions: []`. The ONLY thing that ever
  // repaired that was a client calling GET /api/sessions — a READ path. Since
  // boot-restore selects on `status === 'active'`, a headless server (no UI, so
  // nobody polls) restored NOTHING after a restart. The session write must happen
  // where the session is created.
  it('links the new session into the registry so the agent reads back ACTIVE', async () => {
    mockRuntime.sessionExists.mockResolvedValue(false)
    mockAgentRegistry.getAgentByName.mockReturnValue({ id: 'agent-1', name: 'my-agent', launchCount: 0 })

    await createSession({ name: 'my-agent', workingDirectory: '/work/dir', agentId: 'agent-1' })

    expect(mockAgentRegistry.linkSession).toHaveBeenCalledWith('agent-1', 'my-agent', '/work/dir')
  })

  it('does not touch the registry when the agent could not be registered', async () => {
    mockRuntime.sessionExists.mockResolvedValue(false)
    mockAgentRegistry.getAgentByName.mockReturnValue(null)
    mockAgentRegistry.createAgent.mockImplementation(() => { throw new Error('registry down') })

    await createSession({ name: 'orphan' })

    // No agent id to link to — a session with no owner must not invent one.
    expect(mockAgentRegistry.linkSession).not.toHaveBeenCalled()
  })

  it('returns 400 when name is missing', async () => {
    const result = await createSession({ name: '' })

    expect(result.status).toBe(400)
    expect(result.error).toMatch(/name/i)
  })

  it('returns 400 when name contains invalid characters', async () => {
    const result = await createSession({ name: 'my agent!!' })

    expect(result.status).toBe(400)
    expect(result.error).toMatch(/letters.*numbers.*dashes.*underscores/i)
  })

  it('returns 409 when session already exists', async () => {
    mockRuntime.sessionExists.mockResolvedValue(true)

    const result = await createSession({ name: 'existing' })

    expect(result.status).toBe(409)
    expect(result.error).toMatch(/already exists/i)
  })

  it('normalizes name to lowercase', async () => {
    mockRuntime.sessionExists.mockResolvedValue(false)
    mockAgentRegistry.getAgentByName.mockReturnValue(null)
    mockAgentRegistry.createAgent.mockReturnValue({ id: 'id', name: 'myagent' })

    await createSession({ name: 'MyAgent' })

    // Source passes 3 args: (sessionName, cwd, initialEnv).
    // Env bag always contains AGENT_WORK_DIR + AIM_AGENT_NAME (lowercased name).
    expect(mockRuntime.createSession).toHaveBeenCalledWith(
      'myagent',
      expect.any(String),
      expect.objectContaining({ AIM_AGENT_NAME: 'myagent' })
    )
  })

  it('uses provided working directory', async () => {
    mockRuntime.sessionExists.mockResolvedValue(false)
    mockAgentRegistry.getAgentByName.mockReturnValue(null)
    mockAgentRegistry.createAgent.mockReturnValue({ id: 'id', name: 'agent' })

    await createSession({ name: 'agent', workingDirectory: '/custom/path' })

    // Source passes 3 args: (sessionName, cwd, initialEnv). cwd flows into AGENT_WORK_DIR.
    expect(mockRuntime.createSession).toHaveBeenCalledWith(
      'agent',
      '/custom/path',
      expect.objectContaining({ AGENT_WORK_DIR: '/custom/path' })
    )
  })

  it('registers a new agent when not found in registry', async () => {
    mockRuntime.sessionExists.mockResolvedValue(false)
    mockAgentRegistry.getAgentByName.mockReturnValue(null)
    mockAgentRegistry.createAgent.mockReturnValue({ id: 'new-id', name: 'agent' })

    await createSession({ name: 'agent' })

    expect(mockAgentRegistry.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'agent' })
    )
  })

  it('skips registration when agent exists in registry', async () => {
    mockRuntime.sessionExists.mockResolvedValue(false)
    mockAgentRegistry.getAgentByName.mockReturnValue({ id: 'existing-id', name: 'agent' })

    await createSession({ name: 'agent' })

    expect(mockAgentRegistry.createAgent).not.toHaveBeenCalled()
  })

  it('persists session metadata', async () => {
    mockRuntime.sessionExists.mockResolvedValue(false)
    mockAgentRegistry.getAgentByName.mockReturnValue(null)
    mockAgentRegistry.createAgent.mockReturnValue({ id: 'id', name: 'agent' })

    await createSession({ name: 'agent' })

    expect(mockSessionPersistence.persistSession).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'agent' })
    )
  })

  it('initializes AMP for the session', async () => {
    mockRuntime.sessionExists.mockResolvedValue(false)
    mockAgentRegistry.getAgentByName.mockReturnValue(null)
    mockAgentRegistry.createAgent.mockReturnValue({ id: 'id', name: 'agent' })

    await createSession({ name: 'agent' })

    expect(mockAmpInboxWriter.initAgentAMPHome).toHaveBeenCalled()
  })

  it('accepts valid session names with hyphens and underscores', async () => {
    mockRuntime.sessionExists.mockResolvedValue(false)
    mockAgentRegistry.getAgentByName.mockReturnValue(null)
    mockAgentRegistry.createAgent.mockReturnValue({ id: 'id', name: 'my-test_agent' })

    const result = await createSession({ name: 'my-test_agent' })

    expect(result.status).toBe(200)
  })
})

// ============================================================================
// deleteSession
// ============================================================================

describe('deleteSession', () => {
  it('deletes a local tmux session', async () => {
    mockAgentRegistry.getAgentBySession.mockReturnValue(null)
    mockRuntime.sessionExists.mockResolvedValue(true)

    const result = await deleteSession('my-agent')

    expect(result.status).toBe(200)
    expect(result.data?.success).toBe(true)
    expect(mockRuntime.killSession).toHaveBeenCalledWith('my-agent')
  })

  it('returns 404 when session does not exist', async () => {
    mockAgentRegistry.getAgentBySession.mockReturnValue(null)
    mockRuntime.sessionExists.mockResolvedValue(false)

    const result = await deleteSession('nonexistent')

    expect(result.status).toBe(404)
  })

  it('handles cloud agent deletion without tmux kill', async () => {
    mockAgentRegistry.getAgentBySession.mockReturnValue({
      id: 'cloud-1',
      deployment: { type: 'cloud' },
    })

    const result = await deleteSession('cloud-agent')

    expect(result.status).toBe(200)
    expect(result.data?.type).toBe('cloud')
    expect(mockRuntime.killSession).not.toHaveBeenCalled()
    // Implementation passes agent.id (not sessionName) to deleteAgentBySession for cloud agents
    expect(mockAgentRegistry.deleteAgentBySession).toHaveBeenCalledWith('cloud-1', false)
  })

  it('removes persisted session and agent registry entry', async () => {
    mockAgentRegistry.getAgentBySession.mockReturnValue(null)
    mockRuntime.sessionExists.mockResolvedValue(true)

    await deleteSession('my-agent')

    expect(mockSessionPersistence.unpersistSession).toHaveBeenCalledWith('my-agent')
    expect(mockAgentRegistry.deleteAgentBySession).toHaveBeenCalledWith('my-agent', false)
  })
})

// ============================================================================
// renameSession
// ============================================================================

describe('renameSession', () => {
  it('renames a local tmux session', async () => {
    mockRuntime.sessionExists
      .mockResolvedValueOnce(true)   // old exists
      .mockResolvedValueOnce(false)  // new doesn't exist
    mockFs.default.existsSync.mockReturnValue(false) // not a cloud agent

    const result = await renameSession('old-name', 'new-name')

    expect(result.status).toBe(200)
    expect(result.data?.oldName).toBe('old-name')
    expect(result.data?.newName).toBe('new-name')
    expect(mockRuntime.renameSession).toHaveBeenCalledWith('old-name', 'new-name')
  })

  it('returns 400 when new name is missing', async () => {
    const result = await renameSession('old', '')

    expect(result.status).toBe(400)
  })

  it('returns 400 when new name has invalid characters', async () => {
    const result = await renameSession('old', 'new name!!')

    expect(result.status).toBe(400)
    expect(result.error).toMatch(/letters.*numbers.*dashes.*underscores/i)
  })

  it('returns 404 when old session not found', async () => {
    mockFs.default.existsSync.mockReturnValue(false) // not cloud agent
    mockRuntime.sessionExists.mockResolvedValue(false)

    const result = await renameSession('nonexistent', 'new-name')

    expect(result.status).toBe(404)
  })

  it('returns 409 when new name already exists', async () => {
    mockFs.default.existsSync.mockReturnValue(false) // not cloud agent
    mockRuntime.sessionExists
      .mockResolvedValueOnce(true)  // old exists
      .mockResolvedValueOnce(true)  // new exists too

    const result = await renameSession('old-name', 'existing-name')

    expect(result.status).toBe(409)
  })

  it('updates agent registry after rename', async () => {
    mockFs.default.existsSync.mockReturnValue(false) // not cloud agent
    mockRuntime.sessionExists
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)

    await renameSession('old-name', 'new-name')

    expect(mockAgentRegistry.renameAgentSession).toHaveBeenCalledWith('old-name', 'new-name')
  })
})

// ============================================================================
// sendCommand
// ============================================================================

describe('sendCommand', () => {
  it('sends command to idle session', async () => {
    mockRuntime.sessionExists.mockResolvedValue(true)
    // sendCommand sets activity before idle check, so requireIdle must be false
    // to test basic command-sending behavior
    const result = await sendCommand('my-agent', 'ls -la', { requireIdle: false, authContext: SYSTEM_OWNER_CTX })

    expect(result.status).toBe(200)
    expect(result.data?.success).toBe(true)
    expect(result.data?.commandSent).toBe('ls -la')
    expect(mockRuntime.sendKeys).toHaveBeenCalledWith('my-agent', 'ls -la', { literal: true, enter: true })
  })

  it('cancels copy mode before sending command', async () => {
    mockRuntime.sessionExists.mockResolvedValue(true)

    await sendCommand('my-agent', 'test', { requireIdle: false, authContext: SYSTEM_OWNER_CTX })

    expect(mockRuntime.cancelCopyMode).toHaveBeenCalledWith('my-agent')
  })

  it('returns 400 when command is missing', async () => {
    const result = await sendCommand('my-agent', '', { authContext: SYSTEM_OWNER_CTX })

    expect(result.status).toBe(400)
    expect(result.error).toMatch(/command/i)
  })

  it('returns 404 when session does not exist', async () => {
    mockRuntime.sessionExists.mockResolvedValue(false)

    const result = await sendCommand('nonexistent', 'ls', { authContext: SYSTEM_OWNER_CTX })

    expect(result.status).toBe(404)
  })

  it('returns 409 when session is not idle and requireIdle is true', async () => {
    mockRuntime.sessionExists.mockResolvedValue(true)
    mockSharedState.sessionActivity.set('busy-agent', Date.now()) // very recent = not idle

    const result = await sendCommand('busy-agent', 'ls', { authContext: SYSTEM_OWNER_CTX })

    expect(result.status).toBe(409)
    expect(result.error).toMatch(/not idle/i)
  })

  // CHARACTERISATION TEST — this pins CURRENT behaviour, and the behaviour looks WRONG.
  // Reported, not silently "fixed": changing it alters live injection fleet-wide, which is the
  // same reason #110 is user-gated.
  //
  // The gate is UNCONDITIONAL. `sendCommand` bumps sessionActivity to Date.now() at
  // services/sessions-service.ts:1340, and isSessionIdle (:307-311) is
  //   const activity = sessionActivity.get(name); if (!activity) return true
  //   return (Date.now() - activity) > IDLE_THRESHOLD_MS
  // so by the time the check runs the elapsed time is ~0 and can never exceed the threshold. The
  // `!activity` early-out cannot save the first call either, because the bump already wrote it.
  // Net: with requireIdle at its default (true), EVERY call 409s — even the first one, on a
  // completely fresh session with no prior activity, which is what this test demonstrates.
  //
  // Consequences worth stating, because they reframe three other issues:
  //   - the "protect a busy agent" gate protects nothing; it refuses everything;
  //   - #110's CLI hardcoding require_idle=false reads as a WORKAROUND for this, not a mistake —
  //     which means "fix the CLI to use the server default" would 409 every CLI injection;
  //   - #51's wake mechanism cannot use the default path at all.
  it('CHARACTERISATION (#51/#110): 409s even on a FRESH session — the idle gate never passes', async () => {
    mockRuntime.sessionExists.mockResolvedValue(true)
    // Deliberately NO sessionActivity seeded: this session has never been touched.
    expect(mockSharedState.sessionActivity.has('pristine-agent')).toBe(false)

    const result = await sendCommand('pristine-agent', 'ls', { authContext: SYSTEM_OWNER_CTX })

    expect(result.status).toBe(409)
    expect(result.error).toMatch(/not idle/i)
    expect(mockRuntime.sendKeys).not.toHaveBeenCalled()
  })

  it('sends command even when busy if requireIdle is false', async () => {
    mockRuntime.sessionExists.mockResolvedValue(true)
    mockSharedState.sessionActivity.set('busy-agent', Date.now())

    const result = await sendCommand('busy-agent', 'ls', { requireIdle: false, authContext: SYSTEM_OWNER_CTX })

    expect(result.status).toBe(200)
    expect(result.data?.success).toBe(true)
  })

  it('respects addNewline option', async () => {
    mockRuntime.sessionExists.mockResolvedValue(true)

    await sendCommand('my-agent', 'test', { requireIdle: false, addNewline: false, authContext: SYSTEM_OWNER_CTX })

    expect(mockRuntime.sendKeys).toHaveBeenCalledWith('my-agent', 'test', { literal: true, enter: false })
  })

  it('updates activity timestamp after sending command', async () => {
    mockRuntime.sessionExists.mockResolvedValue(true)

    await sendCommand('my-agent', 'ls', { authContext: SYSTEM_OWNER_CTX })

    expect(mockSharedState.sessionActivity.get('my-agent')).toBeDefined()
  })

  // ai-maestro#117 — the injection MARK. Without these two the `injectedPrompts.set(...)` line
  // could be deleted and this whole file would stay green: the mock would simply go unused.
  // `requireIdle: false` is REQUIRED here and is not boilerplate: the activity bump at
  // sessions-service.ts:1340 runs before the idle check and sets the timestamp to NOW, so with
  // requireIdle defaulting to true this call ALWAYS 409s (see the same note at line 595). That
  // also means the neighbouring 'updates activity timestamp' test is green on a 409 — it asserts
  // the map the refusal path writes anyway. This one is not: a mark only exists after a send.
  it('MARKS the session as injected after a successful send', async () => {
    mockRuntime.sessionExists.mockResolvedValue(true)

    const result = await sendCommand('my-agent', 'ls', { requireIdle: false, authContext: SYSTEM_OWNER_CTX })

    expect(result.status).toBe(200)
    expect(mockSharedState.injectedPrompts.get('my-agent')).toBeDefined()
  })

  // THE LOAD-BEARING ONE, and the reason the mark is not written beside the activity bump.
  // The bump at sessions-service.ts:1340 runs BEFORE the idle check, so it fires even for a send
  // this function then REFUSES with 409. A refused send injects nothing, so it must leave no mark
  // — otherwise the next genuine keystroke would be vetoed as an echo of a prompt never sent.
  // Asserting BOTH maps is what makes this discriminating: it fails if the two are ever marked
  // at the same point, which is the "simplification" a future reader is most likely to attempt.
  //
  // NEUTER RUNS (2026-08-05 — OBSERVED via scripts/dev/neuter, restore verified by blob hash).
  // The second one performs exactly that simplification, and only this test catches it:
  //   s/injectedPrompts\.set\(sessionName, Date\.now\(\)\)/void 0/
  //   → 1 red / 66 green:  MARKS the session as injected after a successful send
  //   s/^  sessionActivity\.set\(sessionName, Date\.now\(\)\)/  sessionActivity.set(sessionName, Date.now()); injectedPrompts.set(sessionName, Date.now())/m
  //   → 1 red / 66 green:  does NOT mark a send it REFUSES with 409, though it still bumps activity
  it('does NOT mark a send it REFUSES with 409, though it still bumps activity', async () => {
    mockRuntime.sessionExists.mockResolvedValue(true)
    mockSharedState.sessionActivity.set('busy-agent', Date.now()) // very recent = not idle

    const result = await sendCommand('busy-agent', 'ls', { authContext: SYSTEM_OWNER_CTX })

    expect(result.status).toBe(409)
    expect(mockSharedState.sessionActivity.get('busy-agent')).toBeDefined()
    expect(mockSharedState.injectedPrompts.has('busy-agent')).toBe(false)
  })
})

// ============================================================================
// checkIdleStatus
// ============================================================================

describe('checkIdleStatus', () => {
  it('returns idle=true when no activity recorded', async () => {
    mockRuntime.sessionExists.mockResolvedValue(true)

    const result = await checkIdleStatus('my-agent')

    expect(result.exists).toBe(true)
    expect(result.idle).toBe(true)
    expect(result.lastActivity).toBeNull()
  })

  it('returns idle=false for recently active session', async () => {
    mockRuntime.sessionExists.mockResolvedValue(true)
    mockSharedState.sessionActivity.set('my-agent', Date.now())

    const result = await checkIdleStatus('my-agent')

    expect(result.exists).toBe(true)
    expect(result.idle).toBe(false)
    expect(result.lastActivity).toBeDefined()
  })

  it('returns idle=true for session with old activity', async () => {
    mockRuntime.sessionExists.mockResolvedValue(true)
    mockSharedState.sessionActivity.set('my-agent', Date.now() - 60000) // 60s ago

    const result = await checkIdleStatus('my-agent')

    expect(result.exists).toBe(true)
    expect(result.idle).toBe(true)
  })

  it('returns exists=false when session not found', async () => {
    mockRuntime.sessionExists.mockResolvedValue(false)

    const result = await checkIdleStatus('nonexistent')

    expect(result.exists).toBe(false)
    expect(result.idle).toBe(false)
  })

  it('includes idle threshold in response', async () => {
    mockRuntime.sessionExists.mockResolvedValue(true)

    const result = await checkIdleStatus('my-agent')

    expect(result.idleThreshold).toBe(30000) // 30s
  })
})

// ============================================================================
// listRestorableSessions
// ============================================================================

describe('listRestorableSessions', () => {
  it('returns persisted sessions that are not currently active', async () => {
    mockSessionPersistence.loadPersistedSessions.mockReturnValue([
      { id: 'saved-agent', name: 'saved-agent', workingDirectory: '/home' },
      { id: 'active-agent', name: 'active-agent', workingDirectory: '/home' },
    ])
    mockRuntime.listSessions.mockResolvedValue([
      { name: 'active-agent', workingDirectory: '/home', createdAt: '2025-01-01T00:00:00Z', windows: 1 },
    ])

    const result = await listRestorableSessions()

    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0].id).toBe('saved-agent')
    expect(result.count).toBe(1)
  })

  it('returns empty when all persisted sessions are active', async () => {
    mockSessionPersistence.loadPersistedSessions.mockReturnValue([
      { id: 'active', name: 'active', workingDirectory: '/home' },
    ])
    mockRuntime.listSessions.mockResolvedValue([
      { name: 'active', workingDirectory: '/home', createdAt: '2025-01-01T00:00:00Z', windows: 1 },
    ])

    const result = await listRestorableSessions()

    expect(result.sessions).toEqual([])
    expect(result.count).toBe(0)
  })

  it('returns all persisted sessions when none are active', async () => {
    mockSessionPersistence.loadPersistedSessions.mockReturnValue([
      { id: 's1', name: 's1', workingDirectory: '/home' },
      { id: 's2', name: 's2', workingDirectory: '/home' },
    ])
    mockRuntime.listSessions.mockResolvedValue([])

    const result = await listRestorableSessions()

    expect(result.sessions).toHaveLength(2)
    expect(result.count).toBe(2)
  })
})

// ============================================================================
// restoreSessions
// ============================================================================

describe('restoreSessions', () => {
  it('restores a specific session by ID', async () => {
    mockSessionPersistence.loadPersistedSessions.mockReturnValue([
      { id: 's1', name: 's1', workingDirectory: '/home/s1' },
    ])
    mockRuntime.sessionExists.mockResolvedValue(false)

    const result = await restoreSessions({ sessionId: 's1' })

    expect(result.status).toBe(200)
    expect(result.data?.results[0]).toEqual({ sessionId: 's1', status: 'restored' })
    expect(result.data?.summary.restored).toBe(1)
  })

  it('restores all sessions when all=true', async () => {
    mockSessionPersistence.loadPersistedSessions.mockReturnValue([
      { id: 's1', name: 's1', workingDirectory: '/home' },
      { id: 's2', name: 's2', workingDirectory: '/home' },
    ])
    mockRuntime.sessionExists.mockResolvedValue(false)

    const result = await restoreSessions({ all: true })

    expect(result.status).toBe(200)
    expect(result.data?.summary.restored).toBe(2)
    expect(result.data?.summary.total).toBe(2)
  })

  it('skips sessions that already exist', async () => {
    mockSessionPersistence.loadPersistedSessions.mockReturnValue([
      { id: 's1', name: 's1', workingDirectory: '/home' },
    ])
    mockRuntime.sessionExists.mockResolvedValue(true)

    const result = await restoreSessions({ sessionId: 's1' })

    expect(result.data?.results[0].status).toBe('already_exists')
    expect(result.data?.summary.alreadyExisted).toBe(1)
    expect(mockRuntime.createSession).not.toHaveBeenCalled()
  })

  it('handles mixed results (some restored, some existing, some failed)', async () => {
    mockSessionPersistence.loadPersistedSessions.mockReturnValue([
      { id: 's1', name: 's1', workingDirectory: '/home' },
      { id: 's2', name: 's2', workingDirectory: '/home' },
      { id: 's3', name: 's3', workingDirectory: '/home' },
    ])
    mockRuntime.sessionExists
      .mockResolvedValueOnce(false)  // s1: will be restored
      .mockResolvedValueOnce(true)   // s2: already exists
      .mockResolvedValueOnce(false)  // s3: will attempt restore
    mockRuntime.createSession
      .mockResolvedValueOnce(undefined) // s1: success
      .mockRejectedValueOnce(new Error('fail')) // s3: fail

    const result = await restoreSessions({ all: true })

    expect(result.data?.summary.restored).toBe(1)
    expect(result.data?.summary.alreadyExisted).toBe(1)
    expect(result.data?.summary.failed).toBe(1)
  })

  it('returns 404 when no sessions to restore', async () => {
    mockSessionPersistence.loadPersistedSessions.mockReturnValue([])

    const result = await restoreSessions({ all: true })

    expect(result.status).toBe(404)
  })
})

// ============================================================================
// broadcastActivityUpdate
// ============================================================================

describe('broadcastActivityUpdate', () => {
  it('broadcasts status update successfully', () => {
    const result = broadcastActivityUpdate('my-agent', 'active')

    expect(result.status).toBe(200)
    expect(result.data?.success).toBe(true)
    expect(mockSharedState.broadcastStatusUpdate).toHaveBeenCalledWith('my-agent', 'active', undefined, undefined)
  })

  it('passes hookStatus and notificationType', () => {
    broadcastActivityUpdate('my-agent', 'waiting', 'waiting_for_input', 'permission')

    expect(mockSharedState.broadcastStatusUpdate).toHaveBeenCalledWith(
      'my-agent', 'waiting', 'waiting_for_input', 'permission'
    )
  })

  it('returns 400 when sessionName is missing', () => {
    const result = broadcastActivityUpdate('', 'active')

    expect(result.status).toBe(400)
    expect(result.error).toMatch(/sessionName/i)
  })
})

// ============================================================================
// deletePersistedSession
// ============================================================================

describe('deletePersistedSession', () => {
  it('deletes a persisted session successfully', async () => {
    // SVC2-MIN-04: unpersistSession returns 'ok' | 'not-found' | 'failed'
    mockSessionPersistence.unpersistSession.mockReturnValue('ok')

    const result = await deletePersistedSession('s1')

    expect(result.status).toBe(200)
    expect(result.data?.success).toBe(true)
  })

  it('returns 400 when session ID is missing', async () => {
    const result = await deletePersistedSession('')

    expect(result.status).toBe(400)
  })

  it('returns 404 when session was not in persistence', async () => {
    mockSessionPersistence.unpersistSession.mockReturnValue('not-found')

    const result = await deletePersistedSession('s1')

    expect(result.status).toBe(404)
  })

  it('returns 500 when unpersist save fails', async () => {
    mockSessionPersistence.unpersistSession.mockReturnValue('failed')

    const result = await deletePersistedSession('s1')

    expect(result.status).toBe(500)
  })
})

// ============================================================================
// getActivity
// ============================================================================

describe('getActivity', () => {
  it('returns activity for sessions with timestamps', async () => {
    mockSharedState.sessionActivity.set('agent-1', Date.now())
    mockAgentRegistry.loadAgents.mockReturnValue([])

    const result = await getActivity()

    expect(result['agent-1']).toBeDefined()
    expect(result['agent-1'].lastActivity).toBeDefined()
  })

  it('returns empty when no activity', async () => {
    mockAgentRegistry.loadAgents.mockReturnValue([])

    const result = await getActivity()

    expect(Object.keys(result)).toHaveLength(0)
  })

  it('detects idle status for old activity', async () => {
    mockSharedState.sessionActivity.set('agent-1', Date.now() - 10000) // 10s ago
    mockAgentRegistry.loadAgents.mockReturnValue([])

    const result = await getActivity()

    expect(result['agent-1'].status).toBe('idle')
  })

  it('detects active status for recent activity', async () => {
    mockSharedState.sessionActivity.set('agent-1', Date.now()) // just now
    mockAgentRegistry.loadAgents.mockReturnValue([])

    const result = await getActivity()

    expect(result['agent-1'].status).toBe('active')
  })
})
