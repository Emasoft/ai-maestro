/**
 * TRDD-K71FV649 — InstallElement PG01: an UNKNOWN must not be reported as a VIOLATION.
 *
 * THE LIVE BUG THIS PINS (measured 2026-07-31, not hypothetical):
 *   PG01's Claude branch does not merely warn — every arm sets `result.success = false`, and PG02
 *   turns that into `corePluginMissing: true` in the REGISTRY, which the wake route then refuses to
 *   start the agent on. With the lenient reader, a corrupt `.claude/settings.local.json` was read as
 *   `{}`, the key looked ABSENT, and a perfectly correct install therefore reported FAILURE and
 *   bricked the agent's wake — on the strength of a file nothing could read.
 *
 * The honest branch was already in the code: PG01's `catch` says "Could not read settings for
 * verification" and pointedly does NOT flip `success`. It could never fire, because `loadJsonSafe`
 * does not throw. Reading strictly makes it reachable.
 *
 * ⚠ WHAT MAKES THIS NON-VACUOUS. Asserting only "success is not false" would pass on a pipeline
 * that never reached PG01 at all, and asserting only the WARN string would pass while `success` was
 * still flipped underneath it. The three assertions must hold TOGETHER: PG01 ran and said it could
 * not read (the WARN), PG01 did NOT claim the plugin is missing (no "not found" op), and the
 * registry was NOT told the core plugin is missing (PG02's write).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const {
  mockExecFileAsync, mockFsExistsSync, mockFsReadFile, mockFsWriteFile, mockFsMkdir,
  mockDetectClientType, mockClientTypeToProviderId, mockUpdateAgent, mockGetAdapter,
} = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
  mockFsExistsSync: vi.fn().mockReturnValue(false),
  mockFsReadFile: vi.fn().mockResolvedValue('{}'),
  mockFsWriteFile: vi.fn().mockResolvedValue(undefined),
  mockFsMkdir: vi.fn().mockResolvedValue(undefined),
  mockDetectClientType: vi.fn(),
  mockClientTypeToProviderId: vi.fn(),
  mockUpdateAgent: vi.fn(async () => undefined),
  mockGetAdapter: vi.fn(),
}))

vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => {
    const cb = args[args.length - 1] as (e: Error | null, r: { stdout: string; stderr: string }) => void
    mockExecFileAsync(args[0], args[1], args[2])
      .then((r: { stdout: string; stderr: string }) => cb(null, r))
      .catch((err: Error) => cb(err, { stdout: '', stderr: '' }))
  },
}))
vi.mock('fs', () => ({ existsSync: mockFsExistsSync }))
vi.mock('fs/promises', () => ({
  readFile: mockFsReadFile,
  writeFile: mockFsWriteFile,
  mkdir: mockFsMkdir,
  readdir: vi.fn().mockResolvedValue([]),
  rm: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
}))
vi.mock('@/lib/agent-registry', () => ({ getAgent: vi.fn(), updateAgent: mockUpdateAgent }))
vi.mock('@/lib/client-capabilities', () => ({
  detectClientType: mockDetectClientType,
  getClientCapabilities: vi.fn(() => ({ plugins: true, skills: true, agents: true, hooks: true })),
  clientTypeToProviderId: mockClientTypeToProviderId,
}))
vi.mock('@/lib/client-plugin-adapters', () => ({ getAdapter: mockGetAdapter }))
vi.mock('@/services/plugin-storage-service', () => ({
  convertAndStorePlugin: vi.fn(), emitForClient: vi.fn(),
  findNativePluginForClient: vi.fn(async () => null), getUniversalIR: vi.fn(async () => null),
}))

const TEST_AUTH = {
  isSystemOwner: true, agentId: undefined, governanceTitle: 'system' as const, teamId: null,
}
const AGENT_DIR = '/tmp/k71-pg01-agent'
const SETTINGS = `${AGENT_DIR}/.claude/settings.local.json`
/** Truncated mid-write — and it still holds the very key PG01 is looking for, so a reader that
 *  could parse it would say "present". That is what makes "not found" a lie rather than a guess. */
const CORRUPT = '{ "enabledPlugins": { "ai-maestro-plugin@ai-maestro-plugins": true'

const install = async () => {
  const { InstallElement } = await import('@/services/element-management-service')
  return InstallElement({
    name: 'ai-maestro-plugin',
    marketplace: 'ai-maestro-plugins',
    action: 'install',
    scope: 'local',
    agentDir: AGENT_DIR,
    clientType: 'claude',
    agentId: 'agent-k71',
  }, TEST_AUTH)
}

describe('PG01 — a settings file it cannot read is UNKNOWN, not ABSENT', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDetectClientType.mockReturnValue('claude')
    mockFsWriteFile.mockResolvedValue(undefined)
    mockFsMkdir.mockResolvedValue(undefined)
    mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })
    // Only the settings file exists — everything else absent, so no other gate is perturbed.
    mockFsExistsSync.mockImplementation((p: string) => String(p) === SETTINGS)
    mockFsReadFile.mockImplementation(async (p: string) =>
      String(p) === SETTINGS ? CORRUPT : '{}')
  })
  afterEach(() => vi.clearAllMocks())

  it('says it could not READ — not that the plugin is missing', async () => {
    const r = await install()
    const ops = (r.operations ?? []).join('\n')
    expect(ops).toMatch(/PG01: WARN — Could not read settings for verification/)
    // The lie the lenient reader used to tell.
    expect(ops).not.toMatch(/PG01: WARN — ai-maestro-plugin not found or disabled/)
  })

  it('does NOT tell the registry the core plugin is missing — the wake-bricking half', async () => {
    await install()
    const flagged = mockUpdateAgent.mock.calls.filter(
      (c: unknown[]) => (c[1] as { corePluginMissing?: boolean })?.corePluginMissing === true)
    expect(flagged).toEqual([])
  })

  it('POSITIVE CONTROL — a READABLE file that genuinely lacks the key IS still a violation', async () => {
    // Without this, every assertion above is satisfied by a PG01 that stopped checking anything.
    mockFsReadFile.mockImplementation(async (p: string) =>
      String(p) === SETTINGS ? JSON.stringify({ enabledPlugins: { 'someone-else@mk': true } }) : '{}')
    const r = await install()
    const ops = (r.operations ?? []).join('\n')
    expect(ops).toMatch(/PG01: WARN — ai-maestro-plugin not found or disabled/)
    const flagged = mockUpdateAgent.mock.calls.filter(
      (c: unknown[]) => (c[1] as { corePluginMissing?: boolean })?.corePluginMissing === true)
    expect(flagged.length).toBeGreaterThan(0)
  })

  it('POSITIVE CONTROL — a readable file that HAS the key verifies clean', async () => {
    mockFsReadFile.mockImplementation(async (p: string) =>
      String(p) === SETTINGS
        ? JSON.stringify({ enabledPlugins: { 'ai-maestro-plugin@ai-maestro-plugins': true } })
        : '{}')
    const r = await install()
    expect((r.operations ?? []).join('\n')).toMatch(/PG01: Verified — ai-maestro-plugin present and enabled/)
  })
})
