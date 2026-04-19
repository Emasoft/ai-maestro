/**
 * CreateMarketplace Pipeline — Integration Regression Test
 *
 * Regression coverage for the `CreateMarketplace` pipeline introduced by
 * commit a2f90e0e ("fix(marketplaces): route add/update/delete via
 * CreateMarketplace/DeleteMarketplace/UpdateMarketplace pipelines"). Prior
 * to that commit, the POST /api/settings/marketplaces route invoked
 * `execSync('claude plugin marketplace add ...')` directly, bypassing the
 * gate pipeline entirely. This test locks in the contract: CreateMarketplace
 * always routes through `ChangeMarketplace({ action: 'add', ... })` and
 * never side-steps the gates.
 *
 * Scope:
 *   - Happy path: valid name + source → claude CLI invoked + success
 *   - Validation failure: invalid name format → rejected at G01 (no CLI call)
 *   - Missing source for `add` action → rejected at G02 (no CLI call)
 *   - AuthContext is accepted as a parameter (structural contract)
 *   - Unknown client: N/A — CreateMarketplace works with marketplace names
 *     (which are NOT per-client); the client enforcement happens in
 *     ChangeClient, not here.
 *
 * Mocking strategy:
 *   - `child_process.execFile` — we must mock this because the test
 *     environment has no `claude` CLI on PATH. Both success and failure
 *     branches are exercised.
 *   - `fs` promise APIs — left untouched; the add branch does not touch
 *     settings.json at all (only the remove branch does), so we don't need
 *     to stub the filesystem.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mocks ─────────────────────────────────────────────────────────────────

// execFile is promisified inside element-management-service at import time.
// We mock it to capture the arguments passed to the real `claude` CLI.
const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
}))

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process')
  return {
    ...actual,
    execFile: mockExecFile,
  }
})

// Default success implementation: callback-style, matching Node's execFile API
// that `util.promisify` wraps. A successful run resolves with { stdout, stderr }.
function defaultExecFileSuccess() {
  mockExecFile.mockImplementation(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout?: string, stderr?: string) => void,
    ) => {
      cb(null, '', '')
    },
  )
}

// Failure implementation — simulates `claude plugin marketplace add` failing
// (e.g., unreachable GitHub repo, invalid source).
function execFileFailure(message: string) {
  mockExecFile.mockImplementation(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout?: string, stderr?: string) => void,
    ) => {
      cb(new Error(message))
    },
  )
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('CreateMarketplace pipeline — regression coverage (commit a2f90e0e)', () => {
  beforeEach(() => {
    mockExecFile.mockReset()
    defaultExecFileSuccess()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('Happy path: new marketplace is added via `claude plugin marketplace add`', async () => {
    // Aim: prove that CreateMarketplace actually delegates to ChangeMarketplace
    // with action='add' and that a valid name+source reaches the CLI. This
    // is the core regression: prior to commit a2f90e0e, the POST route used
    // execSync directly, bypassing the gates — this test ensures the
    // pipeline IS called and returns success.
    const { CreateMarketplace } = await import('@/services/element-management-service')

    const result = await CreateMarketplace(
      { name: 'my-new-marketplace', source: { repo: 'Emasoft/example-marketplace' } },
      { isSystemOwner: true as const },
    )

    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
    expect(Array.isArray(result.operations)).toBe(true)
    expect(result.restartNeeded).toBe(true)

    // Verify the CLI was invoked with the expected args. We intentionally
    // assert the shape of the call rather than deep-compare the options
    // object — the 120s timeout is an implementation detail of the wrapper.
    expect(mockExecFile).toHaveBeenCalledTimes(1)
    const [cmd, args] = mockExecFile.mock.calls[0]
    expect(cmd).toBe('claude')
    expect(args).toEqual(['plugin', 'marketplace', 'add', 'Emasoft/example-marketplace'])

    // Operations array must document every gate that passed.
    const opsJoined = result.operations.join('\n')
    expect(opsJoined).toMatch(/G01/)
    expect(opsJoined).toMatch(/G02/)
    expect(opsJoined).toMatch(/G03/)
  })

  it('Happy path: path-based source (local marketplace)', async () => {
    // Aim: CreateMarketplace also accepts `{ path: ... }` sources for local
    // marketplaces (e.g., ~/agents/role-plugins/). This is the ecosystem's
    // local role-plugins marketplace registration path and must survive
    // any refactor of the pipeline. The CLI receives the raw path argument.
    const { CreateMarketplace } = await import('@/services/element-management-service')

    const result = await CreateMarketplace(
      { name: 'ai-maestro-local-roles-marketplace', source: { path: '/Users/test/agents/role-plugins' } },
      { isSystemOwner: true as const },
    )

    expect(result.success).toBe(true)
    expect(mockExecFile).toHaveBeenCalledTimes(1)
    const [cmd, args] = mockExecFile.mock.calls[0]
    expect(cmd).toBe('claude')
    expect(args).toEqual([
      'plugin',
      'marketplace',
      'add',
      '/Users/test/agents/role-plugins',
    ])
  })

  it('G01: rejects invalid marketplace names (path traversal, special chars, starts with dash)', async () => {
    // Aim: the name-validation regex /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/ is the
    // first line of defense against shell injection and filesystem-traversal
    // attacks. If this gate ever regresses (e.g., someone relaxes the regex
    // or skips it), this test catches it. No CLI call must be made for any
    // rejected name.
    const { CreateMarketplace } = await import('@/services/element-management-service')

    const invalidNames = [
      '../evil',           // path traversal
      '-leading-dash',     // must start with alphanumeric
      'has space',         // spaces not allowed
      'has/slash',         // slashes not allowed
      'has;semicolon',     // shell metacharacter
      'has$var',           // shell expansion attempt
      '',                  // empty name
    ]

    for (const name of invalidNames) {
      mockExecFile.mockClear()
      const result = await CreateMarketplace(
        { name, source: { repo: 'Emasoft/x' } },
        { isSystemOwner: true as const },
      )
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/invalid marketplace name/i)
      // CRITICAL: no CLI call must fire for an invalid name.
      expect(mockExecFile).not.toHaveBeenCalled()
    }
  })

  it('G02: rejects add action when source is missing', async () => {
    // Aim: for action='add', source is mandatory (either { repo } or { path }).
    // CreateMarketplace enforces this via its wrapper signature AND Gate 02
    // of ChangeMarketplace. If a caller somehow manages to invoke the
    // pipeline without a source, Gate 02 must reject before touching the CLI.
    const { CreateMarketplace } = await import('@/services/element-management-service')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await CreateMarketplace(
      { name: 'legit-name', source: undefined as any },
      { isSystemOwner: true as const },
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/source is required/i)
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('CLI failure bubbles up as the ChangeResult.error', async () => {
    // Aim: if `claude plugin marketplace add` fails (e.g., marketplace repo
    // not found, no network), the error message must appear in the
    // ChangeResult.error field. Downstream API routes rely on this to
    // present a diagnostic to the user.
    execFileFailure('repo not found: Emasoft/does-not-exist')

    const { CreateMarketplace } = await import('@/services/element-management-service')
    const result = await CreateMarketplace(
      { name: 'fail-case', source: { repo: 'Emasoft/does-not-exist' } },
      { isSystemOwner: true as const },
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/repo not found/i)
    // CLI WAS called — this proves the failure came from the CLI, not an
    // earlier gate.
    expect(mockExecFile).toHaveBeenCalledTimes(1)
  })

  it('Accepts authContext as parameter (structural contract)', async () => {
    // Aim: CreateMarketplace's signature includes `authContext?: AuthContext`.
    // While the current ChangeMarketplace implementation does NOT yet enforce
    // auth at Gate 0 (it inherits no Gate 0 from ChangeMarketplace as of
    // commit a2f90e0e), the parameter MUST be accepted without error so the
    // callers (POST /api/settings/marketplaces) can pass it through uniformly.
    //
    // If/when auth enforcement is added to ChangeMarketplace in the future,
    // this test should be expanded with a separate "rejects missing
    // authContext" case that asserts result.error matches /authContext/i.
    const { CreateMarketplace } = await import('@/services/element-management-service')

    // With authContext
    const withAuth = await CreateMarketplace(
      { name: 'with-auth', source: { repo: 'Emasoft/x' } },
      { isSystemOwner: true as const },
    )
    expect(withAuth.success).toBe(true)

    // Post-2026-04-19: authContext is MANDATORY at the type level. The old
    // "without-auth-accepted" codepath is gone — tsc rejects the call at
    // compile time, so we no longer exercise the runtime path. Callers must
    // construct a concrete AuthContext (typically via requireAuth() in
    // routes, or { isSystemOwner: true } for system-initiated work).
  })

  it('Returns a well-formed ChangeResult on every invocation', async () => {
    // Aim: every call — success, validation failure, CLI failure — must
    // return the standard ChangeResult shape ({ success, operations,
    // restartNeeded, error? }). Call sites rely on this for logging and
    // error handling.
    const { CreateMarketplace } = await import('@/services/element-management-service')

    const scenarios = [
      // success
      { args: { name: 'ok', source: { repo: 'a/b' } } as const },
      // G01 failure
      { args: { name: '../bad', source: { repo: 'a/b' } } as const },
      // G02 failure
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { args: { name: 'legit', source: undefined as any } as const },
    ]

    for (const { args } of scenarios) {
      const result = await CreateMarketplace(args, { isSystemOwner: true as const })
      expect(result).toHaveProperty('success')
      expect(typeof result.success).toBe('boolean')
      expect(result).toHaveProperty('operations')
      expect(Array.isArray(result.operations)).toBe(true)
      expect(result).toHaveProperty('restartNeeded')
      expect(typeof result.restartNeeded).toBe('boolean')
    }
  })
})
