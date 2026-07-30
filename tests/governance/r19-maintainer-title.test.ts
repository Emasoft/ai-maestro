/**
 * Governance drift tests — R19 (MAINTAINER title) sub-rules that have a REAL
 * code guard inside `ChangeTitle` but were never pinned by any test
 * (docs/GOVERNANCE-ENFORCEMENT-MAP.md rows R19.1, R19.2, R19.3, R19.10).
 *
 * Every test below calls the REAL exported `ChangeTitle` (never a
 * re-implementation, never the guard's own module mocked away) and asserts the
 * REFUSAL the guard produces, by its MESSAGE and by its OPS-TRACE gate label.
 * Asserting only `success === false` would pass on ANY earlier refusal — a
 * missing password, a failed auth gate — so each negative test also pins WHICH
 * gate refused.
 *
 * Two map corrections this file establishes, both by reading the code:
 *
 *   - **R19.2 was recorded UNENFORCED. It is ENFORCED.** `ChangeTitle` Gate 9a
 *     requires `options.githubRepo` and validates it against
 *     `/^[\w.-]+\/[\w.-]+$/` before anything else in the MAINTAINER branch
 *     runs. An UNENFORCED verdict on a live guard is the mirror image of the
 *     usual rot: nothing reddens, because the row claims less than the code
 *     does — so the guard can be deleted and no instrument notices.
 *
 *   - **R19.1's guard is the STANDALONE reverse check**, which the code
 *     comments label as R3 (it was added by SCEN-001 BUG-002). It is the same
 *     block that enforces "a MAINTAINER is NOT a member of any team", and no
 *     R3 row cites it either — so one guard was serving two rules and was
 *     cited by neither.
 *
 *   - **R19.10 was cited at the CONST TABLE, `lib/ecosystem-constants.ts:331`** —
 *     one row of `TITLE_PLUGIN_MAP`. A test asserting a table's contents
 *     survives the deletion of every guard that READS the table, so a pin there
 *     buys a green column and no coverage. The row is re-cited onto the two
 *     gates that ACT on the binding — `ChangeTitle` G15 (selection) and G16
 *     (install) — and pinned by driving the real pipeline with plugin sync ON,
 *     asserting the actual `claude plugin install` argv. R19.10's SECOND clause
 *     (per R17 the core plugin is also required) is enforced OUTSIDE ChangeTitle
 *     — `enforceAgentInvariants`' `core-plugin` row and CreateAgent G11, which
 *     the R17 rows cite — so it is not re-cited here.
 *
 * Deliberately OUT of scope, named rather than silently skipped:
 *   - **`checkMaintainerRepo`'s `a.id !== agentId` self-exclusion** — a neuter run
 *     deleting it left this whole file GREEN, and reading Gate 5 explains why: it
 *     sets `oldTitle` from `agent.governanceTitle` and only overrides when that is
 *     empty, so a registry maintainer always lands in Gate 6's titleUnchanged
 *     branch. Gate 9a is therefore reached only when the subject is NOT a
 *     maintainer, and its own record then fails the `governanceTitle` test anyway.
 *     The clause is defence-in-depth against a future Gate 5 precedence change,
 *     not a live guard — so it stays unpinned ON PURPOSE. A fixture contorted
 *     enough to reach it would be manufacturing coverage for an unreachable branch.
 *
 * Mocking policy in this file:
 *   - ENVIRONMENT is mocked: $HOME-derived state paths, the agent registry,
 *     the governance store, tmux/child_process, the peer-host broadcast.
 *   - GUARDS are never mocked. `ChangeTitle` and everything it calls inside
 *     `services/element-management-service.ts` run for real.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs'
import path from 'path'

// services/element-management-service.ts is ~8,000 lines with a large transitive
// graph; the FIRST test that awaits import() of it pays the whole transform cost,
// which exceeds vitest's 5s default on a cold vite cache. The beforeAll below
// pays it once in a hook so no individual test carries it — the raised budget
// removes a pure infrastructure flake without weakening any assertion.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

// ============================================================================
// Hoisted fake $HOME + state dir. vi.hoisted() runs before vi.mock() factories
// AND before this file's own static imports, which matters because several
// modules under test resolve their paths at MODULE level (e.g.
// lib/team-registry.ts's `const AIMAESTRO_DIR = getStateDir()`).
// ============================================================================
const { FAKE_HOME, FAKE_STATE } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fsSync = require('fs')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const osSync = require('os')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pathSync = require('path')
  const home = fsSync.mkdtempSync(pathSync.join(osSync.tmpdir(), 'r19-home-'))
  const state = fsSync.mkdtempSync(pathSync.join(osSync.tmpdir(), 'r19-state-'))
  fsSync.mkdirSync(pathSync.join(state, 'agents'), { recursive: true })
  fsSync.mkdirSync(pathSync.join(state, 'teams'), { recursive: true })
  return { FAKE_HOME: home, FAKE_STATE: state }
})

// 0-IMPACT, layer 1 — os.homedir(). element-management-service resolves $HOME
// through a STATIC `import { homedir } from 'os'`, which a module mock DOES
// intercept. Everything else on `os` stays real via the spread.
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, default: { ...actual, homedir: () => FAKE_HOME }, homedir: () => FAKE_HOME }
})

// 0-IMPACT, layer 2 — the ~/agents container paths. lib/ecosystem-constants.ts
// resolves homedir() through a RUNTIME require('os') inside each function body,
// which the module mock above does NOT reliably intercept; overriding the PATH
// FUNCTIONS closes the gap however homedir() is reached internally. The override
// list is the SHARED helper rather than a hand-copy: it was copied into 8 files
// and every copy was a chance to omit one override and write the real home. The
// helper also REFUSES a root outside the temp dir, so a mis-wire fails loudly.
vi.mock('@/lib/ecosystem-constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ecosystem-constants')>()
  const { fakeEcosystemPaths } = await import('@/tests/helpers/fake-ecosystem-home')
  return fakeEcosystemPaths(actual, FAKE_HOME, FAKE_STATE)
})

// ============================================================================
// Environment mocks. None of these modules CONTAINS a guard pinned here.
// ============================================================================
const {
  mockAgentRegistry,
  mockGovernance,
  mockExecFileImpl,
  mockRuntime,
  mockAgentInvariants,
  mockHostsConfig,
  mockSessionPersistence,
  mockAmpInboxWriter,
  mockSharedState,
  mockRolePluginService,
  mockAgentLocalConfig,
} = vi.hoisted((): any => ({
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
  mockExecFileImpl: vi.fn(async () => ({ stdout: '', stderr: '' })),
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
    getAgentAMPDir: vi.fn(() => '/tmp/amp/r19'),
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
}))

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
vi.mock('@/lib/governance-sync', () => ({
  broadcastGovernanceSync: vi.fn(async () => undefined),
}))
vi.mock('@/lib/notification-service', () => ({ notifyAgent: vi.fn(async () => undefined) }))

// child_process: preserve every real export, intercept only the call shapes the
// code under test uses (genuine external-process I/O: `tmux …`, `claude plugin …`).
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  const overrides = {
    execFile: (...args: unknown[]) => {
      const cb = args[args.length - 1] as (e: Error | null, r: { stdout: string; stderr: string }) => void
      // args[2] is promisify(execFile)'s OPTIONS object — forwarded because the
      // install double needs its `cwd` to know which agent dir the CLI would
      // have written into.
      mockExecFileImpl(args[0], args[1], args[2])
        .then((r: { stdout: string; stderr: string }) => cb(null, r))
        .catch((err: Error) => cb(err, { stdout: '', stderr: '' }))
    },
    exec: (_c: string, cb: (e: Error | null, r: { stdout: string; stderr: string }) => void) =>
      cb(null, { stdout: '', stderr: '' }),
    execSync: () => { throw new Error('ENOENT (test double)') },
  }
  return { ...actual, ...overrides, default: { ...actual, ...overrides } }
})

// ============================================================================
// Shared helpers
// ============================================================================
const OWNER_CTX = { isSystemOwner: true as const }
const TEAMS_FILE = path.join(FAKE_STATE, 'teams', 'teams.json')
const REGISTRY_FILE = path.join(FAKE_STATE, 'agents', 'registry.json')

/** One recorded external-process invocation (see the child_process mock above). */
type ExecCall = { cmd: unknown; args: unknown }

// Recording array for that double. `mockExecFileImpl` on its own proves only that
// SOMETHING shelled out; the argv is what distinguishes "a role-plugin was
// installed" from "THE maintainer role-plugin was installed", and that distinction
// is the whole of R19.10. It needs no vi.hoisted(): nothing in a vi.mock factory
// touches it — only the implementation installed in beforeEach pushes to it.
const mockExecFileCalls: ExecCall[] = []

type SeedTeam = { id: string; name: string; agentIds: string[]; chiefOfStaffId?: string | null }

/** Write teams.json directly — the REAL team-registry reads from this path. */
function seedTeams(teams: SeedTeam[]): void {
  mkdirSync(path.dirname(TEAMS_FILE), { recursive: true })
  writeFileSync(TEAMS_FILE, JSON.stringify({
    version: '1.0',
    teams: teams.map(t => ({
      type: 'closed', description: '', chiefOfStaffId: null, orchestratorId: null,
      blocked: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      ...t,
    })),
  }, null, 2))
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

function seedAgents(agents: Array<Record<string, unknown>>): void {
  mockAgentRegistry.loadAgents.mockReturnValue(agents)
  mockAgentRegistry.getAgent.mockImplementation((id: string) => agents.find(a => a.id === id) ?? null)
  mockAgentRegistry.getAgentByName.mockImplementation((n: string) => agents.find(a => a.name === n) ?? null)
  // ChangeTitle's G14 proves the write LANDED by re-reading registry.json from disk (via
  // statePath, redirected to FAKE_STATE here) — it deliberately bypasses this module mock, so
  // mocking `@/lib/agent-registry` alone is not enough. Without the file on disk EVERY ChangeTitle
  // fails at G14, and a positive control asserting only "it failed for a different reason" would
  // pass against that failure. That is why the controls below assert success === true.
  const syncRegistryFile = () => {
    mkdirSync(path.dirname(REGISTRY_FILE), { recursive: true })
    writeFileSync(REGISTRY_FILE, JSON.stringify(agents))
  }
  syncRegistryFile()
  mockAgentRegistry.updateAgent.mockImplementation(async (id: string, patch: Record<string, unknown>) => {
    const rec = agents.find(a => a.id === id)
    if (rec) Object.assign(rec, patch)
    syncRegistryFile()
    return rec ?? null // MUST return the record: G14 reads a null return as "registry not written"
  })
}

/** Drive the REAL pipeline. */
async function changeTitle(agentId: string, title: string | null, opts: Record<string, unknown> = {}) {
  const { ChangeTitle } = await import('@/services/element-management-service')
  return ChangeTitle(agentId, title, {
    authContext: OWNER_CTX,
    skipPluginSync: true,
    skipRestart: true,
    ...opts,
  } as never)
}

/** True when the ops trace shows Gate 9a ACCEPTED the maintainer attributes. */
function g9aPassed(ops: string[]): boolean {
  return ops.some(op => /^G9a: MAINTAINER validated/.test(op))
}

// Pay the cold-start module-graph cost ONCE, in a hook. SEQUENTIALLY, and with
// team-registry FIRST: a Promise.all here races the mock factories (several of
// these modules transitively import team-registry), which can non-deterministically
// bind the REAL unwrapped module for some importers.
beforeAll(async () => {
  await import('@/lib/team-registry')
  await import('@/lib/authorization')
  await import('@/services/element-management-service')
})

beforeEach(() => {
  vi.clearAllMocks()
  // clearAllMocks() clears CALLS, not IMPLEMENTATIONS, and it cannot see this
  // array at all — so both are reset by hand, or one test's installs leak into
  // the next test's assertion of "exactly one install".
  mockExecFileCalls.length = 0
  mockExecFileImpl.mockImplementation(async (cmd: unknown, args: unknown, opts: unknown) => {
    mockExecFileCalls.push({ cmd, args })
    // Model the ONE side effect of `claude plugin install` that this pipeline
    // reads back: the agent's enabledPlugins entry. A double that treats the
    // external command as a pure no-op cannot distinguish "installed" from
    // "install left no trace" — and the pipeline CAN: G17 re-scans
    // settings.local.json after G16 and, finding 0 active role-plugins, runs its
    // R9.13 recovery and reinstalls. Without this the run made TWO install calls
    // and every assertion below would have been describing the RECOVERY path
    // while claiming to pin the happy one.
    // The UNINSTALL side effect is deliberately NOT modelled: uninstallPluginLocally
    // deletes the key from settings.local.json itself, as defence in depth.
    const argv = Array.isArray(args) ? (args as string[]) : []
    const cwd = (opts as { cwd?: string } | undefined)?.cwd
    if (cmd === 'claude' && argv[0] === 'plugin' && argv[1] === 'install' && cwd) {
      const file = path.join(cwd, '.claude', 'settings.local.json')
      mkdirSync(path.dirname(file), { recursive: true })
      const cur = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
      cur.enabledPlugins = { ...(cur.enabledPlugins ?? {}), [`${argv[2]}@${argv[3]}`]: true }
      writeFileSync(file, JSON.stringify(cur, null, 2))
    }
    return { stdout: '', stderr: '' }
  })
  mockGovernance.getManagerId.mockReturnValue(null)
  mockGovernance.isManager.mockReturnValue(false)
  mockGovernance.isChiefOfStaffAnywhere.mockReturnValue(false)
  mockGovernance.isUserAuthorityModelEnabled.mockReturnValue(false)
  mockGovernance.loadGovernance.mockReturnValue({ managerId: null, passwordHash: 'stored-hash' })
  mockAgentInvariants.enforceAgentInvariants.mockResolvedValue({
    outcomes: [{ id: 'core-plugin', status: 'ok' }], repaired: [], failed: [],
  })
  mockRuntime.sessionExists.mockResolvedValue(false)
  // MUST be reset by hand. vi.clearAllMocks() clears CALLS, not IMPLEMENTATIONS, so a
  // mockReturnValue set inside one test leaks into every test after it — and this one
  // decides which G15 branch runs. When R20.5's two-compatible-plugins value leaked
  // forward, R12.3's swap test took the KEEP branch instead: no uninstall, no install,
  // and `success === true` the whole way, so only the ops assertion caught it.
  mockRolePluginService.getPluginsForTitle.mockReturnValue([])
  seedAgents([])
  seedTeams([])
})

afterAll(() => {
  rmSync(FAKE_STATE, { recursive: true, force: true })
  rmSync(FAKE_HOME, { recursive: true, force: true })
})

// ============================================================================
// R19.1 — a MAINTAINER is NOT a member of any team.
//
// The guard is the STANDALONE_TITLES reverse check in ChangeTitle's team-membership
// gate. Its own comments label it R3 (it was added by SCEN-001 BUG-002), and no R3
// row cites it — so one block serves two rules and was cited by neither. It matters
// because the FORWARD direction (a team title with no team) was already guarded; the
// reverse silently succeeded, setting agent.team = null while leaving the agent's id
// in team.agentIds. That is registry DRIFT, not a rejected request: the agent reads
// as standalone and the team still counts it as a member.
// ============================================================================
describe('R19.1 — MAINTAINER is a no-team title (ChangeTitle standalone reverse check)', () => {
  it('refuses MAINTAINER while the agent is still in a team — without this the title lands and the agent stays in team.agentIds, so the registry disagrees with itself', async () => {
    seedTeams([{ id: 'team-1', name: 'Team One', agentIds: ['agent-a', 'agent-cos'] }])
    seedAgents([
      makeAgentRecord({ id: 'agent-a', governanceTitle: 'member' }),
      makeAgentRecord({ id: 'agent-cos', name: 'agent-cos', governanceTitle: 'chief-of-staff' }),
    ])

    const r = await changeTitle('agent-a', 'maintainer', { githubRepo: 'Emasoft/some-repo' })

    expect(r.success).toBe(false)
    expect(r.error).toMatch(/standalone title and cannot be assigned while the agent is in a team/i)
    // The refusal names the team the caller must leave first — a bare "not allowed"
    // leaves the operator with no next step.
    expect(r.error).toContain('Team One')
    // It refused AT the standalone check, not incidentally later: the maintainer
    // attribute gate that follows it never ran.
    expect(g9aPassed(r.operations)).toBe(false)
  })

  it('positive control — the SAME agent takes MAINTAINER once it is in no team (the guard blocks team membership, not the title)', async () => {
    seedTeams([{ id: 'team-1', name: 'Team One', agentIds: ['agent-cos'] }])
    seedAgents([
      makeAgentRecord({ id: 'agent-a', governanceTitle: 'member' }),
      makeAgentRecord({ id: 'agent-cos', name: 'agent-cos', governanceTitle: 'chief-of-staff' }),
    ])

    const r = await changeTitle('agent-a', 'maintainer', { githubRepo: 'Emasoft/some-repo' })

    // Asserting `error` merely differs would pass against a G14 persistence failure
    // too, so the control asserts the operation SUCCEEDED.
    expect(r.success).toBe(true)
    expect(r.error).toBeUndefined()
    expect(g9aPassed(r.operations)).toBe(true)
  })
})

// ============================================================================
// R19.2 — MAINTAINER requires a `githubRepo` in "owner/repo" form.
//
// MAP CORRECTION: this row read UNENFORCED. The guard is live in Gate 9a and runs
// before the uniqueness check. An UNENFORCED verdict over a live guard is the
// mirror image of a stale citation: the row claims LESS than the code does, so
// deleting the guard reddens nothing and no instrument ever reports the loss.
// ============================================================================
describe('R19.2 — MAINTAINER requires a githubRepo (ChangeTitle Gate 9a) — map said UNENFORCED', () => {
  it('refuses MAINTAINER with no githubRepo — the title is defined by the repo it maintains, so a repo-less MAINTAINER has nothing to patrol', async () => {
    seedAgents([makeAgentRecord({ id: 'agent-a' })])

    const r = await changeTitle('agent-a', 'maintainer')

    expect(r.success).toBe(false)
    expect(r.error).toMatch(/MAINTAINER requires a githubRepo/i)
    expect(g9aPassed(r.operations)).toBe(false)
  })

  it('refuses a malformed githubRepo — "owner/repo" is the shape every downstream gh call assumes', async () => {
    seedAgents([makeAgentRecord({ id: 'agent-a' })])

    const r = await changeTitle('agent-a', 'maintainer', { githubRepo: 'not-a-repo' })

    expect(r.success).toBe(false)
    expect(r.error).toMatch(/Invalid githubRepo format/i)
    // The rejected value is echoed back, so the operator sees what was parsed.
    expect(r.error).toContain('not-a-repo')
    expect(g9aPassed(r.operations)).toBe(false)
  })

  it('positive control — a well-formed owner/repo passes Gate 9a and is persisted on the agent', async () => {
    const agents = [makeAgentRecord({ id: 'agent-a' })]
    seedAgents(agents)

    const r = await changeTitle('agent-a', 'maintainer', { githubRepo: 'Emasoft/ai-maestro' })

    expect(r.success).toBe(true)
    expect(g9aPassed(r.operations)).toBe(true)
    // The gate does not merely accept the value, it STORES it — the uniqueness
    // check in R19.3 below reads exactly this field on the next assignment.
    expect(agents[0].githubRepo).toBe('Emasoft/ai-maestro')
  })
})

// ============================================================================
// R19.3 — one MAINTAINER per repository per host.
//
// The guard reads the FULL agent records (loadAgents), not the summaries: an
// earlier version used listAgents(), whose AgentSummary strips governanceTitle and
// githubRepo — so every comparison saw `undefined === 'Emasoft/x'` and the
// uniqueness check passed for every input while looking like it ran
// (SCEN-018 BUG-R19.3-UNIQUENESS-001). That is why the negative test here asserts
// the refusal NAMES the incumbent: a guard reading stripped records cannot.
// ============================================================================
describe('R19.3 — one MAINTAINER per repo per host (ChangeTitle Gate 9a)', () => {
  it('refuses a second MAINTAINER for a repo another agent already owns, naming the incumbent — a guard reading stripped summaries would silently allow it', async () => {
    seedAgents([
      makeAgentRecord({ id: 'agent-a' }),
      makeAgentRecord({
        id: 'agent-keeper', name: 'agent-keeper',
        governanceTitle: 'maintainer', githubRepo: 'Emasoft/ai-maestro',
      }),
    ])

    const r = await changeTitle('agent-a', 'maintainer', { githubRepo: 'Emasoft/ai-maestro' })

    expect(r.success).toBe(false)
    expect(r.error).toMatch(/already maintained by/i)
    expect(r.error).toContain('agent-keeper')
    expect(g9aPassed(r.operations)).toBe(false)
  })

  it('positive control — a DIFFERENT repo is accepted while the first MAINTAINER keeps its own (the rule is per-repo, not per-host)', async () => {
    seedAgents([
      makeAgentRecord({ id: 'agent-a' }),
      makeAgentRecord({
        id: 'agent-keeper', name: 'agent-keeper',
        governanceTitle: 'maintainer', githubRepo: 'Emasoft/ai-maestro',
      }),
    ])

    const r = await changeTitle('agent-a', 'maintainer', { githubRepo: 'Emasoft/other-project' })

    expect(r.success).toBe(true)
    expect(g9aPassed(r.operations)).toBe(true)
  })

  it('a SOFT-DELETED maintainer does not hold its repo hostage — the guard filters on deletedAt, or a deleted agent locks a repo forever', async () => {
    seedAgents([
      makeAgentRecord({ id: 'agent-a' }),
      makeAgentRecord({
        id: 'agent-gone', name: 'agent-gone',
        governanceTitle: 'maintainer', githubRepo: 'Emasoft/ai-maestro',
        deletedAt: '2026-07-01T00:00:00.000Z',
      }),
    ])

    const r = await changeTitle('agent-a', 'maintainer', { githubRepo: 'Emasoft/ai-maestro' })

    expect(r.success).toBe(true)
    expect(g9aPassed(r.operations)).toBe(true)
  })

  it('re-asserting MAINTAINER with the SAME repo is a true no-op — Gate 6 short-circuits before Gate 9a, so nothing is re-validated and nothing is rewritten', async () => {
    seedAgents([
      makeAgentRecord({
        id: 'agent-a', governanceTitle: 'maintainer', githubRepo: 'Emasoft/ai-maestro',
      }),
    ])

    const r = await changeTitle('agent-a', 'maintainer', { githubRepo: 'Emasoft/ai-maestro' })

    expect(r.success).toBe(true)
    // Gate 6 answered, so Gate 9a never ran. Asserting this rather than assuming
    // it: the no-op path is exactly what USED to swallow a repo re-point (below).
    expect(r.operations.some(op => /^G06: Title already "maintainer" — no change/.test(op))).toBe(true)
    expect(g9aPassed(r.operations)).toBe(false)
  })
})

// ============================================================================
// R19.2 / R19.3 on an ALREADY-MAINTAINER agent — the silent-drop regression.
//
// Found while pinning the rules above. `ChangeTitle`'s Gate 6 returns
// `success: true` the moment the TITLE is unchanged, and Gate 9a is the ONLY
// writer of `githubRepo` — so re-pointing an existing MAINTAINER at a different
// repository validated nothing, stored nothing, and reported success. The PATCH
// route sealed it from the other side: `agents-core-service` called ChangeTitle
// only `if (oldTitle !== newTitle)` while deliberately stripping githubRepo from
// its own updateAgent body, so the field's single source of truth was unreachable
// in exactly the case where it was the only thing changing. 200 OK, stale record,
// no log line — a missing write produces a SUCCESS, not an error.
//
// These four tests are the regression gate. The first two FAIL against the
// pre-fix code (it reported success and stored nothing); the refusal cases prove
// the repo-only path is validated by the SAME predicate as a title transition,
// not by a second copy that can drift.
// ============================================================================
describe('R19.2 / R19.3 — re-pointing an existing MAINTAINER at another repo (ChangeTitle Gate 6b)', () => {
  it('STORES the new repo instead of silently dropping it — the pre-fix pipeline answered success and wrote nothing', async () => {
    const agents = [
      makeAgentRecord({
        id: 'agent-a', governanceTitle: 'maintainer', githubRepo: 'Emasoft/old-repo',
      }),
    ]
    seedAgents(agents)

    const r = await changeTitle('agent-a', 'maintainer', { githubRepo: 'Emasoft/new-repo' })

    expect(r.success).toBe(true)
    // The load-bearing assertion: the value actually LANDED. `success === true`
    // was already true before the fix, so only the stored field distinguishes
    // "applied" from "silently dropped".
    expect(agents[0].githubRepo).toBe('Emasoft/new-repo')
    expect(r.operations.some(op => /^G06b: Title unchanged — MAINTAINER repo re-pointed to "Emasoft\/new-repo"/.test(op))).toBe(true)
  })

  it('refuses a malformed repo on the repo-only path — the same format predicate as a title transition, not a second copy', async () => {
    const agents = [
      makeAgentRecord({
        id: 'agent-a', governanceTitle: 'maintainer', githubRepo: 'Emasoft/old-repo',
      }),
    ]
    seedAgents(agents)

    const r = await changeTitle('agent-a', 'maintainer', { githubRepo: 'garbage' })

    expect(r.success).toBe(false)
    expect(r.error).toMatch(/Invalid githubRepo format/i)
    // Refused means UNCHANGED — a rejected value must not be half-written.
    expect(agents[0].githubRepo).toBe('Emasoft/old-repo')
  })

  it('refuses a re-point onto a repo another active MAINTAINER already owns — uniqueness holds on this path too, or the repo-only route is the way around R19.3', async () => {
    const agents = [
      makeAgentRecord({
        id: 'agent-a', governanceTitle: 'maintainer', githubRepo: 'Emasoft/old-repo',
      }),
      makeAgentRecord({
        id: 'agent-keeper', name: 'agent-keeper',
        governanceTitle: 'maintainer', githubRepo: 'Emasoft/taken-repo',
      }),
    ]
    seedAgents(agents)

    const r = await changeTitle('agent-a', 'maintainer', { githubRepo: 'Emasoft/taken-repo' })

    expect(r.success).toBe(false)
    expect(r.error).toMatch(/already maintained by/i)
    expect(r.error).toContain('agent-keeper')
    expect(agents[0].githubRepo).toBe('Emasoft/old-repo')
  })

  it('a repo re-point does NOT request a restart — it is agent data, and claiming restartNeeded would bounce a live session for nothing', async () => {
    seedAgents([
      makeAgentRecord({
        id: 'agent-a', governanceTitle: 'maintainer', githubRepo: 'Emasoft/old-repo',
      }),
    ])

    const r = await changeTitle('agent-a', 'maintainer', { githubRepo: 'Emasoft/new-repo' })

    expect(r.success).toBe(true)
    expect(r.restartNeeded).toBe(false)
  })
})

// ============================================================================
// R19.10 — the MAINTAINER title is BOUND to the ai-maestro-maintainer-agent
// role-plugin.
//
// MAP RE-CITATION. The row cited `lib/ecosystem-constants.ts:331` — ONE line of
// the TITLE_PLUGIN_MAP const table. A table is not a guard: delete G15 and G16
// and that line still reads exactly the same, so a test written against it stays
// green while the binding stops being applied to a single agent. The binding is
// only real where something ACTS on it, so the row now cites the two gates that
// do: G15 RESOLVES title → plugin, G16 INSTALLS it.
//
// These are the only tests in this file that do NOT pass skipPluginSync — every
// other test here suppresses G15/G16 precisely because they shell out. The
// external command is safe to let run because child_process is doubled; what
// reaches it is recorded in mockExecFileCalls and asserted verbatim.
// ============================================================================
describe('R19.10 — MAINTAINER is bound to ai-maestro-maintainer-agent (ChangeTitle G15/G16)', () => {
  /** The `claude plugin install …` invocations this pipeline run actually made. */
  function installCalls(): ExecCall[] {
    return mockExecFileCalls.filter(c =>
      c.cmd === 'claude' && Array.isArray(c.args) && c.args[0] === 'plugin' && c.args[1] === 'install')
  }

  it('assigning MAINTAINER installs the maintainer role-plugin — asserted on the real `claude plugin install` argv, so removing G15 or G16 reddens this where a const-table assertion would not', async () => {
    seedAgents([makeAgentRecord({ id: 'agent-a' })])

    const r = await changeTitle('agent-a', 'maintainer', {
      githubRepo: 'Emasoft/ai-maestro',
      skipPluginSync: false,
    })

    expect(r.success).toBe(true)
    // G15 RESOLVED the binding …
    expect(r.operations.some(op =>
      /^G15: Selected compatible plugin "ai-maestro-maintainer-agent" for MAINTAINER/.test(op))).toBe(true)
    // … and G16 ACTED on it.
    expect(r.operations.some(op =>
      /^G16: Installed role-plugin "ai-maestro-maintainer-agent"/.test(op))).toBe(true)
    expect(r.installedPlugin).toBe('ai-maestro-maintainer-agent')

    // The load-bearing assertion. An ops line is written by the same function that
    // would still write it if the install were skipped; the argv can only exist
    // because the CLI was genuinely invoked with this plugin name.
    const calls = installCalls()
    expect(calls).toHaveLength(1)
    const argv = calls[0].args as string[]
    expect(argv[2]).toBe('ai-maestro-maintainer-agent')
    // Local scope, never user scope: a role-plugin installed globally would bind
    // every agent on this client to the MAINTAINER persona (R17.8 / R20.20).
    expect(argv).toContain('--scope')
    expect(argv).toContain('local')
  })

  it('a DIFFERENT title installs a DIFFERENT plugin — the name is resolved from the title, not hardcoded (without this control the test above also passes on a pipeline that installs one fixed plugin for everyone)', async () => {
    seedAgents([makeAgentRecord({ id: 'agent-a' })])

    const r = await changeTitle('agent-a', 'autonomous', { skipPluginSync: false })

    expect(r.success).toBe(true)
    const calls = installCalls()
    expect(calls).toHaveLength(1)
    expect((calls[0].args as string[])[2]).toBe('ai-maestro-autonomous-agent')
  })

  // R20.5's SECOND clause. The rule is "the default role-plugin MUST be installed
  // automatically when the title is granted, UNLESS the user (or a privileged
  // caller) explicitly picks a different COMPATIBLE role-plugin". ChangeTitle has
  // no option for that pick — the mechanism by which an earlier explicit pick
  // SURVIVES a title grant is G15's keep-branch, and that branch was cited by
  // nothing and driven by nothing. Two clauses, two sites; pinning only the
  // auto-install half would leave the "unless" enforceable-on-paper only.
  it('an already-installed COMPATIBLE plugin is KEPT, not replaced by the default — this is the whole of R20.5\'s "unless the user picks a different compatible role-plugin"', async () => {
    // The N:1 model: a plugin whose .agent.toml declares compatible-titles
    // ["MEMBER","MAINTAINER"] is a legitimate MAINTAINER choice, so granting
    // MAINTAINER must not force the default over the operator's standing pick.
    // ORDER MATTERS, and getting it wrong makes this test vacuous: G15's else-branch
    // picks compatibles[0]. With the standing pick listed FIRST, deleting the
    // keep-branch would select the same plugin anyway and the test would stay green
    // over a deleted guard. The DEFAULT goes first, so the keep-branch is the only
    // thing that can produce the expected outcome.
    mockRolePluginService.getPluginsForTitle.mockReturnValue([
      { name: 'ai-maestro-maintainer-agent', marketplace: 'ai-maestro-plugins' },
      { name: 'ai-maestro-programmer-agent', marketplace: 'ai-maestro-plugins' },
    ])
    const agentDir = path.join(FAKE_HOME, 'agents', 'agent-a')
    const settingsFile = path.join(agentDir, '.claude', 'settings.local.json')
    mkdirSync(path.dirname(settingsFile), { recursive: true })
    writeFileSync(settingsFile, JSON.stringify({
      enabledPlugins: { 'ai-maestro-programmer-agent@ai-maestro-plugins': true },
    }))
    seedAgents([makeAgentRecord({ id: 'agent-a', governanceTitle: 'member' })])

    const r = await changeTitle('agent-a', 'maintainer', {
      githubRepo: 'Emasoft/ai-maestro',
      skipPluginSync: false,
    })

    expect(r.success).toBe(true)
    expect(r.operations.some(op =>
      /^G15: Current plugin "ai-maestro-programmer-agent" is compatible with MAINTAINER — keeping/.test(op))).toBe(true)
    // The load-bearing half: nothing was installed OVER the standing pick. An ops
    // line alone would not distinguish "kept" from "kept, then replaced anyway".
    expect(installCalls()).toHaveLength(0)
    expect(r.installedPlugin).toBeNull()
  })
})

// ============================================================================
// R12.3 — a role-plugin serves ONE role, so an agent can never hold two at once
// ("an agent cannot simultaneously serve as COS and ARCHITECT").
//
// MAP CORRECTION, of a kind the ratchet cannot detect. The row read
// `:3149-3152 (ChangeTitle::G15)` — and 3149-3152 is squarely inside **G14d**. The
// range named one gate and the qualifier named another, and the qualifier check
// passed anyway because it proves the LABEL exists somewhere in the pipeline, never
// that the cited range contains it. Reading the trace settled which is right:
//
//   G14d: Uninstalled "ai-maestro-programmer-agent@..." (bound to old title "member")
//   G15:  Cleaned stale role-plugins          <- the no-incumbent branch, not the swap
//
// So on a title CHANGE the enforcer is G14d: it uninstalls EVERY enabled role-plugin
// not compatible with the new title, which leaves G15 nothing to swap. G15's swap
// branch is still reachable — and still load-bearing — in the case G14d declines:
// an agent with NO old title carrying a stale role-plugin. Two paths to one
// guarantee, so both are cited and both are driven.
//
// Each test's load-bearing assertion is the END STATE. An "Uninstalled" ops line is
// written by the same code that would still write it if the uninstall silently
// failed, and R12.3 is a claim about HOW MANY role-plugins are active — so count them.
// ============================================================================
describe('R12.3 — one role-plugin at a time (ChangeTitle G14d + G15)', () => {
  const agentDir = path.join(FAKE_HOME, 'agents', 'agent-a')
  const settingsFile = path.join(agentDir, '.claude', 'settings.local.json')

  function seedInstalledPlugin(name: string): void {
    mkdirSync(path.dirname(settingsFile), { recursive: true })
    writeFileSync(settingsFile, JSON.stringify({
      enabledPlugins: { [`${name}@ai-maestro-plugins`]: true },
    }))
  }

  /** The role-plugins actually enabled in the agent's settings after the run. */
  function activeRolePlugins(): string[] {
    const after = JSON.parse(readFileSync(settingsFile, 'utf8')) as {
      enabledPlugins: Record<string, boolean>
    }
    return Object.keys(after.enabledPlugins)
      .filter(k => after.enabledPlugins[k])
      .map(k => k.split('@')[0])
      .filter(n => n.startsWith('ai-maestro-') && n !== 'ai-maestro-plugin')
  }

  it('changing title uninstalls the incumbent bound to the OLD title (G14d) — the end state has exactly one role-plugin, which is the whole rule', async () => {
    seedInstalledPlugin('ai-maestro-programmer-agent')
    seedAgents([makeAgentRecord({ id: 'agent-a', governanceTitle: 'member' })])

    // getPluginsForTitle stays [] (the beforeEach default), so `compatibles` is the
    // hardcoded MAINTAINER default alone — the incumbent is NOT compatible with the
    // new title, which is what makes G14d schedule it for uninstall instead of
    // keeping it (R20.5's keep-branch, pinned above).
    const r = await changeTitle('agent-a', 'maintainer', {
      githubRepo: 'Emasoft/ai-maestro',
      skipPluginSync: false,
    })

    expect(r.success).toBe(true)
    expect(r.operations.some(op =>
      /^G14d: Uninstalled "ai-maestro-programmer-agent@ai-maestro-plugins" \(bound to old title "member"\)/.test(op))).toBe(true)
    expect(r.installedPlugin).toBe('ai-maestro-maintainer-agent')
    // Asserting only that the NEW plugin arrived would pass on exactly the state
    // this rule forbids — both installed at once.
    expect(activeRolePlugins()).toEqual(['ai-maestro-maintainer-agent'])
  })

  it('a stale role-plugin on an agent with NO old title is swept by G15 — G14d declines (it needs an old title), so this is the path that would leave two installed if the swap branch went away', async () => {
    seedInstalledPlugin('ai-maestro-architect-agent')
    seedAgents([makeAgentRecord({ id: 'agent-a', governanceTitle: null })])

    const r = await changeTitle('agent-a', 'maintainer', {
      githubRepo: 'Emasoft/ai-maestro',
      skipPluginSync: false,
    })

    expect(r.success).toBe(true)
    expect(r.operations.some(op =>
      /^G15: Uninstalled old role-plugin "ai-maestro-architect-agent"/.test(op))).toBe(true)
    expect(r.uninstalledPlugin).toBe('ai-maestro-architect-agent')
    expect(r.installedPlugin).toBe('ai-maestro-maintainer-agent')
    expect(activeRolePlugins()).toEqual(['ai-maestro-maintainer-agent'])
  })
})
