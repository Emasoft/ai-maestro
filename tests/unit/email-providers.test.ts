import { describe, it, expect } from 'vitest'
import { detectProvider, emailDomain } from '@/lib/email-providers'

/**
 * Provider auto-detection (TRDD-P7XKV3N9). The load-bearing claims: a KNOWN consumer
 * domain resolves to that provider's real SMTP submission profile (host/port/TLS), an
 * UNKNOWN domain degrades to a labelled best-effort guess (never a crash, never null
 * for a well-formed address), and a malformed address resolves to null so the mailer
 * stays dormant rather than dialing garbage.
 */
describe('emailDomain', () => {
  it('extracts the lowercased domain', () => {
    expect(emailDomain('Alice@Gmail.com')).toBe('gmail.com')
  })
  it('returns null for shapes that are not local@domain-with-dot', () => {
    for (const bad of ['no-at-sign', '@nodomain.com', 'nolocal@', 'user@localhost', '']) {
      expect(emailDomain(bad)).toBeNull()
    }
  })
})

describe('detectProvider — known providers map to their real SMTP profile', () => {
  it('Gmail → smtp.gmail.com:465 implicit-TLS, app-password link present', () => {
    const p = detectProvider('me@gmail.com')!
    expect(p).toMatchObject({ host: 'smtp.gmail.com', port: 465, secure: true, known: true })
    expect(p.appPasswordUrl).toContain('apppasswords')
  })
  it('iCloud → smtp.mail.me.com:587 STARTTLS (not 465)', () => {
    for (const e of ['me@icloud.com', 'me@me.com', 'me@mac.com']) {
      expect(detectProvider(e)).toMatchObject({ host: 'smtp.mail.me.com', port: 587, secure: false, known: true })
    }
  })
  it('Outlook/Hotmail/Live share smtp-mail.outlook.com:587', () => {
    for (const e of ['me@outlook.com', 'me@hotmail.com', 'me@live.com']) {
      expect(detectProvider(e)).toMatchObject({ host: 'smtp-mail.outlook.com', port: 587, secure: false, known: true })
    }
  })
  it('Yahoo → smtp.mail.yahoo.com:465 implicit-TLS', () => {
    expect(detectProvider('me@yahoo.com')).toMatchObject({ host: 'smtp.mail.yahoo.com', port: 465, secure: true, known: true })
  })
})

describe('detectProvider — unknown + malformed', () => {
  it('guesses smtp.<domain>:587 STARTTLS for an unknown domain and flags it not-known', () => {
    const p = detectProvider('admin@acme-corp.example')!
    expect(p).toMatchObject({ host: 'smtp.acme-corp.example', port: 587, secure: false, known: false })
    expect(p.note).toMatch(/AIM_SMTP_/) // tells the owner how to override a wrong guess
  })
  it('returns null for a malformed address so the mailer stays dormant', () => {
    for (const bad of ['not-an-email', 'user@localhost', '']) {
      expect(detectProvider(bad)).toBeNull()
    }
  })
})
