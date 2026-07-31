/**
 * TRDD-RO90UCKQ — G11's read-back verdict is REPORTED, and the caller decides.
 *
 * ## Why the verdict is not folded into `success`
 *
 * Wiring G11 to fail on a mismatch was implemented and REVERTED the same session. `ChangePlugin` is
 * called both as an OPERATION and as an R51 COMPENSATION — `ChangeMarketplace`'s G02b undo reinstalls
 * through `InstallPlugin` → `ChangePlugin` — and on that path a failed read-back does not report
 * "the reinstall did not verify", it escalates to R51.5 and tells the user the system is in an
 * INVALID STATE requiring manual repair, about a system that was restored.
 *
 * So `verified` is separate from `success`, and it is FAIL-SAFE: a caller that ignores it behaves
 * exactly as before. The rejected alternative — an `isCompensation` input flag — has the inverse
 * property, since a compensation that forgets to set it gets the catastrophic behaviour.
 *
 * ## Why THREE values and not a boolean
 *
 * `mismatch` (read cleanly, the change did not land — a positive VIOLATION) and `unknown` (the file
 * could not be read) are the two things TRDD-K71FV649 spent a whole card separating. A boolean would
 * collapse them, and an invariant may act on a violation and never on an unknown.
 *
 * ⚠ THE LOAD-BEARING TEST IS THE LAST ONE. Everything above it would still pass if `verified` were
 * folded into `success`; only "a mismatch does NOT make the operation fail" distinguishes this
 * design from the one that broke the rollback. Its neuter is that fold.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const {
  mockExecFileAsync, mockFsExistsSync, mockFsReadFile, mockFsWriteFile, mockFsMkdir,
  mockDetectClientType, mockUpdateAgent,
} = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
  mockFsExistsSync: vi.fn().mockReturnValue(false),
  mockFsReadFile: vi.fn().mockResolvedValue('{}'),
  mockFsWriteFile: vi.fn().mockResolvedValue(undefined),
  mockFsMkdir: vi.fn().mockResolvedValue(undefined),
  mockDetectClientType: vi.fn(),
  mockUpdateAgent: vi.fn(async () => undefined),
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
  readFile: mockFsReadFile, writeFile: mockFsWriteFile, mkdir: mockFsMkdir,
  readdir: vi.fn().mockResolvedValue([]), rm: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
}))
vi.mock('@/lib/agent-registry', () => ({ getAgent: vi.fn(), updateAgent: mockUpdateAgent }))
vi.mock('@/lib/client-capabilities', () => ({
  detectClientType: mockDetectClientType,
  getClientCapabilities: vi.fn(() => ({ plugins: true, skills: true, agents: true, hooks: true })),
  clientTypeToProviderId: vi.fn(() => 'claude'),
}))

const AUTH = { isSystemOwner: true as const, agentId: undefined, governanceTitle: 'system' as const, teamId: null }
const KEY = 'my-plugin@some-marketplace'
const SETTINGS = `${process.env.HOME}/.claude/settings.json`

const install = async () => {
  const { ChangePlugin } = await import('@/services/element-management-service')
  return ChangePlugin(null, {
    name: 'my-plugin', marketplace: 'some-marketplace', action: 'install', scope: 'user',
  }, AUTH)
}

/** Only the user-scope settings file exists; its body is whatever the case under test needs. */
const seed = (body: string) => {
  mockFsExistsSync.mockImplementation((p: string) => String(p) === SETTINGS)
  mockFsReadFile.mockImplementation(async (p: string) => (String(p) === SETTINGS ? body : '{}'))
}

describe('ChangePlugin G11 — the read-back verdict is reported, not folded into success', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDetectClientType.mockReturnValue('claude')
    mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })
    mockFsWriteFile.mockResolvedValue(undefined)
    mockFsMkdir.mockResolvedValue(undefined)
  })
  afterEach(() => vi.clearAllMocks())

  it('reports `ok` when the settings file confirms the change landed', async () => {
    // THE FIXTURE MODELS THE WRITE, and it has to: G06 reads first, and if the key is ALREADY there
    // the pipeline short-circuits as an idempotent `no-op` and returns before G11 ever runs
    // (`verified` stays undefined). A fixture that returns one constant body therefore cannot reach
    // this arm at all — which is the same defect as the 13 tests this card found asserting that an
    // install "succeeded" with the plugin absent afterward: a mock that never persists the write is
    // not modelling the system, it is modelling a system where writes do nothing.
    mockFsExistsSync.mockImplementation((p: string) => String(p) === SETTINGS)
    let written = false
    mockFsReadFile.mockImplementation(async (p: string) => {
      if (String(p) !== SETTINGS) return '{}'
      const body = JSON.stringify({ enabledPlugins: written ? { [KEY]: true } : {} })
      written = true   // the CLI's write lands between G06's read and G11's read-back
      return body
    })
    const r = await install()
    expect(r.verified).toBe('ok')
    expect(r.success).toBe(true)
  })

  it('a genuine idempotent NO-OP leaves `verified` unset — and the routes are safe by construction', async () => {
    // The key is already enabled, so G06 short-circuits and G11 never runs. Every wired caller
    // checks `=== 'mismatch'`, so an unset verdict cannot be mistaken for a violation. That is the
    // fail-safe property this design was chosen for, stated as a test rather than as a hope.
    seed(JSON.stringify({ enabledPlugins: { [KEY]: true } }))
    const r = await install()
    expect(r.action).toBe('no-op')
    expect(r.success).toBe(true)
    expect(r.verified).toBeUndefined()
    expect(r.verified === 'mismatch').toBe(false)
  })

  it('reports `mismatch` when the file reads cleanly and the change is NOT there', async () => {
    seed(JSON.stringify({ enabledPlugins: { 'someone-else@mk': true } }))
    const r = await install()
    expect(r.verified).toBe('mismatch')
  })

  it('reports `unknown` — NOT `mismatch` — when the file cannot be parsed', async () => {
    // The distinction TRDD-K71FV649 exists for: unreadable is not absent, and a boolean would
    // collapse these two into one answer.
    seed('{ "enabledPlugins": { "my-plugin@some-marketplace": tr')
    const r = await install()
    expect(r.verified).toBe('unknown')
    expect(r.verified).not.toBe('mismatch')
  })

  it('THE LOAD-BEARING ONE — a mismatch does NOT make the operation fail', async () => {
    // This is the whole design. Folding the verdict into `success` breaks
    // `change-marketplace-rollback.test.ts`, because that rollback reinstalls THROUGH this function
    // and a failure there is reported as "the system is in an invalid state, manual repair
    // required" — about a system that was restored. Neuter: `if (verified==='mismatch') success=false`.
    seed(JSON.stringify({ enabledPlugins: {} }))
    const r = await install()
    expect(r.verified).toBe('mismatch')
    expect(r.success).toBe(true)
    expect(r.error).toBeUndefined()
  })
})
