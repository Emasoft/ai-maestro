/**
 * DeleteMarketplace Pipeline — Integration Regression Test
 *
 * Regression coverage for the `DeleteMarketplace` pipeline introduced by
 * commit a2f90e0e. DeleteMarketplace is a thin wrapper around
 * `ChangeMarketplace({ action: 'remove', name })` that:
 *   1. Invokes `claude plugin marketplace remove <name>`
 *   2. Cleans up ~/.claude/plugins/marketplaces/<name>/ cache dir (G04)
 *   3. Removes the entry from ~/.claude/settings.json:extraKnownMarketplaces (G05)
 *
 * Scope:
 *   - Happy path: marketplace removed + CLI invoked
 *   - Invalid name format → rejected at G01 (no CLI call)
 *   - AuthContext is accepted as a parameter (structural contract)
 *   - R17 protected marketplace: `ai-maestro-plugins` is the core remote
 *     marketplace. It is a DOCUMENTED invariant that deleting it should be
 *     blocked, but that guard is NOT yet implemented in ChangeMarketplace
 *     as of commit a2f90e0e — see the `R17 protected marketplace guard`
 *     placeholder test, which is intentionally skipped until the gate
 *     ships.
 *   - Idempotency: deleting a non-existent marketplace — the current
 *     implementation delegates to the CLI, so idempotency depends on the
 *     CLI's own behavior. The test documents the current contract.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mocks ─────────────────────────────────────────────────────────────────

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

// ─── Tests ────────────────────────────────────────────────────────────────

describe('DeleteMarketplace pipeline — regression coverage (commit a2f90e0e)', () => {
  beforeEach(() => {
    mockExecFile.mockReset()
    defaultExecFileSuccess()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('Happy path: marketplace removed via `claude plugin marketplace remove`', async () => {
    // Aim: prove that DeleteMarketplace routes through ChangeMarketplace
    // with action='remove' and actually fires the CLI. This catches the
    // regression where the POST /api/settings/marketplaces DELETE route
    // used execSync directly, bypassing G04 (cache cleanup) and G05
    // (settings.json strip).
    const { DeleteMarketplace } = await import('@/services/element-management-service')

    const result = await DeleteMarketplace(
      { name: 'my-custom-marketplace' },
      { isSystemOwner: true as const },
    )

    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
    expect(Array.isArray(result.operations)).toBe(true)
    expect(result.restartNeeded).toBe(true)

    expect(mockExecFile).toHaveBeenCalledTimes(1)
    const [cmd, args] = mockExecFile.mock.calls[0]
    expect(cmd).toBe('claude')
    expect(args).toEqual(['plugin', 'marketplace', 'remove', 'my-custom-marketplace'])

    const opsJoined = result.operations.join('\n')
    expect(opsJoined).toMatch(/G01/)
    expect(opsJoined).toMatch(/G03/)
  })

  it('G01: rejects invalid marketplace names without invoking CLI', async () => {
    // Aim: Gate 01 name validation applies to remove actions too. Without
    // this gate, a malicious caller could cause shell-substitution via a
    // marketplace name like `; rm -rf ~`. The regex enforces a safe
    // allow-list of characters.
    const { DeleteMarketplace } = await import('@/services/element-management-service')

    const invalidNames = [
      '../evil',
      '; rm -rf /',
      '$HOME',
      'name with spaces',
      '',
    ]

    for (const name of invalidNames) {
      mockExecFile.mockClear()
      const result = await DeleteMarketplace(
        { name },
        { isSystemOwner: true as const },
      )
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/invalid marketplace name/i)
      expect(mockExecFile).not.toHaveBeenCalled()
    }
  })

  it('CLI failure surfaces in ChangeResult.error (no partial state claim)', async () => {
    // Aim: if `claude plugin marketplace remove` fails — typically because
    // the marketplace was never registered, or a permission error — the
    // ChangeResult must carry the error. The G04/G05 cleanup steps sit
    // AFTER the CLI call in ChangeMarketplace, so they are skipped when
    // the CLI throws. This test locks in that behavior: a CLI failure
    // does not silently "succeed".
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout?: string, stderr?: string) => void,
      ) => {
        cb(new Error('Marketplace "ghost-marketplace" is not registered'))
      },
    )

    const { DeleteMarketplace } = await import('@/services/element-management-service')
    const result = await DeleteMarketplace(
      { name: 'ghost-marketplace' },
      { isSystemOwner: true as const },
    )

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/not registered/i)
    expect(mockExecFile).toHaveBeenCalledTimes(1)
  })

  it('Accepts authContext as parameter (structural contract)', async () => {
    // Aim: DeleteMarketplace's signature includes `authContext?: AuthContext`.
    // This test enforces the signature-level contract — the ChangeMarketplace
    // gate pipeline as of commit a2f90e0e does NOT yet wire Gate 0 auth,
    // but the parameter MUST be plumbed through so route handlers can pass
    // the caller's context uniformly across all Change* functions.
    //
    // If/when auth enforcement lands in ChangeMarketplace, update this test
    // to assert that a missing authContext produces result.error matching
    // /authContext/i.
    const { DeleteMarketplace } = await import('@/services/element-management-service')

    // With authContext
    const withAuth = await DeleteMarketplace(
      { name: 'any-name' },
      { isSystemOwner: true as const },
    )
    expect(withAuth).toHaveProperty('success')
    expect(withAuth).toHaveProperty('operations')

    // Without authContext — current implementation accepts this.
    mockExecFile.mockClear()
    const withoutAuth = await DeleteMarketplace({ name: 'any-name-2' })
    expect(withoutAuth).toHaveProperty('success')
    expect(withoutAuth).toHaveProperty('operations')
    expect(Array.isArray(withoutAuth.operations)).toBe(true)
  })

  it('Returns a well-formed ChangeResult on every invocation', async () => {
    // Aim: downstream callers (POST route, server startup migrations) rely
    // on the ChangeResult shape. Every code path must return it.
    const { DeleteMarketplace } = await import('@/services/element-management-service')

    const scenarios = [
      { name: 'valid-name' },           // success path
      { name: '../traversal' },         // G01 failure
      { name: '' },                     // G01 failure (empty)
    ]

    for (const args of scenarios) {
      mockExecFile.mockClear()
      const result = await DeleteMarketplace(args, { isSystemOwner: true as const })
      expect(result).toHaveProperty('success')
      expect(typeof result.success).toBe('boolean')
      expect(result).toHaveProperty('operations')
      expect(Array.isArray(result.operations)).toBe(true)
      expect(result).toHaveProperty('restartNeeded')
      expect(typeof result.restartNeeded).toBe('boolean')
    }
  })

  // ── Placeholder tests for invariants that are NOT YET enforced ─────
  //
  // These tests document behavior that SHOULD hold but is not yet wired
  // into ChangeMarketplace as of commit a2f90e0e. They are `.skip`'d so
  // they don't break CI but remain visible to future contributors who
  // land the gate work.

  it.skip('R17: cannot delete the core `ai-maestro-plugins` marketplace', async () => {
    // R17 invariant: `ai-maestro-plugins` is the canonical remote
    // marketplace hosting the core `ai-maestro-plugin` (which is mandatory
    // on every agent). Deleting it would orphan every installed agent's
    // core plugin. This test locks in a future Gate that must refuse the
    // delete before any CLI call. Until the gate ships, the current
    // implementation will happily delete the marketplace — hence `.skip`.
    const { DeleteMarketplace } = await import('@/services/element-management-service')
    const result = await DeleteMarketplace(
      { name: 'ai-maestro-plugins' },
      { isSystemOwner: true as const },
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/protected|core|R17|ai-maestro-plugins/i)
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it.skip('Idempotency: deleting a non-existent marketplace is a no-op with logged ops', async () => {
    // Idempotency invariant: if the marketplace is already gone,
    // DeleteMarketplace should succeed (no-op) rather than propagate the
    // CLI's "not registered" error. Several callers (cleanup scripts,
    // repeatable migrations) rely on this. Until the idempotency gate
    // lands (a pre-CLI check that the marketplace exists in
    // extraKnownMarketplaces or cache), the current implementation
    // propagates the CLI error. Skipped until the gate ships.
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb: (err: Error | null, stdout?: string, stderr?: string) => void,
      ) => {
        cb(new Error('Marketplace "already-gone" is not registered'))
      },
    )
    const { DeleteMarketplace } = await import('@/services/element-management-service')
    const result = await DeleteMarketplace(
      { name: 'already-gone' },
      { isSystemOwner: true as const },
    )
    // When idempotency is implemented: success=true, no CLI call, ops note no-op.
    expect(result.success).toBe(true)
    expect(result.operations.join('\n')).toMatch(/no.?op|already/i)
  })
})
