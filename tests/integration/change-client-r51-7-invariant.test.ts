/**
 * ChangeClient R51.7 invariant — the registry-claims-the-new-client check
 *
 * Pins the `invariants` hook added to ChangeClient (TRDD-DQ6XN2VP, the R51.7 box).
 * The contradiction it catches: G08's belt-and-braces verification is claude-only,
 * so for any OTHER target client a silently no-op install would still let G09
 * write `program: <new client>` — the registry claiming a client whose plugins
 * are not on disk. The invariant re-reads the registry through `loadAgentsLoud`
 * (three-valued: valid / missing / unreadable) and treats:
 *   - found with the expected program  → valid
 *   - found with the old program       → CONTRADICTION → full reverse rollback
 *   - unreadable                       → UNKNOWN → rollback with a "could not
 *     verify" message, NOT a false-positive "the migration failed"
 *
 * Neuter map (delete the hook body's contradiction branch → tests 1-2 alone
 * red; delete the `!read.ok` branch → test 3 red with a different message).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises'

const {
  mockGetAgent,
  mockUpdateAgent,
  mockScanAgentLocalConfig,
  mockLoadAgentsLoud,
} = vi.hoisted(() => ({
  mockGetAgent: vi.fn(),
  mockUpdateAgent: vi.fn(),
  mockScanAgentLocalConfig: vi.fn(),
  mockLoadAgentsLoud: vi.fn(),
}))

vi.mock('@/lib/agent-registry', () => ({
  getAgent: mockGetAgent,
  updateAgent: mockUpdateAgent,
  loadAgents: vi.fn(() => []),
  loadAgentsLoud: mockLoadAgentsLoud,
  saveAgents: vi.fn(),
}))

vi.mock('@/services/agent-local-config-service', () => ({
  scanAgentLocalConfig: mockScanAgentLocalConfig,
}))

// Minimal no-op adapters: the tests here care about the G09 registry
// post-condition, not filesystem side effects. Without this mock the REAL
// claude adapter's assertAdapterContext guard fires (R21.4) before G07 runs.
vi.mock('@/lib/client-plugin-adapters', () => ({
  getAdapter: vi.fn(async () => ({
    install: vi.fn(async () => ({ success: true })),
    uninstall: vi.fn(async () => ({ success: true })),
    detectState: vi.fn(async () => ({ installed: true, enabled: true })),
  })),
}))

vi.mock('@/lib/client-capabilities', () => ({
  clientTypeToProviderId: vi.fn((client: string) => ({ claude: 'claude-code', codex: 'codex' }[client] ?? null)),
}))

vi.mock('@/services/plugin-storage-service', () => ({
  findNativePluginForClient: vi.fn(async () => ({ dir: '/tmp/found', strategy: 'native-exists' })),
  convertAndStorePlugin: vi.fn(async () => undefined),
  emitForClient: vi.fn(async () => '/tmp/emitted'),
  getUniversalIR: vi.fn(async () => null),
}))

describe('ChangeClient R51.7 invariants hook — the registry must actually carry the new client', () => {
  let dir: string

  beforeEach(async () => {
    mockGetAgent.mockReset()
    mockUpdateAgent.mockReset()
    mockScanAgentLocalConfig.mockReset()
    mockLoadAgentsLoud.mockReset()
    dir = await mkdtemp(join(tmpdir(), 'r51-7-changeclient-'))
    await mkdir(join(dir, '.claude'), { recursive: true })
    await writeFile(join(dir, '.claude', 'settings.local.json'), '{}', 'utf-8')
  })

  afterEach(async () => {
    vi.clearAllMocks()
    await rm(dir, { recursive: true, force: true })
  })

  const setupHappyPath = (targetProgram: string) => {
    mockGetAgent.mockReturnValue({
      id: 'agent-id',
      name: 'test-agent',
      program: 'claude',
      workingDirectory: dir,
    })
    mockScanAgentLocalConfig.mockReturnValue({ data: { plugins: [] }, status: 200 })
    // G09's updateAgent succeeds; the invariant then reads the LOUD registry.
    mockUpdateAgent.mockResolvedValue({ id: 'agent-id', program: targetProgram })
  }

  it('CONTRADICTION: registry still names the old program after G09 → the whole migration rolls back', async () => {
    setupHappyPath('codex')
    mockLoadAgentsLoud.mockResolvedValue({ ok: true, agents: [{ id: 'agent-id', program: 'claude' }] })
    const { ChangeClient } = await import('@/services/element-management-service')
    const result = await ChangeClient('agent-id', 'codex', { isSystemOwner: true as const })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/program is "claude", expected "codex"/)
    // Reverse-order unwind ran: G09's undo restored the old program.
    const undoCall = mockUpdateAgent.mock.calls.find(
      (c: unknown[]) => (c[1] as { program?: string })?.program === 'claude',
    )
    expect(undoCall).toBeTruthy()
  })

  it('VALID: registry carries the new program → success', async () => {
    setupHappyPath('codex')
    mockLoadAgentsLoud.mockResolvedValue({ ok: true, agents: [{ id: 'agent-id', program: 'codex' }] })
    const { ChangeClient } = await import('@/services/element-management-service')
    const result = await ChangeClient('agent-id', 'codex', { isSystemOwner: true as const })
    expect(result.success).toBe(true)
  })

  it('UNKNOWN: unreadable registry aborts with "could not verify", naming the reason — never a false contradiction', async () => {
    setupHappyPath('codex')
    mockLoadAgentsLoud.mockResolvedValue({ ok: false, reason: 'unreadable', error: 'EACCES' })
    const { ChangeClient } = await import('@/services/element-management-service')
    const result = await ChangeClient('agent-id', 'codex', { isSystemOwner: true as const })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/could not verify the program change/)
    expect(result.error).toMatch(/unreadable/)
    expect(result.error).toMatch(/rolled back/)
    // and it must NOT carry the contradiction message
    expect(result.error).not.toMatch(/expected "codex"/)
  })

  it('MISSING registry is also UNKNOWN (the invariant acts on unknown, not on "agent not found")', async () => {
    setupHappyPath('codex')
    mockLoadAgentsLoud.mockResolvedValue({ ok: false, reason: 'missing' })
    const { ChangeClient } = await import('@/services/element-management-service')
    const result = await ChangeClient('agent-id', 'codex', { isSystemOwner: true as const })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/could not verify the program change/)
    expect(result.error).toMatch(/missing/)
  })
})
