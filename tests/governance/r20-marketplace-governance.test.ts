// @vitest-environment jsdom
/**
 * Governance drift tests — R20 (Marketplace Governance) sub-rules that already
 * have a REAL code guard but were never pinned by any test
 * (docs/GOVERNANCE-ENFORCEMENT-MAP.md rows R20.1, R20.2, R20.4, R20.5, R20.6,
 * R20.8, R20.9, R20.13, R20.14, R20.15, R20.16, R20.18, R20.19, R20.20, R20.22,
 * R20.23, R20.24, R20.25, R20.26, R20.29, R20.31).
 *
 * Every test below calls the REAL exported function that implements the rule
 * (never a re-implementation, never the guard's own module mocked away) and
 * asserts the REFUSAL / real behavior the guard produces. If the guard is
 * deleted, weakened, or its wiring is changed, the corresponding test fails.
 *
 * Mocking policy in this file:
 *   - ENVIRONMENT is mocked: $HOME (so nothing touches the developer's real
 *     ~/agents or ~/.claude), the agent registry, the three identity-token
 *     STORES that agent-auth consults, tmux/child_process.
 *   - GUARDS are never mocked. `@/lib/ecosystem-constants` is a PARTIAL mock
 *     built with importOriginal(): every naming/constant export the guards read
 *     (customMarketplaceDirName, TITLE_PLUGIN_MAP, MARKETPLACE_NAME, …) stays
 *     REAL; only the $HOME-derived PATH FUNCTIONS are redirected at a tmpdir.
 *
 * NOT pinned here — reported as such rather than faked (see the batch report):
 *   - R20.28 — its only enforcement is `install-messaging.sh` (a shell script).
 *     A vitest assertion could only grep the script's TEXT, which pins the text
 *     and not the behaviour. The five canonical folder PATTERNS it must produce
 *     are pinned instead, at their TypeScript single source of truth, by the
 *     R20.1 block below.
 *   - R20.30 — its guard is a React component (components/agent-profile/
 *     PluginsTab.tsx handleUninstall). This file runs in vitest's `node`
 *     environment; rendering needs the jsdom environment, which is a per-FILE
 *     setting, so it cannot coexist with the fs/service tests here.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'fs'
import path from 'path'

// services/element-management-service.ts is ~7,500 lines and pulls in a large
// transitive graph; the FIRST test that awaits `import(...)` of it pays the
// whole transform+load cost, which can exceed vitest's 5s default on a cold
// vite cache. The beforeAll below pays it ONCE, in a hook — the raised budget
// only removes the cold-start flake, it weakens no assertion.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

// ============================================================================
// Hoisted fake $HOME + state dir.
//
// vi.hoisted() runs before vi.mock() factories AND before this file's static
// imports, which matters because several modules under test read their paths
// at MODULE level (element-management-service.ts:81 `const HOME = homedir()`,
// plugin-storage-service.ts:62-73 `const CUSTOM_PLUGINS_DIR = get...Path()`).
// ============================================================================
const { FAKE_HOME, FAKE_STATE } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fsSync = require('fs')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const osSync = require('os')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pathSync = require('path')
  const home = fsSync.mkdtempSync(pathSync.join(osSync.tmpdir(), 'r20-home-'))
  const state = fsSync.mkdtempSync(pathSync.join(osSync.tmpdir(), 'r20-state-'))
  fsSync.mkdirSync(pathSync.join(state, 'agents'), { recursive: true })
  return { FAKE_HOME: home, FAKE_STATE: state }
})

// 0-IMPACT, layer 1 — os.homedir().
// element-management-service, plugin-storage-service and agent-local-config-service
// all resolve $HOME through a STATIC `import { homedir } from 'os'`, which a
// module mock DOES intercept. Everything else on `os` (tmpdir, platform, …)
// stays real via the spread.
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, default: { ...actual, homedir: () => FAKE_HOME }, homedir: () => FAKE_HOME }
})

// 0-IMPACT, layer 2 — the ~/agents container paths.
// lib/ecosystem-constants.ts resolves homedir() through a RUNTIME require('os')
// INSIDE each function body, which the module mock above does NOT reliably
// intercept. Overriding the PATH FUNCTIONS themselves closes the gap regardless
// of how homedir() is resolved internally. Every other export — the naming
// builders and constant maps the R20.1 / R20.4 guards under test actually read —
// stays REAL via the `...actual` spread.
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
      p.join(agentsBase, 'custom-plugins', actual.customMarketplaceDirName(client)),
    getRoleMarketplacePathForClient: (client: string) =>
      p.join(agentsBase, 'role-plugins', actual.rolesMarketplaceDirName(client)),
    getCoreMarketplacePathForClient: (client: string) =>
      p.join(agentsBase, 'core-plugins', actual.coreMarketplaceDirName(client)),
    getLocalMarketplacePath: () => p.join(agentsBase, 'role-plugins'),
    getCustomMarketplacePath: () => p.join(agentsBase, 'custom-plugins'),
  }
})

// ============================================================================
// Environment mocks. None of these modules CONTAINS a guard pinned in this file.
// ============================================================================
const {
  mockAgentRegistry,
  mockExecFileCalls,
  mockExecFileImpl,
  mockAidToken,
  mockAmpAuth,
  mockSessionAuth,
  mockSessionSecret,
  mockSecurityConfig,
  mockAidLedger,
  mockUserRegistry,
  mockHostsConfig,
  mockAdapterInstall,
  mockSudoFetch,
} = vi.hoisted((): any => {
  const execFileCalls: Array<{ cmd: unknown; args: unknown }> = []
  return {
    mockAgentRegistry: {
      getAgent: vi.fn(() => null),
      getAgentByName: vi.fn(() => null),
      getAgentBySession: vi.fn(() => null),
      normalizeHostId: vi.fn((h?: string) => (h ?? '').toLowerCase()),
      loadAgents: vi.fn(() => []),
      saveAgents: vi.fn(),
      createAgent: vi.fn(),
      updateAgent: vi.fn(async () => undefined),
      deleteAgent: vi.fn(() => true),
      linkSession: vi.fn(),
      unlinkSession: vi.fn(),
    },
    mockExecFileCalls: execFileCalls,
    mockExecFileImpl: vi.fn(async (cmd: unknown, args: unknown) => {
      execFileCalls.push({ cmd, args })
      return { stdout: '', stderr: '' }
    }),
    // The three IDENTITY AUTHORITIES agent-auth delegates to (R20.16). These are
    // the token STORES, not the routing guard — the guard is authenticateAgent's
    // own dispatch + refusal logic, which stays 100% real.
    mockAidToken: { validateGovernanceToken: vi.fn(() => null) },
    mockAmpAuth: { authenticateRequest: vi.fn(() => ({ authenticated: false, message: 'no key' })) },
    mockSessionAuth: {
      extractSessionFromCookie: vi.fn(() => null),
      validateSessionWithUser: vi.fn(() => ({ valid: false })),
    },
    mockSessionSecret: {
      isSessionSecret: vi.fn((t: string) => t.startsWith('mst_')),
      validateSessionSecret: vi.fn(() => null),
    },
    mockSecurityConfig: {
      loadSecurityConfig: vi.fn(() => ({
        ledger: { enforceAidAssociation: false },
        agentCreation: { maxAgentsPerHost: 0, maxAgentsPerRequester: 0 },
      })),
    },
    mockAidLedger: { isAidAssociated: vi.fn(() => true), recordAidRevocation: vi.fn() },
    mockUserRegistry: { getUser: vi.fn(() => null) },
    // The per-client plugin adapter shells out to a foreign CLI / writes the
    // client's own state — a genuine external boundary, never a guard here.
    mockAdapterInstall: vi.fn(async () => undefined),
    // R20.30 transport double. The GUARD is the request PluginsTab builds; this
    // only stops it hitting the network so the payload can be asserted verbatim.
    mockSudoFetch: vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    mockHostsConfig: {
      getHosts: vi.fn(() => [{ id: 'test-host', name: 'Test', url: 'http://localhost:23000' }]),
      getSelfHost: vi.fn(() => ({ id: 'test-host', name: 'Test', url: 'http://localhost:23000' })),
      getSelfHostId: vi.fn(() => 'test-host'),
      isSelf: vi.fn(() => true),
    },
  }
})

vi.mock('@/lib/agent-registry', () => mockAgentRegistry)
vi.mock('@/lib/aid-token', () => mockAidToken)
vi.mock('@/lib/amp-auth', () => mockAmpAuth)
vi.mock('@/lib/session-auth', () => mockSessionAuth)
vi.mock('@/lib/session-secret', () => mockSessionSecret)
vi.mock('@/lib/security-config', () => mockSecurityConfig)
vi.mock('@/lib/aid-ledger-authority', () => mockAidLedger)
vi.mock('@/lib/user-registry', () => mockUserRegistry)
vi.mock('@/lib/hosts-config', () => mockHostsConfig)
// agent-auth.ts uses RELATIVE specifiers ('./aid-token', …). Vitest resolves a
// mock by resolved module id, so the '@/...' aliases above already cover them —
// but agent-auth also `require()`s './governance' and './user-registry' lazily,
// which is why both shapes are declared.
vi.mock('@/lib/governance', () => ({
  loadGovernance: vi.fn(() => ({ managerId: null, passwordHash: 'stored-hash' })),
  isManager: vi.fn(() => false),
  isChiefOfStaffAnywhere: vi.fn(() => false),
  getManagerId: vi.fn(() => null),
  isUserAuthorityModelEnabled: vi.fn(() => false),
}))
vi.mock('@/lib/ibct', () => ({ verifyCompactIbct: vi.fn(async () => null) }))
vi.mock('@/lib/sudo-fetch', () => ({ sudoFetch: mockSudoFetch }))
vi.mock('@/contexts/SudoContext', () => ({
  useSudo: () => ({ requestSudoToken: vi.fn(async () => 'sudo-token'), reportSudoError: vi.fn() }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}))
vi.mock('@/lib/client-plugin-adapters', () => ({
  getAdapter: vi.fn(async () => ({
    install: mockAdapterInstall,
    uninstall: vi.fn(async () => undefined),
  })),
}))

// child_process: preserve every real export, intercept only the call shapes the
// code under test uses (all genuine external-process I/O: `claude plugin ...`).
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
  // A `default` key is required as well as the named exports: some consumers
  // (and the jsdom environment's own resolution) reach for the CJS default.
  return { ...actual, ...overrides, default: { ...actual, ...overrides } }
})

// ============================================================================
// Helpers
// ============================================================================
const AGENTS_BASE = path.join(FAKE_HOME, 'agents')
const ROLE_CONTAINER = path.join(AGENTS_BASE, 'role-plugins')
const CUSTOM_CONTAINER = path.join(AGENTS_BASE, 'custom-plugins')
const CORE_CONTAINER = path.join(AGENTS_BASE, 'core-plugins')

function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(value, null, 2))
}

/**
 * Materialise a minimal but REAL Claude plugin under the fake ~/.claude plugin
 * cache, so plugin-storage-service's own findSourcePluginDir() locates it and
 * the REAL Claude parser can parse it. `agentToml` present ⇒ role-plugin
 * (universal-ir.ts sets meta.is_role_plugin from project.agentProfile).
 */
function seedSourcePlugin(name: string, opts: { role?: boolean } = {}): string {
  const dir = path.join(FAKE_HOME, '.claude', 'plugins', 'cache', 'seed-mkt', name, '1.0.0')
  mkdirSync(dir, { recursive: true })
  writeJson(path.join(dir, '.claude-plugin', 'plugin.json'), {
    name,
    version: '1.0.0',
    description: `${name} fixture`,
  })
  mkdirSync(path.join(dir, 'skills', 'demo'), { recursive: true })
  writeFileSync(
    path.join(dir, 'skills', 'demo', 'SKILL.md'),
    '---\nname: demo\ndescription: demo skill fixture\n---\n\nBody.\n',
  )
  if (opts.role) {
    writeFileSync(
      path.join(dir, `${name}.agent.toml`),
      [
        '[agent]',
        `name = "${name}"`,
        'description = "fixture role plugin"',
        'compatible-titles = ["MEMBER"]',
        'compatible-clients = ["claude", "codex"]',
        '',
      ].join('\n'),
    )
    mkdirSync(path.join(dir, 'agents'), { recursive: true })
    writeFileSync(
      path.join(dir, 'agents', `${name}-main-agent.md`),
      `---\nname: ${name}-main-agent\ndescription: fixture main agent\n---\n\nPersona.\n`,
    )
  }
  return dir
}

/**
 * Materialise an INSTALLED plugin in the fake client cache, at the
 * `<marketplace>/<name>/<version>/` shape resolvePluginKeyToPath() expects.
 */
function seedInstalledPlugin(name: string, marketplace = 'ai-maestro-plugins'): string {
  const dir = path.join(FAKE_HOME, '.claude', 'plugins', 'cache', marketplace, name, '1.0.0')
  mkdirSync(dir, { recursive: true })
  writeJson(path.join(dir, '.claude-plugin', 'plugin.json'), {
    name, version: '1.0.0', description: `${name} installed fixture`,
  })
  return dir
}

/** Recursively collect every file path under `root` (relative to it). */
function walk(root: string, prefix = ''): string[] {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readdirSync } = require('fs') as typeof import('fs')
  if (!existsSync(root)) return []
  const out: string[] = []
  for (const e of readdirSync(root, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...walk(path.join(root, e.name), rel))
    else out.push(rel)
  }
  return out
}

const SYSTEM_AUTH = { isSystemOwner: true as const }

/** One recorded external-process invocation (see the child_process mock above). */
type ExecCall = { cmd: unknown; args: unknown }

// Pay the cold-start module-graph cost ONCE, in a hook, and SEQUENTIALLY:
// a Promise.all here races the partial-mock factories (several of these modules
// transitively import ecosystem-constants), which can non-deterministically bind
// the REAL, unredirected path helpers for some importers — the exact failure
// mode that writes into the developer's real ~/agents.
beforeAll(async () => {
  await import('@/lib/ecosystem-constants')
  await import('@/lib/agent-auth')
  await import('@/lib/agent-directory')
  await import('@/lib/agent-invariants')
  await import('@/lib/converter/marketplace-emitters')
  await import('@/services/plugin-storage-service')
  await import('@/services/agent-local-config-service')
  await import('@/services/element-management-service')
})

beforeEach(() => {
  vi.clearAllMocks()
  mockExecFileCalls.length = 0
  mockExecFileImpl.mockImplementation(async (cmd: unknown, args: unknown) => {
    mockExecFileCalls.push({ cmd, args })
    return { stdout: '', stderr: '' }
  })
  mockAgentRegistry.getAgentByName.mockReturnValue(null)
  mockAgentRegistry.getAgent.mockReturnValue(null)
  mockAgentRegistry.loadAgents.mockReturnValue([])
  mockAidToken.validateGovernanceToken.mockReturnValue(null)
  mockAmpAuth.authenticateRequest.mockReturnValue({ authenticated: false, message: 'no key' })
  mockSessionAuth.extractSessionFromCookie.mockReturnValue(null)
  mockSessionAuth.validateSessionWithUser.mockReturnValue({ valid: false })
  mockSessionSecret.isSessionSecret.mockImplementation((t: string) => t.startsWith('mst_'))
  mockSessionSecret.validateSessionSecret.mockReturnValue(null)
  mockAidLedger.isAidAssociated.mockReturnValue(true)
  mockAdapterInstall.mockResolvedValue(undefined)
  mockSudoFetch.mockResolvedValue({ ok: true, json: async () => ({}) })
})

// ════════════════════════════════════════════════════════════════════════════
// R20.1 — three containers, and the per-client marketplace NAMING convention.
//
// MAP SAYS lib/ecosystem-constants.ts:151-190 (the getXMarketplacePathForClient
// helpers). ACTUALLY the decision those helpers delegate to lives at
// lib/ecosystem-constants.ts:70-90 — customMarketplaceDirName /
// rolesMarketplaceDirName / coreMarketplaceDirName. Deleting the Claude ternary
// in either of the first two is the drift this pins; the cited range would
// still be byte-identical.
//
// This block ALSO pins the five canonical folder patterns of R20.28 at their
// TypeScript source of truth (the installer only mirrors them in shell).
// ════════════════════════════════════════════════════════════════════════════
describe('R20.1 — container layout and per-client marketplace naming', () => {
  it('gives Claude the bare marketplace name and every other client a <client>- prefix', async () => {
    const ec = await import('@/lib/ecosystem-constants')

    // Claude is the ONLY unprefixed case (R20.1 naming convention).
    expect(ec.rolesMarketplaceDirName('claude')).toBe('roles-marketplace')
    expect(ec.customMarketplaceDirName('claude')).toBe('custom-marketplace')

    // Non-vacuity floor: a guard that returned the bare name for EVERY client
    // would pass the two assertions above and fail these.
    for (const client of ['codex', 'gemini', 'kiro', 'opencode']) {
      expect(ec.rolesMarketplaceDirName(client)).toBe(`${client}-roles-marketplace`)
      expect(ec.customMarketplaceDirName(client)).toBe(`${client}-custom-marketplace`)
      expect(ec.coreMarketplaceDirName(client)).toBe(`${client}-core-marketplace`)
    }
  })

  it('resolves the three containers under ~/agents/ and never registers a container as a marketplace', async () => {
    const ec = await import('@/lib/ecosystem-constants')

    expect(ec.ROLE_PLUGINS_CONTAINER_DIR_NAME).toBe('role-plugins')
    expect(ec.CUSTOM_PLUGINS_CONTAINER_DIR_NAME).toBe('custom-plugins')
    expect(ec.CORE_PLUGINS_CONTAINER_DIR_NAME).toBe('core-plugins')
    expect(ec.ABSTRACT_IR_DIR_NAME).toBe('.abstract')

    // The per-client marketplace is a SUBFOLDER of the container — never the
    // container itself (Container-marketplace separation invariant, R20.1+R20.21).
    for (const client of ['claude', 'codex']) {
      const rolesMkt = ec.getRoleMarketplacePathForClient(client)
      const customMkt = ec.getCustomMarketplacePathForClient(client)
      expect(path.dirname(rolesMkt)).toBe(ec.getRolePluginsContainerPath())
      expect(path.dirname(customMkt)).toBe(ec.getCustomPluginsContainerPath())
      expect(rolesMkt).not.toBe(ec.getRolePluginsContainerPath())
      expect(customMkt).not.toBe(ec.getCustomPluginsContainerPath())
    }
  })

  it('exposes exactly the five canonical local marketplace folder patterns (R20.28 vocabulary)', async () => {
    const ec = await import('@/lib/ecosystem-constants')
    // (1) claude roles · (2) <client> roles · (3) claude custom
    // (4) <client> custom · (5) <client> core.  Claude core is ABSENT by R20.25.
    expect(ec.getRoleMarketplacePathForClient('claude')).toBe(path.join(ROLE_CONTAINER, 'roles-marketplace'))
    expect(ec.getRoleMarketplacePathForClient('codex')).toBe(path.join(ROLE_CONTAINER, 'codex-roles-marketplace'))
    expect(ec.getCustomMarketplacePathForClient('claude')).toBe(path.join(CUSTOM_CONTAINER, 'custom-marketplace'))
    expect(ec.getCustomMarketplacePathForClient('codex')).toBe(path.join(CUSTOM_CONTAINER, 'codex-custom-marketplace'))
    expect(ec.getCoreMarketplacePathForClient('codex')).toBe(path.join(CORE_CONTAINER, 'codex-core-marketplace'))
  })
})

// ════════════════════════════════════════════════════════════════════════════
// R20.4 — every title has a default role-plugin, and AUTONOMOUS is NOT "(none)".
// MAP SAYS lib/ecosystem-constants.ts:324-334. ACTUALLY 334-344 (the cited range
// is the doc-comment; it stops one line INTO the map it means to cite).
//
// NOTE, load-bearing: element-management-service.ts:290-292 re-keys the map to
// LOWERCASE for its own use (`getRequiredPluginForTitle`,
// `autoAssignRolePluginForTitle`). The canonical map is UPPERCASE-keyed; the
// service's is lowercase-keyed. Both spellings are asserted below so a future
// "cleanup" of either keying breaks a test instead of silently returning null.
// ════════════════════════════════════════════════════════════════════════════
describe('R20.4 — title → default role-plugin map', () => {
  const EXPECTED: Record<string, string> = {
    MANAGER: 'ai-maestro-assistant-manager-agent',
    'CHIEF-OF-STAFF': 'ai-maestro-chief-of-staff',
    ARCHITECT: 'ai-maestro-architect-agent',
    INTEGRATOR: 'ai-maestro-integrator-agent',
    ORCHESTRATOR: 'ai-maestro-orchestrator-agent',
    MEMBER: 'ai-maestro-programmer-agent',
    MAINTAINER: 'ai-maestro-maintainer-agent',
    AUTONOMOUS: 'ai-maestro-autonomous-agent',
  }

  it('maps every governance title to its documented default role-plugin', async () => {
    const ec = await import('@/lib/ecosystem-constants')
    for (const [title, plugin] of Object.entries(EXPECTED)) {
      expect(ec.TITLE_PLUGIN_MAP[title], title).toBe(plugin)
    }
    // AUTONOMOUS is explicitly NOT "(none)" any more (R20.4 / R9.13 / R11.12).
    expect(ec.TITLE_PLUGIN_MAP['AUTONOMOUS']).toBeTruthy()
  })

  it('resolves the same default through the service, whose map is lowercase-keyed', async () => {
    const { getRequiredPluginForTitle } = await import('@/services/element-management-service')
    for (const [title, plugin] of Object.entries(EXPECTED)) {
      expect(getRequiredPluginForTitle(title.toLowerCase()), title).toBe(plugin)
    }
  })

  it('refuses to resolve a plugin for a title that does not exist', async () => {
    const { getRequiredPluginForTitle } = await import('@/services/element-management-service')
    // Non-vacuity: the lookup really discriminates — an unknown title is null,
    // while AUTONOMOUS (the one R20.4 says is no longer "(none)") is not.
    expect(getRequiredPluginForTitle('not-a-title')).toBeNull()
    expect(getRequiredPluginForTitle('autonomous')).not.toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// R20.18 — every per-client marketplace conforms to its client's published spec,
// and every source path starts with ./ with no traversal.
// MAP SAYS lib/converter/marketplace-emitters.ts (no line). ACTUALLY the guard is
// CLAUDE_SPEC.validate (:101-144) and CODEX_SPEC.validate (:180-245), reached
// through the exported validateMarketplace (:332-338).
// ════════════════════════════════════════════════════════════════════════════
describe('R20.18 — per-client marketplace spec conformance', () => {
  let dir: string
  beforeEach(() => {
    dir = path.join(FAKE_HOME, 'mkt-fixture', `t${Date.now()}${Math.random().toString(36).slice(2)}`)
    mkdirSync(path.join(dir, 'good-plugin'), { recursive: true })
  })

  const claudeManifest = (source: unknown) => ({
    name: 'fixture',
    owner: { name: 'local' },
    plugins: [{ name: 'good-plugin', version: '1.0.0', source }],
  })
  const codexManifest = (source: unknown) => ({
    name: 'fixture',
    interface: { displayName: 'fixture' },
    plugins: [{
      name: 'good-plugin',
      version: '1.0.0',
      source,
      category: 'Productivity',
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
    }],
  })

  it('accepts a well-formed Claude manifest (string source at .claude-plugin/)', async () => {
    const { validateMarketplace } = await import('@/lib/converter/marketplace-emitters')
    writeJson(path.join(dir, '.claude-plugin', 'marketplace.json'), claudeManifest('./good-plugin'))
    // Non-vacuity floor: the validator is not refusing everything.
    expect(await validateMarketplace(dir, 'claude')).toEqual({ ok: true, issues: [] })
  })

  it('REFUSES a Claude source that is an object (Codex shape) — schemas are not interchangeable', async () => {
    const { validateMarketplace } = await import('@/lib/converter/marketplace-emitters')
    writeJson(path.join(dir, '.claude-plugin', 'marketplace.json'),
      claudeManifest({ source: 'local', path: './good-plugin' }))
    const r = await validateMarketplace(dir, 'claude')
    expect(r.ok).toBe(false)
    expect(r.issues.join('\n')).toMatch(/source must be a STRING per Claude spec/)
  })

  it('REFUSES a source path that does not start with ./', async () => {
    const { validateMarketplace } = await import('@/lib/converter/marketplace-emitters')
    writeJson(path.join(dir, '.claude-plugin', 'marketplace.json'), claudeManifest('good-plugin'))
    const r = await validateMarketplace(dir, 'claude')
    expect(r.ok).toBe(false)
    expect(r.issues.join('\n')).toMatch(/source must start with \.\//)
  })

  it('REFUSES a ../ traversal that would escape the marketplace root', async () => {
    const { validateMarketplace } = await import('@/lib/converter/marketplace-emitters')
    writeJson(path.join(dir, '.claude-plugin', 'marketplace.json'), claudeManifest('./../good-plugin'))
    const r = await validateMarketplace(dir, 'claude')
    expect(r.ok).toBe(false)
    expect(r.issues.join('\n')).toMatch(/traversal paths forbidden/)
  })

  it('REFUSES a source folder that does not exist inside the marketplace root', async () => {
    const { validateMarketplace } = await import('@/lib/converter/marketplace-emitters')
    writeJson(path.join(dir, '.claude-plugin', 'marketplace.json'), claudeManifest('./ghost-plugin'))
    const r = await validateMarketplace(dir, 'claude')
    expect(r.ok).toBe(false)
    expect(r.issues.join('\n')).toMatch(/source folder does not exist/)
  })

  it('puts the Claude manifest under .claude-plugin/ and the Codex manifest at the root', async () => {
    const { writeMarketplaceManifest } = await import('@/lib/converter/marketplace-emitters')
    const entry = [{ name: 'good-plugin', description: 'd', version: '1.0.0', relativePath: './good-plugin' }]
    const claudePath = await writeMarketplaceManifest(dir, 'claude', 'fixture', entry)
    const codexDir = path.join(dir, 'codex')
    mkdirSync(path.join(codexDir, 'good-plugin'), { recursive: true })
    const codexPath = await writeMarketplaceManifest(codexDir, 'codex', 'fixture', entry)

    expect(claudePath).toBe(path.join(dir, '.claude-plugin', 'marketplace.json'))
    expect(codexPath).toBe(path.join(codexDir, 'marketplace.json'))
    // …and each emitted manifest passes ITS OWN validator (round-trip).
    const { validateMarketplace } = await import('@/lib/converter/marketplace-emitters')
    expect((await validateMarketplace(dir, 'claude')).ok).toBe(true)
    expect((await validateMarketplace(codexDir, 'codex')).ok).toBe(true)
  })

  it('REFUSES a Codex manifest missing the mandatory policy / category fields', async () => {
    const { validateMarketplace } = await import('@/lib/converter/marketplace-emitters')
    const m = codexManifest({ source: 'local', path: './good-plugin' }) as Record<string, any>
    delete m.plugins[0].policy
    delete m.plugins[0].category
    writeJson(path.join(dir, 'marketplace.json'), m)
    const r = await validateMarketplace(dir, 'codex')
    expect(r.ok).toBe(false)
    expect(r.issues.join('\n')).toMatch(/missing required `category`/)
    expect(r.issues.join('\n')).toMatch(/missing required `policy` object/)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// R20.15 / R20.16 — identity verification is non-negotiable, and the token TYPE
// selects which identity AUTHORITY certifies the caller.
// MAP SAYS lib/agent-auth.ts (no line). ACTUALLY authenticateAgent, and the
// specific refusals are at :110-116 (spoof), :125-132 (AID authority),
// :187-194 (this server's own session secret), :220-228 (AMP provider).
// ════════════════════════════════════════════════════════════════════════════
describe('R20.15 — no privileged identity without a verified credential', () => {
  it('REFUSES X-Agent-Id without an Authorization header (identity spoofing)', async () => {
    const { authenticateAgent } = await import('@/lib/agent-auth')
    const r = authenticateAgent(null, 'agent-victim')
    expect(r.agentId).toBeUndefined()
    expect(r.status).toBe(401)
    expect(r.error).toMatch(/Agent identity requires authentication/)
  })

  it('REFUSES a request with no credentials at all', async () => {
    const { authenticateAgent } = await import('@/lib/agent-auth')
    const r = authenticateAgent(null, null)
    expect(r.agentId).toBeUndefined()
    expect(r.status).toBe(401)
  })

  it('REFUSES an X-Agent-Id that contradicts the authenticated identity', async () => {
    const { authenticateAgent } = await import('@/lib/agent-auth')
    mockAidToken.validateGovernanceToken.mockReturnValue({
      agent_id: 'agent-real', subject_type: 'agent', governance_title: 'member', team_id: null,
    })
    const r = authenticateAgent('Bearer aim_tk_valid', 'agent-someone-else')
    expect(r.agentId).toBeUndefined()
    expect(r.status).toBe(403)
    expect(r.error).toMatch(/X-Agent-Id does not match/)
  })

  it('ADMITS a valid browser session — the non-vacuity floor for the refusals above', async () => {
    const { authenticateAgent } = await import('@/lib/agent-auth')
    mockSessionAuth.extractSessionFromCookie.mockReturnValue('sess-token')
    mockSessionAuth.validateSessionWithUser.mockReturnValue({ valid: true })
    const r = authenticateAgent(null, null, 'aim_session=sess-token')
    expect(r.error).toBeUndefined()
    expect(r.status).toBeUndefined()
  })
})

describe('R20.16 — the token type selects the certifying identity authority', () => {
  it('routes aim_tk_* to the AID authority, and refuses when that authority declines', async () => {
    const { authenticateAgent } = await import('@/lib/agent-auth')
    mockAidToken.validateGovernanceToken.mockReturnValue(null)
    const r = authenticateAgent('Bearer aim_tk_bogus', null)
    expect(mockAidToken.validateGovernanceToken).toHaveBeenCalledWith('aim_tk_bogus')
    expect(r.status).toBe(401)
    expect(r.error).toMatch(/Invalid or expired governance token/)
    // The other two authorities were NOT consulted — the type, not a fallback chain, decides.
    expect(mockSessionSecret.validateSessionSecret).not.toHaveBeenCalled()
    expect(mockAmpAuth.authenticateRequest).not.toHaveBeenCalled()
  })

  it('routes mst_* to THIS server (the host that spawned the session) and refuses an unknown secret', async () => {
    const { authenticateAgent } = await import('@/lib/agent-auth')
    const r = authenticateAgent('Bearer mst_unknown', null)
    expect(mockSessionSecret.isSessionSecret).toHaveBeenCalledWith('mst_unknown')
    expect(r.status).toBe(401)
    expect(r.error).toMatch(/Invalid or expired session secret/)
    expect(mockAmpAuth.authenticateRequest).not.toHaveBeenCalled()
  })

  it('routes amp_live_sk_* to the AMP provider and refuses when the provider declines', async () => {
    const { authenticateAgent } = await import('@/lib/agent-auth')
    mockAmpAuth.authenticateRequest.mockReturnValue({ authenticated: false, message: 'Invalid API key' })
    const r = authenticateAgent('Bearer amp_live_sk_bogus', null)
    expect(mockAmpAuth.authenticateRequest).toHaveBeenCalledWith('Bearer amp_live_sk_bogus')
    expect(r.status).toBe(401)
    expect(mockAidToken.validateGovernanceToken).not.toHaveBeenCalled()
  })

  it('ADMITS each authority when it certifies — the non-vacuity floor', async () => {
    const { authenticateAgent } = await import('@/lib/agent-auth')

    mockAidToken.validateGovernanceToken.mockReturnValue({
      agent_id: 'agent-aid', subject_type: 'agent', governance_title: 'member', team_id: 'team-1',
    })
    const aid = authenticateAgent('Bearer aim_tk_ok', null)
    expect(aid.agentId).toBe('agent-aid')
    expect(aid.governanceTitle).toBe('member')

    mockAmpAuth.authenticateRequest.mockReturnValue({ authenticated: true, agentId: 'agent-amp' })
    expect(authenticateAgent('Bearer amp_live_sk_ok', null).agentId).toBe('agent-amp')

    // Both admits happened WITHOUT the other authority being consulted — the
    // token type alone selects the certifier (R20.16), there is no fallback chain.
    expect(mockSessionSecret.validateSessionSecret).not.toHaveBeenCalled()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// R20.14 — a mesh-consultable, READ-ONLY directory of agent identities that
// exposes no secret.
// MAP SAYS lib/agent-directory.ts (no line). ACTUALLY getLocalEntriesForSync
// (:338-341) is the surface peers consult, and registerRemoteAgent's
// local-entry protection (:206-211) is the refusal.
// ════════════════════════════════════════════════════════════════════════════
describe('R20.14 — cross-host agent directory', () => {
  beforeEach(async () => {
    const { clearDirectoryCache } = await import('@/lib/agent-directory')
    clearDirectoryCache()
    rmSync(path.join(FAKE_STATE, 'agent-directory.json'), { force: true })
  })

  it('publishes local agents to peers with identity fields only — no secrets', async () => {
    const { rebuildLocalDirectory, getLocalEntriesForSync } = await import('@/lib/agent-directory')
    mockAgentRegistry.loadAgents.mockReturnValue([
      {
        id: 'agent-1', name: 'alpha', hostId: 'test-host',
        hostUrl: 'http://localhost:23000', ampRegistered: true,
        metadata: { amp: { address: 'alpha@default.local' } },
        // Things that must NEVER leave this host:
        sessionSecret: 'mst_supersecret', apiKey: 'amp_live_sk_supersecret',
      },
    ])
    rebuildLocalDirectory()
    const shared = getLocalEntriesForSync()

    expect(shared.map(e => e.name)).toEqual(['alpha'])
    const serialized = JSON.stringify(shared)
    expect(serialized).not.toMatch(/mst_supersecret/)
    expect(serialized).not.toMatch(/amp_live_sk_supersecret/)
    // Non-vacuity: the entry is not empty — it really carries the identity.
    expect(shared[0].hostId).toBe('test-host')
    expect(shared[0].ampAddress).toBe('alpha@default.local')
  })

  it('REFUSES to let a peer overwrite a LOCAL directory entry', async () => {
    const { rebuildLocalDirectory, registerRemoteAgent, lookupAgent } = await import('@/lib/agent-directory')
    mockAgentRegistry.loadAgents.mockReturnValue([
      { id: 'agent-1', name: 'alpha', hostId: 'test-host', hostUrl: 'http://localhost:23000' },
    ])
    rebuildLocalDirectory()

    const accepted = registerRemoteAgent({
      name: 'alpha', hostId: 'evil-host', hostUrl: 'http://evil:23000',
    } as never)

    expect(accepted).toBe(false)
    expect(lookupAgent('alpha')?.hostId).toBe('test-host')
    expect(lookupAgent('alpha')?.source).toBe('local')

    // Non-vacuity: a name this host does NOT own IS accepted from a peer.
    expect(registerRemoteAgent({ name: 'beta', hostId: 'peer-host', hostUrl: 'http://peer:23000' } as never)).toBe(true)
    expect(lookupAgent('beta')?.source).toBe('remote')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// R20.2 — every agent carries the CORE plugin at LOCAL scope.
// MAP SAYS services/element-management-service.ts:7530-7551. ACTUALLY that range
// is CreateAgent G08's NON-CLAUDE role-plugin branch, which is R20.6's guard, not
// R20.2's. The core-plugin-presence guard is the `core-plugin` row of
// lib/agent-invariants.ts (:110-150).
//
// R20.19 — optional plugins are NOT subject to that enforcement loop.
// ════════════════════════════════════════════════════════════════════════════
describe('R20.2 / R20.19 — core plugin is mandatory, optional plugins are not', () => {
  it('installs the CORE plugin at LOCAL scope when it is missing on wake', async () => {
    const { enforceAgentInvariants } = await import('@/lib/agent-invariants')
    const coreSvc = await import('@/services/agents-core-service')
    const ems = await import('@/services/element-management-service')

    const spyPresent = vi.spyOn(coreSvc, 'isCorePluginPresent').mockResolvedValue(false)
    const spyInstall = vi.spyOn(ems, 'InstallElement').mockResolvedValue({
      success: true, operations: [], restartNeeded: false,
    } as never)
    // finally-restore: a spy that survives a FAILED assertion silently poisons
    // every later test in the file (it did, on the first draft of this batch).
    try {
      const workdir = path.join(AGENTS_BASE, 'r20-core-agent')
      mkdirSync(workdir, { recursive: true })
      await enforceAgentInvariants({
        agentId: 'agent-core', workdir, clientType: 'claude', trigger: 'wake',
      } as never)

      const coreCalls = spyInstall.mock.calls.filter(
        c => (c[0] as Record<string, unknown>).name === 'ai-maestro-plugin',
      )
      expect(coreCalls).toHaveLength(1)
      const arg = coreCalls[0][0] as Record<string, unknown>
      expect(arg.marketplace).toBe('ai-maestro-plugins')
      expect(arg.scope).toBe('local')          // R20.2: local scope, never user
      expect(arg.agentDir).toBe(workdir)

      // Non-vacuity: when the core plugin IS present, nothing is installed.
      spyInstall.mockClear()
      spyPresent.mockResolvedValue(true)
      await enforceAgentInvariants({
        agentId: 'agent-core', workdir, clientType: 'claude', trigger: 'wake',
      } as never)
      expect(spyInstall.mock.calls.filter(
        c => (c[0] as Record<string, unknown>).name === 'ai-maestro-plugin',
      )).toHaveLength(0)
    } finally {
      spyPresent.mockRestore()
      spyInstall.mockRestore()
    }
  })

  it('enforces ONLY the two mandatory plugins — optional ones are outside the loop (R20.19)', async () => {
    const { AGENT_INVARIANTS } = await import('@/lib/agent-invariants')
    const pluginRows = AGENT_INVARIANTS.filter(i => /plugin/i.test(i.id) || /plugin/i.test(i.description))
    // R20.19: only CORE (R20.2) and the TITLE role-plugin (R20.4) are mandatory.
    // A new row that reinstalled optional/marketplace plugins would fail here.
    expect(pluginRows.map(r => r.id).sort()).toEqual(['core-plugin', 'role-plugin'])
    // …and both are wake-only: no background loop reinstalls plugins fleet-wide.
    for (const row of pluginRows) expect(row.triggers, row.id).toEqual(['wake'])
  })
})

// ════════════════════════════════════════════════════════════════════════════
// R20.20 — scope isolation: an agent's LOCAL plugin list never contains a
// USER-scope plugin.
// MAP SAYS services/agent-local-config-service.ts (no line). ACTUALLY the guard
// is scanClaudeDirectory reading enabledPlugins from the WORKDIR's
// .claude/settings.local.json (:415, consumed :789-792); the user-scope
// ~/.claude/settings.json is read into a separate `userGlobalSettings` field
// (:502) and never merged into `plugins[]`.
// ════════════════════════════════════════════════════════════════════════════
describe('R20.20 — local-scope and user-scope plugin lists are disjoint', () => {
  it('lists only the workdir-local plugins, never the user-scope ones', async () => {
    const { scanAgentLocalConfig } = await import('@/services/agent-local-config-service')

    const workdir = path.join(AGENTS_BASE, 'r20-scope-agent')
    mkdirSync(path.join(workdir, '.claude'), { recursive: true })

    // BOTH plugins are really installed in the client cache — so the only thing
    // that can keep the user-scope one out of this list is the SCOPE guard, not
    // a missing file.
    seedInstalledPlugin('local-only-plugin')
    seedInstalledPlugin('user-only-plugin')

    writeJson(path.join(workdir, '.claude', 'settings.local.json'), {
      enabledPlugins: { 'local-only-plugin@ai-maestro-plugins': true },
    })
    // A DIFFERENT plugin enabled at USER scope on the same client.
    writeJson(path.join(FAKE_HOME, '.claude', 'settings.json'), {
      enabledPlugins: { 'user-only-plugin@ai-maestro-plugins': true },
    })
    mockAgentRegistry.getAgent.mockReturnValue({
      id: 'agent-scope', name: 'scope-agent', workingDirectory: workdir, sessions: [],
    })

    const r = scanAgentLocalConfig('agent-scope')
    expect(r.error).toBeUndefined()
    const names = (r.data!.plugins ?? []).map(p => p.name)

    // Non-vacuity floor: the local one IS listed, so an "empty list" cannot pass.
    expect(names).toContain('local-only-plugin')
    // The invariant: the user-scope plugin is invisible here.
    expect(names).not.toContain('user-only-plugin')
    expect(JSON.stringify(r.data!.plugins)).not.toMatch(/user-only-plugin/)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// R20.13 — agent names are unique host-wide; a collision is refused at creation.
// MAP SAYS services/element-management-service.ts:6849. ACTUALLY 6849 is inside
// DeleteAgent's incomplete-teardown warning and has nothing to do with name
// uniqueness. The guard is CreateAgent gate G01b (:6953-6966).
// ════════════════════════════════════════════════════════════════════════════
describe('R20.13 — host-wide agent name uniqueness', () => {
  it('REFUSES to create a second agent with a name already in the registry', async () => {
    const { CreateAgent } = await import('@/services/element-management-service')
    mockAgentRegistry.getAgentByName.mockImplementation(
      (n: string) => (n === 'taken-name' ? { id: 'agent-existing', name: 'taken-name' } : null),
    )

    const r = await CreateAgent({ name: 'taken-name', authContext: SYSTEM_AUTH } as never)

    expect(r.success).toBe(false)
    expect(r.agentId).toBeNull()
    expect(r.error).toMatch(/Agent with name "taken-name" already exists \(id=agent-existing\)/)
    // The gate REFUSED — its success op must be absent, and nothing was created.
    expect(r.operations.join('\n')).not.toMatch(/G01b: Name .* is unique/)
    expect(mockAgentRegistry.createAgent).not.toHaveBeenCalled()
  })

  it('lets the uniqueness gate PASS for a free name (non-vacuity floor)', async () => {
    const { CreateAgent } = await import('@/services/element-management-service')
    mockAgentRegistry.getAgentByName.mockReturnValue(null)
    // The pipeline continues past G01b and fails later (no registry double for
    // the create step) — but G01b itself must have PASSED, which is the claim.
    const r = await CreateAgent({ name: 'free-name', authContext: SYSTEM_AUTH } as never)
    expect(r.operations.join('\n')).toMatch(/G01b: Name "free-name" is unique in registry/)
    expect(r.error ?? '').not.toMatch(/already exists/)
  })

  it('REFUSES a name that is not a legal agent identifier (the gate before it)', async () => {
    const { CreateAgent } = await import('@/services/element-management-service')
    const r = await CreateAgent({ name: '../escape', authContext: SYSTEM_AUTH } as never)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/Invalid agent name/)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// R20.5 — the title's default role-plugin is installed automatically when the
// title is granted; R20.6 — a non-Claude agent gets the CONVERTED version, and a
// NATIVE one is preferred over re-conversion.
// MAP SAYS R20.5 → element-management-service.ts:1722-1778 (that range is
// getRequiredPluginForTitle + getCompatiblePluginsForTitle — the lookup, not the
// install). ACTUALLY the auto-install is autoAssignRolePluginForTitle
// (:1764-1830): Claude path :1808+, non-Claude conversion path :1791-1806.
// MAP SAYS R20.6 → :7419-7468, which is CreateAgent G07/G07b/G07c (team join and
// the R9.13 reject) — unrelated. Its real guards are the non-Claude branch of
// autoAssignRolePluginForTitle and CreateAgent G08 (:7531+).
// ════════════════════════════════════════════════════════════════════════════
describe('R20.5 / R20.6 — automatic role-plugin assignment on title grant', () => {
  const workdir = path.join(AGENTS_BASE, 'r20-title-agent')

  /** Every `claude plugin <verb> <plugin> …` invocation the pipeline made. */
  function cliPluginOps(): Array<{ verb: string; plugin: string }> {
    return mockExecFileCalls
      .filter((c: ExecCall) => c.cmd === 'claude' && Array.isArray(c.args) && (c.args as string[])[0] === 'plugin')
      .map((c: ExecCall) => ({ verb: (c.args as string[])[1], plugin: (c.args as string[])[2] }))
  }

  beforeEach(() => {
    mkdirSync(path.join(workdir, '.claude'), { recursive: true })
    mockAgentRegistry.getAgent.mockReturnValue({
      id: 'agent-title', name: 'title-agent', workingDirectory: workdir,
      program: 'claude', sessions: [],
    })
  })

  it('installs the title default into the agent workdir, sweeping every OTHER role-plugin (R20.5)', async () => {
    const { autoAssignRolePluginForTitle } = await import('@/services/element-management-service')

    const installed = await autoAssignRolePluginForTitle('architect' as never, 'agent-title')
    expect(installed).toBe('ai-maestro-architect-agent')

    const ops = cliPluginOps()
    const installs = ops.filter(o => o.verb === 'install').map(o => o.plugin)
    const uninstalls = ops.filter(o => o.verb === 'uninstall').map(o => o.plugin)

    // R20.5: the title's DEFAULT is what gets installed — and at local scope,
    // in the agent's own workdir (the cwd the CLI is invoked with).
    expect(installs).toEqual(['ai-maestro-architect-agent'])
    const installCall = mockExecFileCalls.find(
      (c: ExecCall) => Array.isArray(c.args) && (c.args as string[])[1] === 'install',
    )
    expect(installCall!.args).toEqual(expect.arrayContaining(['--scope', 'local']))

    // Title-plugin invariant #8: exactly one role-plugin survives.
    expect(uninstalls).not.toContain('ai-maestro-architect-agent')
    // Non-vacuity: it really swept the others rather than doing nothing.
    expect(uninstalls).toContain('ai-maestro-programmer-agent')
    expect(uninstalls).toContain('ai-maestro-assistant-manager-agent')
  })

  it('refuses to guess a plugin for an unknown title (non-vacuity floor for R20.5)', async () => {
    const { autoAssignRolePluginForTitle } = await import('@/services/element-management-service')
    const r = await autoAssignRolePluginForTitle('not-a-title' as never, 'agent-title')
    expect(r).toBeNull()
    expect(cliPluginOps().filter(o => o.verb === 'install')).toEqual([])
  })

  it('gives a NON-Claude agent the CONVERTED plugin via its own adapter, never the Claude CLI (R20.6)', async () => {
    const { autoAssignRolePluginForTitle } = await import('@/services/element-management-service')

    // A REAL Claude source for the MEMBER default, so the REAL conversion runs.
    seedSourcePlugin('ai-maestro-programmer-agent', { role: true })
    mockAgentRegistry.getAgent.mockReturnValue({
      id: 'agent-title', name: 'title-agent', workingDirectory: workdir,
      program: 'codex', sessions: [],
    })

    await autoAssignRolePluginForTitle('member' as never, 'agent-title')

    // The CONVERTED copy really exists in the codex role marketplace…
    const emitted = path.join(
      ROLE_CONTAINER, 'codex-roles-marketplace', 'ai-maestro-programmer-agent-codex',
    )
    expect(existsSync(emitted), emitted).toBe(true)
    // …and it was handed to the CLIENT's own adapter…
    expect(mockAdapterInstall).toHaveBeenCalledTimes(1)
    const adapterArgs = mockAdapterInstall.mock.calls[0] as unknown[]
    expect((adapterArgs[0] as Record<string, unknown>).clientType).toBe('codex')
    expect(adapterArgs[1]).toBe(workdir)
    // …NEVER through `claude plugin install`. A guard that lost the clientType
    // branch would push the Claude plugin into a Codex agent.
    expect(cliPluginOps().filter(o => o.verb === 'install')).toEqual([])
  })
})

// ════════════════════════════════════════════════════════════════════════════
// R20.29 / R20.31 — a plugin LIVES at its install target (the client's own
// state), and uninstall NEVER reaches into the AI Maestro source containers.
// MAP SAYS R20.29 → element-management-service.ts:1531-1533 (the
// isLocalOnlyMarketplace routing decision — correct, though it is the SOURCE
// routing half only). MAP SAYS R20.31 → plugin-storage-service.ts:426-460, which
// is `removeConvertedPlugin` — a function that DELETES from all three source
// containers, i.e. the exact opposite of a guard. It has ZERO call sites; R20.31
// holds because nothing invokes it. Both halves are pinned behaviourally below.
// ════════════════════════════════════════════════════════════════════════════
describe('R20.29 / R20.31 — install target vs source container', () => {
  const workdir = path.join(AGENTS_BASE, 'r20-target-agent')

  it('installs a REMOTE-marketplace plugin through the client protocol, into the client target', async () => {
    const { installPluginLocally } = await import('@/services/element-management-service')
    mkdirSync(path.join(workdir, '.claude'), { recursive: true })

    await installPluginLocally('ai-maestro-plugin', workdir, 'ai-maestro-plugins')

    const cli = mockExecFileCalls.find((c: ExecCall) => c.cmd === 'claude')
    expect(cli, 'the client’s own install protocol must be invoked').toBeDefined()
    expect(cli!.args).toEqual(
      expect.arrayContaining(['plugin', 'install', 'ai-maestro-plugin', 'ai-maestro-plugins', '--scope', 'local']),
    )
  })

  it('routes a LOCAL-container source away from the CLI, and still writes only into the agent workdir', async () => {
    const { installPluginLocally } = await import('@/services/element-management-service')
    const { LOCAL_MARKETPLACE_NAME } = await import('@/lib/ecosystem-constants')

    // Seed a SOURCE folder in the role-plugins container, as an author/converter would.
    const sourceDir = path.join(ROLE_CONTAINER, 'roles-marketplace', 'authored-plugin')
    mkdirSync(sourceDir, { recursive: true })
    writeFileSync(path.join(sourceDir, 'marker.txt'), 'source artifact')

    const dir = path.join(AGENTS_BASE, 'r20-local-src-agent')
    mkdirSync(path.join(dir, '.claude'), { recursive: true })
    mockExecFileCalls.length = 0

    await installPluginLocally('authored-plugin', dir, LOCAL_MARKETPLACE_NAME)

    // Non-vacuity vs the previous test: this source is NOT installed via the CLI.
    expect(mockExecFileCalls.find((c: ExecCall) => c.cmd === 'claude')).toBeUndefined()
    // The write landed in the CLIENT target (the agent's own settings), …
    const settings = JSON.parse(
      readFileSync(path.join(dir, '.claude', 'settings.local.json'), 'utf-8'),
    )
    expect(Object.keys(settings.enabledPlugins ?? {})).toContain(
      `authored-plugin@${LOCAL_MARKETPLACE_NAME}`,
    )
    // …and the SOURCE artifact is untouched.
    expect(existsSync(path.join(sourceDir, 'marker.txt'))).toBe(true)
  })

  it('UNINSTALL never deletes from the three source containers (R20.31)', async () => {
    const { uninstallPluginLocally } = await import('@/services/element-management-service')
    const { LOCAL_MARKETPLACE_NAME } = await import('@/lib/ecosystem-constants')

    // Sources in ALL THREE containers, plus their shared IR hubs.
    const artifacts = [
      path.join(ROLE_CONTAINER, 'roles-marketplace', 'authored-plugin', 'marker.txt'),
      path.join(ROLE_CONTAINER, '.abstract', 'authored-plugin', 'plugin-universal-ir.yaml'),
      path.join(CUSTOM_CONTAINER, 'custom-marketplace', 'authored-plugin', 'marker.txt'),
      path.join(CUSTOM_CONTAINER, '.abstract', 'authored-plugin', 'plugin-universal-ir.yaml'),
      path.join(CORE_CONTAINER, 'codex-core-marketplace', 'ai-maestro-plugin-codex', 'marker.txt'),
    ]
    for (const f of artifacts) {
      mkdirSync(path.dirname(f), { recursive: true })
      writeFileSync(f, 'source artifact')
    }

    const dir = path.join(AGENTS_BASE, 'r20-uninstall-agent')
    mkdirSync(path.join(dir, '.claude'), { recursive: true })
    writeJson(path.join(dir, '.claude', 'settings.local.json'), {
      enabledPlugins: { [`authored-plugin@${LOCAL_MARKETPLACE_NAME}`]: true },
    })

    await uninstallPluginLocally('authored-plugin', dir, LOCAL_MARKETPLACE_NAME)

    // Non-vacuity: the uninstall DID do its job at the client target…
    const settings = JSON.parse(readFileSync(path.join(dir, '.claude', 'settings.local.json'), 'utf-8'))
    expect(Object.keys(settings.enabledPlugins ?? {})).not.toContain(
      `authored-plugin@${LOCAL_MARKETPLACE_NAME}`,
    )
    // …while every source artifact survives. Wiring removeConvertedPlugin (or any
    // rm of a container path) into this pipeline fails here.
    for (const f of artifacts) {
      expect(existsSync(f), f).toBe(true)
    }
  })
})

// ════════════════════════════════════════════════════════════════════════════
// R20.8 / R20.9 / R20.22 — universal IR lives at the CONTAINER level, one hub
// per plugin CATEGORY, never duplicated into a per-client marketplace.
// R20.23 — a multi-client plugin is DUPLICATED, one emitted copy per marketplace.
// R20.24 — .agent.toml is written for role-plugins ONLY.
// R20.25 — Claude has no local core-marketplace.
// R20.26 — names are immutable: target name is literal, and an existing folder is
//          overwritten in place (never renamed, never suffixed with a counter).
//
// MAP SAYS R20.8, R20.9 AND R20.22 all share plugin-storage-service.ts:166-170.
// ACTUALLY those five lines are the CATEGORY→hub selection (isRolePlugin /
// isCorePlugin → abstractDirForPluginType at :82-85), which genuinely enforces
// R20.8 and R20.9. They do NOT enforce R20.22's second half (“the IR MUST NOT be
// duplicated into per-client subdirectories”) — that is a property of the EMIT
// loop (:182-266) writing only emitted artifacts, never the IR, under a
// marketplace dir. Two of the three citations are therefore imprecise.
// ════════════════════════════════════════════════════════════════════════════
describe('R20.8 / R20.9 / R20.22 — container-level IR hubs', () => {
  it('stores an ORDINARY plugin’s IR in custom-plugins/.abstract (R20.8)', async () => {
    const { convertAndStorePlugin } = await import('@/services/plugin-storage-service')
    seedSourcePlugin('ord-plugin')

    const { abstractDir } = await convertAndStorePlugin('ord-plugin', 'claude', ['claude'])

    expect(abstractDir).toBe(path.join(CUSTOM_CONTAINER, '.abstract', 'ord-plugin'))
    expect(existsSync(path.join(abstractDir, 'plugin-universal-ir.yaml'))).toBe(true)
    // Non-vacuity + isolation: it did NOT land in the role hub.
    expect(existsSync(path.join(ROLE_CONTAINER, '.abstract', 'ord-plugin'))).toBe(false)
  })

  it('stores a ROLE plugin’s IR in role-plugins/.abstract, isolated from the ordinary namespace (R20.9)', async () => {
    const { convertAndStorePlugin } = await import('@/services/plugin-storage-service')
    seedSourcePlugin('role-plugin-fx', { role: true })

    const { abstractDir } = await convertAndStorePlugin('role-plugin-fx', 'claude', ['claude'])

    expect(abstractDir).toBe(path.join(ROLE_CONTAINER, '.abstract', 'role-plugin-fx'))
    expect(existsSync(path.join(CUSTOM_CONTAINER, '.abstract', 'role-plugin-fx'))).toBe(false)
  })

  it('never duplicates the IR into a per-client marketplace subfolder (R20.22)', async () => {
    const { convertAndStorePlugin } = await import('@/services/plugin-storage-service')
    seedSourcePlugin('ir-dup-check')

    await convertAndStorePlugin('ir-dup-check', 'claude', ['claude', 'codex'])

    for (const client of ['claude', 'codex']) {
      const mktDir = path.join(CUSTOM_CONTAINER,
        client === 'claude' ? 'custom-marketplace' : `${client}-custom-marketplace`)
      const files = walk(mktDir)
      // Non-vacuity: the marketplace is NOT empty — the emitted copy is there.
      expect(files.length, `${client} marketplace should hold the emitted plugin`).toBeGreaterThan(0)
      expect(files.filter(f => f.includes('plugin-universal-ir.yaml')), client).toEqual([])
      expect(files.filter(f => f.includes('.abstract')), client).toEqual([])
    }
  })
})

describe('R20.23 / R20.24 / R20.25 / R20.26 — emission layout and immutable names', () => {
  it('duplicates a multi-client role-plugin, one copy per marketplace, each keeping the full client list (R20.23)', async () => {
    const { convertAndStorePlugin } = await import('@/services/plugin-storage-service')
    seedSourcePlugin('multi-role', { role: true })

    const { emittedDirs } = await convertAndStorePlugin('multi-role', 'claude', ['claude', 'codex'])

    const claudeDir = path.join(ROLE_CONTAINER, 'roles-marketplace', 'multi-role')
    const codexDir = path.join(ROLE_CONTAINER, 'codex-roles-marketplace', 'multi-role-codex')
    expect(emittedDirs.claude).toBe(claudeDir)
    expect(emittedDirs.codex).toBe(codexDir)
    // Two INDEPENDENT copies — never a symlink or a shared reference.
    expect(existsSync(claudeDir)).toBe(true)
    expect(existsSync(codexDir)).toBe(true)
    expect(claudeDir).not.toBe(codexDir)

    // Each copy's .agent.toml retains the FULL compatible-clients list.
    for (const [dir, name] of [[claudeDir, 'multi-role'], [codexDir, 'multi-role-codex']] as const) {
      const toml = readFileSync(path.join(dir, `${name}.agent.toml`), 'utf-8')
      expect(toml, dir).toMatch(/claude/)
      expect(toml, dir).toMatch(/codex/)
    }
  })

  it('writes .agent.toml for a ROLE plugin and NEVER for a custom plugin (R20.24)', async () => {
    const { convertAndStorePlugin } = await import('@/services/plugin-storage-service')
    seedSourcePlugin('toml-role', { role: true })
    seedSourcePlugin('toml-custom')

    await convertAndStorePlugin('toml-role', 'claude', ['codex'])
    await convertAndStorePlugin('toml-custom', 'claude', ['codex'])

    const roleDir = path.join(ROLE_CONTAINER, 'codex-roles-marketplace', 'toml-role-codex')
    const customDir = path.join(CUSTOM_CONTAINER, 'codex-custom-marketplace', 'toml-custom-codex')

    // Non-vacuity: the role copy DOES carry the marker…
    expect(walk(roleDir).filter(f => f.endsWith('.agent.toml'))).toEqual(['toml-role-codex.agent.toml'])
    // …and the custom copy carries none. `.agent.toml` is the SOLE role marker,
    // so a stray one here would silently reclassify an ordinary plugin.
    expect(walk(customDir).filter(f => f.endsWith('.agent.toml'))).toEqual([])
  })

  it('skips Claude for the CORE plugin — there is no Claude core-marketplace (R20.25)', async () => {
    const { convertAndStorePlugin } = await import('@/services/plugin-storage-service')
    seedSourcePlugin('ai-maestro-plugin')

    const { abstractDir, emittedDirs } = await convertAndStorePlugin(
      'ai-maestro-plugin', 'claude', ['claude', 'codex'],
    )

    expect(abstractDir).toBe(path.join(CORE_CONTAINER, '.abstract', 'ai-maestro-plugin'))
    // Claude is skipped outright…
    expect(emittedDirs.claude).toBeUndefined()
    expect(existsSync(path.join(CORE_CONTAINER, 'core-marketplace'))).toBe(false)
    expect(existsSync(path.join(CORE_CONTAINER, 'claude-core-marketplace'))).toBe(false)
    // …while the non-Claude client DOES get a per-client core marketplace.
    expect(emittedDirs.codex).toBe(
      path.join(CORE_CONTAINER, 'codex-core-marketplace', 'ai-maestro-plugin-codex'),
    )
  })

  it('uses the literal target name and OVERWRITES in place on re-conversion (R20.26)', async () => {
    const { convertAndStorePlugin } = await import('@/services/plugin-storage-service')
    seedSourcePlugin('immutable-name')

    const first = await convertAndStorePlugin('immutable-name', 'claude', ['claude', 'codex'])
    // Claude keeps the bare name; every other client gets the -<client> suffix.
    expect(first.emittedDirs.claude).toBe(
      path.join(CUSTOM_CONTAINER, 'custom-marketplace', 'immutable-name'))
    expect(first.emittedDirs.codex).toBe(
      path.join(CUSTOM_CONTAINER, 'codex-custom-marketplace', 'immutable-name-codex'))

    const second = await convertAndStorePlugin('immutable-name', 'claude', ['claude', 'codex'])
    // Same folders — no rename, no "-1"/"-2" sibling, no deduplicated alias.
    expect(second.emittedDirs).toEqual(first.emittedDirs)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readdirSync } = require('fs') as typeof import('fs')
    const siblings = readdirSync(path.join(CUSTOM_CONTAINER, 'codex-custom-marketplace'))
      .filter(e => e.startsWith('immutable-name'))
    expect(siblings).toEqual(['immutable-name-codex'])
  })

  it('rewrites the manifest name to equal the target folder name (R20.26/R20.27)', async () => {
    const { convertAndStorePlugin } = await import('@/services/plugin-storage-service')
    seedSourcePlugin('manifest-name')

    await convertAndStorePlugin('manifest-name', 'claude', ['codex'])

    const dir = path.join(CUSTOM_CONTAINER, 'codex-custom-marketplace', 'manifest-name-codex')
    const manifestRel = walk(dir).find(f => f.endsWith('plugin.json'))
    expect(manifestRel, `a manifest under ${dir}`).toBeDefined()
    const manifest = JSON.parse(readFileSync(path.join(dir, manifestRel!), 'utf-8'))
    expect(manifest.name).toBe('manifest-name-codex')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// R20.30 — the Agent Profile → Config → Plugins uninstall button performs a
// LOCAL-scope uninstall, scoped to THAT agent alone, and never reaches into the
// AI Maestro source containers.
// MAP SAYS components/agent-profile/PluginsTab.tsx:116-153 — CORRECT (the
// handleUninstall closure). It is a React component, so this block renders it
// for real; the file therefore runs under the jsdom environment declared at the
// top. `sudoFetch` is mocked as the TRANSPORT only — the request the guard
// builds (URL, method, body) is asserted verbatim.
// ════════════════════════════════════════════════════════════════════════════
describe('R20.30 — the agent Plugins tab uninstalls at LOCAL scope only', () => {
  it('sends the agent’s own workdir as the uninstall scope, and no user-scope marker', async () => {
    const React = (await import('react')).default
    const { render, screen, fireEvent, cleanup, waitFor } = await import('@testing-library/react')
    const { default: PluginsTab } = await import('@/components/agent-profile/PluginsTab')

    const workdir = path.join(AGENTS_BASE, 'r20-uninstall-ui-agent')
    const config = {
      workingDirectory: workdir,
      skills: [], agents: [], hooks: [], rules: [], commands: [],
      mcpServers: [], lspServers: [], outputStyles: [],
      plugins: [{
        name: 'some-plugin',
        key: 'some-plugin@ai-maestro-plugins',
        path: path.join(workdir, '.claude', 'plugins', 'some-plugin'),
        enabled: true,
      }],
      rolePlugin: null, globalDependencies: null, settings: {},
      userGlobalSettings: null, keybindings: null,
      lastScanned: new Date().toISOString(),
    }

    try {
      render(React.createElement(PluginsTab as never, { config, agentId: 'agent-ui' } as never))
      fireEvent.click(screen.getByLabelText('Uninstall some-plugin'))
      fireEvent.click(await screen.findByText('Yes'))
      await waitFor(() => expect(mockSudoFetch).toHaveBeenCalledTimes(1))

      const [url, init] = mockSudoFetch.mock.calls[0] as [string, RequestInit]
      expect(init.method).toBe('DELETE')
      const body = JSON.parse(init.body as string)

      // LOCAL scope IS the agent's own working directory — the one field that
      // confines the uninstall to this agent and leaves every other agent
      // holding the same plugin untouched.
      expect(body.agentDir).toBe(workdir)
      expect(body.pluginName).toBe('some-plugin')
      expect(body.marketplaceName).toBe('ai-maestro-plugins')
      // …never a user-scope uninstall, and never a source-container path.
      expect(body.scope).not.toBe('user')
      expect(JSON.stringify(body)).not.toMatch(/role-plugins|custom-plugins|core-plugins/)
      expect(url).toBe('/api/agents/role-plugins/install')
    } finally {
      cleanup()
    }
  })
})
