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

describe('detectProvider — Asian providers (fixed hosts, 465 SSL, webmail guidance)', () => {
  it('QQ Mail → smtp.qq.com:465 with Authorization Code guidance', () => {
    const p = detectProvider('u@qq.com')!
    expect(p).toMatchObject({ host: 'smtp.qq.com', port: 465, secure: true, known: true })
    expect(p.note).toMatch(/Authorization Code/i)
  })
  it('NetEase 163/126 → smtp.163.com / smtp.126.com:465', () => {
    expect(detectProvider('u@163.com')).toMatchObject({ host: 'smtp.163.com', port: 465, secure: true, known: true })
    expect(detectProvider('u@126.com')).toMatchObject({ host: 'smtp.126.com', port: 465, secure: true, known: true })
  })
  it('Naver → smtp.naver.com:465', () => {
    expect(detectProvider('u@naver.com')).toMatchObject({ host: 'smtp.naver.com', port: 465, secure: true, known: true })
  })
  it('Yahoo! JAPAN → smtp.mail.yahoo.co.jp:465', () => {
    expect(detectProvider('u@yahoo.co.jp')).toMatchObject({ host: 'smtp.mail.yahoo.co.jp', port: 465, secure: true, known: true })
  })
})

describe('detectProvider — IMEA providers (India / Middle East / Africa, incl. local-part auth)', () => {
  it('Rediffmail → smtp.rediffmail.com:465', () => {
    expect(detectProvider('u@rediffmail.com')).toMatchObject({ host: 'smtp.rediffmail.com', port: 465, secure: true, known: true })
  })
  it('Etisalat (UAE) → mail.etisalat.ae:465', () => {
    expect(detectProvider('u@etisalat.ae')).toMatchObject({ host: 'mail.etisalat.ae', port: 465, secure: true, known: true })
  })
  it('BSNL (India) authenticates with the local part', () => {
    expect(detectProvider('u@bsnl.in')).toMatchObject({ host: 'mail.bsnl.in', port: 587, secure: false, known: true, usernameFormat: 'local' })
  })
  it('Telkom (SA) authenticates with the local part', () => {
    expect(detectProvider('u@telkomsa.net')).toMatchObject({ host: 'smtp.telkomsa.net', port: 587, secure: false, known: true, usernameFormat: 'local' })
  })
})

describe('detectProvider — Italy/EU regional + Zoho regional split', () => {
  it('Fastweb → smtp.fastwebnet.it:465', () => {
    expect(detectProvider('u@fastwebnet.it')).toMatchObject({ host: 'smtp.fastwebnet.it', port: 465, secure: true, known: true })
  })
  it('Iliad → mail.iliad.it:465', () => {
    expect(detectProvider('u@iliad.it')).toMatchObject({ host: 'mail.iliad.it', port: 465, secure: true, known: true })
  })
  it('Alice/TIM authenticates with the local part', () => {
    expect(detectProvider('u@alice.it')).toMatchObject({ host: 'out.alice.it', port: 587, secure: false, known: true, usernameFormat: 'local' })
  })
  it('Zoho regional hosts differ: .com vs .eu vs .in', () => {
    expect(detectProvider('u@zoho.com')).toMatchObject({ host: 'smtp.zoho.com', known: true })
    expect(detectProvider('u@zoho.eu')).toMatchObject({ host: 'smtp.zoho.eu', known: true })
    expect(detectProvider('u@zoho.in')).toMatchObject({ host: 'smtp.zoho.in', known: true })
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
