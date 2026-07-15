import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * Recovery-email governance fields (TRDD-P7XKV3N9). governance.ts computes its file path
 * from $HOME at module load, so — exactly like password-invalidation.test.ts — we stub HOME
 * and reset modules BEFORE importing, against a throwaway ~/.aimaestro. The load-bearing
 * claims: the email + resolved SMTP settings round-trip, (re)configuring always resets the
 * verified flag (a new address must re-prove receipt), and verifying with nothing configured
 * is refused rather than silently marking a null address verified.
 */
let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aim-gov-recovery-'))
  vi.stubEnv('HOME', dir)
  vi.resetModules()
})
afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(dir, { recursive: true, force: true })
})

const GMAIL_SMTP = { host: 'smtp.gmail.com', port: 465, secure: true, usernameFormat: 'full' as const }

describe('governance recovery-email', () => {
  it('stores, verifies, reads, and clears the recovery email', async () => {
    const g = await import('@/lib/governance')
    expect(g.getRecoveryEmail()).toBeNull()

    await g.setRecoveryEmail('me@gmail.com', GMAIL_SMTP)
    expect(g.getRecoveryEmail()).toEqual({ email: 'me@gmail.com', verified: false, smtp: GMAIL_SMTP })

    await g.setRecoveryEmailVerified()
    expect(g.getRecoveryEmail()?.verified).toBe(true)

    await g.clearRecoveryEmail()
    expect(g.getRecoveryEmail()).toBeNull()
  })

  it('re-configuring resets verification to false (a new address must re-prove receipt)', async () => {
    const g = await import('@/lib/governance')
    await g.setRecoveryEmail('me@icloud.com', GMAIL_SMTP)
    await g.setRecoveryEmailVerified()
    expect(g.getRecoveryEmail()?.verified).toBe(true)

    await g.setRecoveryEmail('me@icloud.com', GMAIL_SMTP) // reconfigure
    expect(g.getRecoveryEmail()?.verified).toBe(false)
  })

  it('refuses to mark verified when no email is configured', async () => {
    const g = await import('@/lib/governance')
    await expect(g.setRecoveryEmailVerified()).rejects.toThrow(/no recovery email/)
  })
})
