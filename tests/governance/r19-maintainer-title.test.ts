/**
 * Governance drift tests — R19 (MAINTAINER title) sub-rules that have a REAL
 * code guard inside `ChangeTitle` but were never pinned by any test
 * (docs/GOVERNANCE-ENFORCEMENT-MAP.md rows R19.1, R19.2, R19.3).
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
 * Deliberately OUT of scope, named rather than silently skipped:
 *   - **R19.10** — its citation is `lib/ecosystem-constants.ts:331`, a single
 *     row of the `TITLE_PLUGIN_MAP` const table. A test asserting a table's
 *     contents survives the guard's deletion, so pinning it there would buy a
 *     green column and no coverage. R19.10 also has a SECOND clause (the R17
 *     core-plugin requirement) that nothing cites at all. It needs a
 *     re-citation decision onto the site that ACTS on the binding
 *     (ChangeTitle G15/G16), not a test written against the table.
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
import { rmSync, mkdirSync, writeFileSync } from 'fs'
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
      mockExecFileImpl(args[0], args[1])
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
  mockExecFileImpl.mockImplementation(async () => ({ stdout: '', stderr: '' }))
  mockGovernance.getManagerId.mockReturnValue(null)
  mockGovernance.isManager.mockReturnValue(false)
  mockGovernance.isChiefOfStaffAnywhere.mockReturnValue(false)
  mockGovernance.isUserAuthorityModelEnabled.mockReturnValue(false)
  mockGovernance.loadGovernance.mockReturnValue({ managerId: null, passwordHash: 'stored-hash' })
  mockAgentInvariants.enforceAgentInvariants.mockResolvedValue({
    outcomes: [{ id: 'core-plugin', status: 'ok' }], repaired: [], failed: [],
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
