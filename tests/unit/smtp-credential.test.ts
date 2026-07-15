import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { storeSmtpPassword, getSmtpPassword, hasSmtpPassword, deleteSmtpPassword } from '@/lib/smtp-credential'

/**
 * The persistent SMTP app-password store (TRDD-P7XKV3N9). Exercises the FILE backend
 * (AIM_SMTP_CRED_BACKEND=file) against a throwaway $HOME — never the developer's real
 * login Keychain. The load-bearing claims: a stored password round-trips, an unstored
 * email reads back null (so the mailer stays dormant), the key is case-insensitive
 * (matching detectProvider's normalization), delete is idempotent, and the on-disk file
 * is 0600 (this is a replayable secret — it must not be world/group-readable).
 */
let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aim-smtp-cred-'))
  vi.stubEnv('HOME', dir)
  vi.stubEnv('AIM_SMTP_CRED_BACKEND', 'file') // force the file backend; never touch the real keychain
})
afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(dir, { recursive: true, force: true })
})

describe('smtp-credential — file backend', () => {
  it('round-trips a stored password', () => {
    storeSmtpPassword('me@gmail.com', 'app-specific-pw')
    expect(getSmtpPassword('me@gmail.com')).toBe('app-specific-pw')
    expect(hasSmtpPassword('me@gmail.com')).toBe(true)
  })

  it('reads null for an email with no stored password', () => {
    expect(getSmtpPassword('nobody@gmail.com')).toBeNull()
    expect(hasSmtpPassword('nobody@gmail.com')).toBe(false)
  })

  it('overwrites an existing password', () => {
    storeSmtpPassword('me@gmail.com', 'old')
    storeSmtpPassword('me@gmail.com', 'new')
    expect(getSmtpPassword('me@gmail.com')).toBe('new')
  })

  it('is case-insensitive on the email key', () => {
    storeSmtpPassword('Me@Gmail.com', 'pw')
    expect(getSmtpPassword('me@gmail.com')).toBe('pw')
  })

  it('deletes idempotently', () => {
    storeSmtpPassword('me@gmail.com', 'pw')
    deleteSmtpPassword('me@gmail.com')
    expect(getSmtpPassword('me@gmail.com')).toBeNull()
    expect(() => deleteSmtpPassword('me@gmail.com')).not.toThrow() // absent → no-op
  })

  it('writes the credential file 0600 (owner-only — a replayable secret)', () => {
    storeSmtpPassword('me@gmail.com', 'pw')
    const mode = statSync(join(dir, '.aimaestro', 'smtp-credential.json')).mode & 0o777
    expect(mode).toBe(0o600)
  })
})
