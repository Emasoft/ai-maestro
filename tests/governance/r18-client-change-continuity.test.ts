/**
 * R18 — Plugin continuity when an agent's client changes, pinned against the REAL ChangeClient.
 *
 * WHY THIS FILE EXISTS SEPARATELY, AND WHY IT IS NOT A FIFTH COPY OF THE HARNESS
 * -----------------------------------------------------------------------------
 * `tests/governance/r17-r11-core-plugin-binding.test.ts` mocks 24 modules — but that is the cost of
 * driving CreateAgent + InstallElement + ChangeTeam, not the cost of touching this service.
 * `ChangeClient` needs SEVEN, because `gate0Auth` short-circuits on `isSystemOwner` (so the whole
 * authorization module is out of the picture) and the pipeline's remaining reach is the registry,
 * the config scanner, the plugin store, and the two per-client adapter lookups. Measuring that
 * before writing is what turned "this needs a harness refactor first" into "this needs seven lines".
 *
 * WHAT IS MOCKED AND WHAT IS NOT
 * ------------------------------
 * Everything below the guard: the stores, the converter, the adapters. The pipeline's own control
 * flow — the snapshot, the resolution order, the abort-before-uninstall, the registry write — is
 * real, which is what keeps the mutation-kill property. The adapters are spies precisely because
 * R18's central promise is about ORDER (never uninstall before a replacement is ready), and order
 * is only observable by watching who was called and when.
 *
 * 0-IMPACT: `@/lib/ecosystem-constants` is contained via the shared `fakeEcosystemPaths` helper,
 * and `process.env.HOME` is redirected to a temp dir because `ChangeClient` probes
 * `~/agents/role-plugins/…` and `~/agents/custom-plugins/…` with `existsSync`. Those are reads, but
 * a read against the developer's real home makes the test's outcome depend on that developer's
 * machine — a flake, not a leak, and still worth eliminating.
 *
 * CITATIONS: every R18 row was re-verified by reading ChangeClient (5517-5908) on 2026-07-27; all
 * eight were wrong or too coarse and were corrected in the map (see TRDD-W8NA7ROZ). Do not trust an
 * R18 citation older than that commit.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { FAKE_HOME, FAKE_STATE } = vi.hoisted(() => {
  const { mkdtempSync: mk } = require('node:fs') as typeof import('node:fs')
  const { tmpdir: td } = require('node:os') as typeof import('node:os')
  const { join: j } = require('node:path') as typeof import('node:path')
  return { FAKE_HOME: mk(j(td(), 'r18-home-')), FAKE_STATE: mk(j(td(), 'r18-state-')) }
})

vi.mock('@/lib/ecosystem-constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ecosystem-constants')>()
  const { fakeEcosystemPaths } = await import('@/tests/helpers/fake-ecosystem-home')
  return fakeEcosystemPaths(actual, FAKE_HOME, FAKE_STATE)
})

const mockGetAgent = vi.fn()
const mockUpdateAgent = vi.fn()
vi.mock('@/lib/agent-registry', () => ({
  getAgent: (...a: unknown[]) => mockGetAgent(...a),
  updateAgent: (...a: unknown[]) => mockUpdateAgent(...a),
}))

const mockScanAgentLocalConfig = vi.fn()
vi.mock('@/services/agent-local-config-service', () => ({
  scanAgentLocalConfig: (...a: unknown[]) => mockScanAgentLocalConfig(...a),
}))

const mockFindNative = vi.fn()
const mockGetUniversalIR = vi.fn()
const mockEmitForClient = vi.fn()
const mockConvertAndStore = vi.fn()
vi.mock('@/services/plugin-storage-service', () => ({
  findNativePluginForClient: (...a: unknown[]) => mockFindNative(...a),
  getUniversalIR: (...a: unknown[]) => mockGetUniversalIR(...a),
  emitForClient: (...a: unknown[]) => mockEmitForClient(...a),
  convertAndStorePlugin: (...a: unknown[]) => mockConvertAndStore(...a),
}))

const mockUninstall = vi.fn()
const mockInstall = vi.fn()
vi.mock('@/lib/client-plugin-adapters', () => ({
  getAdapter: vi.fn(async () => ({ uninstall: mockUninstall, install: mockInstall })),
}))

vi.mock('@/lib/client-capabilities', () => ({
  clientTypeToProviderId: (c: string) => `provider-${c}`,
}))

vi.mock('@/lib/ledger-emit', () => ({ emitAgentOp: vi.fn(async () => undefined) }))

import { ChangeClient } from '@/services/element-management-service'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const AGENT_ID = 'agent-under-test'
const CORE = 'ai-maestro-plugin'
const ROLE = 'ai-maestro-programmer-agent'
const EXTRA = 'some-normal-plugin'

/** The caller every test uses: a system-owner, so gate0Auth short-circuits at G00. */
const SYSTEM_OWNER = { isSystemOwner: true } as unknown as Parameters<typeof ChangeClient>[2]

let agentDir: string
const REAL_HOME = process.env.HOME

const agentFixture = (over: Record<string, unknown> = {}) => ({
  id: AGENT_ID,
  name: 'test-agent',
  program: 'claude',
  workingDirectory: agentDir,
  governanceTitle: 'member',
  ...over,
})

/** A scan result carrying a role-plugin, the core plugin, and one ordinary plugin. */
const scanFixture = (plugins: Array<{ name: string; marketplace?: string }> = [
  { name: CORE, marketplace: 'ai-maestro-plugins' },
  { name: EXTRA, marketplace: 'some-marketplace' },
]) => ({
  data: {
    rolePlugin: { name: ROLE, marketplace: 'ai-maestro-plugins' },
    plugins,
  },
})

/** Names the pipeline actually asked the new-client adapter to install. */
const installedNames = () => mockInstall.mock.calls.map(c => (c[0] as { name: string }).name).sort()

beforeEach(() => {
  vi.clearAllMocks()
  process.env.HOME = FAKE_HOME
  agentDir = mkdtempSync(join(tmpdir(), 'r18-agentdir-'))

  mockGetAgent.mockReturnValue(agentFixture())
  mockUpdateAgent.mockResolvedValue(true)
  mockScanAgentLocalConfig.mockReturnValue(scanFixture())

  // Default resolution: every plugin already has a native version for the target client, which is
  // the R18.3d-preferred path and keeps the converter out of the picture unless a test wants it.
  mockFindNative.mockImplementation(async (name: string) => `/native/${name}`)
  mockGetUniversalIR.mockResolvedValue(null)
  mockEmitForClient.mockResolvedValue(null)
  mockConvertAndStore.mockResolvedValue(undefined)
  mockUninstall.mockResolvedValue(undefined)
  mockInstall.mockResolvedValue(undefined)
})

afterAll(() => {
  if (REAL_HOME === undefined) delete process.env.HOME
  else process.env.HOME = REAL_HOME
})

// ---------------------------------------------------------------------------
// R18.1 — the agent is NEVER left without its plugins
// Guard: services/element-management-service.ts:5697-5727 (ChangeClient::G06)
// ---------------------------------------------------------------------------

describe('R18.1 — an agent is never left without its plugins', () => {
  it('ABORTS before touching the agent directory when one plugin cannot be resolved', async () => {
    /**
     * The whole rule in one assertion: if even ONE plugin has no path to the new client, nothing is
     * uninstalled. A pipeline that uninstalled first and discovered the problem afterwards would
     * leave the agent with neither the old plugins nor the new ones — the exact state R18 exists to
     * make impossible.
     */
    mockFindNative.mockImplementation(async (name: string) => (name === EXTRA ? null : `/native/${name}`))
    mockConvertAndStore.mockRejectedValue(new Error('no source to convert from'))

    const res = await ChangeClient(AGENT_ID, 'codex', SYSTEM_OWNER)

    expect(res.success).toBe(false)
    expect(res.error).toMatch(/R18 violation/)
    expect(mockUninstall).not.toHaveBeenCalled()
    expect(mockInstall).not.toHaveBeenCalled()
    expect(mockUpdateAgent).not.toHaveBeenCalled()
  })

  it('succeeds and installs EVERY snapshotted plugin when all of them resolve', async () => {
    /** The positive control: without it, the abort test above would pass on a pipeline that always failed. */
    const res = await ChangeClient(AGENT_ID, 'codex', SYSTEM_OWNER)

    expect(res.success).toBe(true)
    expect(installedNames()).toEqual([CORE, ROLE, EXTRA].sort())
  })
})

// ---------------------------------------------------------------------------
// R18.2 — snapshot BEFORE uninstalling anything
// Guard: services/element-management-service.ts:5568-5607 (ChangeClient::G05)
// ---------------------------------------------------------------------------

describe('R18.2 — the plugin set is snapshotted before anything is uninstalled', () => {
  it('scans the agent config BEFORE the first uninstall call', async () => {
    /**
     * Ordering is the rule. Reading the installed set after uninstalling would snapshot an already
     * emptied directory, so the "preserve everything" promise would preserve nothing.
     */
    const order: string[] = []
    mockScanAgentLocalConfig.mockImplementation(() => { order.push('scan'); return scanFixture() })
    mockUninstall.mockImplementation(async () => { order.push('uninstall') })

    await ChangeClient(AGENT_ID, 'codex', SYSTEM_OWNER)

    expect(order[0]).toBe('scan')
    expect(order).toContain('uninstall')
  })

  it('aborts when the scan itself fails, rather than proceeding on an empty snapshot', async () => {
    /**
     * A failed scan is indistinguishable from "this agent has no plugins" unless the pipeline says
     * so. Treating the error as an empty set would uninstall nothing and install nothing, and
     * report success — silently dropping every plugin on the next scan.
     */
    mockScanAgentLocalConfig.mockReturnValue({ error: 'cannot read .claude/' })

    const res = await ChangeClient(AGENT_ID, 'codex', SYSTEM_OWNER)

    expect(res.success).toBe(false)
    expect(res.error).toMatch(/Failed to scan agent config/)
    expect(mockUninstall).not.toHaveBeenCalled()
  })

  it('carries a DISABLED plugin through the change — the snapshot is not filtered by enablement', async () => {
    /**
     * R18.2 says "enabled AND disabled". A pipeline that preserved only enabled plugins would
     * silently delete the disabled ones, and the agent would never get them back.
     */
    mockScanAgentLocalConfig.mockReturnValue(
      scanFixture([
        { name: CORE, marketplace: 'ai-maestro-plugins' },
        { name: 'a-disabled-plugin', marketplace: 'some-marketplace' },
      ]),
    )

    await ChangeClient(AGENT_ID, 'codex', SYSTEM_OWNER)

    expect(installedNames()).toContain('a-disabled-plugin')
  })
})

// ---------------------------------------------------------------------------
// R18.3 — resolution order: native first, then IR emit, then fresh conversion
// Guard: services/element-management-service.ts:5645-5727 (ChangeClient::G06)
// ---------------------------------------------------------------------------

describe('R18.3 / R18.3d — native sources are preferred over any conversion', () => {
  it('uses the native version and does NOT convert or emit when one already exists', async () => {
    /**
     * Conversion is lossy in every direction. A native plugin is authoritative, so re-deriving one
     * that already exists would DOWNGRADE a working plugin — the rule's whole point.
     */
    await ChangeClient(AGENT_ID, 'codex', SYSTEM_OWNER)

    expect(mockFindNative).toHaveBeenCalled()
    expect(mockEmitForClient).not.toHaveBeenCalled()
    expect(mockConvertAndStore).not.toHaveBeenCalled()
  })

  it('falls back to emitting from the Universal IR when no native version exists', async () => {
    /** Step (b): an IR is a richer source than a fresh parse of a reduced-format plugin. */
    mockFindNative.mockResolvedValue(null)
    mockGetUniversalIR.mockResolvedValue({ name: 'ir' })
    mockEmitForClient.mockImplementation(async (name: string) => `/emitted/${name}`)

    const res = await ChangeClient(AGENT_ID, 'codex', SYSTEM_OWNER)

    expect(res.success).toBe(true)
    expect(mockEmitForClient).toHaveBeenCalled()
    expect(mockConvertAndStore).not.toHaveBeenCalled()
  })

  it('falls back to a fresh conversion only when there is neither a native version nor an IR', async () => {
    /** Step (c), the last resort — reached only after (a) and (b) have both come up empty. */
    mockFindNative.mockResolvedValue(null)
    mockGetUniversalIR.mockResolvedValue(null)
    mockEmitForClient.mockResolvedValue(null)
    let converted = false
    mockConvertAndStore.mockImplementation(async () => { converted = true })
    mockEmitForClient.mockImplementation(async () => (converted ? '/converted/dir' : null))

    const res = await ChangeClient(AGENT_ID, 'codex', SYSTEM_OWNER)

    expect(res.success).toBe(true)
    expect(mockConvertAndStore).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// R18.5 — the core plugin rides the same pipeline (R17 stays satisfied)
// Guard: services/element-management-service.ts:5594-5605 (ChangeClient::G05b)
// ---------------------------------------------------------------------------

describe('R18.5 — the core plugin is carried across the client change', () => {
  it('adds ai-maestro-plugin to the snapshot even when the scan did not see it', async () => {
    /**
     * The safety net that keeps R17 true through a client change. An agent on a NON-Claude client
     * keeps its core plugin outside `.claude/`, so the scan legitimately misses it — and without
     * this gate the client change would be the moment the mandatory plugin quietly disappeared.
     */
    mockScanAgentLocalConfig.mockReturnValue(scanFixture([{ name: EXTRA, marketplace: 'm' }]))

    const res = await ChangeClient(AGENT_ID, 'codex', SYSTEM_OWNER)

    expect(res.success).toBe(true)
    expect(installedNames()).toContain(CORE)
    expect(res.operations.some(o => o.startsWith('G05b:'))).toBe(true)
  })

  it('does not duplicate the core plugin when the scan already reported it', async () => {
    /** The net is a net, not a second install path. */
    await ChangeClient(AGENT_ID, 'codex', SYSTEM_OWNER)
    expect(installedNames().filter(n => n === CORE)).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// R18.7 — a successful change requires a client restart
// Guard: services/element-management-service.ts:5889-5891 (ChangeClient::G10)
// ---------------------------------------------------------------------------

describe('R18.7 — a successful client change reports restartNeeded', () => {
  it('sets restartNeeded on success', async () => {
    /**
     * The new client binary has to be relaunched for the converted plugins to load. Reporting
     * success without it leaves a running agent on the OLD binary with the NEW plugin set on disk.
     */
    const res = await ChangeClient(AGENT_ID, 'codex', SYSTEM_OWNER)
    expect(res.success).toBe(true)
    expect(res.restartNeeded).toBe(true)
  })

  it('does NOT claim a restart is needed when the change aborted', async () => {
    /** A restart prompt after a no-op abort would be a lie the operator has to act on. */
    mockScanAgentLocalConfig.mockReturnValue({ error: 'boom' })
    const res = await ChangeClient(AGENT_ID, 'codex', SYSTEM_OWNER)
    expect(res.success).toBe(false)
    expect(res.restartNeeded).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// R18.10 — the governance title survives the client change untouched
// Guard: services/element-management-service.ts:5882 (ChangeClient::G09)
// ---------------------------------------------------------------------------

describe('R18.10 — the agent governance title does not change', () => {
  it('writes ONLY the program field to the registry', async () => {
    /**
     * An absence-invariant, pinned in the inverse direction: there is no guard to delete, so the
     * test asserts what the write does NOT contain. If a future edit folded a title update into
     * G09 — say, "reset to autonomous because the role-plugin was re-emitted" — the R11 title↔plugin
     * binding would silently break and every other test here would stay green.
     */
    await ChangeClient(AGENT_ID, 'codex', SYSTEM_OWNER)

    expect(mockUpdateAgent).toHaveBeenCalledTimes(1)
    const patch = mockUpdateAgent.mock.calls[0][1] as Record<string, unknown>
    expect(patch).toEqual({ program: 'codex' })
    expect(Object.keys(patch)).not.toContain('governanceTitle')
  })

  it('does not write to the registry at all when the pipeline aborts', async () => {
    /** A registry that says "codex" for an agent whose directory still holds Claude plugins is
     * worse than a failed change, because nothing downstream can tell it apart from a real one. */
    mockScanAgentLocalConfig.mockReturnValue({ error: 'boom' })
    await ChangeClient(AGENT_ID, 'codex', SYSTEM_OWNER)
    expect(mockUpdateAgent).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// R18.9 — ChangeClient must not route the role-plugin through syncRolePlugin
// Guard: services/element-management-service.ts:5517-5908 (the whole function body)
// ---------------------------------------------------------------------------

describe('R18.9 — the role-plugin is converted explicitly, not via syncRolePlugin', () => {
  it('carries the role-plugin through the SAME conversion plan as every other plugin', async () => {
    /**
     * HONEST SCOPE. `syncRolePlugin` is module-internal, so a test cannot spy on it — the literal
     * "does not call X" half is pinned by a static check (grep) recorded in the map's citation,
     * not here. What IS pinnable, and what the rule is actually protecting, is the CONSEQUENCE:
     * the role-plugin is resolved and installed through the ordinary plan path, so it is never
     * subject to syncRolePlugin's Claude-assuming title→plugin map.
     */
    await ChangeClient(AGENT_ID, 'codex', SYSTEM_OWNER)

    expect(installedNames()).toContain(ROLE)
    // Installed for the NEW client, from a resolved source — i.e. via the plan, not a title lookup.
    const roleCall = mockInstall.mock.calls.find(c => (c[0] as { name: string }).name === ROLE)
    expect((roleCall?.[0] as { clientType: string }).clientType).toBe('codex')
    expect((roleCall?.[0] as { storageDir: string }).storageDir).toBeTruthy()
  })
})
