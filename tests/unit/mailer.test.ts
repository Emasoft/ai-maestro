import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getMailerConfig, isMailerConfigured } from '@/lib/mailer'
import { storeSmtpPassword } from '@/lib/smtp-credential'

/**
 * Mailer config RESOLUTION (TRDD-P7XKV3N9) — the deterministic half of the mailer,
 * tested without any network. The actual SMTP send is nodemailer's job; here we prove
 * the three-way resolution: env override wins, else auto-config from the registered
 * email + stored app-password, else dormant (null → caller falls back to console).
 */
let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aim-mailer-'))
  vi.stubEnv('HOME', dir)
  vi.stubEnv('AIM_SMTP_CRED_BACKEND', 'file') // credential store uses the throwaway $HOME
  // Neutralize any AIM_SMTP_* the developer's shell may export, so the auto-config
  // tests aren't shadowed by a real env override ('' is falsy → envConfig returns null).
  for (const k of ['AIM_SMTP_HOST', 'AIM_SMTP_PORT', 'AIM_SMTP_USER', 'AIM_SMTP_PASS', 'AIM_SMTP_FROM', 'AIM_SMTP_SECURE']) {
    vi.stubEnv(k, '')
  }
})
afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(dir, { recursive: true, force: true })
})

describe('getMailerConfig — resolution order', () => {
  it('is dormant when nothing is configured', () => {
    expect(getMailerConfig()).toBeNull()
    expect(getMailerConfig('me@gmail.com')).toBeNull() // domain known, but no stored password
    expect(isMailerConfigured('me@gmail.com')).toBe(false)
  })

  it('auto-configures from the registered email + stored app-password (Gmail)', () => {
    storeSmtpPassword('me@gmail.com', 'app-pw')
    expect(getMailerConfig('me@gmail.com')).toEqual({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      user: 'me@gmail.com',
      from: 'me@gmail.com',
      pass: 'app-pw',
    })
    expect(isMailerConfigured('me@gmail.com')).toBe(true)
  })

  it('auto-configures iCloud to STARTTLS:587', () => {
    storeSmtpPassword('me@icloud.com', 'app-pw')
    expect(getMailerConfig('me@icloud.com')).toMatchObject({ host: 'smtp.mail.me.com', port: 587, secure: false })
  })

  it('the env override wins over auto-config', () => {
    storeSmtpPassword('me@gmail.com', 'app-pw') // an auto-config path exists…
    vi.stubEnv('AIM_SMTP_HOST', 'relay.example.com')
    vi.stubEnv('AIM_SMTP_PORT', '2525')
    vi.stubEnv('AIM_SMTP_USER', 'relay-user')
    vi.stubEnv('AIM_SMTP_PASS', 'relay-pass')
    // …but the explicit env override is used instead.
    expect(getMailerConfig('me@gmail.com')).toMatchObject({ host: 'relay.example.com', port: 2525, user: 'relay-user', secure: false })
  })
})
