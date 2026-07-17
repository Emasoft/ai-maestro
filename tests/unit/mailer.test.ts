import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * Mailer config RESOLUTION (TRDD-P7XKV3N9) — the deterministic half of the mailer, tested
 * without any network. Proves resolution is PER FIELD: each AIM_SMTP_* var overrides only
 * its own field of the STORED autodetected config (from governance), else the curated table,
 * else dormant (null → caller falls back to console). Dynamic imports after a stubbed $HOME +
 * resetModules, because the mailer transitively loads governance, which binds ~/.aimaestro at
 * module load — a static top-level import would bind the developer's REAL governance.json.
 */
let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aim-mailer-'))
  vi.stubEnv('HOME', dir)
  vi.stubEnv('AIM_SMTP_CRED_BACKEND', 'file') // credential store uses the throwaway $HOME
  // Neutralize any AIM_SMTP_* the dev shell may export ('' is falsy → env override off).
  for (const k of ['AIM_SMTP_HOST', 'AIM_SMTP_PORT', 'AIM_SMTP_USER', 'AIM_SMTP_PASS', 'AIM_SMTP_FROM', 'AIM_SMTP_SECURE']) {
    vi.stubEnv(k, '')
  }
  vi.resetModules()
})
afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(dir, { recursive: true, force: true })
})

async function load() {
  const mailer = await import('@/lib/mailer')
  const cred = await import('@/lib/smtp-credential')
  const gov = await import('@/lib/governance')
  return { mailer, cred, gov }
}

describe('getMailerConfig — resolution order', () => {
  it('is dormant when nothing is configured', async () => {
    const { mailer } = await load()
    expect(mailer.getMailerConfig()).toBeNull()
    expect(mailer.getMailerConfig('me@gmail.com')).toBeNull() // domain known, but no stored password
    expect(mailer.isMailerConfigured('me@gmail.com')).toBe(false)
  })

  it('auto-configures from the curated table + stored app-password (Gmail, no stored smtp)', async () => {
    const { mailer, cred } = await load()
    cred.storeSmtpPassword('me@gmail.com', 'app-pw')
    expect(mailer.getMailerConfig('me@gmail.com')).toEqual({
      host: 'smtp.gmail.com', port: 465, secure: true, user: 'me@gmail.com', from: 'me@gmail.com', pass: 'app-pw',
    })
    expect(mailer.isMailerConfigured('me@gmail.com')).toBe(true)
  })

  it('prefers the STORED autodetected smtp over the table, honoring the local-part username', async () => {
    const { mailer, cred, gov } = await load()
    cred.storeSmtpPassword('mario@alice.it', 'app-pw')
    await gov.setRecoveryEmail('mario@alice.it', { host: 'out.alice.it', port: 465, secure: true, usernameFormat: 'local' })
    // local-part username → auth user is 'mario', not the full address.
    expect(mailer.getMailerConfig('mario@alice.it')).toEqual({
      host: 'out.alice.it', port: 465, secure: true, user: 'mario', from: 'mario@alice.it', pass: 'app-pw',
    })
  })

  it('a curated local-part provider (BSNL) sets the auth user to the local part', async () => {
    const { mailer, cred } = await load()
    cred.storeSmtpPassword('ravi@bsnl.in', 'app-pw')
    expect(mailer.getMailerConfig('ravi@bsnl.in')).toEqual({
      host: 'mail.bsnl.in', port: 587, secure: false, user: 'ravi', from: 'ravi@bsnl.in', pass: 'app-pw',
    })
  })

  it('the env override wins over auto-config', async () => {
    const { mailer, cred } = await load()
    cred.storeSmtpPassword('me@gmail.com', 'app-pw') // an auto-config path exists…
    vi.stubEnv('AIM_SMTP_HOST', 'relay.example.com')
    vi.stubEnv('AIM_SMTP_PORT', '2525')
    vi.stubEnv('AIM_SMTP_USER', 'relay-user')
    vi.stubEnv('AIM_SMTP_PASS', 'relay-pass')
    // …but the explicit env override is used instead.
    expect(mailer.getMailerConfig('me@gmail.com')).toMatchObject({ host: 'relay.example.com', port: 2525, user: 'relay-user', secure: false })
  })
})

describe('getMailerConfig — each env var overrides ONE field, independently', () => {
  it('a LONE host override keeps every other field from the stored config', async () => {
    const { mailer, cred } = await load()
    cred.storeSmtpPassword('me@gmail.com', 'app-pw')
    vi.stubEnv('AIM_SMTP_HOST', 'relay.internal') // the ONLY var set
    // Same account, same credentials, different host. Under the old all-or-nothing shape
    // this lone override was silently discarded and Gmail's host was used.
    expect(mailer.getMailerConfig('me@gmail.com')).toEqual({
      host: 'relay.internal', port: 465, secure: true, user: 'me@gmail.com', from: 'me@gmail.com', pass: 'app-pw',
    })
  })

  it('a lone user/from override leaves host, port and password alone', async () => {
    const { mailer, cred } = await load()
    cred.storeSmtpPassword('me@gmail.com', 'app-pw')
    vi.stubEnv('AIM_SMTP_USER', 'login-id')
    vi.stubEnv('AIM_SMTP_FROM', 'noreply@example.com')
    expect(mailer.getMailerConfig('me@gmail.com')).toEqual({
      host: 'smtp.gmail.com', port: 465, secure: true, user: 'login-id', from: 'noreply@example.com', pass: 'app-pw',
    })
  })

  it('a partial override with NO stored relay behind it stays dormant', async () => {
    const { mailer } = await load()
    vi.stubEnv('AIM_SMTP_HOST', 'relay.internal') // no stored password → merge is incomplete
    // The fail-safe the all-or-nothing shape protected is preserved: never half-enable a
    // channel that would fail at send time.
    expect(mailer.getMailerConfig('me@gmail.com')).toBeNull()
    expect(mailer.isMailerConfigured('me@gmail.com')).toBe(false)
  })

  it('overriding the port re-derives secure, so 587 does not inherit the stored implicit TLS', async () => {
    const { mailer, cred } = await load()
    cred.storeSmtpPassword('me@gmail.com', 'app-pw') // base is 465 / secure:true
    vi.stubEnv('AIM_SMTP_PORT', '587')
    // Inheriting secure:true onto 587 would wedge the TLS handshake — the one field that
    // cannot be varied independently of the port.
    expect(mailer.getMailerConfig('me@gmail.com')).toMatchObject({ port: 587, secure: false })
  })

  it('an explicit AIM_SMTP_SECURE beats the port derivation', async () => {
    const { mailer, cred } = await load()
    cred.storeSmtpPassword('me@gmail.com', 'app-pw')
    vi.stubEnv('AIM_SMTP_PORT', '587')
    vi.stubEnv('AIM_SMTP_SECURE', 'true')
    expect(mailer.getMailerConfig('me@gmail.com')).toMatchObject({ port: 587, secure: true })
  })

  it('a malformed port THROWS instead of silently disabling the channel', async () => {
    const { mailer, cred } = await load()
    cred.storeSmtpPassword('me@gmail.com', 'app-pw')
    vi.stubEnv('AIM_SMTP_PORT', '58x')
    // Fail-fast: a typo must not leave the owner believing email recovery is live.
    expect(() => mailer.getMailerConfig('me@gmail.com')).toThrow(/AIM_SMTP_PORT/)
  })

  it('a malformed secure THROWS rather than being coerced to false', async () => {
    const { mailer, cred } = await load()
    cred.storeSmtpPassword('me@gmail.com', 'app-pw')
    vi.stubEnv('AIM_SMTP_SECURE', 'yes')
    expect(() => mailer.getMailerConfig('me@gmail.com')).toThrow(/AIM_SMTP_SECURE/)
  })
})
