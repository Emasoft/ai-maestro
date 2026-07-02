/**
 * ChangeClient — R18.3d Priority Decision Matrix
 *
 * Supplements `tests/integration/change-client-matrix.test.ts` with deeper
 * coverage of the R18.3d priority chain. Where the existing file tests the
 * outer gates (auth, agent existence, no-op, signature), this file tests
 * the INNER decision: when ChangeClient walks a plugin through the priority
 * order to find its source, which branch did it pick?
 *
 * R18.3d priority order (see CLAUDE.md §"ChangeClient — Plugin Continuity"):
 *   1. Client-native plugin cache (~/.<client>/plugins/cache/)
 *      → `findNativePluginForClient(name, newClient)` returns a path → reuse, no conversion
 *   2. Local role-plugins marketplace (~/agents/role-plugins/<name>/)
 *      → compatible-clients in .agent.toml includes the target → reuse
 *   3. Previously emitted custom-plugins (~/agents/custom-plugins/<client>/<name>/)
 *      → directory exists → reuse
 *   4. Universal IR emit
 *      → `getUniversalIR(name)` returns non-null → `emitForClient(name, newClient)` is called ONCE
 *   5. Fresh conversion (absolute last resort)
 *      → `convertAndStorePlugin(name, source, [newClient])` is called, then emit
 *
 * R18.3b invariant (locked separately in change-client-matrix.test.ts):
 *   - X → Claude with no canonical Claude source must REFUSE before any
 *     uninstall. This file adds a concrete mock-driven test for that path.
 *
 * Mocks:
 *   - `@/lib/agent-registry` — stub agent record, capture updateAgent calls
 *   - `@/services/agent-local-config-service` — return a fake snapshot of
 *     installed plugins
 *   - `@/services/plugin-storage-service` — all four R18.3d branching
 *     functions: findNativePluginForClient, getUniversalIR, emitForClient,
 *     convertAndStorePlugin (so we can verify exact call sequence)
 *   - `@/lib/client-plugin-adapters` — stub install/uninstall so the
 *     pipeline runs to G09 without touching the filesystem
 *   - `@/lib/client-capabilities` — stub clientTypeToProviderId
 *   - `fs` — existsSync is consulted for priority steps 2 and 3 (role-plugin
 *     and custom-plugins directory existence). We mock it to return false
 *     for those paths by default so the pipeline falls through to the
 *     correct priority level being tested.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Hoisted mock refs ────────────────────────────────────────────────────

const {
  mockGetAgent,
  mockUpdateAgent,
  mockScanAgentLocalConfig,
  mockFindNativePluginForClient,
  mockGetUniversalIR,
  mockEmitForClient,
  mockConvertAndStorePlugin,
  mockGetAdapter,
  mockClientTypeToProviderId,
  mockExistsSync,
} = vi.hoisted(() => ({
  mockGetAgent: vi.fn(),
  mockUpdateAgent: vi.fn(),
  mockScanAgentLocalConfig: vi.fn(),
  mockFindNativePluginForClient: vi.fn(),
  mockGetUniversalIR: vi.fn(),
  mockEmitForClient: vi.fn(),
  mockConvertAndStorePlugin: vi.fn(),
  mockGetAdapter: vi.fn(),
  mockClientTypeToProviderId: vi.fn(),
  mockExistsSync: vi.fn(),
}))

// ─── Module mocks ─────────────────────────────────────────────────────────

vi.mock('@/lib/agent-registry', () => ({
  getAgent: mockGetAgent,
  updateAgent: mockUpdateAgent,
  loadAgents: vi.fn(() => []),
  saveAgents: vi.fn(),
}))

vi.mock('@/services/agent-local-config-service', () => ({
  scanAgentLocalConfig: mockScanAgentLocalConfig,
}))

vi.mock('@/services/plugin-storage-service', () => ({
  findNativePluginForClient: mockFindNativePluginForClient,
  getUniversalIR: mockGetUniversalIR,
  emitForClient: mockEmitForClient,
  convertAndStorePlugin: mockConvertAndStorePlugin,
}))

vi.mock('@/lib/client-plugin-adapters', () => ({
  getAdapter: mockGetAdapter,
}))

vi.mock('@/lib/client-capabilities', () => ({
  clientTypeToProviderId: mockClientTypeToProviderId,
}))

// fs.existsSync is called by ChangeClient for:
//   - priority 2: role-plugin .agent.toml + folder
//   - priority 3: custom-plugins suffix/unsuffixed folders
// Default to FALSE so tests drive specific branches by overriding.
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    existsSync: mockExistsSync,
  }
})

// ─── Helpers ──────────────────────────────────────────────────────────────

const TEST_AGENT_ID = 'agent-r18-test'
const TEST_AGENT_DIR = '/tmp/r18-test-agent'

function seedValidAgent(oldClient: 'claude' | 'codex' | 'gemini' | 'opencode' | 'kiro' = 'claude') {
  mockGetAgent.mockReturnValue({
    id: TEST_AGENT_ID,
    name: 'r18-test',
    program: oldClient,
    workingDirectory: TEST_AGENT_DIR,
  })
}

function seedSingleNormalPlugin(pluginName: string, marketplace = 'ai-maestro-plugins') {
  // ChangeClient's snapshot starts from scanAgentLocalConfig. Provide the
  // minimal shape it reads: { rolePlugin?, plugins[] }.
  //
  // IMPORTANT: we always include `ai-maestro-plugin` in the snapshot because
  // ChangeClient's G05b step auto-adds it as a safety net if missing (R17
  // invariant: the core plugin is mandatory on every agent). Including it
  // up-front avoids the duplicate "we added ai-maestro-plugin too" path
  // from firing extra conversion/emit calls during the test, which would
  // make per-test call-count assertions flaky.
  const plugins: Array<{ name: string; marketplace?: string; enabled: boolean }> = [
    { name: pluginName, marketplace, enabled: true },
  ]
  if (pluginName !== 'ai-maestro-plugin') {
    plugins.push({ name: 'ai-maestro-plugin', marketplace: 'ai-maestro-plugins', enabled: true })
  }
  mockScanAgentLocalConfig.mockReturnValue({
    data: {
      rolePlugin: null,
      plugins,
    },
    error: null,
  })
}

function stubAdapters() {
  // Provide minimal old/new adapters so the pipeline can run through G07/G08
  // without throwing. Install and uninstall are no-ops; the test cares about
  // the resolution calls that happened BEFORE adapter invocation.
  mockGetAdapter.mockResolvedValue({
    install: vi.fn(async () => undefined),
    uninstall: vi.fn(async () => undefined),
  })
  mockClientTypeToProviderId.mockImplementation((client: string) => {
    const map: Record<string, string> = {
      claude: 'claude-code',
      codex: 'codex',
      gemini: 'gemini',
      opencode: 'opencode',
      kiro: 'kiro',
    }
    return map[client] || null
  })
  mockUpdateAgent.mockResolvedValue(true)
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('ChangeClient — R18.3d priority decision matrix', () => {
  beforeEach(() => {
    mockGetAgent.mockReset()
    mockUpdateAgent.mockReset()
    mockScanAgentLocalConfig.mockReset()
    mockFindNativePluginForClient.mockReset()
    mockGetUniversalIR.mockReset()
    mockEmitForClient.mockReset()
    mockConvertAndStorePlugin.mockReset()
    mockGetAdapter.mockReset()
    mockClientTypeToProviderId.mockReset()
    mockExistsSync.mockReset()

    // Default: existsSync returns false for everything (so priority 2 and 3
    // are skipped unless a test overrides). Tests that want priority 2 or 3
    // to fire will .mockImplementation to return true for the right path.
    mockExistsSync.mockReturnValue(false)
    stubAdapters()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('Priority 1: native plugin in target client cache — reuse, no conversion calls', async () => {
    // Aim: when findNativePluginForClient returns a real path for the
    // target client, the pipeline MUST use it as-is and MUST NOT call
    // emitForClient or convertAndStorePlugin. This is the "cheapest, safest,
    // loss-free" path and skipping it would trigger lossy conversion for
    // no reason.
    seedValidAgent('claude')
    seedSingleNormalPlugin('ai-maestro-plugin')

    // Priority 1 hit: native codex plugin already exists in ~/.codex/plugins/cache/
    mockFindNativePluginForClient.mockImplementation(
      (_name: string, client: string) => {
        return client === 'codex'
          ? '/Users/test/.codex/plugins/cache/ai-maestro-plugin'
          : null
      },
    )

    const { ChangeClient } = await import('@/services/element-management-service')
    const result = await ChangeClient(
      TEST_AGENT_ID,
      'codex',
      { isSystemOwner: true as const },
    )

    expect(result.success).toBe(true)
    // findNativePluginForClient must have been called with the target client.
    expect(mockFindNativePluginForClient).toHaveBeenCalledWith(
      'ai-maestro-plugin',
      'codex',
    )
    // NO conversion calls at priority 1.
    expect(mockConvertAndStorePlugin).not.toHaveBeenCalled()
    expect(mockEmitForClient).not.toHaveBeenCalled()
  })

  it('Priority 3: previously emitted custom-plugin — reuse, no conversion calls', async () => {
    // Aim: when no client-native plugin exists (priority 1 miss) and no
    // role-plugin marketplace match (priority 2 miss), but a previously
    // emitted custom-plugin directory is present, ChangeClient must reuse
    // it without re-emitting. Re-emitting would waste time AND could
    // overwrite user edits inside the custom-plugins dir.
    seedValidAgent('claude')
    seedSingleNormalPlugin('my-custom-plugin')

    // The core `ai-maestro-plugin` is ALSO in the snapshot (R17). Give it a
    // priority-1 hit so it doesn't trigger conversion side-effects that
    // would pollute this test's assertions. `my-custom-plugin` gets priority
    // 1 miss → priority 3 hit.
    mockFindNativePluginForClient.mockImplementation(
      async (name: string, client: string) => {
        if (name === 'ai-maestro-plugin' && client === 'codex') {
          return '/Users/test/.codex/plugins/cache/ai-maestro-plugin'
        }
        return null
      },
    )

    // Priority 3 hit: ~/agents/custom-plugins/codex/my-custom-plugin-codex/ exists.
    mockExistsSync.mockImplementation((p: string) => {
      // Match the custom-plugins suffixed path; that's the first one checked.
      return typeof p === 'string' && p.endsWith('custom-plugins/codex/my-custom-plugin-codex')
    })

    const { ChangeClient } = await import('@/services/element-management-service')
    const result = await ChangeClient(
      TEST_AGENT_ID,
      'codex',
      { isSystemOwner: true as const },
    )

    expect(result.success).toBe(true)
    // Neither `my-custom-plugin` (priority 3) nor `ai-maestro-plugin`
    // (priority 1) should have triggered conversion or emit.
    expect(mockConvertAndStorePlugin).not.toHaveBeenCalled()
    expect(mockEmitForClient).not.toHaveBeenCalled()
  })

  it('Priority 4: Universal IR emit — exactly one emitForClient call, no fresh conversion', async () => {
    // Aim: when priorities 1/2/3 all miss but a Universal IR exists for
    // the plugin, ChangeClient must emit from the IR (priority 4) and NOT
    // call convertAndStorePlugin (priority 5). The IR is the already-
    // processed abstract form — regenerating it from source would be
    // wasteful and potentially lossy (source may have been modified).
    seedValidAgent('claude')
    seedSingleNormalPlugin('plugin-with-ir')

    // Route the core `ai-maestro-plugin` to priority 1 (native) so it
    // doesn't pollute conversion/emit call counts.
    mockFindNativePluginForClient.mockImplementation(
      async (name: string, client: string) => {
        if (name === 'ai-maestro-plugin' && client === 'codex') {
          return '/Users/test/.codex/plugins/cache/ai-maestro-plugin'
        }
        return null
      },
    )
    // Priority 2 and 3 misses (default existsSync returns false) for the
    // test plugin. Priority 4 hit:
    mockGetUniversalIR.mockImplementation(async (name: string) => {
      if (name === 'plugin-with-ir') {
        // Minimal IR shape — ChangeClient only checks non-null.
        return { meta: {}, components: {} }
      }
      return null
    })
    // When emitForClient is called, return a fake emitted dir path.
    mockEmitForClient.mockImplementation(async (name: string, _client: string) => {
      if (name === 'plugin-with-ir') {
        return '/Users/test/agents/custom-plugins/codex/plugin-with-ir'
      }
      return null
    })

    const { ChangeClient } = await import('@/services/element-management-service')
    const result = await ChangeClient(
      TEST_AGENT_ID,
      'codex',
      { isSystemOwner: true as const },
    )

    expect(result.success).toBe(true)
    // Emit MUST be called exactly once (priority 4 hit for plugin-with-ir).
    // ai-maestro-plugin hits priority 1, no emit needed.
    expect(mockEmitForClient).toHaveBeenCalledTimes(1)
    expect(mockEmitForClient).toHaveBeenCalledWith('plugin-with-ir', 'codex')
    // Fresh conversion (priority 5) MUST NOT fire.
    expect(mockConvertAndStorePlugin).not.toHaveBeenCalled()
  })

  it('Priority 5: fresh conversion when all higher priorities miss', async () => {
    // Aim: when no native plugin exists, no role-plugin match, no
    // custom-plugins, and no Universal IR, ChangeClient MUST fall back to
    // convertAndStorePlugin (the most expensive, potentially lossy path).
    // After conversion, emitForClient is called to materialize the new-
    // client artifact. Both functions must fire, in that order.
    seedValidAgent('claude')
    seedSingleNormalPlugin('plugin-needs-conversion')

    mockFindNativePluginForClient.mockImplementation(
      async (name: string, client: string) => {
        // Route the core `ai-maestro-plugin` to priority 1 (native codex)
        // so it does NOT trigger conversion and pollute the counts.
        if (name === 'ai-maestro-plugin' && client === 'codex') {
          return '/Users/test/.codex/plugins/cache/ai-maestro-plugin'
        }
        // For `plugin-needs-conversion`: priority 1 miss for codex.
        // But ChangeClient also queries for 'claude' as a potential
        // CONVERSION SOURCE when it reaches priority 5 (see
        // `conversionSource = claudeCanonical ? 'claude' : oldProgram`).
        // Return a Claude source so the conversion has something to work
        // from.
        if (name === 'plugin-needs-conversion' && client === 'claude') {
          return '/Users/test/.claude/plugins/cache/ai-maestro-plugins/plugin-needs-conversion/v1'
        }
        return null
      },
    )
    // Priority 2 and 3 misses via existsSync default.
    // Priority 4 miss: IR does not exist.
    mockGetUniversalIR.mockResolvedValue(null)
    // Priority 5: conversion succeeds, then emit returns a dir.
    mockConvertAndStorePlugin.mockResolvedValue({
      abstractDir: '/tmp/.abstract/plugin-needs-conversion',
      emittedDirs: {
        codex: '/tmp/custom-plugins/codex/plugin-needs-conversion',
      },
    })
    mockEmitForClient.mockResolvedValue(
      '/tmp/custom-plugins/codex/plugin-needs-conversion',
    )

    const { ChangeClient } = await import('@/services/element-management-service')
    const result = await ChangeClient(
      TEST_AGENT_ID,
      'codex',
      { isSystemOwner: true as const },
    )

    expect(result.success).toBe(true)
    // Conversion MUST happen for plugin-needs-conversion (once). The core
    // plugin hit priority 1 so did not convert.
    expect(mockConvertAndStorePlugin).toHaveBeenCalledTimes(1)
    expect(mockConvertAndStorePlugin).toHaveBeenCalledWith(
      'plugin-needs-conversion',
      'claude', // conversion source when Claude canonical exists
      ['codex'],
    )
    // emitForClient is called AFTER conversion to materialize output dir.
    expect(mockEmitForClient).toHaveBeenCalled()
    expect(mockEmitForClient).toHaveBeenCalledWith(
      'plugin-needs-conversion',
      'codex',
    )
  })

  it('R18.3b: X → Claude with no canonical Claude source must REFUSE before uninstall', async () => {
    // Aim: this is the single most important R18 invariant. When converting
    // FROM a non-Claude client TO Claude, ChangeClient MUST NOT attempt a
    // lossy X→Claude conversion. If priorities 1-4 all miss, the pipeline
    // must abort with an R18.3b violation error BEFORE any uninstall call.
    // Losing a plugin during a client change is unacceptable — the agent
    // must remain usable even if the change fails.
    seedValidAgent('codex')
    seedSingleNormalPlugin('plugin-without-claude-source')

    // Priority 1 miss for Claude: no cached Claude version.
    mockFindNativePluginForClient.mockResolvedValue(null)
    // Priority 2, 3 miss via existsSync default false.
    // Priority 4 miss: no IR.
    mockGetUniversalIR.mockResolvedValue(null)

    const { ChangeClient } = await import('@/services/element-management-service')
    const result = await ChangeClient(
      TEST_AGENT_ID,
      'claude',
      { isSystemOwner: true as const },
    )

    expect(result.success).toBe(false)
    // The error message must mention R18.3b or equivalent rejection text.
    expect(result.error).toMatch(/R18\.3b|no canonical Claude|X.+Claude/i)
    // Fresh conversion MUST NOT have been attempted — X→Claude is forbidden.
    expect(mockConvertAndStorePlugin).not.toHaveBeenCalled()
    // And critically: the adapter's UNINSTALL must not have been invoked.
    // We verify this by checking updateAgent was NOT called with a program
    // change — if ChangeClient had reached G09, updateAgent would carry the
    // new program. A pre-uninstall refusal means updateAgent never fires.
    const programUpdateCall = mockUpdateAgent.mock.calls.find(
      (call: unknown[]) => {
        const patch = call[1] as { program?: string } | undefined
        return patch && 'program' in patch
      },
    )
    expect(programUpdateCall).toBeUndefined()
  })

  it('Priority order is strict: priority 1 hit short-circuits, no later calls', async () => {
    // Aim: the priority chain must be evaluated strictly in order. If
    // priority 1 hits, priorities 2-5 must not even be consulted. This
    // prevents accidentally triggering a conversion when a native plugin
    // is right there. Uses a priority-1 hit and asserts that neither IR
    // lookup nor conversion is called.
    seedValidAgent('claude')
    seedSingleNormalPlugin('ai-maestro-plugin')

    mockFindNativePluginForClient.mockImplementation(
      (_name: string, client: string) => {
        return client === 'codex'
          ? '/Users/test/.codex/plugins/cache/ai-maestro-plugin'
          : null
      },
    )

    const { ChangeClient } = await import('@/services/element-management-service')
    const result = await ChangeClient(
      TEST_AGENT_ID,
      'codex',
      { isSystemOwner: true as const },
    )

    expect(result.success).toBe(true)
    // Priority 4 function NOT called (short-circuit at priority 1).
    expect(mockGetUniversalIR).not.toHaveBeenCalled()
    // Priority 5 function NOT called.
    expect(mockConvertAndStorePlugin).not.toHaveBeenCalled()
    expect(mockEmitForClient).not.toHaveBeenCalled()
  })
})
