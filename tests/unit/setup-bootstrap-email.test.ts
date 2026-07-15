import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * The email delivery channel of startSetupFlow (TRDD-P7XKV3N9). The load-bearing claims:
 * a code goes to the owner's registered EMAIL (the only remote-capable channel) when the
 * mailer is configured for it, and EVERY failure mode — mailer unconfigured, send error,
 * or no recipient — degrades to the console file rather than stranding the code.
 *
 * child_process is mocked so the real osascript/notify-send never fires a desktop banner
 * during the suite, and so the file-fallback channel is deterministic ('file', not
 * 'notification + file'). The mailer is mocked so no real SMTP connection is opened.
 */
let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aim-setup-'))
  vi.stubEnv('HOME', dir)
  vi.resetModules()
  vi.doMock('child_process', () => ({
    execFile: (...args: unknown[]) => {
      const cb = args[args.length - 1] as (e: Error) => void
      cb(new Error('exec disabled in test')) // notification path throws → notified=false
    },
  }))
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.resetModules()
  rmSync(dir, { recursive: true, force: true })
})

describe('startSetupFlow — email channel', () => {
  it('delivers via email when the mailer is configured for the recipient', async () => {
    const sendCodeEmail = vi.fn(async (_to: string, _code: string, _purpose: string) => ({ ok: true }))
    vi.doMock('@/lib/mailer', () => ({ isMailerConfigured: () => true, sendCodeEmail }))
    const { startSetupFlow } = await import('@/lib/setup-bootstrap')
    const r = await startSetupFlow({ email: 'me@gmail.com', purpose: 'password reset' })
    expect(r.channel).toBe('email')
    expect(sendCodeEmail).toHaveBeenCalledOnce()
    const [to, code, purpose] = sendCodeEmail.mock.calls[0]
    expect(to).toBe('me@gmail.com')
    expect(code).toMatch(/^\d{6}$/) // the digits-only code, injection-safe
    expect(purpose).toBe('password reset')
  })

  it('falls back to the console file when the mailer is not configured', async () => {
    const sendCodeEmail = vi.fn()
    vi.doMock('@/lib/mailer', () => ({ isMailerConfigured: () => false, sendCodeEmail }))
    const { startSetupFlow } = await import('@/lib/setup-bootstrap')
    const r = await startSetupFlow({ email: 'me@gmail.com' })
    expect(r.channel).toBe('file')
    expect(sendCodeEmail).not.toHaveBeenCalled()
  })

  it('falls back to the console file when the email send fails', async () => {
    const sendCodeEmail = vi.fn(async () => ({ ok: false, error: 'smtp down' }))
    vi.doMock('@/lib/mailer', () => ({ isMailerConfigured: () => true, sendCodeEmail }))
    const { startSetupFlow } = await import('@/lib/setup-bootstrap')
    const r = await startSetupFlow({ email: 'me@gmail.com' })
    expect(r.channel).toBe('file') // send failed → console fallback, code still on disk
    expect(sendCodeEmail).toHaveBeenCalledOnce()
  })

  it('uses the console file when no recipient email is given (backward-compatible default)', async () => {
    const sendCodeEmail = vi.fn(async () => ({ ok: true }))
    vi.doMock('@/lib/mailer', () => ({ isMailerConfigured: () => true, sendCodeEmail }))
    const { startSetupFlow } = await import('@/lib/setup-bootstrap')
    const r = await startSetupFlow() // the existing setup-init caller passes nothing
    expect(r.channel).toBe('file')
    expect(sendCodeEmail).not.toHaveBeenCalled()
  })
})
