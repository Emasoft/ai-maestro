import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * sendUserCodeEmail — the MAESTRO-relay gate (TRDD-7U927FCM 2B, the role-split). A
 * normal/foreign user supplies ONLY a destination email; their verification code is RELAYED
 * through the MAESTRO's own provider, so the SMTP `from`/account is the MAESTRO's verified
 * recovery email and `to` is the user. The relay is gated on VERIFIED — `verified` means the
 * MAESTRO already sent+received a code through this provider (proof it can send); with no
 * verified relay the send is {skipped:true} so the caller falls back to another factor.
 *
 * Uses a stubbed $HOME (real governance + credential store in a throwaway dir) and a mocked
 * nodemailer so the "actually relays" case asserts from/to without a network. Dynamic imports
 * after resetModules, because the mailer transitively binds ~/.aimaestro at module load.
 */
const sendMailMock = vi.fn(async (_opts: { to: string; from: string; subject: string; text: string }) => ({}))
vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: sendMailMock }) },
}))

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aim-relay-'))
  vi.stubEnv('HOME', dir)
  vi.stubEnv('AIM_SMTP_CRED_BACKEND', 'file') // credential store uses the throwaway $HOME
  // Neutralize any AIM_SMTP_* the dev shell may export ('' is falsy → env override off), so
  // the test exercises the auto-config relay path rather than a developer's real relay.
  for (const k of ['AIM_SMTP_HOST', 'AIM_SMTP_PORT', 'AIM_SMTP_USER', 'AIM_SMTP_PASS', 'AIM_SMTP_FROM', 'AIM_SMTP_SECURE']) {
    vi.stubEnv(k, '')
  }
  sendMailMock.mockClear()
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

const GMAIL = { host: 'smtp.gmail.com', port: 465, secure: true, usernameFormat: 'full' as const }

describe('sendUserCodeEmail — MAESTRO relay gate (TRDD-7U927FCM 2B)', () => {
  it('skips when no MAESTRO recovery email is configured', async () => {
    const { mailer } = await load()
    const r = await mailer.sendUserCodeEmail('foreign@user.com', '123456', 'password reset')
    expect(r).toEqual({ ok: false, skipped: true })
    expect(sendMailMock).not.toHaveBeenCalled()
  })

  it('skips when the MAESTRO relay exists but is UNVERIFIED (proof-of-send missing)', async () => {
    const { mailer, cred, gov } = await load()
    cred.storeSmtpPassword('boss@gmail.com', 'app-pw') // relay creds present…
    await gov.setRecoveryEmail('boss@gmail.com', GMAIL)
    // …but never verified → the gate blocks; we never trust an unproven relay to reach a user.
    const r = await mailer.sendUserCodeEmail('foreign@user.com', '123456', 'password reset')
    expect(r).toEqual({ ok: false, skipped: true })
    expect(sendMailMock).not.toHaveBeenCalled()
  })

  it('relays through the MAESTRO once verified — from = MAESTRO, to = the user', async () => {
    const { mailer, cred, gov } = await load()
    cred.storeSmtpPassword('boss@gmail.com', 'app-pw')
    await gov.setRecoveryEmail('boss@gmail.com', GMAIL)
    await gov.setRecoveryEmailVerified() // prove the relay can send
    const r = await mailer.sendUserCodeEmail('foreign@user.com', '654321', 'password reset')
    expect(r).toEqual({ ok: true })
    expect(sendMailMock).toHaveBeenCalledTimes(1)
    const arg = sendMailMock.mock.calls[0][0]
    expect(arg.to).toBe('foreign@user.com') // the user is the recipient
    expect(arg.from).toBe('boss@gmail.com') // sent AS the MAESTRO (the relay), never the user
    expect(arg.subject).toContain('654321')
  })

  it('skips when verified but the relay app-password is missing (unconfigured mailer)', async () => {
    const { mailer, gov } = await load()
    await gov.setRecoveryEmail('boss@gmail.com', GMAIL)
    await gov.setRecoveryEmailVerified()
    // No storeSmtpPassword → getMailerConfig(relay) is null → sendCodeEmail returns skipped.
    const r = await mailer.sendUserCodeEmail('foreign@user.com', '111111', 'password reset')
    expect(r).toEqual({ ok: false, skipped: true })
    expect(sendMailMock).not.toHaveBeenCalled()
  })
})
