/**
 * Governance drift tests — R3 (Manager / Chief-of-Staff structure) + R9
 * (Manager-gated team governance) sub-rules that already have a REAL code guard
 * but were never pinned by any test (docs/GOVERNANCE-ENFORCEMENT-MAP.md rows
 * R3.2, R3.3, R3.4, R3.5, R3.7, R3.9, R3.12, R9.1, R9.2, R9.4, R9.5, R9.6,
 * R9.7, R9.8, R9.11, R9.12).
 *
 * Every test below calls the REAL exported function that implements the rule
 * (never a re-implementation, never the guard's own module mocked away) and
 * asserts the REFUSAL / real behavior the guard produces. If the guard is
 * deleted, weakened, or its wiring is changed, the corresponding test fails.
 *
 * Mocking policy in this file:
 *   - ENVIRONMENT is mocked: $HOME-derived state paths, agent registry,
 *     governance store, tmux/child_process, network broadcast.
 *   - GUARDS are never mocked. `@/lib/team-registry` and `@/services/teams-service`
 *     are PARTIAL mocks built with importOriginal(): every implementation stays
 *     real; three functions are additionally wrapped in vi.fn() so a CALL SITE in
 *     another module can be observed while the real body still runs.
 *
 * Out of scope for this file (see the accompanying report for why):
 *   - R9.9 — the startup manager-gate lives inside server.mjs's
 *     `server.listen(...)` callback in the monolithic, un-exported startServer()
 *     async IIFE. Importing server.mjs binds a real socket and starts tmux
 *     discovery; there is no independently-callable seam and extracting one
 *     would be a production change (out of scope for a tests-only batch).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { rmSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import path from 'path'

// Vitest's 5s default is a COLD-START trap for this file, not a generous budget.
// services/element-management-service.ts is ~6,500 lines and pulls in a large
// transitive graph; the FIRST test that awaits `import(...)` of it pays the whole
// transform+load cost, which exceeds 5s on a cold vite cache or a loaded machine.
// That surfaced as a ~1-in-25 "Test timed out in 5000ms" on whichever test
// happened to be first — a pure infrastructure flake with nothing to do with the
// guard under test. The warm steady state is ~1.5s for all 36 tests. Raising the
// budget removes the false failure without weakening a single assertion; the
// beforeAll below additionally pays the import cost ONCE, in a hook, so no
// individual test carries it.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

// ============================================================================
// Hoisted fake state dir.
//
// lib/team-registry.ts evaluates `const AIMAESTRO_DIR = getStateDir()` at
// MODULE level (line ~204), so the ecosystem-constants override must be in
// place before that module is first imported anywhere. vi.hoisted() runs before
// vi.mock() factories AND before this file's own static imports.
// ============================================================================
const FAKE_STATE = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fsSync = require('fs')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const osSync = require('os')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pathSync = require('path')
  const root = fsSync.mkdtempSync(pathSync.join(osSync.tmpdir(), 'r3-r9-state-'))
  fsSync.mkdirSync(pathSync.join(root, 'teams'), { recursive: true })
  fsSync.mkdirSync(pathSync.join(root, 'agents'), { recursive: true })
  return root
})

const FAKE_HOME = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fsSync = require('fs')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const osSync = require('os')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pathSync = require('path')
  return fsSync.mkdtempSync(pathSync.join(osSync.tmpdir(), 'r3-r9-home-'))
})

// 0-IMPACT (hard constraint). lib/ecosystem-constants.ts derives BOTH the
// ~/.aimaestro state dir and the ~/agents/{role,custom,core}-plugins containers
// from homedir(). A `vi.mock('os', ...)` does NOT reliably redirect those —
// several of these helpers resolve homedir() through a runtime require('os')
// inside the function body, which the module mock does not intercept (proved
// the hard way in the R17/R11 batch, which wrote real folders under the
// developer's actual ~/agents/ before this override was added). Overriding the
// PATH FUNCTIONS themselves closes the gap regardless of how homedir() is
// resolved internally. Every other export (MARKETPLACE_NAME, TITLE_PLUGIN_MAP,
// ROLE_PLUGIN_*, ...) stays real via the `...actual` spread, so nothing the
// guards under test read is altered.
vi.mock('@/lib/ecosystem-constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ecosystem-constants')>()
  const p = await import('path')
  const agentsBase = p.join(FAKE_HOME, 'agents')
  return {
    ...actual,
    getStateDir: () => FAKE_STATE,
    statePath: (...segments: string[]) => p.join(FAKE_STATE, ...segments),
    getCustomPluginsContainerPath: () => p.join(agentsBase, 'custom-plugins'),
    getRolePluginsContainerPath: () => p.join(agentsBase, 'role-plugins'),
    getCorePluginsContainerPath: () => p.join(agentsBase, 'core-plugins'),
    getCustomAbstractDir: () => p.join(agentsBase, 'custom-plugins', '.abstract'),
    getRoleAbstractDir: () => p.join(agentsBase, 'role-plugins', '.abstract'),
    getCoreAbstractDir: () => p.join(agentsBase, 'core-plugins', '.abstract'),
    getCustomMarketplacePathForClient: (client: string) =>
      p.join(agentsBase, 'custom-plugins', client === 'claude' ? 'custom-marketplace' : `${client}-custom-marketplace`),
    getRoleMarketplacePathForClient: (client: string) =>
      p.join(agentsBase, 'role-plugins', client === 'claude' ? 'roles-marketplace' : `${client}-roles-marketplace`),
    getCoreMarketplacePathForClient: (client: string) =>
      p.join(agentsBase, 'core-plugins', `${client}-core-marketplace`),
    getLocalMarketplacePath: () => p.join(agentsBase, 'role-plugins'),
    getCustomMarketplacePath: () => p.join(agentsBase, 'custom-plugins'),
  }
})

// ============================================================================
// Environment mocks (none of these modules CONTAINS a guard pinned here).
// ============================================================================
const {
  mockAgentRegistry,
  mockGovernance,
  mockExecFileCalls,
  mockExecFileImpl,
  mockRuntime,
  mockAgentInvariants,
  mockHostsConfig,
  mockSessionPersistence,
  mockAmpInboxWriter,
  mockSharedState,
  mockRolePluginService,
  mockAgentLocalConfig,
  mockUuid,
} = vi.hoisted((): any => {
  let uuidCounter = 0
  const execFileCalls: Array<{ cmd: unknown; args: unknown }> = []
  return {
    mockAgentRegistry: {
      getAgent: vi.fn(() => null),
      loadAgents: vi.fn(() => []),
      saveAgents: vi.fn(),
      createAgent: vi.fn(),
      getAgentByName: vi.fn(() => null),
      getAgentBySession: vi.fn(() => null),
      updateAgent: vi.fn(async () => undefined),
      deleteAgent: vi.fn(() => true),
      searchAgents: vi.fn(() => []),
      linkSession: vi.fn(),
      unlinkSession: vi.fn(),
    },
    mockGovernance: {
      loadGovernance: vi.fn(() => ({ managerId: null, passwordHash: 'stored-hash' })),
      saveGovernance: vi.fn(),
      verifyPassword: vi.fn(async () => false),
      setPassword: vi.fn(async () => undefined),
      setUserName: vi.fn(async () => undefined),
      setManager: vi.fn(async () => undefined),
      removeManager: vi.fn(async () => undefined),
      isManager: vi.fn(() => false),
      getManagerId: vi.fn(() => null),
      isChiefOfStaffAnywhere: vi.fn(() => false),
      isUserAuthorityModelEnabled: vi.fn(() => false),
    },
    mockExecFileCalls: execFileCalls,
    mockExecFileImpl: vi.fn(async (cmd: unknown, args: unknown) => {
      execFileCalls.push({ cmd, args })
      return { stdout: '', stderr: '' }
    }),
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
    mockAgentInvariants: {
      enforceAgentInvariants: vi.fn(async () => ({
        outcomes: [{ id: 'core-plugin', status: 'ok' }],
        repaired: [],
        failed: [],
      })),
      formatEnforceResult: vi.fn(() => null),
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
      getAgentAMPDir: vi.fn(() => '/tmp/amp/r3-r9'),
    },
    mockSharedState: { sessionActivity: new Map<string, number>(), broadcastAgentUpdate: vi.fn() },
    mockRolePluginService: {
      installPluginLocally: vi.fn(async () => undefined),
      uninstallPluginLocally: vi.fn(async () => undefined),
      getPluginsForTitle: vi.fn(() => []),
      ensureMarketplace: vi.fn(async () => undefined),
      updateMarketplaceManifest: vi.fn(async () => undefined),
      listRolePlugins: vi.fn(async () => []),
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
    mockUuid: { v4: vi.fn(() => `uuid-${++uuidCounter}`) },
  }
})

vi.mock('@/lib/agent-registry', () => mockAgentRegistry)
vi.mock('@/lib/governance', () => mockGovernance)
vi.mock('@/lib/agent-runtime', () => ({ getRuntime: vi.fn(() => mockRuntime) }))
vi.mock('@/lib/agent-invariants', () => mockAgentInvariants)
vi.mock('@/lib/hosts-config', () => mockHostsConfig)
vi.mock('@/lib/session-persistence', () => mockSessionPersistence)
vi.mock('@/lib/amp-inbox-writer', () => mockAmpInboxWriter)
vi.mock('@/services/shared-state', () => mockSharedState)
vi.mock('@/services/role-plugin-service', () => mockRolePluginService)
vi.mock('@/services/agent-local-config-service', () => mockAgentLocalConfig)
vi.mock('uuid', () => mockUuid)
// Network fan-out to peer hosts — genuine external I/O, never a guard here.
vi.mock('@/lib/governance-sync', () => ({
  broadcastGovernanceSync: vi.fn(async () => undefined),
}))
// The cemetery archive. Default: succeeds — a failing archive now REFUSES a soft delete, so a
// stub that fails would break every soft-delete test for a reason it is not testing.
const mockExportAgentZip = vi.fn(async (id: string) => {
  return { data: { filename: `${id}-export.zip`, buffer: Buffer.from('zip') } } as {
    data: { filename: string; buffer: Buffer } | null
    error?: string
  }
})
vi.mock('@/services/agents-transfer-service', () => ({
  exportAgentZip: (...a: [string]) => mockExportAgentZip(...a),
}))
vi.mock('@/lib/notification-service', () => ({
  notifyAgent: vi.fn(async () => undefined),
}))

// NOTE — deliberately NOT mocking @/lib/agent-auth or @/lib/sudo-guard here.
// Both were tried as file-wide partial mocks and both are traps: `lib/sudo-guard`
// imports `./authorization`, which imports `./team-registry`, so its
// importOriginal() factory races the team-registry partial mock below and can
// leave the REAL, unwrapped team-registry bound for some importers — which
// silently un-spies blockAllTeams/unblockAllTeams/updateTeam and made five
// unrelated tests fail with "expected vi.fn() to be called at least once".
// The R3.12 route test needs neither: an unauthenticated Request resolves to the
// system-owner web path, and the strict-route gate is skipped for a body whose
// only privileged field (chiefOfStaffId) the guard under test has already
// stripped. Letting both run for real is simpler AND a stronger test.

// child_process: preserve every real export, intercept only the three call
// shapes the code under test uses (all of them genuine external-process I/O:
// `tmux kill-session`, `claude plugin ...`).
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return {
    ...actual,
    execFile: (...args: unknown[]) => {
      const cb = args[args.length - 1] as (err: Error | null, r: { stdout: string; stderr: string }) => void
      mockExecFileImpl(args[0], args[1])
        .then((r: { stdout: string; stderr: string }) => cb(null, r))
        .catch((err: Error) => cb(err, { stdout: '', stderr: '' }))
    },
    exec: (_cmd: string, cb: (err: Error | null, r: { stdout: string; stderr: string }) => void) =>
      cb(null, { stdout: '', stderr: '' }),
    execSync: () => { throw new Error('ENOENT (test double)') },
  }
})

// ============================================================================
// PARTIAL mocks — the implementation stays REAL (importOriginal + spread); only
// a spy wrapper is added so a CALL SITE inside another module can be observed.
// The guard bodies (blockAllTeams's hibernation loop, unblockAllTeams's
// no-wake contract, updateTeam's write path) all still execute for real.
// ============================================================================
const { spyBlockAllTeams, spyUnblockAllTeams, spyUpdateTeam, spyUpdateTeamById } =
  vi.hoisted((): any => ({
    spyBlockAllTeams: vi.fn(),
    spyUnblockAllTeams: vi.fn(),
    spyUpdateTeam: vi.fn(),
    spyUpdateTeamById: vi.fn(),
  }))

vi.mock('@/lib/team-registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/team-registry')>()
  return {
    ...actual,
    blockAllTeams: (...a: []) => { spyBlockAllTeams(...a); return actual.blockAllTeams(...a) },
    unblockAllTeams: (...a: []) => { spyUnblockAllTeams(...a); return actual.unblockAllTeams(...a) },
    updateTeam: (...a: Parameters<typeof actual.updateTeam>) => {
      spyUpdateTeam(...a)
      return actual.updateTeam(...a)
    },
  }
})

vi.mock('@/services/teams-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/teams-service')>()
  return {
    ...actual,
    updateTeamById: (...a: Parameters<typeof actual.updateTeamById>) => {
      spyUpdateTeamById(...a)
      return actual.updateTeamById(...a)
    },
  }
})

// ============================================================================
// Shared helpers
// ============================================================================
const OWNER_CTX = { isSystemOwner: true as const }
const TEAMS_FILE = path.join(FAKE_STATE, 'teams', 'teams.json')

/** One recorded external-process invocation (see the child_process mock above). */
type ExecCall = { cmd: unknown; args: unknown }

type SeedTeam = {
  id: string
  name: string
  agentIds: string[]
  chiefOfStaffId?: string | null
  orchestratorId?: string | null
  blocked?: boolean
}

/** Write teams.json directly — the REAL team-registry reads from this path. */
function seedTeams(teams: SeedTeam[]): void {
  mkdirSync(path.dirname(TEAMS_FILE), { recursive: true })
  writeFileSync(
    TEAMS_FILE,
    JSON.stringify({
      version: '1.0',
      teams: teams.map(t => ({
        type: 'closed',
        description: '',
        chiefOfStaffId: null,
        orchestratorId: null,
        blocked: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...t,
      })),
    }, null, 2),
  )
}

function readTeamsFile(): SeedTeam[] {
  return JSON.parse(readFileSync(TEAMS_FILE, 'utf-8')).teams
}

function makeAgentRecord(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'agent-a',
    name: 'agent-a',
    workingDirectory: path.join(FAKE_HOME, 'agents', 'agent-a'),
    sessions: [],
    hostId: 'test-host',
    program: 'claude',
    governanceTitle: null,
    config: {},
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastActive: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

/** Register a fixed set of agent records with the mocked registry. */
const REGISTRY_FILE = path.join(FAKE_STATE, 'agents', 'registry.json')

function seedAgents(agents: Array<Record<string, unknown>>): void {
  mockAgentRegistry.loadAgents.mockReturnValue(agents)
  mockAgentRegistry.getAgent.mockImplementation(
    (id: string) => agents.find(a => a.id === id) ?? null,
  )
  mockAgentRegistry.getAgentByName.mockImplementation(
    (n: string) => agents.find(a => a.name === n) ?? null,
  )
  // ChangeTitle's G14 proves the write LANDED by re-reading registry.json from disk (via
  // statePath, redirected to FAKE_STATE here) — it deliberately bypasses this module mock, so
  // mocking `@/lib/agent-registry` alone is not enough. Without the file on disk EVERY ChangeTitle
  // fails at G14, and that is not hypothetical: it is how four R9 tests came to assert the
  // G10/G13 blocking cascade while the pipeline they drove was returning an ERROR. They only
  // passed because G10/G13 used to run BEFORE G14 — the very ordering TRDD-EE5YX5LF fixed.
  const syncRegistryFile = () => {
    mkdirSync(path.dirname(REGISTRY_FILE), { recursive: true })
    writeFileSync(REGISTRY_FILE, JSON.stringify(agents))
  }
  syncRegistryFile()
  // Default write-through. A test that needs a specific failure overrides this AFTER seedAgents;
  // re-establishing it on every seed also heals any implementation leaked by a previous test.
  mockAgentRegistry.updateAgent.mockImplementation(async (id: string, patch: Record<string, unknown>) => {
    const rec = agents.find(a => a.id === id)
    if (rec) Object.assign(rec, patch)
    syncRegistryFile()
    return rec ?? null // MUST return the record: G14 reads a null return as "registry not written"
  })
  // DeleteAgent's G08b verifies a hard delete by re-reading registry.json, so the delete has to be
  // modelled or that gate correctly reports the agent is still there. It used to "pass" only
  // because it was reading the DEVELOPER'S live registry, which of course never contains a
  // synthetic test agent — a verification gate satisfied by the wrong file.
  mockAgentRegistry.deleteAgent.mockImplementation((id: string) => {
    const i = agents.findIndex(a => a.id === id)
    if (i >= 0) agents.splice(i, 1)
    syncRegistryFile()
    return i >= 0
  })
}

// Pay the cold-start module-graph cost ONCE, in a hook, instead of billing it to
// whichever test happens to import first (see the vi.setConfig note at the top).
// SEQUENTIALLY, and with team-registry FIRST. Both details are load-bearing:
// a Promise.all here races the partial-mock factories (several of these modules
// transitively import team-registry), which non-deterministically binds the REAL
// unwrapped module for some importers and silently un-spies
// blockAllTeams/unblockAllTeams/updateTeam.
beforeAll(async () => {
  await import('@/lib/team-registry')
  await import('@/lib/authorization')
  await import('@/lib/communication-graph')
  await import('@/services/element-management-service')
  await import('@/services/agents-core-service')
  await import('@/services/teams-service')
  await import('@/services/governance-service')
})

beforeEach(() => {
  vi.clearAllMocks()
  mockExecFileCalls.length = 0
  mockExecFileImpl.mockImplementation(async (cmd: unknown, args: unknown) => {
    mockExecFileCalls.push({ cmd, args })
    return { stdout: '', stderr: '' }
  })
  mockGovernance.getManagerId.mockReturnValue(null)
  mockGovernance.isManager.mockReturnValue(false)
  mockGovernance.isChiefOfStaffAnywhere.mockReturnValue(false)
  mockGovernance.isUserAuthorityModelEnabled.mockReturnValue(false)
  mockGovernance.loadGovernance.mockReturnValue({ managerId: null, passwordHash: 'stored-hash' })
  mockGovernance.verifyPassword.mockResolvedValue(false)
  mockAgentInvariants.enforceAgentInvariants.mockResolvedValue({
    outcomes: [{ id: 'core-plugin', status: 'ok' }],
    repaired: [],
    failed: [],
  })
  mockRuntime.sessionExists.mockResolvedValue(false)
  seedAgents([])
  seedTeams([])
})

afterAll(() => {
  rmSync(FAKE_STATE, { recursive: true, force: true })
  rmSync(FAKE_HOME, { recursive: true, force: true })
})

// ============================================================================
// R3.2 — MANAGER singleton (services/element-management-service.ts, ChangeTitle
//        GATE 7, lines 2291-2303 — the enforcement map's 2249-2256 is stale;
//        that range is GATE 3's R9.13 role-plugin check)
// ============================================================================
describe('R3.2 — only ONE agent may hold MANAGER (ChangeTitle GATE 7)', () => {
  it('refuses to make a second agent MANAGER while another already holds the title — deleting GATE 7 lets two MANAGERs coexist and the whole manager-gated cascade (R9) loses its single owner', async () => {
    seedAgents([
      makeAgentRecord({ id: 'agent-a', name: 'agent-a' }),
      makeAgentRecord({ id: 'agent-mgr', name: 'agent-mgr', governanceTitle: 'manager' }),
    ])
    mockGovernance.getManagerId.mockReturnValue('agent-mgr')

    const { ChangeTitle } = await import('@/services/element-management-service')
    const result = await ChangeTitle('agent-a', 'manager', {
      authContext: OWNER_CTX,
      skipPluginSync: true,
      skipRestart: true,
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Only one MANAGER allowed/i)
    expect(result.error).toContain('agent-mgr')
    // The refusal happened AT gate 7, not incidentally later.
    expect(result.operations.some(op => /G07: MANAGER singleton check passed/.test(op))).toBe(false)
    expect(result.operations.some(op => /^G06:/.test(op))).toBe(true)
  })

  it('positive control — re-asserting MANAGER on the agent that ALREADY holds it passes GATE 7 (the singleton is "one", not "none")', async () => {
    seedAgents([makeAgentRecord({ id: 'agent-mgr', name: 'agent-mgr', governanceTitle: null })])
    mockGovernance.getManagerId.mockReturnValue('agent-mgr')

    const { ChangeTitle } = await import('@/services/element-management-service')
    const result = await ChangeTitle('agent-mgr', 'manager', {
      authContext: OWNER_CTX,
      skipPluginSync: true,
      skipRestart: true,
    })

    // `expect(result.error).not.toMatch(/Only one MANAGER allowed/)` used to stand here, and it
    // passed for EVERY other error too — including the G14 persistence failure this fixture was
    // silently producing before it seeded registry.json. A positive control has to assert the
    // operation SUCCEEDED, not merely that it failed for a different reason.
    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
    expect(result.operations.some(op => /G07: MANAGER singleton check passed/.test(op))).toBe(true)
  })
})

// ============================================================================
// R3.3 — COS is per-team and each team has exactly ONE
//        (services/element-management-service.ts, ChangeTitle GATE 8)
// ============================================================================
describe('R3.3 — one CHIEF-OF-STAFF per team (ChangeTitle GATE 8)', () => {
  it('refuses CHIEF-OF-STAFF for a second agent in a team that already has one — deleting GATE 8 lets the UI check be bypassed by any direct API PATCH, giving a team two gateways', async () => {
    seedTeams([{ id: 'team-1', name: 'Team One', agentIds: ['agent-a', 'agent-cos'], chiefOfStaffId: 'agent-cos' }])
    seedAgents([
      makeAgentRecord({ id: 'agent-a', name: 'agent-a', governanceTitle: 'member' }),
      makeAgentRecord({ id: 'agent-cos', name: 'agent-cos', governanceTitle: 'chief-of-staff' }),
    ])

    const { ChangeTitle } = await import('@/services/element-management-service')
    const result = await ChangeTitle('agent-a', 'chief-of-staff', {
      authContext: OWNER_CTX,
      skipPluginSync: true,
      skipRestart: true,
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Only one Chief-of-Staff is allowed per team/i)
    expect(
      result.operations.some(op => /G08: DENIED — CHIEF-OF-STAFF singleton already held by agent-cos/.test(op)),
    ).toBe(true)
  })

  it('the same GATE 8 also refuses a second ORCHESTRATOR — the per-team singleton set is not COS-only', async () => {
    seedTeams([{ id: 'team-1', name: 'Team One', agentIds: ['agent-a', 'agent-orch'], chiefOfStaffId: 'agent-cos', orchestratorId: 'agent-orch' }])
    seedAgents([
      makeAgentRecord({ id: 'agent-a', name: 'agent-a', governanceTitle: 'member' }),
      makeAgentRecord({ id: 'agent-orch', name: 'agent-orch', governanceTitle: 'orchestrator' }),
    ])

    const { ChangeTitle } = await import('@/services/element-management-service')
    const result = await ChangeTitle('agent-a', 'orchestrator', {
      authContext: OWNER_CTX,
      skipPluginSync: true,
      skipRestart: true,
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Only one Orchestrator is allowed per team/i)
    expect(
      result.operations.some(op => /G08: DENIED — ORCHESTRATOR singleton already held by agent-orch/.test(op)),
    ).toBe(true)
  })

  it('positive control — a team with a VACANT COS slot accepts the assignment (GATE 8 blocks a second COS, not the first)', async () => {
    seedTeams([{ id: 'team-1', name: 'Team One', agentIds: ['agent-a'], chiefOfStaffId: null }])
    seedAgents([makeAgentRecord({ id: 'agent-a', name: 'agent-a', governanceTitle: 'member' })])

    const { ChangeTitle } = await import('@/services/element-management-service')
    const result = await ChangeTitle('agent-a', 'chief-of-staff', {
      authContext: OWNER_CTX,
      skipPluginSync: true,
      skipRestart: true,
    })

    // Same correction as the GATE 7 positive control above: "the error is not THIS error" is
    // satisfied by every OTHER error, so it stayed green while the pipeline was failing at G14.
    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
    expect(result.operations.some(op => /G08: CHIEF-OF-STAFF per-team singleton check passed/.test(op))).toBe(true)
  })
})

// ============================================================================
// R3.4 — an agent may be COS of ONE team only
//        (lib/team-registry.ts validateTeamMutation, lines 132-138)
// ============================================================================
describe('R3.4 — an agent can be CHIEF-OF-STAFF of only ONE team (validateTeamMutation)', () => {
  /** validateTeamMutation returns a discriminated union; widen it for assertions. */
  type MutationVerdict = { valid: boolean; error?: string; code?: number }

  it('refuses (409) assigning an agent as COS of team B while it is already COS of team A — deleting this check lets one agent become the gateway of every team at once', async () => {
    const { validateTeamMutation } = await import('@/lib/team-registry')
    const teams = [
      { id: 'team-a', name: 'Team Alpha', type: 'closed', agentIds: ['cos-1'], chiefOfStaffId: 'cos-1', orchestratorId: null, description: '', createdAt: '', updatedAt: '' },
      { id: 'team-b', name: 'Team Beta', type: 'closed', agentIds: ['other'], chiefOfStaffId: null, orchestratorId: null, description: '', createdAt: '', updatedAt: '' },
    ] as unknown as import('@/types/team').Team[]

    const res = validateTeamMutation(teams, 'team-b', { chiefOfStaffId: 'cos-1' }, null) as MutationVerdict

    expect(res.valid).toBe(false)
    expect(res.error).toMatch(/already Chief-of-Staff of team "Team Alpha"/)
    expect(res.code).toBe(409)
  })

  it('the same check fires on CREATE (teamId = null), not only on update — a fresh team cannot steal another team\'s COS', async () => {
    const { validateTeamMutation } = await import('@/lib/team-registry')
    const teams = [
      { id: 'team-a', name: 'Team Alpha', type: 'closed', agentIds: ['cos-1'], chiefOfStaffId: 'cos-1', orchestratorId: null, description: '', createdAt: '', updatedAt: '' },
    ] as unknown as import('@/types/team').Team[]

    const res = validateTeamMutation(teams, null, { name: 'Team Gamma', chiefOfStaffId: 'cos-1' }, null) as MutationVerdict

    expect(res.valid).toBe(false)
    expect(res.error).toMatch(/already Chief-of-Staff of team "Team Alpha"/)
    expect(res.code).toBe(409)
  })

  it('positive control — re-asserting the SAME agent as COS of the SAME team is not a second-team conflict', async () => {
    const { validateTeamMutation } = await import('@/lib/team-registry')
    const teams = [
      { id: 'team-a', name: 'Team Alpha', type: 'closed', agentIds: ['cos-1'], chiefOfStaffId: 'cos-1', orchestratorId: null, description: '', createdAt: '', updatedAt: '' },
    ] as unknown as import('@/types/team').Team[]

    const res = validateTeamMutation(teams, 'team-a', { chiefOfStaffId: 'cos-1' }, null) as MutationVerdict

    expect(res.valid).toBe(true)
    expect(res.error ?? '').not.toMatch(/already Chief-of-Staff/)
  })
})

// ============================================================================
// R3.5 — role changes require the governance password
//        (services/governance-service.ts setManagerRole, lines 66-68 + 82-84)
// ============================================================================
describe('R3.5 — MANAGER role changes require the governance password (setManagerRole)', () => {
  it('refuses with 400 when NO password is supplied — deleting this gate makes POST /api/governance/manager an unauthenticated title-grant endpoint', async () => {
    const { setManagerRole } = await import('@/services/governance-service')
    const res = await setManagerRole({ agentId: 'agent-a' })

    expect(res.status).toBe(400)
    expect(res.error).toBe('Governance password is required')
    expect(mockGovernance.verifyPassword).not.toHaveBeenCalled()
    expect(mockGovernance.setManager).not.toHaveBeenCalled()
  })

  it('refuses with 401 when the password is WRONG, and performs no title mutation — deleting the verifyPassword gate would let any string through', async () => {
    mockGovernance.verifyPassword.mockResolvedValue(false)

    const { setManagerRole } = await import('@/services/governance-service')
    const res = await setManagerRole({ agentId: 'agent-a', password: 'not-the-password' })

    expect(res.status).toBe(401)
    expect(res.error).toBe('Invalid governance password')
    expect(mockGovernance.verifyPassword).toHaveBeenCalledWith('not-the-password')
    // The refusal must land BEFORE any governance mutation.
    expect(mockGovernance.setManager).not.toHaveBeenCalled()
    expect(mockGovernance.removeManager).not.toHaveBeenCalled()
  })

  it('also refuses (400) when no governance password has been configured at all — the gate is not skipped on an unconfigured host', async () => {
    mockGovernance.loadGovernance.mockReturnValue({ managerId: null })

    const { setManagerRole } = await import('@/services/governance-service')
    const res = await setManagerRole({ agentId: 'agent-a', password: 'anything' })

    expect(res.status).toBe(400)
    expect(res.error).toMatch(/Governance password not set/i)
    expect(mockGovernance.setManager).not.toHaveBeenCalled()
  })
})

// ============================================================================
// R3.7 — COS is the team's external contact point
//        (lib/communication-graph.ts ALLOW_EDGES, lines 97-102)
// ============================================================================
describe('R3.7 — COS is the sole external contact point of its team (communication graph)', () => {
  it('COS reaches OUT to MANAGER and MANAGER reaches IN to COS — the two halves of the gateway edge', async () => {
    const { getEdgeType } = await import('@/lib/communication-graph')
    expect(getEdgeType('chief-of-staff', 'manager')).toBe('allow')
    expect(getEdgeType('manager', 'chief-of-staff')).toBe('allow')
  })

  it('every in-team title reaches its COS — the gateway is reachable from inside the team', async () => {
    const { getEdgeType } = await import('@/lib/communication-graph')
    for (const inTeam of ['orchestrator', 'architect', 'integrator', 'member'] as const) {
      expect(getEdgeType(inTeam, 'chief-of-staff')).toBe('allow')
    }
  })

  it('an OUTSIDE agent cannot reach an in-team agent directly, MANAGER included — deleting the COS-gateway shape lets outsiders bypass the team gateway entirely', async () => {
    const { getEdgeType } = await import('@/lib/communication-graph')
    for (const inTeam of ['orchestrator', 'architect', 'integrator', 'member'] as const) {
      expect(getEdgeType('manager', inTeam)).toBe('deny')
      expect(getEdgeType('maintainer', inTeam)).toBe('deny')
      expect(getEdgeType('autonomous', inTeam)).toBe('deny')
    }
  })

  it('an in-team agent cannot reach OUTSIDE the team except through its COS — the gateway is the only outbound door', async () => {
    const { getEdgeType, getAllowedRecipients } = await import('@/lib/communication-graph')
    for (const inTeam of ['architect', 'integrator', 'member'] as const) {
      expect(getEdgeType(inTeam, 'manager')).toBe('deny')
      expect(getEdgeType(inTeam, 'maintainer')).toBe('deny')
      expect(getEdgeType(inTeam, 'autonomous')).toBe('deny')
      // The only titles they may freely initiate to are inside their own team.
      expect(getAllowedRecipients(inTeam).sort()).toEqual(['chief-of-staff', 'orchestrator'])
    }
  })
})

// ============================================================================
// R3.9 — MANAGER can do everything COS can (lib/authorization.ts, line 285 for
//        change-title + the general MANAGER grant at ~527)
// ============================================================================
describe('R3.9 — MANAGER is a superset of COS (authorize)', () => {
  const COS = { agentId: 'cos-1', governanceTitle: 'chief-of-staff', teamId: 'team-1' }
  const MGR = { agentId: 'mgr-1', governanceTitle: 'manager', teamId: undefined }
  const TARGET = 'agent-a'

  beforeEach(() => {
    // authorize() resolves team membership through the REAL team-registry, so
    // seed a team that contains both the COS and the target.
    seedTeams([{ id: 'team-1', name: 'Team One', agentIds: ['cos-1', 'agent-a'], chiefOfStaffId: 'cos-1' }])
  })

  it('for EVERY action a same-team COS is allowed, a MANAGER is allowed too — deleting the MANAGER grant inverts the hierarchy (a COS could act where its MANAGER could not)', async () => {
    const { authorize } = await import('@/lib/authorization')
    const actions = [
      'modify-agent', 'change-title', 'delete-agent', 'hibernate-agent', 'wake-agent',
      'link-session', 'delete-session', 'create-session', 'manage-team', 'manage-skills',
      'manage-group', 'view-agent', 'send-command', 'restart-session', 'register-agent',
      'export-agent',
    ] as const

    const inversions: string[] = []
    let cosAllowedCount = 0
    for (const action of actions) {
      const cos = authorize(COS as never, action, TARGET)
      const mgr = authorize(MGR as never, action, TARGET)
      if (cos.allowed) cosAllowedCount++
      if (cos.allowed && !mgr.allowed) inversions.push(`${action}: COS allowed but MANAGER denied`)
    }

    expect(inversions).toEqual([])
    // Guard against a vacuous pass: the COS must actually be allowed something.
    expect(cosAllowedCount).toBeGreaterThan(3)
  })

  it('change-title specifically: MANAGER is granted with no team relationship at all, while COS needs same-team — this is the line-285 grant', async () => {
    const { authorize } = await import('@/lib/authorization')

    // MANAGER: not in any team, still allowed.
    expect(authorize(MGR as never, 'change-title', TARGET)).toEqual({ allowed: true })

    // COS: allowed inside its own team...
    expect(authorize(COS as never, 'change-title', TARGET).allowed).toBe(true)
    // ...and denied outside it.
    const outsider = authorize(COS as never, 'change-title', 'stranger-agent')
    expect(outsider.allowed).toBe(false)
    expect(outsider.reason).toMatch(/own team/i)
  })

  it('the superset does NOT extend to self-action: neither MANAGER nor COS may change its OWN title (the one rule that binds a MANAGER)', async () => {
    const { authorize } = await import('@/lib/authorization')
    expect(authorize(MGR as never, 'change-title', 'mgr-1')).toEqual({
      allowed: false,
      reason: 'No agent can change its own governance title',
    })
    expect(authorize(COS as never, 'change-title', 'cos-1').allowed).toBe(false)
  })
})

// ============================================================================
// R3.12 — BYPASS PREVENTION: COS cannot be changed through the generic
//         PUT /api/teams/[id]. Two independent strip layers (SF-015), both
//         pinned: app/api/teams/[id]/route.ts:115 and
//         services/teams-service.ts::updateTeamById.
// ============================================================================
describe('R3.12 — chiefOfStaffId cannot be set via the generic PUT /api/teams/[id]', () => {
  beforeEach(() => {
    seedTeams([{ id: '11111111-1111-4111-8111-111111111111', name: 'Team One', agentIds: ['agent-a'], chiefOfStaffId: 'cos-1' }])
    seedAgents([makeAgentRecord({ id: 'agent-a', name: 'agent-a' })])
  })

  it('LAYER 1 (route): a PUT body carrying chiefOfStaffId reaches updateTeamById with that field STRIPPED — deleting the route strip re-opens a password-free COS reassignment path', async () => {
    // Only `authenticateFromRequest` is stubbed, and only for THIS test. It is not
    // an R3/R9 guard — it decides WHO the caller is, and it correctly rejects a
    // header-less Request (401) before control ever reaches the COS-strip that IS
    // the guard. Scoped rather than file-wide because agent-auth's transitive graph
    // overlaps team-registry's, and a file-wide importOriginal() factory there races
    // the team-registry partial mock (that race un-spied blockAllTeams and broke
    // four unrelated tests). try/finally so a throw cannot leak the mock forward.
    // requireSudoToken is deliberately left REAL: with chiefOfStaffId stripped, no
    // privileged field remains, so the strict-route gate is legitimately skipped.
    vi.doMock('@/lib/agent-auth', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/agent-auth')>()
      return { ...actual, authenticateFromRequest: () => ({}) }
    })
    vi.resetModules()
    try {
      const { PUT } = await import('@/app/api/teams/[id]/route')
      const teamId = '11111111-1111-4111-8111-111111111111'
      const req = new Request(`http://localhost:23000/api/teams/${teamId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed Team', chiefOfStaffId: '22222222-2222-4222-8222-222222222222' }),
      })

      const res = await PUT(req as never, { params: Promise.resolve({ id: teamId }) })

      // Fail loudly if the request never reached the service at all, rather than
      // letting a 401/400 masquerade as "the field was stripped".
      expect(res.status, `route returned ${res.status}: ${await res.clone().text()}`).toBe(200)
      expect(spyUpdateTeamById).toHaveBeenCalled()
      const forwarded = spyUpdateTeamById.mock.calls.at(-1)![1] as Record<string, unknown>
      expect(forwarded).not.toHaveProperty('chiefOfStaffId')
      expect(forwarded).not.toHaveProperty('orchestratorId')
      expect(forwarded).not.toHaveProperty('type')
      // Proof the request was otherwise well-formed and DID reach the service:
      expect(forwarded.name).toBe('Renamed Team')
    } finally {
      vi.doUnmock('@/lib/agent-auth')
      vi.resetModules()
      // Re-warm sequentially so every later test sees a consistently mocked graph
      // (see the beforeAll note — concurrent re-imports can un-spy team-registry).
      await import('@/lib/team-registry')
      await import('@/services/element-management-service')
      await import('@/services/teams-service')
    }
  })

  it('LAYER 2 (service): updateTeamById strips chiefOfStaffId before it reaches team-registry.updateTeam — deleting this second strip means a direct service caller could reassign the COS', async () => {
    const teamId = '11111111-1111-4111-8111-111111111111'
    const { updateTeamById } = await import('@/services/teams-service')

    await updateTeamById(teamId, {
      name: 'Renamed Again',
      chiefOfStaffId: '22222222-2222-4222-8222-222222222222',
      orchestratorId: '33333333-3333-4333-8333-333333333333',
      authContext: OWNER_CTX,
    } as never)

    expect(spyUpdateTeam).toHaveBeenCalled()
    const fields = spyUpdateTeam.mock.calls.at(-1)![1] as Record<string, unknown>
    expect(fields).not.toHaveProperty('chiefOfStaffId')
    expect(fields).not.toHaveProperty('orchestratorId')
    expect(fields.name).toBe('Renamed Again')

    // And the persisted team still names the ORIGINAL COS.
    expect(readTeamsFile().find(t => t.id === teamId)!.chiefOfStaffId).toBe('cos-1')
  })
})

// ============================================================================
// R9.1 / R9.11 — team creation is manager-gated (services/teams-service.ts
//                createNewTeam, lines 279-282 and 285-291)
// ============================================================================
describe('R9.1 / R9.11 — team creation requires a MANAGER on the host (createNewTeam)', () => {
  it('R9.1: refuses (400) to create ANY team while no MANAGER exists — deleting this gate lets a host accumulate teams with no governance owner, which is exactly the state R9.2 blocks', async () => {
    mockGovernance.getManagerId.mockReturnValue(null)

    const { createNewTeam } = await import('@/services/teams-service')
    const res = await createNewTeam({ name: 'Orphan Team', authContext: OWNER_CTX } as never)

    expect(res.status).toBe(400)
    expect(res.error).toMatch(/Teams require an existing MANAGER first/i)
    // Nothing was written.
    expect(readTeamsFile()).toEqual([])
  })

  it('R9.11: a NON-manager agent caller is refused (403) — the MANAGER slot, not merely "some agent", is the create authority', async () => {
    mockGovernance.getManagerId.mockReturnValue('mgr-1')

    const { createNewTeam } = await import('@/services/teams-service')
    const res = await createNewTeam({
      name: 'Hijacked Team',
      requestingAgentId: 'not-the-manager',
      authContext: OWNER_CTX,
    } as never)

    expect(res.status).toBe(403)
    expect(res.error).toMatch(/Only the MANAGER agent can create teams/i)
    expect(readTeamsFile()).toEqual([])
  })

  it('R9.11: the MANAGER itself passes both gates supplying NO governance password — an agent never faces a password prompt (R29/R32)', async () => {
    mockGovernance.getManagerId.mockReturnValue('mgr-1')

    const { createNewTeam } = await import('@/services/teams-service')
    const res = await createNewTeam({
      name: 'Manager Team',
      requestingAgentId: 'mgr-1',
      authContext: OWNER_CTX,
    } as never)

    // Whatever happens downstream, it must NOT be one of the two manager gates.
    expect(res.error ?? '').not.toMatch(/Teams require an existing MANAGER first/i)
    expect(res.error ?? '').not.toMatch(/Only the MANAGER agent can create teams/i)
    expect(res.error ?? '').not.toMatch(/password/i)
  })
})

// ============================================================================
// R9.2 / R9.6 — the manager-gated blocking cascade
//               (element-management-service.ts ChangeTitle GATE 10 @2461-2474
//                and GATE 13 @2539-2554 — the map's 2419-2431 / 2497-2515 are
//                stale; those ranges are GATE 9b and GATE 11 respectively)
// ============================================================================
describe('R9.2 / R9.6 — losing/gaining the MANAGER blocks/unblocks every team (ChangeTitle G10 / G13)', () => {
  it('R9.2: demoting the MANAGER runs the blocking cascade — deleting the G10 call leaves teams live with no governance owner', async () => {
    seedTeams([
      { id: 'team-1', name: 'Team One', agentIds: ['agent-x'], chiefOfStaffId: 'agent-x' },
      { id: 'team-2', name: 'Team Two', agentIds: ['agent-y'], chiefOfStaffId: 'agent-y' },
    ])
    seedAgents([
      makeAgentRecord({ id: 'agent-mgr', name: 'agent-mgr', governanceTitle: 'manager' }),
      makeAgentRecord({ id: 'agent-x', name: 'agent-x' }),
      makeAgentRecord({ id: 'agent-y', name: 'agent-y' }),
    ])
    mockGovernance.getManagerId.mockReturnValue('agent-mgr')
    mockGovernance.isManager.mockImplementation((id: string) => id === 'agent-mgr')

    const { ChangeTitle } = await import('@/services/element-management-service')
    const result = await ChangeTitle('agent-mgr', 'autonomous', {
      authContext: OWNER_CTX,
      skipPluginSync: true,
      skipRestart: true,
    })

    expect(spyBlockAllTeams).toHaveBeenCalled()
    expect(result.operations.some(op => /G10: Blocked all teams/.test(op))).toBe(true)
    // ...and the REAL blockAllTeams actually persisted the block.
    expect(readTeamsFile().every(t => t.blocked === true)).toBe(true)
  })

  it('TRDD-EE5YX5LF: a demotion whose title write FAILS must not have touched governance — G14 runs before G10', async () => {
    /**
     * G10-G13b mutate HOST-WIDE governance: removeManager(), block every team, hibernate their
     * agents, null out team COS/ORCH pointers. G14 — the verified title write — used to run AFTER
     * all of that, and every one of its failure paths is a `return result`. So a demotion whose
     * write failed left the host with NO MANAGER, every team blocked, team agents hibernated and
     * un-wakeable ("assign MANAGER first"), while the agent still read `manager` in the registry:
     * a single failed registry write turning into a host-wide outage fixable only by hand-editing
     * governance.json.
     *
     * G14 is also the gate that fails MOST readily, by design — it verifies the write actually
     * landed. Running it FIRST makes such a failure a clean no-op, which is what this pins.
     */
    seedTeams([{ id: 'team-1', name: 'Team One', agentIds: ['agent-x'], chiefOfStaffId: 'agent-x' }])
    seedAgents([
      makeAgentRecord({ id: 'agent-mgr', name: 'agent-mgr', governanceTitle: 'manager' }),
      makeAgentRecord({ id: 'agent-x', name: 'agent-x' }),
    ])
    mockGovernance.getManagerId.mockReturnValue('agent-mgr')
    mockGovernance.isManager.mockImplementation((id: string) => id === 'agent-mgr')

    // Make G14 fail the way it most often does in production: the registry write does not land.
    const writeThrough = mockAgentRegistry.updateAgent.getMockImplementation()!
    mockAgentRegistry.updateAgent.mockImplementation(async (id: string, patch: Record<string, unknown>) => {
      if (patch.governanceTitle !== undefined) return null // "registry not written"
      return writeThrough(id, patch)
    })

    const { ChangeTitle } = await import('@/services/element-management-service')
    const result = await ChangeTitle('agent-mgr', 'autonomous', {
      authContext: OWNER_CTX,
      skipPluginSync: true,
      skipRestart: true,
    })

    // Pin the REASON, not just the outcome — an earlier refusal would also give success===false.
    expect(result.success).toBe(false)
    expect(result.operations.some(op => op.startsWith('G14: DENIED'))).toBe(true)

    // THE POINT: none of the host-wide governance mutations may have run.
    expect(mockGovernance.removeManager).not.toHaveBeenCalled()
    expect(spyBlockAllTeams).not.toHaveBeenCalled()
    expect(readTeamsFile().some(t => t.blocked === true)).toBe(false)
  })

  it('R9.2 negative control — a title change that does NOT vacate the MANAGER slot must not block anything', async () => {
    seedTeams([{ id: 'team-1', name: 'Team One', agentIds: ['agent-a'], chiefOfStaffId: 'agent-cos' }])
    seedAgents([makeAgentRecord({ id: 'agent-a', name: 'agent-a', governanceTitle: 'member' })])
    mockGovernance.getManagerId.mockReturnValue('agent-mgr')

    const { ChangeTitle } = await import('@/services/element-management-service')
    const result = await ChangeTitle('agent-a', 'architect', {
      authContext: OWNER_CTX,
      skipPluginSync: true,
      skipRestart: true,
    })

    expect(spyBlockAllTeams).not.toHaveBeenCalled()
    expect(result.operations.some(op => /G10: Old title not MANAGER/.test(op))).toBe(true)
    expect(readTeamsFile().every(t => !t.blocked)).toBe(true)
  })

  it('R9.6: assigning a MANAGER unblocks every team — deleting the G13 call leaves the host permanently frozen after a MANAGER is restored', async () => {
    seedTeams([
      { id: 'team-1', name: 'Team One', agentIds: ['agent-x'], chiefOfStaffId: 'agent-x', blocked: true },
      { id: 'team-2', name: 'Team Two', agentIds: ['agent-y'], chiefOfStaffId: 'agent-y', blocked: true },
    ])
    seedAgents([makeAgentRecord({ id: 'agent-new-mgr', name: 'agent-new-mgr', governanceTitle: null })])
    mockGovernance.getManagerId.mockReturnValue(null)

    const { ChangeTitle } = await import('@/services/element-management-service')
    const result = await ChangeTitle('agent-new-mgr', 'manager', {
      authContext: OWNER_CTX,
      skipPluginSync: true,
      skipRestart: true,
    })

    expect(spyUnblockAllTeams).toHaveBeenCalled()
    expect(result.operations.some(op => /G13: Unblocked all teams/.test(op))).toBe(true)
    expect(readTeamsFile().every(t => t.blocked === false)).toBe(true)
  })
})

// ============================================================================
// R9.4 / R9.7 — blockAllTeams hibernates; unblockAllTeams does NOT wake
//               (lib/team-registry.ts, blockAllTeams @427-505,
//                unblockAllTeams @518-534)
// ============================================================================
describe('R9.4 / R9.7 — blockAllTeams hibernates every team agent; unblockAllTeams wakes none', () => {
  it('R9.4: kills the tmux session of EVERY agent in EVERY team (members + COS + orchestrator) — deleting the hibernation loop leaves team agents running with no MANAGER governing them', async () => {
    seedTeams([
      { id: 'team-1', name: 'Team One', agentIds: ['a1', 'a2'], chiefOfStaffId: 'cos1', orchestratorId: 'orch1' },
      { id: 'team-2', name: 'Team Two', agentIds: ['b1'], chiefOfStaffId: 'cosb' },
    ])
    seedAgents([
      makeAgentRecord({ id: 'a1', name: 'sess-a1' }),
      makeAgentRecord({ id: 'a2', name: 'sess-a2' }),
      makeAgentRecord({ id: 'cos1', name: 'sess-cos1' }),
      makeAgentRecord({ id: 'orch1', name: 'sess-orch1' }),
      makeAgentRecord({ id: 'b1', name: 'sess-b1' }),
      makeAgentRecord({ id: 'cosb', name: 'sess-cosb' }),
    ])

    const { blockAllTeams } = await import('@/lib/team-registry')
    const hibernated = await blockAllTeams()

    const killed = (mockExecFileCalls as ExecCall[])
      .filter(c => c.cmd === 'tmux' && Array.isArray(c.args) && (c.args as string[])[0] === 'kill-session')
      .map(c => (c.args as string[])[2])
      .sort()

    expect(killed).toEqual(['sess-a1', 'sess-a2', 'sess-b1', 'sess-cos1', 'sess-cosb', 'sess-orch1'])
    expect(hibernated.sort()).toEqual(['a1', 'a2', 'b1', 'cos1', 'cosb', 'orch1'])
    expect(readTeamsFile().every(t => t.blocked === true)).toBe(true)
  })

  it('R9.4: refuses to kill a session whose name contains shell metacharacters — the argv guard is part of the hibernation path, not decoration', async () => {
    seedTeams([{ id: 'team-1', name: 'Team One', agentIds: ['evil'], chiefOfStaffId: null }])
    seedAgents([makeAgentRecord({ id: 'evil', name: 'a; rm -rf /' })])

    const { blockAllTeams } = await import('@/lib/team-registry')
    const hibernated = await blockAllTeams()

    expect(hibernated).toEqual([])
    expect((mockExecFileCalls as ExecCall[]).filter(c => c.cmd === 'tmux')).toEqual([])
    // The team is still blocked — the unsafe name is skipped, not fatal.
    expect(readTeamsFile()[0].blocked).toBe(true)
  })

  it('R9.7: unblockAllTeams clears the flag and wakes NOBODY — deleting the "no auto-wake" contract would silently relaunch every agent the moment a MANAGER appears', async () => {
    seedTeams([
      { id: 'team-1', name: 'Team One', agentIds: ['a1'], chiefOfStaffId: 'cos1', blocked: true },
      { id: 'team-2', name: 'Team Two', agentIds: ['b1'], chiefOfStaffId: 'cosb', blocked: true },
    ])
    seedAgents([
      makeAgentRecord({ id: 'a1', name: 'sess-a1' }),
      makeAgentRecord({ id: 'cos1', name: 'sess-cos1' }),
      makeAgentRecord({ id: 'b1', name: 'sess-b1' }),
      makeAgentRecord({ id: 'cosb', name: 'sess-cosb' }),
    ])

    const { unblockAllTeams } = await import('@/lib/team-registry')
    await unblockAllTeams()

    expect(readTeamsFile().every(t => t.blocked === false)).toBe(true)
    // No session was created and no tmux process was spawned. Asserted on the
    // tmux SUBSET rather than on the whole recorded-call array: some pipelines
    // fire genuinely detached background work, and a late-landing unrelated call
    // must not be able to turn this rule's assertion red.
    expect(mockRuntime.createSession).not.toHaveBeenCalled()
    expect((mockExecFileCalls as ExecCall[]).filter(c => c.cmd === 'tmux')).toEqual([])
  })
})

// ============================================================================
// R9.5 — AUTONOMOUS agents are unaffected by the MANAGER gate
//        (services/agents-core-service.ts wakeAgent Gate 1 @2045-2054 — the
//         map's 2019-2028 is the function signature, not the guard)
// ============================================================================
describe('R9.5 — the MANAGER wake-gate binds TEAM agents only (wakeAgent Gate 1)', () => {
  it('refuses (403) to wake a TEAM agent while no MANAGER exists — deleting Gate 1 lets a team run ungoverned', async () => {
    seedTeams([{ id: 'team-1', name: 'Team One', agentIds: ['team-agent'], chiefOfStaffId: 'cos1' }])
    seedAgents([makeAgentRecord({ id: 'team-agent', name: 'team-agent', governanceTitle: 'member' })])
    mockGovernance.getManagerId.mockReturnValue(null)

    const { wakeAgent } = await import('@/services/agents-core-service')
    const res = await wakeAgent('team-agent', { startProgram: false })

    expect(res.status).toBe(403)
    expect(res.error).toMatch(/Cannot wake team agent: no MANAGER exists/i)
    expect(mockRuntime.createSession).not.toHaveBeenCalled()
  })

  it('wakes an AUTONOMOUS (team-less) agent with no MANAGER present — deleting the isAgentInAnyTeam conjunct would freeze the whole host, which R9.5 explicitly forbids', async () => {
    seedTeams([{ id: 'team-1', name: 'Team One', agentIds: ['someone-else'], chiefOfStaffId: 'cos1' }])
    seedAgents([makeAgentRecord({ id: 'auto-1', name: 'auto-1', governanceTitle: 'autonomous' })])
    mockGovernance.getManagerId.mockReturnValue(null)

    const { wakeAgent } = await import('@/services/agents-core-service')
    const res = await wakeAgent('auto-1', { startProgram: false })

    expect(res.status).toBe(200)
    expect(res.error).toBeUndefined()
    expect(mockRuntime.createSession).toHaveBeenCalled()
  })

  it('the gate also releases for a TEAM agent once a MANAGER exists — it is a manager gate, not a permanent team ban', async () => {
    seedTeams([{ id: 'team-1', name: 'Team One', agentIds: ['team-agent'], chiefOfStaffId: 'cos1' }])
    seedAgents([makeAgentRecord({ id: 'team-agent', name: 'team-agent', governanceTitle: 'member' })])
    mockGovernance.getManagerId.mockReturnValue('mgr-1')

    const { wakeAgent } = await import('@/services/agents-core-service')
    const res = await wakeAgent('team-agent', { startProgram: false })

    expect(res.status).toBe(200)
    expect(mockRuntime.createSession).toHaveBeenCalled()
  })
})

// ============================================================================
// R9.8 — deleting the MANAGER triggers the cascade immediately
//        (services/element-management-service.ts DeleteAgent G02 @6442-6465 —
//         the map's 6392-6415 is the G00/G01 auth+exists block)
// ============================================================================
describe('R9.8 — deleting the MANAGER runs the blocking cascade before the delete (DeleteAgent G02)', () => {
  it('auto-demotes the MANAGER (which fires the R9.2 cascade) before removing it — deleting G02 would delete the MANAGER and leave every team live and ownerless', async () => {
    seedTeams([{ id: 'team-1', name: 'Team One', agentIds: ['agent-x'], chiefOfStaffId: 'agent-x' }])
    seedAgents([
      makeAgentRecord({ id: 'agent-mgr', name: 'agent-mgr', governanceTitle: 'manager' }),
      makeAgentRecord({ id: 'agent-x', name: 'agent-x' }),
    ])
    mockGovernance.getManagerId.mockReturnValue('agent-mgr')
    mockGovernance.isManager.mockImplementation((id: string) => id === 'agent-mgr')

    const { DeleteAgent } = await import('@/services/element-management-service')
    const result = await DeleteAgent('agent-mgr', { authContext: OWNER_CTX, hard: true })

    expect(
      result.operations.some(op => /G02: Agent is MANAGER — auto-demoting to AUTONOMOUS/.test(op)),
    ).toBe(true)
    expect(spyBlockAllTeams).toHaveBeenCalled()
    expect(readTeamsFile().every(t => t.blocked === true)).toBe(true)
  })

  it('negative control — deleting a NON-manager agent runs no cascade', async () => {
    seedTeams([{ id: 'team-1', name: 'Team One', agentIds: ['agent-x'], chiefOfStaffId: 'agent-x' }])
    seedAgents([
      makeAgentRecord({ id: 'agent-mgr', name: 'agent-mgr', governanceTitle: 'manager' }),
      makeAgentRecord({ id: 'agent-plain', name: 'agent-plain', governanceTitle: 'autonomous' }),
    ])
    mockGovernance.getManagerId.mockReturnValue('agent-mgr')
    mockGovernance.isManager.mockImplementation((id: string) => id === 'agent-mgr')

    const { DeleteAgent } = await import('@/services/element-management-service')
    const result = await DeleteAgent('agent-plain', { authContext: OWNER_CTX, hard: true })

    expect(result.operations.some(op => /G02: Agent is not MANAGER/.test(op))).toBe(true)
    expect(spyBlockAllTeams).not.toHaveBeenCalled()
    expect(readTeamsFile().every(t => !t.blocked)).toBe(true)
  })
})

// ============================================================================
// A SOFT DELETE MUST STAY RECOVERABLE
// (services/element-management-service.ts DeleteAgent::G01c — the cemetery archive)
//
// DeleteAgent cannot be made all-or-nothing by rollback: it revokes AMP keys, kills the tmux
// session and `rm -rf`s the working directory and the Claude transcripts. None of that can be
// undone. So its guarantee rests on ORDERING plus ONE artifact — the cemetery zip. These two
// tests pin the two ways that guarantee was silently broken.
// ============================================================================
describe('DeleteTeam::G03 — an aborted delete puts the half-dismantled team back', () => {
  it('restores the membership, team field and title of every agent it had already dismantled', async () => {
    /**
     * G03 dismantles the team agent-by-agent BEFORE G04 deletes it: each agent is pulled out of
     * team.agentIds, reverted to AUTONOMOUS (role-plugin stripped) and has its legacy `team` field
     * cleared. When a later agent's revert failed, the pipeline aborted and told the operator
     * "Team NOT deleted to preserve consistency" — while holding a team whose earlier agents had
     * already been stripped and un-enrolled. The operator's natural next move, a retry, then ran
     * against state that no longer matched the first attempt.
     *
     * All THREE restore steps are pinned. Reaching the title one required TRDD-N7X4KDQ2 first:
     * ChangeTitle's G14 used to re-read `~/.aimaestro/agents/registry.json` built from a
     * module-scope `const HOME = homedir()`, so every revert failed there, `previousTitle` was
     * never recorded, and the title branch was unreachable — which is exactly why the first
     * version of this test passed with the compensation NEUTERED. G14 now resolves through
     * `statePath()`, the seam this fixture already redirects, so a synthetic agent verifies
     * against the fake state dir instead of the developer's live registry.
     */
    seedTeams([{ id: 'team-abort', name: 'Abort Team', agentIds: ['agent-a', 'agent-b'] }])
    const agents = [
      makeAgentRecord({ id: 'agent-a', name: 'agent-a', governanceTitle: 'member', team: 'Abort Team' }),
      makeAgentRecord({ id: 'agent-b', name: 'agent-b', governanceTitle: 'member', team: 'Abort Team' }),
    ]
    seedAgents(agents) // also seeds registry.json on disk + a write-through updateAgent

    // Make the registry actually persist, so ChangeTitle's read-back verification can pass for
    // agent-a — and then refuse exactly ONE write: agent-b's revert. A blanket rejection would
    // also break the restore path, and the test would pass without proving anything.
    // Override seedAgents' write-through to refuse exactly ONE write: agent-b's revert. A blanket
    // rejection would also break the restore path, and the test would pass without proving anything.
    const writeThrough = mockAgentRegistry.updateAgent.getMockImplementation()!
    mockAgentRegistry.updateAgent.mockImplementation(async (id: string, patch: Record<string, unknown>) => {
      if (id === 'agent-b' && patch.governanceTitle === 'autonomous') {
        throw new Error('simulated persistence failure on agent-b')
      }
      return writeThrough(id, patch)
    })

    // G00b gates on the governance password. `verifyPassword` is a mock here, so this string is an
    // arbitrary token the mock accepts — never the real governance secret, which no test may name.
    mockGovernance.verifyPassword.mockResolvedValue(true)

    const { DeleteTeam } = await import('@/services/element-management-service')
    const result = await DeleteTeam('team-abort', { authContext: OWNER_CTX, password: 'mocked-ok' })

    // Pin the REASON, not just the outcome: without this, an early refusal (a missing password, a
    // failed auth gate) also yields success===false and the test passes having never reached G03.
    expect(result.success).toBe(false)
    expect(result.operations.some(o => o.startsWith('G03: ABORTED'))).toBe(true)

    // THE POINT: both agents were pulled out of team.agentIds before the abort. A team that still
    // exists but has been emptied of its members is not "unchanged" — it is a husk, and the old
    // message called that consistency.
    const { loadTeams } = await import('@/lib/team-registry')
    const team = loadTeams().find(t => t.id === 'team-abort')
    expect(team).toBeDefined()
    expect(team!.agentIds).toContain('agent-a')
    expect(team!.agentIds).toContain('agent-b')
    // And the legacy `team` field, cleared on the way down, is put back on the way up.
    expect(agents.find(x => x.id === 'agent-a')!.team).toBe('Abort Team')
    // The third restore step: agent-a's revert SUCCEEDED before agent-b failed, so its title was
    // stripped to autonomous. It must be back. This is the assertion TRDD-N7X4KDQ2 unblocked.
    expect(agents.find(x => x.id === 'agent-a')!.governanceTitle).toBe('member')
  })
})

describe('DeleteTeam::G05 — deleting a team cancels the transfers that pointed at it (R8.3)', () => {
  it('rejects THIS team\'s pending requests and leaves every other request untouched', async () => {
    /**
     * R8.3: a deleted team must not leave live governance requests aimed at it. A pending
     * `transfer-agent` naming a team that no longer exists is worse than a dangling row — approving
     * it later runs an agent move into a team id nothing resolves.
     *
     * G05 walks the pending requests and rejects the ones whose payload names this team, counting
     * transfers separately from other request types. So the fixture has to DISCRIMINATE, or the
     * test cannot tell the guard from a blunter one that rejects everything it can reach. Four
     * records, one per branch the guard actually has:
     *
     *   pending  transfer-agent   THIS team   -> cancelled  (the rule's own case)
     *   pending  join-team        THIS team   -> rejected   (the `else` arm, counted separately)
     *   pending  transfer-agent   OTHER team  -> UNTOUCHED  (pins `involvesTeam`)
     *   approved transfer-agent   THIS team   -> UNTOUCHED  (pins `status !== 'pending'`)
     *
     * Without the last two a G05 that rejected every pending request in the file — or every request
     * of any status — would pass. They are the two assertions that make this a test of the filter
     * rather than of the loop.
     *
     * Nothing is mocked here: `governance-request-registry` resolves its file through
     * `getStateDir()`, which this fixture already redirects to FAKE_STATE, so the real registry
     * reads and writes a real file inside the fake home. That is the point — the guard's effect is
     * read back off disk, not off a spy.
     */
    seedTeams([{ id: 'team-doomed', name: 'Doomed Team', agentIds: [] }])
    seedAgents([])

    const REQUESTS_FILE = path.join(FAKE_STATE, 'governance-requests.json')
    const base = {
      sourceHostId: 'host-1',
      targetHostId: 'host-1',
      requestedBy: 'agent-req',
      requestedByRole: 'member',
      approvals: {},
      createdAt: '2026-07-30T10:00:00+0200',
      updatedAt: '2026-07-30T10:00:00+0200',
    }
    mkdirSync(path.dirname(REQUESTS_FILE), { recursive: true })
    writeFileSync(
      REQUESTS_FILE,
      JSON.stringify({
        version: 1,
        requests: [
          { ...base, id: 'req-transfer-doomed', type: 'transfer-agent', status: 'pending',
            payload: { agentId: 'agent-x', fromTeamId: 'team-doomed', toTeamId: 'team-other' } },
          { ...base, id: 'req-other-type-doomed', type: 'join-team', status: 'pending',
            payload: { agentId: 'agent-y', teamId: 'team-doomed' } },
          { ...base, id: 'req-transfer-elsewhere', type: 'transfer-agent', status: 'pending',
            payload: { agentId: 'agent-z', fromTeamId: 'team-other', toTeamId: 'team-third' } },
          { ...base, id: 'req-already-approved', type: 'transfer-agent', status: 'approved',
            payload: { agentId: 'agent-w', fromTeamId: 'team-doomed', toTeamId: 'team-other' } },
        ],
      }),
      'utf8',
    )

    // G00b gates on the governance password; `verifyPassword` is a mock, so this is an arbitrary
    // token the mock accepts — never the real governance secret, which no test may name.
    mockGovernance.verifyPassword.mockResolvedValue(true)

    const { DeleteTeam } = await import('@/services/element-management-service')
    const result = await DeleteTeam('team-doomed', { authContext: OWNER_CTX, password: 'mocked-ok' })

    // Pin the REASON, not just the outcome: several earlier gates also yield success===false, so a
    // bare falsy check would pass on a run that never reached G05.
    expect(result.success).toBe(true)
    expect(
      result.operations.some(o => o === 'G05: 1 transfer(s) cancelled, 1 governance request(s) rejected'),
      `G05 op line missing or miscounted. ops:\n${result.operations.join('\n')}`,
    ).toBe(true)

    const after = JSON.parse(readFileSync(REQUESTS_FILE, 'utf8')) as {
      requests: Array<{ id: string; status: string; rejectReason?: string }>
    }
    const byId = (id: string) => after.requests.find(r => r.id === id)!

    // The rule's own case, and the reason is part of it — an operator reading the row later needs
    // to know the team went away rather than that someone declined the move.
    expect(byId('req-transfer-doomed').status).toBe('rejected')
    expect(byId('req-transfer-doomed').rejectReason).toBe('Team deleted — transfer cancelled')
    expect(byId('req-other-type-doomed').status).toBe('rejected')

    // THE DISCRIMINATING HALF. Deleting one team must not touch another team's queue, and an
    // already-decided request must not be re-decided.
    expect(byId('req-transfer-elsewhere').status).toBe('pending')
    expect(byId('req-already-approved').status).toBe('approved')
  })
})

describe('ChangeTeam::G07 — joining a team with no role stated makes the agent a MEMBER (R4.4)', () => {
  /**
   * R4.4: joining a team auto-assigns MEMBER and the programmer role-plugin. The whole guard is one
   * expression — `const effectiveRole = (desired.role || 'member').toLowerCase()` — feeding
   * `ChangeTitle(agentId, effectiveRole, { authContext })`. The `|| 'member'` IS the rule.
   *
   * Why this needs TWO cases and not one. A test that only joins without a role, and only asserts
   * the title came out MEMBER, passes just as well against a guard that IGNORES `desired.role` and
   * hardcodes 'member' — which is a different (and wrong) rule. The explicit-role case is what
   * separates "member is the DEFAULT" from "member is the ONLY value", so it is not an extra
   * scenario, it is this test's vacuity control.
   *
   * Historical note worth keeping: the pre-2026 bug here was the OPPOSITE of a missing default —
   * `authContext` was not forwarded, so ChangeTitle's Gate 0 hard-rejected, the title was never
   * assigned, and the agent sat in the team with governanceTitle=null (SCEN-020 BUG-001 /
   * SCEN-007 P0-003). Both cases below assert a real title, so losing the forward reddens them too.
   */
  const joinFixture = (title: string | null) => {
    seedTeams([{ id: 'team-join', name: 'Join Team', agentIds: [] }])
    const agents = [makeAgentRecord({ id: 'agent-j', name: 'agent-j', governanceTitle: title })]
    seedAgents(agents) // write-through updateAgent mutates this array, so it reads back the persist
    // Team ops are manager-gated (R9/R10) and this file's beforeEach deliberately leaves the host
    // manager-less, so without this ChangeTeam refuses at G01b — "Team operations are blocked: no
    // MANAGER exists on this host" — and never reaches G07. Diagnosed from the ops trace, not from
    // reading: the failure was a bare `success === false` naming no gate.
    //
    // It must be `getManagerId`, NOT `loadGovernance`. G01b calls `getManagerId()` directly, so
    // seeding a managerId into loadGovernance's return value changes nothing and the gate still
    // refuses — which is exactly what the second run showed.
    mockGovernance.getManagerId.mockReturnValue('agent-mgr')
    return agents
  }

  it('with NO role stated, sets and PERSISTS the title MEMBER', async () => {
    const agents = joinFixture(null)

    const { ChangeTeam } = await import('@/services/element-management-service')
    // NOTE the desired-state object: `teamId` only. No `role` key at all — that absence is the
    // input under test.
    const result = await ChangeTeam('agent-j', { teamId: 'team-join' }, OWNER_CTX)

    // Pin the REASON, not just the outcome — an earlier gate refusing also yields success===false,
    // so carry the trace into the message or a failure here says nothing about which gate refused.
    expect(result.success, `${result.error}\nops:\n${result.operations.join('\n')}`).toBe(true)
    expect(
      result.operations.some(o => o === 'G07: Title set to MEMBER'),
      `G07 did not set MEMBER. ops:\n${result.operations.join('\n')}`,
    ).toBe(true)
    // ...and that it PERSISTED, not merely that a log line was pushed.
    expect(agents.find(a => a.id === 'agent-j')!.governanceTitle).toBe('member')

    // R4.4's SECOND half — "and the programmer role-plugin" — is deliberately NOT asserted here,
    // and the reason is worth stating so nobody adds it back as an oversight.
    //
    // That half is not ChangeTeam's code at all: G07 hands off to ChangeTitle, whose G15 resolves
    // title→plugin and G16 installs it. That chain is already pinned, adversarially and with its
    // own neuters, in tests/governance/r19-maintainer-title.test.ts (R19.10 + R20.5, which assert
    // the actual `claude plugin install <plugin> <marketplace> --scope local` argv). Re-asserting it
    // through ChangeTeam would need this file to grow a whole plugin-resolution fixture —
    // `listRolePlugins`/`getPluginsForTitle` are stubbed to [] here, so nothing resolves and nothing
    // installs — to re-prove a guard that is already covered. A second, weaker copy of an existing
    // pin is not coverage; it is a second thing to keep true.
    //
    // What ChangeTeam::G07 uniquely owns is the DEFAULT, and that is what the two cases above pin.
  })

  it('VACUITY CONTROL — an explicit role wins, so MEMBER is the default and not a constant', async () => {
    const agents = joinFixture(null)

    const { ChangeTeam } = await import('@/services/element-management-service')
    const result = await ChangeTeam('agent-j', { teamId: 'team-join', role: 'architect' }, OWNER_CTX)

    expect(result.success).toBe(true)
    expect(
      result.operations.some(o => o === 'G07: Title set to ARCHITECT'),
      `an explicitly requested role was overridden. ops:\n${result.operations.join('\n')}`,
    ).toBe(true)
    expect(agents.find(a => a.id === 'agent-j')!.governanceTitle).toBe('architect')
  })
})

describe('ChangeTitle::G17 — a title whose role-plugin cannot be installed is QUARANTINED, not rejected', () => {
  it('TRDD-C9LXXT76: 0 role-plugins after G16 ⇒ roleMissing=true + hibernate — deleting the G17 recovery leaves a titled, role-less, RUNNABLE agent', async () => {
    /**
     * CHARACTERIZATION TEST — it pins what the code DOES, which is NOT what R9.13 SAYS.
     *
     * R9.13 (docs/GOVERNANCE-RULES.md:483) says ChangeTitle "MUST reject any desired state that
     * would leave an agent with zero role-plugins … the agent is never persisted in that state".
     * G17 does not reject: the title is already written (G14), so it retries the install once and,
     * if the agent is still role-less, persists `roleMissing: true` and hibernates it — the same
     * forward-repair ChangePlugin::PG04 uses. The pipeline returns SUCCESS.
     *
     * That contradiction is filed as TRDD-C9LXXT76 and is a GOVERNANCE decision (amend the rule to
     * permit the quarantine, or rewrite the pipeline to reject + roll back). This test takes no
     * side: it pins the CURRENT behaviour so it cannot drift silently while that decision is
     * pending, and it is the acceptance criterion either way — unchanged if the rule moves,
     * rewritten to assert rejection if the code moves.
     *
     * Why it matters that the quarantine is real: R9.13 exists because a persona-less agent could
     * destroy other agents' workdirs or force-merge PRs (all agents share one gh identity). A
     * hibernated agent does none of that, and wakeAgent refuses to wake a roleMissing agent — so
     * losing THIS gate is not cosmetic. Without it the agent stays titled, role-less AND runnable.
     */
    // Hold the array: seedAgents keeps this exact reference and write-through updateAgent
    // mutates it, so it is how we read the persisted record back.
    const agents = [makeAgentRecord({ id: 'agent-a', name: 'agent-a', governanceTitle: null })]
    seedAgents(agents)

    // No settings.local.json exists under the fake agent dir, so the post-G16 re-scan finds 0
    // active role-plugins — the production shape of "the install did not land". The mocked
    // installPluginLocally resolves without writing one, so the single retry cannot recover.
    const { ChangeTitle } = await import('@/services/element-management-service')
    const result = await ChangeTitle('agent-a', 'autonomous', {
      authContext: OWNER_CTX,
      skipRestart: true,
      // NOTE: skipPluginSync deliberately NOT set — it is what gates G15-G17 off, and every
      // other ChangeTitle test in this file sets it, which is exactly why G17 was never covered.
    })

    // The pipeline SUCCEEDS — it does not reject, which is the contradiction being pinned.
    expect(result.success).toBe(true)

    // Pin the REASON, not just the outcome: the recovery must have run and named R9.13.
    expect(result.operations.some(op => /G17: R9\.13 VIOLATION/.test(op))).toBe(true)

    // And it must have QUARANTINED the agent — the half that makes the state safe.
    const quarantined = agents.find(x => x.id === 'agent-a')!
    expect(quarantined.roleMissing).toBe(true)
    expect(quarantined.governanceTitle).toBe('autonomous') // the title WAS persisted
  })
})

describe('DeleteAgent::G01c — the cemetery archive is what makes a soft delete recoverable', () => {
  beforeEach(() => {
    mockExportAgentZip.mockImplementation(async (id: string) => ({
      data: { filename: `${id}-export.zip`, buffer: Buffer.from('zip') },
    }))
  })

  it('archives the MANAGER *before* auto-demoting it, so the zip records `manager`', async () => {
    /**
     * The archive gate used to run AFTER the G02 auto-demotion, while its own comment claimed it
     * "must happen before … cleanup so the archive captures the agent's full state (… title …)".
     * For the one agent whose title matters most, the cemetery zip therefore recorded
     * `autonomous`, and restoring it handed back an agent with the WRONG TITLE — a corruption
     * invisible until someone actually restored, which is the worst time to discover it.
     */
    seedTeams([{ id: 'team-1', name: 'Team One', agentIds: ['agent-x'], chiefOfStaffId: 'agent-x' }])
    seedAgents([
      makeAgentRecord({ id: 'agent-mgr', name: 'agent-mgr', governanceTitle: 'manager' }),
      makeAgentRecord({ id: 'agent-x', name: 'agent-x' }),
    ])
    mockGovernance.getManagerId.mockReturnValue('agent-mgr')
    mockGovernance.isManager.mockImplementation((id: string) => id === 'agent-mgr')

    // Observe the ORDER directly, the way the R18.2 snapshot test does. Reading the title back
    // from the registry would NOT work here and would be VACUOUS: this fixture's ChangeTitle does
    // not write the demotion through, so the archived title reads 'manager' whichever gate ran
    // first — the assertion would pass on the very pipeline it is supposed to reject. G02's
    // isManager() call is the demotion's own first observable act, so the two are directly
    // comparable.
    const order: string[] = []
    mockExportAgentZip.mockImplementation(async (id: string) => {
      order.push('G01c:archive')
      return { data: { filename: `${id}-export.zip`, buffer: Buffer.from('zip') } }
    })
    mockGovernance.isManager.mockImplementation((id: string) => {
      order.push('G02:demote-check')
      return id === 'agent-mgr'
    })

    const { DeleteAgent } = await import('@/services/element-management-service')
    await DeleteAgent('agent-mgr', { authContext: OWNER_CTX, hard: false })

    expect(mockExportAgentZip).toHaveBeenCalledWith('agent-mgr')
    expect(order[0]).toBe('G01c:archive')
    expect(order).toContain('G02:demote-check')
  })

  it('REFUSES the soft delete when the archive fails, and mutates nothing', async () => {
    /**
     * This used to WARN and proceed. "Soft" delete means exactly one thing — it is recoverable —
     * and the zip IS the recovery. Continuing without it does not degrade the operation, it
     * CHANGES it into the irreversible delete the caller did not ask for, and then reports
     * success. Nothing downstream can detect that, because the missing archive was the only
     * evidence. Refusing costs a retry; proceeding costs the agent.
     */
    seedTeams([])
    seedAgents([makeAgentRecord({ id: 'agent-doomed', name: 'agent-doomed', governanceTitle: 'autonomous' })])
    mockGovernance.isManager.mockReturnValue(false)
    mockExportAgentZip.mockResolvedValue({ data: null, error: 'disk full' })

    const { DeleteAgent } = await import('@/services/element-management-service')
    const result = await DeleteAgent('agent-doomed', { authContext: OWNER_CTX, hard: false })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/not be recoverable/i)
    // The agent is still there — the refusal happened before the first mutation.
    expect(mockAgentRegistry.getAgent('agent-doomed')).toBeTruthy()
    expect(mockAgentRegistry.deleteAgent).not.toHaveBeenCalled()
  })

  it('a HARD delete still proceeds with no archive — that asymmetry is deliberate', async () => {
    /** Positive control: `hard: true` is the user explicitly asking for permanence, so demanding
     *  an archive there would contradict the request rather than protect it. Without this, the
     *  refusal test above would also pass on a pipeline that had simply broken all deletes. */
    seedTeams([])
    seedAgents([makeAgentRecord({ id: 'agent-gone', name: 'agent-gone', governanceTitle: 'autonomous' })])
    mockGovernance.isManager.mockReturnValue(false)
    mockExportAgentZip.mockResolvedValue({ data: null, error: 'disk full' })

    const { DeleteAgent } = await import('@/services/element-management-service')
    const result = await DeleteAgent('agent-gone', { authContext: OWNER_CTX, hard: true })

    expect(result.success).toBe(true)
    expect(mockExportAgentZip).not.toHaveBeenCalled()
  })
})

// ============================================================================
// R9.12 — the agent registry is NEVER filtered by governance state
//         (services/agents-core-service.ts listAgents @404-418 — the only
//          filter is `!a.deletedAt`)
//
// NOTE: this rule's "guard" is an ABSENCE, so it cannot be pinned by deleting
// a guard. It is pinned in the opposite direction: the test sets up the most
// hostile governance precondition (no MANAGER, every team blocked, every agent
// a member of a blocked team) and asserts the listing is still complete. Adding
// any governance filter to listAgents — the drift this rule exists to prevent —
// makes it fail.
// ============================================================================
describe('R9.12 — every agent stays visible regardless of MANAGER state (listAgents)', () => {
  it('returns every non-deleted agent with no MANAGER and all teams blocked — the MANAGER gate controls WAKE, never VISIBILITY', async () => {
    seedTeams([{ id: 'team-1', name: 'Team One', agentIds: ['a1', 'a2'], chiefOfStaffId: 'a2', blocked: true }])
    seedAgents([
      makeAgentRecord({ id: 'a1', name: 'a1', governanceTitle: 'member' }),
      makeAgentRecord({ id: 'a2', name: 'a2', governanceTitle: 'chief-of-staff' }),
      makeAgentRecord({ id: 'a3', name: 'a3', governanceTitle: 'autonomous' }),
    ])
    mockGovernance.getManagerId.mockReturnValue(null)

    const { listAgents } = await import('@/services/agents-core-service')
    const res = await listAgents()

    expect(res.status).toBe(200)
    expect((res.data!.agents as Array<{ id: string }>).map(a => a.id).sort()).toEqual(['a1', 'a2', 'a3'])
  })

  it('the ONLY exclusion is a soft-deleted tombstone — proof the listing does filter something, so the assertion above is not vacuous', async () => {
    seedTeams([{ id: 'team-1', name: 'Team One', agentIds: ['a1'], chiefOfStaffId: 'a1', blocked: true }])
    seedAgents([
      makeAgentRecord({ id: 'a1', name: 'a1', governanceTitle: 'chief-of-staff' }),
      makeAgentRecord({ id: 'gone', name: 'gone', deletedAt: '2026-01-02T00:00:00.000Z' }),
    ])
    mockGovernance.getManagerId.mockReturnValue(null)

    const { listAgents } = await import('@/services/agents-core-service')
    const res = await listAgents()

    expect((res.data!.agents as Array<{ id: string }>).map(a => a.id)).toEqual(['a1'])
  })
})
