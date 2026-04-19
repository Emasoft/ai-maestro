/**
 * InstallElement — Codex client adapter routing (SCEN-013 P0-001)
 *
 * Background (SCEN-013 P0-001):
 *   When InstallElement runs for a non-Claude client like `codex`, the EXE
 *   phase MUST route through the per-client adapter — NOT through the
 *   `claude plugin install` CLI call nor the direct `.claude/settings.local.json`
 *   fallback write. Writing `.claude/settings.local.json` for a codex agent
 *   creates an orphan config the codex CLI never reads; the core
 *   `ai-maestro-plugin` ends up functionally dead even though the Config tab
 *   shows "Plugins 1" with the "core" badge.
 *
 *   The fix (commit 4f76714) introduces `useClientAdapter` which is `true`
 *   when `clientType !== 'claude' && clientType !== 'unknown'`. In that case:
 *     - EXE install → adapter.install({ name, clientType, storageDir, providerId }, agentDir)
 *     - EXE uninstall → adapter.uninstall(...)
 *     - PG01 verification → adapter.detectState(name, agentDir)
 *
 *   The Claude path is left byte-for-byte identical.
 *
 * Scope: this test pins the contract that:
 *   1. For Codex, the `claude plugin install` CLI is NEVER called.
 *   2. `getAdapter('codex')` is invoked and its `install` method is called.
 *   3. The adapter install receives the `convertedDir` from G13 as `storageDir`.
 *   4. PG01 reads state via the adapter, not via `.claude/settings.local.json`.
 *   5. For Claude, the old behaviour is preserved (CLI OR settings write).
 *
 * This is the unit-test complement to tests/scenarios/SCEN-013_*.scen.md and
 * tests/integration/createagent-g11-r17-core.test.ts (which only covers
 * `claude` + capability-gated `aider`, not the codex install path end-to-end).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const {
  mockExecFileAsync,
  mockFsExistsSync,
  mockFsReadFile,
  mockFsWriteFile,
  mockFsMkdir,
  mockDetectClientType,
  mockClientTypeToProviderId,
  mockConvertAndStore,
  mockEmitForClient,
  mockAdapterInstall,
  mockAdapterUninstall,
  mockAdapterDetectState,
  mockGetAdapter,
} = vi.hoisted(() => {
  return {
    mockExecFileAsync: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    mockFsExistsSync: vi.fn().mockReturnValue(false),
    mockFsReadFile: vi.fn().mockResolvedValue('{}'),
    mockFsWriteFile: vi.fn().mockResolvedValue(undefined),
    mockFsMkdir: vi.fn().mockResolvedValue(undefined),
    mockDetectClientType: vi.fn(),
    mockClientTypeToProviderId: vi.fn(),
    mockConvertAndStore: vi.fn(),
    mockEmitForClient: vi.fn(),
    mockAdapterInstall: vi.fn(),
    mockAdapterUninstall: vi.fn(),
    mockAdapterDetectState: vi.fn(),
    mockGetAdapter: vi.fn(),
  }
})

// child_process: promisified execFile is used for `claude plugin install` CLI.
// The Codex path must NEVER hit this mock.
vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => {
    const cb = args[args.length - 1] as (err: Error | null, result: { stdout: string; stderr: string }) => void
    mockExecFileAsync(args[0], args[1], args[2])
      .then((r: { stdout: string; stderr: string }) => cb(null, r))
      .catch((err: Error) => cb(err, { stdout: '', stderr: '' }))
  },
}))

vi.mock('fs', () => ({
  existsSync: mockFsExistsSync,
}))

vi.mock('fs/promises', () => ({
  readFile: mockFsReadFile,
  writeFile: mockFsWriteFile,
  mkdir: mockFsMkdir,
  readdir: vi.fn().mockResolvedValue([]),
  rm: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
}))

vi.mock('@/lib/agent-registry', () => ({
  getAgent: vi.fn(),
  updateAgent: vi.fn(async () => undefined),
}))

vi.mock('@/lib/client-capabilities', () => ({
  detectClientType: mockDetectClientType,
  getClientCapabilities: vi.fn(() => ({
    plugins: true, skills: true, agents: true, hooks: true,
  })),
  clientTypeToProviderId: mockClientTypeToProviderId,
}))

vi.mock('@/services/plugin-storage-service', () => ({
  convertAndStorePlugin: mockConvertAndStore,
  emitForClient: mockEmitForClient,
  findNativePluginForClient: vi.fn(async () => null),
  getUniversalIR: vi.fn(async () => null),
}))

vi.mock('@/lib/client-plugin-adapters', () => ({
  getAdapter: mockGetAdapter,
}))

vi.mock('@/lib/ecosystem-constants', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ecosystem-constants')>('@/lib/ecosystem-constants')
  return {
    ...actual,
  }
})

describe('InstallElement — Codex adapter routing (SCEN-013 P0-001)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFsExistsSync.mockReturnValue(false)
    mockFsReadFile.mockResolvedValue('{}')
    mockDetectClientType.mockReturnValue('codex')
    mockClientTypeToProviderId.mockReturnValue('codex')
    mockConvertAndStore.mockResolvedValue(undefined)
    mockEmitForClient.mockResolvedValue('/tmp/custom-plugins/codex/ai-maestro-plugin')

    // Default adapter returns success install/uninstall and a clean
    // "installed+enabled" state for PG01 verification.
    mockAdapterInstall.mockResolvedValue({
      success: true,
      installedPaths: ['/tmp/test-agent/.codex-plugin/plugin.json'],
    })
    mockAdapterUninstall.mockResolvedValue({ success: true })
    mockAdapterDetectState.mockResolvedValue({
      installed: true, enabled: true, method: 'manifest',
    })
    mockGetAdapter.mockResolvedValue({
      clientType: 'codex',
      supportsEnableDisable: false,
      install: mockAdapterInstall,
      uninstall: mockAdapterUninstall,
      enable: vi.fn().mockResolvedValue({ success: true }),
      disable: vi.fn().mockResolvedValue({ success: true }),
      detectState: mockAdapterDetectState,
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  /**
   * Core contract: for codex, the EXE phase routes through getAdapter('codex').install(…).
   * The `claude plugin install` CLI MUST NOT be called. Historical bug: the old
   * code called `claude plugin install` unconditionally, wrote to
   * .claude/settings.local.json on failure, and the codex CLI never saw the plugin.
   */
  it('codex install: routes through getAdapter(codex).install, NOT claude CLI', async () => {
    const { InstallElement } = await import('@/services/element-management-service')
    const result = await InstallElement({
      name: 'ai-maestro-plugin',
      marketplace: 'ai-maestro-plugins',
      action: 'install',
      scope: 'local',
      agentDir: '/tmp/test-codex-agent',
      clientType: 'codex',
    })

    // 1. The codex adapter was resolved
    expect(mockGetAdapter).toHaveBeenCalledWith('codex')

    // 2. adapter.install() was called with the correct StoredPlugin shape
    expect(mockAdapterInstall).toHaveBeenCalledTimes(1)
    const [storedPlugin, targetDir, options] = mockAdapterInstall.mock.calls[0]
    expect(storedPlugin).toMatchObject({
      name: 'ai-maestro-plugin',
      clientType: 'codex',
      providerId: 'codex',
    })
    expect(typeof storedPlugin.storageDir).toBe('string')
    expect(storedPlugin.storageDir.length).toBeGreaterThan(0)
    expect(targetDir).toBe('/tmp/test-codex-agent')
    expect(options).toMatchObject({ scope: 'local' })

    // 3. The Claude CLI fallback MUST NOT have run.
    const claudeInstallCalls = mockExecFileAsync.mock.calls.filter(
      (c: unknown[]) => c[0] === 'claude'
        && Array.isArray(c[1])
        && (c[1] as string[])[0] === 'plugin'
        && (c[1] as string[])[1] === 'install',
    )
    expect(claudeInstallCalls).toHaveLength(0)

    // 4. The direct settings.local.json write MUST NOT have happened either
    //    (that was the historical fallback — per-client adapter replaces it).
    const settingsWrites = mockFsWriteFile.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string'
        && (c[0] as string).includes('settings.local.json'),
    )
    expect(settingsWrites).toHaveLength(0)

    // 5. Ops log should mention the codex-adapter install path
    expect(result.success).toBe(true)
    const adapterOp = result.operations.find(op =>
      op.startsWith('EXE:') && /codex-adapter/i.test(op),
    )
    expect(adapterOp).toBeDefined()
  })

  /**
   * G13 conversion feeds `convertedDir` into the codex adapter install.
   * If G13 returns a non-null directory, it must be passed as storageDir —
   * not discarded (which was the original SCEN-013 P0-001 symptom: convertedDir
   * was computed but never read).
   */
  it('codex install: G13 convertedDir is forwarded as adapter storageDir', async () => {
    mockEmitForClient.mockResolvedValue('/tmp/custom-plugins/codex/ai-maestro-plugin')

    const { InstallElement } = await import('@/services/element-management-service')
    await InstallElement({
      name: 'ai-maestro-plugin',
      marketplace: 'ai-maestro-plugins',
      action: 'install',
      scope: 'local',
      agentDir: '/tmp/test-codex-agent',
      clientType: 'codex',
    })

    expect(mockAdapterInstall).toHaveBeenCalledTimes(1)
    const [storedPlugin] = mockAdapterInstall.mock.calls[0]
    expect(storedPlugin.storageDir).toBe('/tmp/custom-plugins/codex/ai-maestro-plugin')
  })

  /**
   * G13 converts via Universal IR before the adapter install runs —
   * this is what guarantees a non-Claude native artifact exists to copy.
   */
  it('codex install: G13 runs convertAndStorePlugin before adapter install', async () => {
    const { InstallElement } = await import('@/services/element-management-service')
    await InstallElement({
      name: 'ai-maestro-plugin',
      marketplace: 'ai-maestro-plugins',
      action: 'install',
      scope: 'local',
      agentDir: '/tmp/test-codex-agent',
      clientType: 'codex',
    })

    expect(mockConvertAndStore).toHaveBeenCalled()
    const convertCall = mockConvertAndStore.mock.calls.find(
      (c: unknown[]) => c[0] === 'ai-maestro-plugin',
    )
    expect(convertCall).toBeDefined()
    // The R18 signature: convertAndStorePlugin(name, 'claude', [target])
    expect(convertCall).toEqual(['ai-maestro-plugin', 'claude', ['codex']])
  })

  /**
   * PG01 verification for codex clients must go through adapter.detectState().
   * If the legacy path fires (reading .claude/settings.local.json), we get
   * a false "plugin missing" warning because codex never writes there.
   */
  it('codex install: PG01 verifies via adapter.detectState, not .claude/settings.local.json', async () => {
    const { InstallElement } = await import('@/services/element-management-service')
    const result = await InstallElement({
      name: 'ai-maestro-plugin',
      marketplace: 'ai-maestro-plugins',
      action: 'install',
      scope: 'local',
      agentDir: '/tmp/test-codex-agent',
      clientType: 'codex',
    })

    // detectState was invoked on the codex adapter
    expect(mockAdapterDetectState).toHaveBeenCalledWith('ai-maestro-plugin', '/tmp/test-codex-agent')

    // PG01 ops reflect the adapter-based verification, not the claude legacy
    const pg01Op = result.operations.find(op => op.startsWith('PG01:'))
    expect(pg01Op).toBeDefined()
    expect(pg01Op).toMatch(/codex-adapter/i)
  })

  /**
   * When PG01 reports the plugin is not installed/enabled, the result must
   * reflect failure — otherwise orphan plugins pass silently through the pipeline.
   */
  it('codex install: PG01 failure (adapter reports not installed) fails the result', async () => {
    mockAdapterDetectState.mockResolvedValue({
      installed: false, enabled: false, method: 'manifest',
    })

    const { InstallElement } = await import('@/services/element-management-service')
    const result = await InstallElement({
      name: 'ai-maestro-plugin',
      marketplace: 'ai-maestro-plugins',
      action: 'install',
      scope: 'local',
      agentDir: '/tmp/test-codex-agent',
      clientType: 'codex',
    })

    expect(result.success).toBe(false)
    const pg01Op = result.operations.find(op => op.startsWith('PG01:'))
    expect(pg01Op).toMatch(/WARN/)
  })

  /**
   * Uninstall on codex also routes through the adapter — symmetric with
   * install. Legacy path would have called `claude plugin uninstall` which
   * the codex CLI doesn't understand.
   */
  it('codex uninstall: routes through adapter.uninstall, NOT claude CLI', async () => {
    // Fake an idempotency miss: settings say plugin IS installed under the
    // matching plugin key. G10's currentlyInstalled check matches on substring
    // (`Object.keys(ep).find(k => k.includes(name))`), so the key MUST include
    // the plugin name for uninstall to reach the EXE block.
    mockFsExistsSync.mockReturnValue(true)
    mockFsReadFile.mockResolvedValue(JSON.stringify({
      enabledPlugins: { 'my-custom-plugin@ai-maestro-plugins': true },
    }))
    // Adapter reports the plugin present so uninstall is not a no-op
    mockAdapterDetectState.mockResolvedValue({
      installed: true, enabled: true, method: 'manifest',
    })

    const { InstallElement } = await import('@/services/element-management-service')
    // Note: R17 core plugin uninstall is guarded elsewhere; test with a
    // non-core name to avoid G08 core-plugin guard tripping.
    await InstallElement({
      name: 'my-custom-plugin',
      marketplace: 'ai-maestro-plugins',
      action: 'uninstall',
      scope: 'local',
      agentDir: '/tmp/test-codex-agent',
      clientType: 'codex',
    })

    expect(mockGetAdapter).toHaveBeenCalledWith('codex')
    expect(mockAdapterUninstall).toHaveBeenCalledTimes(1)

    const claudeUninstallCalls = mockExecFileAsync.mock.calls.filter(
      (c: unknown[]) => c[0] === 'claude'
        && Array.isArray(c[1])
        && (c[1] as string[])[0] === 'plugin'
        && (c[1] as string[])[1] === 'uninstall',
    )
    expect(claudeUninstallCalls).toHaveLength(0)
  })

  /**
   * Claude parity: the original code path (CLI + settings write fallback)
   * must remain untouched. Passing `clientType: 'claude'` bypasses the
   * adapter system entirely.
   */
  it('claude install: adapter is NOT consulted, original CLI path runs', async () => {
    mockDetectClientType.mockReturnValue('claude')

    const { InstallElement } = await import('@/services/element-management-service')
    await InstallElement({
      name: 'ai-maestro-plugin',
      marketplace: 'ai-maestro-plugins',
      action: 'install',
      scope: 'local',
      agentDir: '/tmp/test-claude-agent',
      clientType: 'claude',
    })

    // Adapter must NOT have been consulted for Claude — this is the
    // core claude-parity invariant: the pre-adapter-fix behaviour is
    // preserved byte-for-byte for Claude clients.
    expect(mockGetAdapter).not.toHaveBeenCalled()
    expect(mockAdapterInstall).not.toHaveBeenCalled()

    // The Claude path either calls the CLI or writes settings directly.
    // PG01 verification may still report failure because the mocked fs
    // reads back empty settings (the fallback writeFile mock does not
    // persist) — that's outside the scope of this adapter-parity test.
    const usedCliOrDirect =
      mockExecFileAsync.mock.calls.some(
        (c: unknown[]) => c[0] === 'claude'
          && Array.isArray(c[1])
          && (c[1] as string[])[0] === 'plugin',
      )
      || mockFsWriteFile.mock.calls.some(
        (c: unknown[]) => typeof c[0] === 'string'
          && (c[0] as string).includes('settings.local.json'),
      )
    expect(usedCliOrDirect).toBe(true)
  })
})
