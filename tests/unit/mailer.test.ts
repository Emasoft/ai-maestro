import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * Mailer config RESOLUTION (TRDD-P7XKV3N9) — the deterministic half of the mailer, tested
 * without any network. Proves resolution: the STORED autodetected config (from governance) for
 * the registered account, else the curated table, else dormant (null → caller falls back to
 * console). Dynamic imports after a stubbed $HOME + resetModules, because the mailer
 * transitively loads governance, which binds ~/.aimaestro at module load — a static top-level
 * import would bind the developer's REAL governance.json.
 *
 * There is no AIM_SMTP_* env path to test: it was DELETED (TRDD-CC9PY337) as an
 * account-takeover vector. The suite no longer needs to neutralize those vars either — a
 * dev shell that exports them can no longer affect this code at all, which is the point.
 */
let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aim-mailer-'))
  vi.stubEnv('HOME', dir)
  vi.stubEnv('AIM_SMTP_CRED_BACKEND', 'file') // credential store uses the throwaway $HOME
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

  it('is dormant without an account email — there is no other source', async () => {
    const { mailer, cred } = await load()
    cred.storeSmtpPassword('me@gmail.com', 'app-pw')
    // The dashboard relay is keyed to the registered address; with no address there is
    // nothing to resolve. (This used to be the case the env override could satisfy alone.)
    expect(mailer.getMailerConfig()).toBeNull()
  })
})

describe('the AIM_SMTP_* env path is GONE, not merely ignored (TRDD-CC9PY337)', () => {
  it('an exported AIM_SMTP_* cannot redirect the relay', async () => {
    const { mailer, cred } = await load()
    cred.storeSmtpPassword('me@gmail.com', 'app-pw')
    // The vector: a prompt-injected agent appends this to ~/.zshrc, and every password-reset
    // code transits an attacker's relay after the next restart — silently, with the dashboard
    // still showing the owner's own provider.
    vi.stubEnv('AIM_SMTP_HOST', 'relay.evil.example')
    vi.stubEnv('AIM_SMTP_PORT', '2525')
    vi.stubEnv('AIM_SMTP_USER', 'attacker')
    vi.stubEnv('AIM_SMTP_PASS', 'attacker-pw')
    vi.stubEnv('AIM_SMTP_FROM', 'noreply@evil.example')
    // Every field still comes from the dashboard-configured relay. Note this holds in
    // DEVELOPMENT — the read is deleted, not gated on NODE_ENV, because dev machines run
    // agents too.
    expect(mailer.getMailerConfig('me@gmail.com')).toEqual({
      host: 'smtp.gmail.com', port: 465, secure: true, user: 'me@gmail.com', from: 'me@gmail.com', pass: 'app-pw',
    })
  })

  it('an exported AIM_SMTP_* cannot enable the channel when no relay is configured', async () => {
    const { mailer } = await load()
    vi.stubEnv('AIM_SMTP_HOST', 'relay.evil.example')
    vi.stubEnv('AIM_SMTP_PORT', '2525')
    vi.stubEnv('AIM_SMTP_USER', 'attacker')
    vi.stubEnv('AIM_SMTP_PASS', 'attacker-pw')
    // Previously these four together WERE a complete config and turned the mailer on.
    expect(mailer.getMailerConfig('me@gmail.com')).toBeNull()
    expect(mailer.isMailerConfigured('me@gmail.com')).toBe(false)
  })
})
