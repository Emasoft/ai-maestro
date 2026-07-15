import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * Mailer config RESOLUTION (TRDD-P7XKV3N9) — the deterministic half of the mailer, tested
 * without any network. Proves the resolution order: env override wins, else the STORED
 * autodetected config (from governance) for the registered account, else the curated table,
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
