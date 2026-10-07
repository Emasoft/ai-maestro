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

// TRDD-X5MVYUTO: the keychain add passes the password in argv, and execFileSync's failure message
// quotes that argv. The thrown error must not carry the plaintext.
describe('smtp-credential — keychain write failure does not leak the password', () => {
  it('throws an error whose message, stack and cause omit the plaintext', async () => {
    const SECRET = 'PLAINTEXT-SMTP-APP-PASSWORD-9f3a'
    vi.resetModules()
    vi.doMock('child_process', () => ({
      execFileSync: (file: string, args: string[]) => {
        // Same shape Node produces: message embeds the full command line.
        throw Object.assign(new Error(`Command failed: ${file} ${args.join(' ')}`), { status: 1 })
      },
    }))
    vi.doMock('fs', async (orig) => {
      const actual = await orig<typeof import('fs')>()
      return { ...actual, existsSync: (p: string) => p === '/usr/bin/security' || actual.existsSync(p) }
    })
    vi.stubEnv('AIM_SMTP_CRED_BACKEND', '') // let the keychain branch be selected
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    const logged: string[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => { logged.push(a.join(' ')) })
    try {
      const mod = await import('@/lib/smtp-credential')
      let caught: unknown
      try { mod.storeSmtpPassword('me@gmail.com', SECRET) } catch (e) { caught = e }
      expect(caught).toBeInstanceOf(Error)
      const err = caught as Error & { cause?: unknown }
      expect(err.message).toContain('keychain write failed')
      expect(JSON.stringify({ m: err.message, s: err.stack, c: err.cause, logged })).not.toContain(SECRET)
    } finally {
      spy.mockRestore()
      Object.defineProperty(process, 'platform', platform)
      vi.doUnmock('child_process')
      vi.doUnmock('fs')
    }
  })
})
