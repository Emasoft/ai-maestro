import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * The invalidation state machine (TRDD-P7XKV3N9).
 *
 * The claim under test is narrow and load-bearing: after an invalidate there is
 * NOTHING LEFT ON DISK TO MATCH AGAINST. A design that merely set a flag would
 * leave a still-valid hash next to it, and every existing caller that reads
 * `passwordHash` without also consulting the flag would keep honouring a
 * credential the owner had just revoked.
 */
let dir: string

beforeEach(() => {
  // governance.ts computes GOVERNANCE_FILE from os.homedir() at MODULE LOAD, and
  // homedir() reads $HOME on POSIX — so the stub must land BEFORE the import, and
  // the module registry must be reset so the constant is recomputed. Otherwise the
  // test cheerfully rewrites the developer's real ~/.aimaestro/governance.json.
  dir = mkdtempSync(join(tmpdir(), 'aim-pw-'))
  vi.stubEnv('HOME', dir)
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(dir, { recursive: true, force: true })
})

describe('invalidatePassword', () => {
  it('DESTROYS the hash — a revoked password must not remain verifiable', async () => {
    const g = await import('@/lib/governance')
    await g.setPassword('correct-horse-battery-staple')
    expect(await g.verifyPassword('correct-horse-battery-staple')).toBe(true)

    await g.invalidatePassword()

    // The whole point: the old password no longer verifies. Not "is flagged" —
    // does not verify, because there is nothing to verify against.
    expect(await g.verifyPassword('correct-horse-battery-staple')).toBe(false)
    expect(g.loadGovernance().passwordHash).toBeNull()
    expect(g.isPasswordInvalidated()).toBe(true)
  })

  it('distinguishes a revocation from a fresh install', async () => {
    const g = await import('@/lib/governance')
    // Fresh host: no hash, but nobody revoked anything.
    expect(g.loadGovernance().passwordHash).toBeNull()
    expect(g.isPasswordInvalidated()).toBe(false)

    await g.setPassword('pw')
    await g.invalidatePassword()

    // Same "no hash" on disk, opposite meaning to the person reading the screen.
    expect(g.isPasswordInvalidated()).toBe(true)
    expect(g.loadGovernance().passwordInvalidatedAt).toBeTruthy()
  })

  it('setPassword CLEARS the invalidation — else the host is bricked in reset mode', async () => {
    const g = await import('@/lib/governance')
    await g.setPassword('old')
    await g.invalidatePassword()
    expect(g.isPasswordInvalidated()).toBe(true)

    await g.setPassword('new')

    // Without this, the user creates a new password, logs in, and is told to
    // create a new password. Forever.
    expect(g.isPasswordInvalidated()).toBe(false)
    expect(g.loadGovernance().passwordInvalidatedAt).toBeNull()
    expect(await g.verifyPassword('new')).toBe(true)
    expect(await g.verifyPassword('old')).toBe(false)
  })

  it('survives a restart — rotation is not a suggestion', async () => {
    const g = await import('@/lib/governance')
    await g.setPassword('pw')
    await g.invalidatePassword()

    // Simulate a fresh process: drop the module (and its caches) and re-read disk.
    vi.resetModules()
    const g2 = await import('@/lib/governance')
    expect(g2.isPasswordInvalidated()).toBe(true)
    expect(await g2.verifyPassword('pw')).toBe(false)
  })
})
