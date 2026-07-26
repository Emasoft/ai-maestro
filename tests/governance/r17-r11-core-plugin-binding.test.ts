/**
 * Governance drift tests — R11 (Title-Plugin Binding) + R17 (Mandatory Core
 * Plugin Installation) sub-rules that already have a REAL code guard but were
 * never pinned by any test (docs/GOVERNANCE-ENFORCEMENT-MAP.md rows R11.2,
 * R11.3, R11.4, R11.5, R11.11, R17.1, R17.2, R17.5, R17.6, R17.8, R17.9,
 * R17.13, R17.15, R17.19, R17.21, R17.22, R17.23).
 *
 * Every test below calls the REAL exported function that implements the rule
 * (never a re-implementation, never the guard's own module mocked away) and
 * asserts the refusal / real behavior the guard produces. If the guard is
 * deleted, weakened, or its wiring is changed, the corresponding test fails.
 *
 * Out of scope for this file (see the accompanying report for why):
 *   - R11.6, R17.16 — React component guards (UI layer, not service layer).
 *   - R17.18a — marked RULING-NEEDED in the enforcement map.
 *   - R17.17, R17.20 — the server.mjs guards are real but are embedded in the
 *     monolithic, un-exported `startServer()` async IIFE that runs for real
 *     (network bind, tmux) the instant server.mjs is imported. There is no
 *     extracted, independently-callable seam (unlike R17.17's twin guard in
 *     InstallElement's G08 gate, which IS covered here) — see the report.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  chmodSync,
} from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { execFileSync } from 'child_process'

// ============================================================================
// Hoisted fake $HOME — plugin-storage-service.ts computes several MODULE-LEVEL
// path constants from `homedir()` (getCustomPluginsContainerPath() etc., see
// lib/ecosystem-constants.ts) at IMPORT TIME, so the fake home must exist
// before that module is first imported anywhere in this file. vi.hoisted()
// runs before vi.mock() factories AND before this file's own static imports.
// ============================================================================
const FAKE_HOME = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fsSync = require('fs')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const osSync = require('os')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pathSync = require('path')
  return fsSync.mkdtempSync(pathSync.join(osSync.tmpdir(), 'r17-r11-home-'))
})

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return {
    ...actual,
    default: { ...actual, homedir: () => FAKE_HOME },
    homedir: () => FAKE_HOME,
  }
})

// SAFETY BELT-AND-BRACES (0-IMPACT hard constraint): lib/ecosystem-constants.ts
// resolves its container paths via a runtime `require('os')` INSIDE each
// function body (not the static `import` above), and empirically that dynamic
// require is NOT redirected by the `vi.mock('os', ...)` above under this
// project's Vitest setup — a first draft of this file proved that the hard
// way by writing real plugin folders under the developer's actual
// ~/agents/role-plugins/ and ~/agents/custom-plugins/ before this override was
// added (cleaned up by hand; see the accompanying report). Overriding the
// container/marketplace PATH functions directly closes that gap regardless of
// how homedir() is resolved internally. Every OTHER export (MAIN_PLUGIN_NAME,
// TITLE_PLUGIN_MAP, ROLE_PLUGIN_*, ...) stays real via the `...actual` spread,
// so the R11.2/R11.3 tests and element-management-service.ts's own use of
// these constants are unaffected.
vi.mock('@/lib/ecosystem-constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ecosystem-constants')>()
  const path = await import('path')
  const base = path.join(FAKE_HOME, 'agents')
  return {
    ...actual,
    getCustomPluginsContainerPath: () => path.join(base, 'custom-plugins'),
    getRolePluginsContainerPath: () => path.join(base, 'role-plugins'),
    getCorePluginsContainerPath: () => path.join(base, 'core-plugins'),
    getCustomAbstractDir: () => path.join(base, 'custom-plugins', '.abstract'),
    getRoleAbstractDir: () => path.join(base, 'role-plugins', '.abstract'),
    getCoreAbstractDir: () => path.join(base, 'core-plugins', '.abstract'),
    getCustomMarketplacePathForClient: (client: string) =>
      path.join(base, 'custom-plugins', client === 'claude' ? 'custom-marketplace' : `${client}-custom-marketplace`),
    getRoleMarketplacePathForClient: (client: string) =>
      path.join(base, 'role-plugins', client === 'claude' ? 'roles-marketplace' : `${client}-roles-marketplace`),
    getCoreMarketplacePathForClient: (client: string) =>
      path.join(base, 'core-plugins', `${client}-core-marketplace`),
    getLocalMarketplacePath: () => path.join(base, 'role-plugins'),
    getCustomMarketplacePath: () => path.join(base, 'custom-plugins'),
  }
})

// ============================================================================
// The rest of the shared mock registry (agent-registry / governance /
// team-registry / etc. are dependencies of the REAL functions under test —
// none of these modules IS the guard being pinned).
// ============================================================================
const {
  mockAgentRegistry,
  mockGovernance,
  mockTeamRegistry,
  mockAgentLocalConfig,
  mockRolePluginService,
  mockAgentInvariants,
  mockRuntime,
  mockHostsConfig,
  mockSessionPersistence,
  mockAmpInboxWriter,
  mockSharedState,
  mockAgentStartup,
  mockMessageQueue,
  mockAuthorization,
  mockUuid,
  mockExecFileAsync,
  mockExecSyncFn,
  mockGetParser,
  mockGetEmitter,
  mockProjectIRToUniversal,
} = vi.hoisted((): any => {
  let uuidCounter = 0
  return {
    mockAgentRegistry: {
      getAgent: vi.fn(),
      loadAgents: vi.fn(() => []),
      saveAgents: vi.fn(),
      createAgent: vi.fn(),
      getAgentByName: vi.fn(),
      getAgentBySession: vi.fn(() => null),
      updateAgent: vi.fn(async () => undefined),
      deleteAgent: vi.fn(),
      searchAgents: vi.fn(() => []),
      linkSession: vi.fn(),
      unlinkSession: vi.fn(),
    },
    mockGovernance: {
      loadGovernance: vi.fn(() => ({ managerId: 'manager-1' })),
      saveGovernance: vi.fn(),
      isManager: vi.fn(() => false),
      getManagerId: vi.fn(() => 'manager-1'),
      isChiefOfStaffAnywhere: vi.fn(() => false),
    },
    mockTeamRegistry: {
      loadTeams: vi.fn(() => []),
      saveTeams: vi.fn(),
      blockAllTeams: vi.fn(),
      unblockAllTeams: vi.fn(),
      isAgentInAnyTeam: vi.fn(() => false),
      getTeam: vi.fn(() => null),
      updateTeam: vi.fn(async () => undefined),
    },
    mockAgentLocalConfig: {
      scanAgentLocalConfig: vi.fn(() => ({
        data: {
          plugins: [], skills: [], agents: [], commands: [], rules: [],
          hooks: [], mcp: [], lsp: [], outputStyles: [], rolePlugin: null,
        },
        error: null,
      })),
    },
    mockRolePluginService: {
      installPluginLocally: vi.fn(async () => undefined),
      uninstallPluginLocally: vi.fn(async () => undefined),
      getPluginsForTitle: vi.fn(() => []),
      ensureMarketplace: vi.fn(async () => undefined),
      updateMarketplaceManifest: vi.fn(async () => undefined),
    },
    mockAgentInvariants: {
      enforceAgentInvariants: vi.fn(async () => ({
        outcomes: [{ id: 'core-plugin', status: 'ok' }],
        repaired: [],
        failed: [],
      })),
      formatEnforceResult: vi.fn(() => null),
    },
    mockRuntime: {
      listSessions: vi.fn(async () => []),
      sessionExists: vi.fn(async () => false),
      createSession: vi.fn(async () => undefined),
      killSession: vi.fn(async () => undefined),
      renameSession: vi.fn(async () => undefined),
      sendKeys: vi.fn(async () => undefined),
      cancelCopyMode: vi.fn(async () => undefined),
      setEnvironment: vi.fn(async () => undefined),
      unsetEnvironment: vi.fn(async () => undefined),
    },
    mockHostsConfig: {
      getHosts: vi.fn(() => [{ id: 'test-host', name: 'Test Host', url: 'http://localhost:23000' }]),
      getSelfHost: vi.fn(() => ({ id: 'test-host', name: 'Test Host', url: 'http://localhost:23000' })),
      getSelfHostId: vi.fn(() => 'test-host'),
      isSelf: vi.fn(() => true),
    },
    mockSessionPersistence: { persistSession: vi.fn(), unpersistSession: vi.fn() },
    mockAmpInboxWriter: {
      initAgentAMPHome: vi.fn(async () => undefined),
      getAgentAMPDir: vi.fn(() => '/tmp/amp/test'),
    },
    mockSharedState: { sessionActivity: new Map<string, number>(), broadcastAgentUpdate: vi.fn() },
    mockAgentStartup: {
      initializeAllAgents: vi.fn(async () => ({ initialized: [], failed: [] })),
      getStartupStatus: vi.fn(() => ({ discoveredAgents: 0, activeAgents: 0, agents: [] })),
    },
    mockMessageQueue: { resolveAgentIdentifier: vi.fn() },
    mockAuthorization: { authorize: vi.fn(() => ({ allowed: true })) },
    mockUuid: { v4: vi.fn(() => `uuid-${++uuidCounter}`) },
    mockExecFileAsync: vi.fn(async () => ({ stdout: '', stderr: '' })),
    mockExecSyncFn: vi.fn(() => { throw new Error('ENOENT: no such tmux session (test double)') }),
    mockGetParser: vi.fn(),
    mockGetEmitter: vi.fn(),
    mockProjectIRToUniversal: vi.fn(),
  }
})

vi.mock('@/lib/agent-registry', () => mockAgentRegistry)
vi.mock('@/lib/governance', () => mockGovernance)
vi.mock('@/lib/team-registry', () => mockTeamRegistry)
vi.mock('@/services/agent-local-config-service', () => mockAgentLocalConfig)
vi.mock('@/services/role-plugin-service', () => mockRolePluginService)
vi.mock('@/lib/agent-invariants', () => mockAgentInvariants)
vi.mock('@/lib/agent-runtime', () => ({ getRuntime: vi.fn(() => mockRuntime) }))
vi.mock('@/lib/hosts-config', () => mockHostsConfig)
vi.mock('@/lib/session-persistence', () => mockSessionPersistence)
vi.mock('@/lib/amp-inbox-writer', () => mockAmpInboxWriter)
vi.mock('@/services/shared-state', () => mockSharedState)
vi.mock('@/lib/agent-startup', () => mockAgentStartup)
vi.mock('@/lib/messageQueue', () => mockMessageQueue)
vi.mock('@/lib/authorization', () => mockAuthorization)
vi.mock('uuid', () => mockUuid)
vi.mock('@/lib/converter/parsers', () => ({ getParser: mockGetParser }))
vi.mock('@/lib/converter/emitters', () => ({ getEmitter: mockGetEmitter }))
vi.mock('@/lib/converter/universal-ir', () => ({ projectIRToUniversal: mockProjectIRToUniversal }))
vi.mock('@/lib/converter/marketplace-emitters', () => ({
  writeMarketplaceManifest: vi.fn(async () => undefined),
  isMarketplaceSupported: vi.fn(() => true),
}))

// child_process: preserve every REAL export (execFileSync is used for real by
// the R17.19 shell-script test) and only intercept the 3 functions the
// pipelines under test actually call — genuine external-process I/O.
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return {
    ...actual,
    execFile: (...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: Error | null, result: { stdout: string; stderr: string }) => void
      mockExecFileAsync(args[0], args[1], args[2])
        .then((r: { stdout: string; stderr: string }) => cb(null, r))
        .catch((err: Error) => cb(err, { stdout: '', stderr: '' }))
    },
    exec: (_cmd: string, cb: (err: Error | null, r: { stdout: string; stderr: string }) => void) =>
      cb(null, { stdout: '', stderr: '' }),
    execSync: (...args: unknown[]) => mockExecSyncFn(...(args as [string])),
  }
})

const OWNER_CTX = { isSystemOwner: true as const }

const tempDirs: string[] = []
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length) {
    const d = tempDirs.pop()!
    try {
      // Undo any permission sabotage a test may have left behind so cleanup
      // can actually remove the directory's contents.
      chmodSync(d, 0o755)
    } catch { /* already gone or already writable */ }
    rmSync(d, { recursive: true, force: true })
  }
})

// FAKE_HOME (the hoisted fake $HOME used by the ecosystem-constants /
// plugin-storage-service overrides above) lives for the whole file, not one
// test — clean it up once the whole suite is done so no OS-tmpdir litter
// survives the run.
afterAll(() => {
  rmSync(FAKE_HOME, { recursive: true, force: true })
})

// ============================================================================
// R11.2 / R11.3 — TITLE_PLUGIN_MAP (lib/ecosystem-constants.ts)
// ============================================================================
describe('R11.2 / R11.3 — TITLE_PLUGIN_MAP (lib/ecosystem-constants.ts)', () => {
  it('R11.2: pins MEMBER -> ai-maestro-programmer-agent — the ChangeTitle pipeline reads this map to decide which role-plugin a MEMBER gets', async () => {
    const { TITLE_PLUGIN_MAP, ROLE_PLUGIN_PROGRAMMER } = await import('@/lib/ecosystem-constants')
    expect(TITLE_PLUGIN_MAP['MEMBER']).toBe(ROLE_PLUGIN_PROGRAMMER)
    expect(TITLE_PLUGIN_MAP['MEMBER']).toBe('ai-maestro-programmer-agent')
  })

  it('R11.3: pins AUTONOMOUS -> ai-maestro-autonomous-agent — the mandatory no-team role-plugin (R9.13); there is no "autonomous with no plugin" entry', async () => {
    const { TITLE_PLUGIN_MAP, ROLE_PLUGIN_AUTONOMOUS } = await import('@/lib/ecosystem-constants')
    expect(TITLE_PLUGIN_MAP['AUTONOMOUS']).toBe(ROLE_PLUGIN_AUTONOMOUS)
    expect(TITLE_PLUGIN_MAP['AUTONOMOUS']).toBe('ai-maestro-autonomous-agent')
  })
})

// ============================================================================
// R17.8 / R17.15 — InstallElement's G08 core-plugin protection gate
// ============================================================================
describe('R17.8 / R17.15 — InstallElement G08 core-plugin protection gate (services/element-management-service.ts)', () => {
  let agentDir: string

  beforeEach(() => {
    agentDir = makeTempDir('r17-8-15-agent-')
  })

  it('R17.8: refuses to enable the core plugin at USER scope — it must only ever be local-scope (own agent dir), never host-wide', async () => {
    const { InstallElement } = await import('@/services/element-management-service')
    const result = await InstallElement(
      { name: 'ai-maestro-plugin', marketplace: 'ai-maestro-plugins', action: 'enable', scope: 'user' },
      OWNER_CTX,
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/user scope/i)
    expect(result.operations.some(op => /DENIED — core plugin user-scope/i.test(op))).toBe(true)
  })

  it('R17.15: refuses to disable the core plugin regardless of scope — a disabled ai-maestro-plugin leaves the agent invisible to AI Maestro', async () => {
    const { InstallElement } = await import('@/services/element-management-service')
    const result = await InstallElement(
      { name: 'ai-maestro-plugin', marketplace: 'ai-maestro-plugins', action: 'disable', scope: 'local', agentDir },
      OWNER_CTX,
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/cannot be disabled/i)
    expect(result.operations.some(op => /DENIED — core plugin disable blocked by R17/i.test(op))).toBe(true)
  })
})

// ============================================================================
// R17.1 / R17.2 / R17.6 / R17.9 — InstallElement's install/verify/flag chain
// ============================================================================
describe('R17.1 / R17.2 / R17.6 / R17.9 — InstallElement CLI-install + PG01 verify + PG02 registry-flag gates', () => {
  let agentDir: string

  beforeEach(() => {
    agentDir = makeTempDir('r17-install-agent-')
    mockExecFileAsync.mockReset()
    mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })
    mockAgentRegistry.updateAgent.mockReset()
    mockAgentRegistry.updateAgent.mockResolvedValue(undefined)
  })

  it('R17.2: issues the exact command `claude plugin install ai-maestro-plugin@ai-maestro-plugins --scope local`', async () => {
    const { InstallElement } = await import('@/services/element-management-service')
    await InstallElement(
      { name: 'ai-maestro-plugin', marketplace: 'ai-maestro-plugins', action: 'install', scope: 'local', agentDir, clientType: 'claude' },
      OWNER_CTX,
    )
    const installCall = mockExecFileAsync.mock.calls.find(
      (c: any[]) => Array.isArray(c[1]) && c[1][0] === 'plugin' && c[1][1] === 'install',
    )
    expect(installCall).toBeTruthy()
    expect(installCall![0]).toBe('claude')
    expect(installCall![1]).toEqual(['plugin', 'install', 'ai-maestro-plugin@ai-maestro-plugins', '--scope', 'local'])
  })

  it('R17.1: when the CLI silently claims success but the plugin key is missing, the belt-and-braces write-back forces it into settings.local.json (the agent is never left "installed" in name only)', async () => {
    const { InstallElement } = await import('@/services/element-management-service')
    await InstallElement(
      { name: 'ai-maestro-plugin', marketplace: 'ai-maestro-plugins', action: 'install', scope: 'local', agentDir, clientType: 'claude' },
      OWNER_CTX,
    )
    const settingsPath = path.join(agentDir, '.claude', 'settings.local.json')
    expect(existsSync(settingsPath)).toBe(true)
    const written = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    expect(written.enabledPlugins?.['ai-maestro-plugin@ai-maestro-plugins']).toBe(true)
  })

  it('R17.6: even when the `claude` CLI fails outright, InstallElement still writes ai-maestro-plugin into settings.local.json directly — CreateAgent\'s provisioning gate cannot silently no-op', async () => {
    mockExecFileAsync.mockImplementation((_cmd: string, args: string[]) => {
      if (Array.isArray(args) && args[0] === 'plugin' && args[1] === 'install') {
        return Promise.reject(new Error('claude: command not found (test double)'))
      }
      return Promise.resolve({ stdout: '', stderr: '' })
    })
    const { InstallElement } = await import('@/services/element-management-service')
    const result = await InstallElement(
      { name: 'ai-maestro-plugin', marketplace: 'ai-maestro-plugins', action: 'install', scope: 'local', agentDir, clientType: 'claude' },
      OWNER_CTX,
    )
    expect(result.success).toBe(true)
    const settingsPath = path.join(agentDir, '.claude', 'settings.local.json')
    const written = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    expect(written.enabledPlugins?.['ai-maestro-plugin@ai-maestro-plugins']).toBe(true)
  })

  it('R17.9: flags corePluginMissing=true on the agent registry when post-install verification cannot confirm the plugin — never a silent "looks fine"', async () => {
    // The CLI reports success, but we sabotage the local write-back (chmod the
    // .claude dir read-only) so the belt-and-braces write ALSO cannot land.
    // PG01's re-read of settings.local.json then genuinely sees no plugin key,
    // flips result.success=false, and PG02 must record that on the registry.
    mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })
    const claudeDir = path.join(agentDir, '.claude')
    mkdirSync(claudeDir, { recursive: true })
    chmodSync(claudeDir, 0o555) // read+execute only: writeFile() of a NEW file inside must fail

    const { InstallElement } = await import('@/services/element-management-service')
    const result = await InstallElement(
      {
        name: 'ai-maestro-plugin', marketplace: 'ai-maestro-plugins', action: 'install',
        scope: 'local', agentDir, agentId: 'agent-r17-9', clientType: 'claude',
      },
      OWNER_CTX,
    )

    expect(result.success).toBe(false)
    const flagCall = mockAgentRegistry.updateAgent.mock.calls.find((c: any[]) => c[0] === 'agent-r17-9')
    expect(flagCall).toBeTruthy()
    expect(flagCall![1]).toEqual(expect.objectContaining({ corePluginMissing: true }))
  })
})

// ============================================================================
// R11.4 / R11.5 — ChangeTeam drives the title <-> role-plugin cascade
// ============================================================================
describe('R11.4 / R11.5 — ChangeTeam calls ChangeTitle(member|autonomous) on join/leave (services/element-management-service.ts)', () => {
  beforeEach(() => {
    mockAgentRegistry.getAgent.mockReset()
    mockAgentRegistry.updateAgent.mockReset()
    mockAgentRegistry.updateAgent.mockResolvedValue(undefined)
    mockGovernance.getManagerId.mockReset()
    mockGovernance.getManagerId.mockReturnValue('manager-1')
    mockGovernance.isManager.mockReset()
    mockGovernance.isManager.mockReturnValue(false)
    mockTeamRegistry.getTeam.mockReset()
    mockTeamRegistry.loadTeams.mockReset()
    mockTeamRegistry.updateTeam.mockReset()
    mockTeamRegistry.updateTeam.mockResolvedValue(undefined)
    mockAgentLocalConfig.scanAgentLocalConfig.mockReturnValue({
      data: {
        plugins: [], skills: [], agents: [], commands: [], rules: [],
        hooks: [], mcp: [], lsp: [], outputStyles: [], rolePlugin: null,
      },
      error: null,
    })
    mockRolePluginService.installPluginLocally.mockResolvedValue(undefined)
    mockRolePluginService.uninstallPluginLocally.mockResolvedValue(undefined)
  })

  it('R11.4: joining a team calls ChangeTitle with role "member" — this is what auto-installs the ai-maestro-programmer-agent role-plugin (R11.2)', async () => {
    mockAgentRegistry.getAgent.mockReturnValue({
      id: 'agent-t1', name: 'team-test-agent', governanceTitle: null,
      program: 'claude', workingDirectory: '/tmp/agent-t1-noop-r11-4', config: {},
    })
    const team = { id: 'team-1', name: 'Team One', agentIds: [], chiefOfStaffId: 'cos-1', orchestratorId: null }
    mockTeamRegistry.getTeam.mockReturnValue(team)
    mockTeamRegistry.loadTeams.mockReturnValue([team])

    const { ChangeTeam } = await import('@/services/element-management-service')
    const result = await ChangeTeam('agent-t1', { teamId: 'team-1' }, OWNER_CTX)

    expect(result.operations.some((op) => /ChangeTitle to member|Title set to MEMBER/i.test(op))).toBe(true)
  })

  it('R11.5: leaving a team calls ChangeTitle with role "autonomous" — this reverts to the ai-maestro-autonomous-agent role-plugin (R11.3)', async () => {
    mockAgentRegistry.getAgent.mockReturnValue({
      id: 'agent-t1', name: 'team-test-agent', governanceTitle: 'member',
      program: 'claude', workingDirectory: '/tmp/agent-t1-noop-r11-5', config: {},
    })
    const team = { id: 'team-1', name: 'Team One', agentIds: ['agent-t1'], chiefOfStaffId: 'cos-1', orchestratorId: null }
    mockTeamRegistry.getTeam.mockReturnValue(team)
    mockTeamRegistry.loadTeams.mockReturnValue([team])

    const { ChangeTeam } = await import('@/services/element-management-service')
    const result = await ChangeTeam('agent-t1', { teamId: null }, OWNER_CTX)

    expect(result.operations.some((op) => /ChangeTitle to autonomous|Title reverted to AUTONOMOUS/i.test(op))).toBe(true)
  })
})

// ============================================================================
// R11.11 / R17.13 — convertAndStorePlugin routing + multi-client emission
// ============================================================================
describe('R11.11 / R17.13 — convertAndStorePlugin container routing + multi-client emission (services/plugin-storage-service.ts)', () => {
  const emptyProjectIR = {
    skills: [], agents: [], commands: [], instructions: [], hooks: [],
    mcp: undefined, resources: [], pluginMeta: undefined, agentProfile: undefined,
  }

  beforeEach(() => {
    mockGetParser.mockReset()
    mockGetEmitter.mockReset()
    mockProjectIRToUniversal.mockReset()
    mockGetParser.mockResolvedValue({ parse: vi.fn(async () => emptyProjectIR) })
    mockGetEmitter.mockResolvedValue({ emit: vi.fn(() => [{ path: 'plugin.json', content: '{}' }]) })
  })

  function seedSourceDir(pluginName: string): void {
    // findSourcePluginDir('claude') checks ~/agents/role-plugins/<name>/ as its
    // fallback lookup — any existing directory there is enough for the source
    // resolution step; the role-vs-custom OUTPUT routing is driven entirely by
    // the (mocked) universalIR.meta.is_role_plugin flag below.
    mkdirSync(path.join(FAKE_HOME, 'agents', 'role-plugins', pluginName), { recursive: true })
  }

  it('R11.11: a role-plugin (is_role_plugin=true) is emitted under the role-plugins container, never under custom-plugins', async () => {
    const pluginName = 'r11-11-role-plugin'
    seedSourceDir(pluginName)
    mockProjectIRToUniversal.mockReturnValue({ meta: { is_role_plugin: true, compatible_titles: ['MEMBER'] }, extensions: {} })

    const { convertAndStorePlugin } = await import('@/services/plugin-storage-service')
    const { emittedDirs } = await convertAndStorePlugin(pluginName, 'claude', ['codex'])

    expect(emittedDirs.codex).toBeTruthy()
    expect(emittedDirs.codex).toContain(`${path.sep}role-plugins${path.sep}`)
    expect(emittedDirs.codex).not.toContain(`${path.sep}custom-plugins${path.sep}`)
    expect(existsSync(emittedDirs.codex)).toBe(true)
  })

  it('R11.11: an ordinary plugin (is_role_plugin=false) is emitted under the custom-plugins container, never under role-plugins', async () => {
    const pluginName = 'r11-11-ordinary-plugin'
    seedSourceDir(pluginName)
    mockProjectIRToUniversal.mockReturnValue({ meta: { is_role_plugin: false }, extensions: {} })

    const { convertAndStorePlugin } = await import('@/services/plugin-storage-service')
    const { emittedDirs } = await convertAndStorePlugin(pluginName, 'claude', ['codex'])

    expect(emittedDirs.codex).toBeTruthy()
    expect(emittedDirs.codex).toContain(`${path.sep}custom-plugins${path.sep}`)
    expect(emittedDirs.codex).not.toContain(`${path.sep}role-plugins${path.sep}`)
    expect(existsSync(emittedDirs.codex)).toBe(true)
  })

  it('R17.13: emits for EVERY requested target client, not just the first — a partial multi-client loop would silently drop functionality for the skipped clients', async () => {
    const pluginName = 'r17-13-multi-client-plugin'
    seedSourceDir(pluginName)
    mockProjectIRToUniversal.mockReturnValue({ meta: { is_role_plugin: false }, extensions: {} })

    const { convertAndStorePlugin } = await import('@/services/plugin-storage-service')
    const { emittedDirs } = await convertAndStorePlugin(pluginName, 'claude', ['codex', 'gemini'])

    expect(Object.keys(emittedDirs).sort()).toEqual(['codex', 'gemini'])
    expect(existsSync(emittedDirs.codex)).toBe(true)
    expect(existsSync(emittedDirs.gemini)).toBe(true)
  })
})

// ============================================================================
// R17.5 / R17.21 / R17.23 — wakeAgent's R17 gate (services/agents-core-service.ts)
// ============================================================================
describe('R17.5 / R17.21 / R17.23 — wakeAgent core-plugin gate (services/agents-core-service.ts)', () => {
  beforeEach(async () => {
    mockAgentInvariants.enforceAgentInvariants.mockReset()
    mockAgentInvariants.formatEnforceResult.mockReset()
    mockAgentInvariants.formatEnforceResult.mockReturnValue(null)
    mockRuntime.createSession.mockClear()
    mockRuntime.sessionExists.mockReset()
    mockRuntime.sessionExists.mockResolvedValue(false)
    mockAgentRegistry.getAgent.mockReset()
    mockAgentRegistry.loadAgents.mockReset()
    mockAgentRegistry.loadAgents.mockReturnValue([])
    const { resetFixtureCounter } = await import('../test-utils/fixtures')
    resetFixtureCounter()
  })

  it('R17.5 / R17.21: rejects the wake with role_missing_core when the core-plugin invariant cannot be repaired — an agent without ai-maestro-plugin must never be launched', async () => {
    const { makeAgent } = await import('../test-utils/fixtures')
    const agent = makeAgent({ id: 'agent-1', name: 'my-agent', workingDirectory: '/tmp/wake-test-agent-1' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockAgentRegistry.loadAgents.mockReturnValue([agent])
    mockAgentInvariants.enforceAgentInvariants.mockResolvedValue({
      outcomes: [{ id: 'core-plugin', status: 'failed', detail: 'install failed (test double)' }],
      repaired: [],
      failed: [{ id: 'core-plugin', status: 'failed', detail: 'install failed (test double)' }],
    })

    const { wakeAgent } = await import('@/services/agents-core-service')
    const result = await wakeAgent('agent-1', { startProgram: false })

    expect(result.status).toBe(400)
    expect(result.error).toBe('role_missing_core')
    expect(mockRuntime.createSession).not.toHaveBeenCalled()
  })

  it('R17.23: does not block the wake response on the (fire-and-forget) directory-trust auto-accept — wakeAgent resolves without waiting for handleTrustAutoAccept', async () => {
    vi.useFakeTimers()
    try {
      const { makeAgent } = await import('../test-utils/fixtures')
      const agent = makeAgent({ id: 'agent-2', name: 'my-agent-2', workingDirectory: '/tmp/wake-test-agent-2' })
      mockAgentRegistry.getAgent.mockReturnValue(agent)
      mockAgentRegistry.loadAgents.mockReturnValue([agent])
      mockAgentInvariants.enforceAgentInvariants.mockResolvedValue({
        outcomes: [{ id: 'core-plugin', status: 'ok' }],
        repaired: [],
        failed: [],
      })

      const { wakeAgent } = await import('@/services/agents-core-service')
      // handleTrustAutoAccept's first internal step is `await setTimeout(2500)`.
      // If wakeAgent AWAITED it (rather than firing it and moving on), this
      // promise would not settle until fake timers are advanced — it does not
      // need any advancing at all, proving the call is genuinely detached.
      // `program: 'none'` picks the terminal-only launch branch (skips
      // resolveLaunchArgs' role-plugin/persona resolution and the keychain
      // preflight, neither of which this test is about) while still reaching
      // the unconditional `startProgram && isFirstLaunch` trust-accept call.
      const result = await wakeAgent('agent-2', { startProgram: true, program: 'none' })

      expect(result.status).toBe(200)
      // Drain whatever the detached handleTrustAutoAccept() background chain
      // scheduled so no timer/handle is left dangling once this test returns.
      await vi.runAllTimersAsync()
    } finally {
      vi.useRealTimers()
    }
  })
})

// ============================================================================
// R17.22 — handleTrustAutoAccept (services/agents-core-service.ts)
// ============================================================================
describe('R17.22 — handleTrustAutoAccept auto-accepts the directory-trust prompt (services/agents-core-service.ts)', () => {
  it('pins: on detecting the trust prompt in the tmux pane, it sends Enter (accepts "Yes, I trust this folder")', async () => {
    vi.useFakeTimers()
    try {
      mockRuntime.sendKeys.mockClear()
      mockExecSyncFn.mockReset()
      mockExecSyncFn.mockReturnValue(
        'Do you trust the files in this folder?\n❯ Yes, I trust this folder\n  No, exit',
      )

      const { handleTrustAutoAccept } = await import('@/services/agents-core-service')
      const p = handleTrustAutoAccept('trust-test-session', 'trust-test-agent')
      // Skip the initial 2.5s "wait for Claude to render the prompt" delay.
      await vi.advanceTimersByTimeAsync(2600)
      await p

      expect(mockRuntime.sendKeys).toHaveBeenCalledWith('trust-test-session', '', { enter: true })
    } finally {
      vi.useRealTimers()
    }
  })
})

// ============================================================================
// R17.19 — bump-version.sh updates the core plugin from the marketplace
// ============================================================================
describe('R17.19 — bump-version.sh updates ai-maestro-plugin from the marketplace on every version bump (scripts/bump-version.sh)', () => {
  it('pins: running the real script calls `claude plugin marketplace add` then `claude plugin update ai-maestro-plugin@ai-maestro-plugins`', () => {
    const projectDir = makeTempDir('r17-19-project-')
    mkdirSync(path.join(projectDir, 'scripts'), { recursive: true })

    // Copy (never edit) the REAL script into an isolated fixture project so
    // running it cannot touch this repo's own version.json/package.json/etc.
    const realScript = readFileSync(path.resolve(__dirname, '../../scripts/bump-version.sh'), 'utf-8')
    const scriptPath = path.join(projectDir, 'scripts', 'bump-version.sh')
    writeFileSync(scriptPath, realScript, { mode: 0o755 })
    writeFileSync(
      path.join(projectDir, 'version.json'),
      JSON.stringify({ version: '1.0.0', releaseDate: '2026-01-01' }, null, 2),
    )

    const fakeBinDir = makeTempDir('r17-19-bin-')
    const logPath = path.join(fakeBinDir, 'claude-calls.log')
    writeFileSync(
      path.join(fakeBinDir, 'claude'),
      `#!/usr/bin/env bash\necho "$@" >> "${logPath}"\nexit 0\n`,
      { mode: 0o755 },
    )

    execFileSync('bash', [scriptPath, 'patch'], {
      cwd: projectDir,
      env: { ...process.env, PATH: `${fakeBinDir}:${process.env.PATH}` },
    })

    expect(existsSync(logPath)).toBe(true)
    const log = readFileSync(logPath, 'utf-8')
    expect(log).toMatch(/plugin marketplace add Emasoft\/ai-maestro-plugins/)
    expect(log).toMatch(/plugin update ai-maestro-plugin@ai-maestro-plugins/)

    // Sanity check the script actually ran end to end (bonus, not the rule).
    const bumped = JSON.parse(readFileSync(path.join(projectDir, 'version.json'), 'utf-8'))
    expect(bumped.version).toBe('1.0.1')
  })
})
