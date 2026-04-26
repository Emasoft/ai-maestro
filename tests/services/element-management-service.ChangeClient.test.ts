/**
 * ChangeClient pipeline tests (PROP-P0-002, SCEN-016 11th-HOUR proposal).
 *
 * Covers the R18.4 "abort before uninstall" invariant that could not be
 * exercised from the UI (SCEN-016 S023 deferred this to a unit test because
 * the dashboard has no "hide a plugin from disk" affordance).
 *
 * The fixture wires up mocks for:
 *   - agent-registry (getAgent / updateAgent)
 *   - agent-local-config-service (scanAgentLocalConfig — the snapshot source)
 *   - plugin-storage-service (convertAndStorePlugin, emitForClient, etc. —
 *     the conversion resolver that decides if R18.3d succeeds or fails)
 *   - client-plugin-adapters (install / uninstall spies)
 *   - authorization (G0 is short-circuited via isSystemOwner: true)
 *   - fs (to spy on the belt-and-braces settings.local.json strip / write-back)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeAgent, resetFixtureCounter } from '../test-utils/fixtures'

// ============================================================================
// Mocks — vi.hoisted() makes these available before any import is resolved
// ============================================================================

const {
  mockExecFileAsync,
  mockFsExistsSync,
  mockFsReadFileSync,
  mockFsWriteFileSync,
  mockFsMkdirSync,
  mockAgentRegistry,
  mockClientCapabilities,
  mockScanAgentLocalConfig,
  mockConvertAndStorePlugin,
  mockEmitForClient,
  mockGetUniversalIR,
  mockFindNativePluginForClient,
  mockGetAdapter,
  mockOldAdapter,
  mockNewAdapter,
  mockTryEmitLedgerOp,
} = vi.hoisted(() => {
  const oldAdapter = {
    install: vi.fn().mockResolvedValue(undefined),
    uninstall: vi.fn().mockResolvedValue(undefined),
  }
  const newAdapter = {
    install: vi.fn().mockResolvedValue(undefined),
    uninstall: vi.fn().mockResolvedValue(undefined),
  }
  return {
    mockExecFileAsync: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    mockFsExistsSync: vi.fn().mockReturnValue(false),
    mockFsReadFileSync: vi.fn().mockReturnValue('{}'),
    mockFsWriteFileSync: vi.fn(),
    mockFsMkdirSync: vi.fn(),
    mockAgentRegistry: {
      getAgent: vi.fn(),
      updateAgent: vi.fn().mockResolvedValue({ id: 'agent-1' }),
    },
    mockClientCapabilities: {
      detectClientType: vi.fn().mockReturnValue('claude'),
      clientTypeToProviderId: vi.fn().mockReturnValue('claude'),
    },
    mockScanAgentLocalConfig: vi.fn(),
    mockConvertAndStorePlugin: vi.fn().mockResolvedValue(undefined),
    mockEmitForClient: vi.fn().mockResolvedValue('/home/test/emitted'),
    mockGetUniversalIR: vi.fn().mockResolvedValue(null),
    mockFindNativePluginForClient: vi.fn().mockResolvedValue(null),
    mockGetAdapter: vi.fn((client: string) => {
      if (client === 'claude') return oldAdapter
      if (client === 'codex') return newAdapter
      return null
    }),
    mockOldAdapter: oldAdapter,
    mockNewAdapter: newAdapter,
    mockTryEmitLedgerOp: vi.fn().mockResolvedValue(undefined),
  }
})

// Mock child_process for any CLI invocations (not expected in ChangeClient but safe)
vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => {
    const cb = args[args.length - 1] as (
      err: Error | null,
      result: { stdout: string; stderr: string },
    ) => void
    mockExecFileAsync(args[0], args[1], args[2])
      .then((r: { stdout: string; stderr: string }) => cb(null, r))
      .catch((err: Error) => cb(err, { stdout: '', stderr: '' }))
  },
}))

// fs — ChangeClient uses existsSync + readFileSync/writeFileSync/mkdirSync
// via `await import('fs')` and `require('fs')`. Both paths hit this mock.
vi.mock('fs', () => ({
  existsSync: mockFsExistsSync,
  readFileSync: mockFsReadFileSync,
  writeFileSync: mockFsWriteFileSync,
  mkdirSync: mockFsMkdirSync,
  default: {
    existsSync: mockFsExistsSync,
    readFileSync: mockFsReadFileSync,
    writeFileSync: mockFsWriteFileSync,
    mkdirSync: mockFsMkdirSync,
  },
}))

vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('{}'),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  rm: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockRejectedValue(new Error('ENOENT')),
}))

vi.mock('@/lib/agent-registry', () => mockAgentRegistry)
vi.mock('@/lib/client-capabilities', () => mockClientCapabilities)

vi.mock('@/services/agent-local-config-service', () => ({
  scanAgentLocalConfig: mockScanAgentLocalConfig,
}))

vi.mock('@/services/plugin-storage-service', () => ({
  convertAndStorePlugin: mockConvertAndStorePlugin,
  emitForClient: mockEmitForClient,
  getUniversalIR: mockGetUniversalIR,
  findNativePluginForClient: mockFindNativePluginForClient,
}))

vi.mock('@/lib/client-plugin-adapters', () => ({
  getAdapter: mockGetAdapter,
}))

// Ledger emit is side-channel — stub to avoid pulling in crypto/ledger state.
// The real module lives elsewhere in element-management-service internals; the
// service imports it via a local helper (`tryEmitLedgerOp`), which we don't
// directly mock here because it's internal. Instead we ensure writeFileSync
// never blocks the flow by always resolving.

// ============================================================================
// authContext — the 2026-04-19 refactor makes this mandatory. isSystemOwner
// short-circuits G0 authorization (see gate0Auth in element-management-service).
// ============================================================================
const _tAuth = { isSystemOwner: true as const }

// ============================================================================
// Helpers to build scanAgentLocalConfig return values
// ============================================================================

function makeSnapshot(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    data: {
      workingDirectory: '/home/test/agent-1',
      skills: [],
      agents: [],
      hooks: [],
      rules: [],
      commands: [],
      mcpServers: [],
      lspServers: [],
      outputStyles: [],
      plugins: [
        {
          name: 'ai-maestro-plugin',
          key: 'ai-maestro-plugin@ai-maestro-plugins',
          path: '/home/test/agent-1',
          marketplace: 'ai-maestro-plugins',
          enabled: true,
        },
      ],
      rolePlugin: null,
      globalDependencies: null,
      settings: {},
      userGlobalSettings: null,
      keybindings: null,
      lastScanned: new Date().toISOString(),
      ...overrides,
    },
    status: 200,
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('element-management-service.ChangeClient (R18 pipeline)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetFixtureCounter()
    mockFsExistsSync.mockReturnValue(false)
    mockFsReadFileSync.mockReturnValue('{}')
    mockOldAdapter.install.mockClear()
    mockOldAdapter.uninstall.mockClear()
    mockNewAdapter.install.mockClear()
    mockNewAdapter.uninstall.mockClear()
    mockNewAdapter.install.mockResolvedValue(undefined)
    mockOldAdapter.uninstall.mockResolvedValue(undefined)
    mockGetUniversalIR.mockResolvedValue(null)
    mockFindNativePluginForClient.mockResolvedValue(null)
    mockEmitForClient.mockResolvedValue('/home/test/emitted')
    mockConvertAndStorePlugin.mockResolvedValue(undefined)
    mockAgentRegistry.updateAgent.mockResolvedValue({ id: 'agent-1', program: 'codex' })
    mockClientCapabilities.clientTypeToProviderId.mockReturnValue('claude')
    // getAdapter returns the right adapter based on client
    mockGetAdapter.mockImplementation((client: string) => {
      if (client === 'claude') return mockOldAdapter
      if (client === 'codex') return mockNewAdapter
      return null
    })
  })

  // --------------------------------------------------------------------------
  // Test A — Abort-before-uninstall path (R18.4 invariant)
  //
  // If the resolver cannot find a source for even ONE plugin in the snapshot,
  // ChangeClient MUST abort at G06 BEFORE any uninstall call runs. This is the
  // invariant that keeps an agent from being stripped of its core plugin when
  // a conversion target is unreachable.
  // --------------------------------------------------------------------------
  describe('R18.4 — abort before uninstall when a plugin cannot be converted', () => {
    it('aborts without uninstalling when one plugin has no resolvable source', async () => {
      /**
       * When the snapshot has 2 plugins (core + "missing") and the conversion
       * resolver throws for "missing", the pipeline must return with an error
       * BEFORE reaching G07 (uninstall old). R18.4 invariant.
       */
      const agent = makeAgent({
        id: 'agent-1',
        workingDirectory: '/home/test/agent-1',
        program: 'claude',
      })
      mockAgentRegistry.getAgent.mockReturnValue(agent)

      // Snapshot: 2 plugins — the core + an unresolvable one.
      mockScanAgentLocalConfig.mockReturnValue(
        makeSnapshot({
          plugins: [
            {
              name: 'ai-maestro-plugin',
              key: 'ai-maestro-plugin@ai-maestro-plugins',
              path: '/home/test/agent-1',
              marketplace: 'ai-maestro-plugins',
              enabled: true,
            },
            {
              name: 'missing-plugin',
              key: 'missing-plugin@some-marketplace',
              path: '/home/test/agent-1',
              marketplace: 'some-marketplace',
              enabled: true,
            },
          ],
        }),
      )

      // Resolver succeeds for ai-maestro-plugin (native cache exists)
      // and fails for missing-plugin — no native, no IR, fresh conversion throws.
      mockFindNativePluginForClient.mockImplementation(
        async (name: string, _client: string) => {
          if (name === 'ai-maestro-plugin') return '/cache/ai-maestro-plugin/2.5.2'
          return null
        },
      )
      mockGetUniversalIR.mockResolvedValue(null) // no IR for either plugin
      // Fresh conversion throws for missing-plugin (last-resort path).
      mockConvertAndStorePlugin.mockImplementation(async (name: string) => {
        if (name === 'missing-plugin') {
          throw new Error('source folder not found on disk')
        }
        return undefined
      })

      const { ChangeClient } = await import('@/services/element-management-service')
      const result = await ChangeClient('agent-1', 'codex', _tAuth)

      // R18.4 invariant: operation aborted
      expect(result.success).toBe(false)
      expect(result.error).toContain('missing-plugin')

      // CRITICAL: no uninstall on the old client
      expect(mockOldAdapter.uninstall).not.toHaveBeenCalled()
      // CRITICAL: no install on the new client
      expect(mockNewAdapter.install).not.toHaveBeenCalled()
      // CRITICAL: registry program NOT updated
      expect(mockAgentRegistry.updateAgent).not.toHaveBeenCalled()
      // CRITICAL: no write to settings.local.json
      expect(mockFsWriteFileSync).not.toHaveBeenCalled()
    })

    it('aborts with a restart-needed=false signal (no partial state exposed)', async () => {
      /**
       * Even when aborting, ChangeResult must not leave restartNeeded:true or
       * success:true. The caller should see a clean failure.
       */
      const agent = makeAgent({
        id: 'agent-1',
        workingDirectory: '/home/test/agent-1',
        program: 'claude',
      })
      mockAgentRegistry.getAgent.mockReturnValue(agent)

      mockScanAgentLocalConfig.mockReturnValue(
        makeSnapshot({
          plugins: [
            {
              name: 'ai-maestro-plugin',
              key: 'ai-maestro-plugin@ai-maestro-plugins',
              path: '/home/test/agent-1',
              marketplace: 'ai-maestro-plugins',
              enabled: true,
            },
            {
              name: 'unreachable',
              key: 'unreachable@mktp',
              path: '/home/test/agent-1',
              marketplace: 'mktp',
              enabled: true,
            },
          ],
        }),
      )

      mockFindNativePluginForClient.mockImplementation(
        async (name: string) => (name === 'ai-maestro-plugin' ? '/cache/x' : null),
      )
      mockConvertAndStorePlugin.mockRejectedValue(new Error('convert failed'))

      const { ChangeClient } = await import('@/services/element-management-service')
      const result = await ChangeClient('agent-1', 'codex', _tAuth)

      expect(result.success).toBe(false)
      expect(result.restartNeeded).toBe(false)
      expect(result.error).toBeTruthy()
    })
  })

  // --------------------------------------------------------------------------
  // Test B — Success path
  //
  // All plugins resolve, G06→G10 all run, the registry is updated, and the
  // belt-and-braces settings write-back fires for Claude targets. For a Codex
  // target, the Claude side's settings strip fires instead.
  // --------------------------------------------------------------------------
  describe('success path — Claude → Codex with one resolvable plugin', () => {
    it('runs G06 → G09, updates registry, strips Claude settings, flags restart', async () => {
      /**
       * Happy path: one plugin, native cache exists for codex target. The
       * pipeline uninstalls on Claude adapter, installs on Codex adapter,
       * updates agent.program, and sets restartNeeded=true.
       */
      const agent = makeAgent({
        id: 'agent-1',
        workingDirectory: '/home/test/agent-1',
        program: 'claude',
      })
      mockAgentRegistry.getAgent.mockReturnValue(agent)

      // Single plugin in snapshot — the core plugin.
      mockScanAgentLocalConfig.mockReturnValue(makeSnapshot())

      // Native cache has a Codex version ready to install.
      mockFindNativePluginForClient.mockImplementation(
        async (_name: string, client: string) =>
          client === 'codex' ? '/cache/ai-maestro-plugin-codex/2.5.2' : null,
      )

      // For the settings-strip belt-and-braces code path:
      //   1. existsSync(.claude/settings.local.json) → true
      //   2. readFileSync returns current settings with the core plugin enabled
      //   3. writeFileSync is called with the key removed
      mockFsExistsSync.mockImplementation((p: string) => {
        if (typeof p !== 'string') return false
        return p.endsWith('.claude/settings.local.json') || p.includes('.claude')
      })
      mockFsReadFileSync.mockImplementation((p: unknown) => {
        if (typeof p === 'string' && p.endsWith('.claude/settings.local.json')) {
          return JSON.stringify({
            enabledPlugins: { 'ai-maestro-plugin@ai-maestro-plugins': true },
          })
        }
        return '{}'
      })

      const { ChangeClient } = await import('@/services/element-management-service')
      const result = await ChangeClient('agent-1', 'codex', _tAuth)

      // Overall success + restart flag
      expect(result.success).toBe(true)
      expect(result.restartNeeded).toBe(true)
      expect(result.error).toBeUndefined()

      // G07 — old (Claude) adapter uninstall ran
      expect(mockOldAdapter.uninstall).toHaveBeenCalled()
      // G08 — new (Codex) adapter install ran
      expect(mockNewAdapter.install).toHaveBeenCalled()
      // G09 — registry was updated to codex
      expect(mockAgentRegistry.updateAgent).toHaveBeenCalledWith(
        'agent-1',
        expect.objectContaining({ program: 'codex' }),
      )

      // Belt-and-braces: the Claude settings-strip fallback writes
      // settings.local.json back without the old plugin key.
      const wrote = mockFsWriteFileSync.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).endsWith('settings.local.json'),
      )
      expect(wrote).toBeTruthy()
      const writtenData = JSON.parse(String(wrote![1]))
      // The old Claude plugin key should have been stripped out.
      expect(
        writtenData.enabledPlugins?.['ai-maestro-plugin@ai-maestro-plugins'],
      ).toBeUndefined()
    })

    it('no-op when client already matches', async () => {
      /**
       * G03 guards against a wasted pipeline when the client is unchanged.
       * The function must return success without any adapter calls.
       */
      const agent = makeAgent({
        id: 'agent-1',
        workingDirectory: '/home/test/agent-1',
        program: 'codex',
      })
      mockAgentRegistry.getAgent.mockReturnValue(agent)

      const { ChangeClient } = await import('@/services/element-management-service')
      const result = await ChangeClient('agent-1', 'codex', _tAuth)

      expect(result.success).toBe(true)
      expect(mockOldAdapter.uninstall).not.toHaveBeenCalled()
      expect(mockNewAdapter.install).not.toHaveBeenCalled()
      expect(mockAgentRegistry.updateAgent).not.toHaveBeenCalled()
    })
  })

  // --------------------------------------------------------------------------
  // Test C — Validation
  // --------------------------------------------------------------------------
  describe('input validation', () => {
    it('rejects invalid client values', async () => {
      /** G01: unknown client names are rejected before any snapshot is taken. */
      const agent = makeAgent({
        id: 'agent-1',
        workingDirectory: '/home/test/agent-1',
        program: 'claude',
      })
      mockAgentRegistry.getAgent.mockReturnValue(agent)

      const { ChangeClient } = await import('@/services/element-management-service')
      const result = await ChangeClient('agent-1', 'not-a-client', _tAuth)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid client')
      expect(mockScanAgentLocalConfig).not.toHaveBeenCalled()
      expect(mockOldAdapter.uninstall).not.toHaveBeenCalled()
    })

    it('requires authContext', async () => {
      /** The 2026-04-19 security refactor makes authContext mandatory. */
      const { ChangeClient } = await import('@/services/element-management-service')
      // @ts-expect-error intentionally missing authContext
      const result = await ChangeClient('agent-1', 'codex', undefined)

      expect(result.success).toBe(false)
      expect(result.error).toContain('authContext')
    })
  })
})
