import { describe, it, expect } from 'vitest'
import { parseIspdbSmtp, mapMxToSmtp, autodetectSMTP, authRequiredInstructions, resolveAuthUser } from '@/lib/smtp-autodetect'

/**
 * Dynamic SMTP autodetection (TRDD-P7XKV3N9). Tests the OFFLINE, deterministic surface:
 * the ISPDB-XML parser (the exact regex the internet snippet got wrong, PLUS the EU
 * username-format quirk), the MX fingerprint map (whose host strings the snippet
 * corrupted to '://gmail.com'), and the curated-table fast-path (which short-circuits
 * before any network). The network steps (ISPDB fetch, DNS SRV/MX, EHLO verify,
 * authenticated verifyCredentials) are integration concerns, not unit-tested here.
 */

const GMAIL_ISPDB = `<?xml version="1.0"?>
<clientConfig version="1.1">
  <emailProvider id="googlemail.com">
    <incomingServer type="imap"><hostname>imap.gmail.com</hostname><port>993</port><socketType>SSL</socketType></incomingServer>
    <outgoingServer type="smtp">
      <hostname>smtp.gmail.com</hostname>
      <port>465</port>
      <socketType>SSL</socketType>
      <username>%EMAILADDRESS%</username>
      <authentication>password-cleartext</authentication>
    </outgoingServer>
  </emailProvider>
</clientConfig>`

const STARTTLS_ISPDB = `<clientConfig><emailProvider id="acme.example">
  <outgoingServer type="smtp"><hostname>mail.acme.example</hostname><port>587</port><socketType>STARTTLS</socketType></outgoingServer>
</emailProvider></clientConfig>`

// Alice/TIM-style: authenticate with the LOCAL part only, not the full address.
const LOCALPART_ISPDB = `<clientConfig><emailProvider id="alice.it">
  <outgoingServer type="smtp"><hostname>out.alice.it</hostname><port>465</port><socketType>SSL</socketType><username>%EMAILLOCALPART%</username></outgoingServer>
</emailProvider></clientConfig>`

describe('parseIspdbSmtp', () => {
  it('extracts host/port, maps socketType SSL → implicit TLS, full username', () => {
    expect(parseIspdbSmtp(GMAIL_ISPDB)).toEqual({ host: 'smtp.gmail.com', port: 465, secure: true, usernameFormat: 'full' })
  })
  it('maps socketType STARTTLS → secure:false (username defaults to full)', () => {
    expect(parseIspdbSmtp(STARTTLS_ISPDB)).toEqual({ host: 'mail.acme.example', port: 587, secure: false, usernameFormat: 'full' })
  })
  it('detects the EU local-part username quirk (%EMAILLOCALPART%)', () => {
    expect(parseIspdbSmtp(LOCALPART_ISPDB)).toEqual({ host: 'out.alice.it', port: 465, secure: true, usernameFormat: 'local' })
  })
  it('returns null when there is no outgoingServer block', () => {
    expect(parseIspdbSmtp('<clientConfig><emailProvider/></clientConfig>')).toBeNull()
  })
  it("returns null for the snippet's WRONG tag <outgoing type=\"smtp\"> (regression guard)", () => {
    const wrong = '<outgoing type="smtp"><hostname>x</hostname><port>25</port></outgoing>'
    expect(parseIspdbSmtp(wrong)).toBeNull()
  })
})

describe('mapMxToSmtp — fingerprints resolve to REAL hosts (not the snippet\'s "://" corruption)', () => {
  it('Google MX → smtp.gmail.com:465', () => {
    expect(mapMxToSmtp('aspmx.l.google.com', 'acme.com')).toEqual({ host: 'smtp.gmail.com', port: 465, secure: true, usernameFormat: 'full' })
  })
  it('Microsoft 365 MX → smtp.office365.com:587', () => {
    expect(mapMxToSmtp('acme-com.mail.protection.outlook.com', 'acme.com')).toEqual({ host: 'smtp.office365.com', port: 587, secure: false, usernameFormat: 'full' })
  })
  it('Zoho EU MX → smtp.zoho.eu:465 (regional datacenter)', () => {
    expect(mapMxToSmtp('mx.zoho.eu', 'acme.it')).toEqual({ host: 'smtp.zoho.eu', port: 465, secure: true, usernameFormat: 'full' })
  })
  it('Zoho global MX → smtp.zoho.com:465', () => {
    expect(mapMxToSmtp('mx.zoho.com', 'acme.com')).toEqual({ host: 'smtp.zoho.com', port: 465, secure: true, usernameFormat: 'full' })
  })
  it('GoDaddy secureserver MX → smtpout.secureserver.net:465', () => {
    expect(mapMxToSmtp('smtp.secureserver.net', 'acme.com')).toEqual({ host: 'smtpout.secureserver.net', port: 465, secure: true, usernameFormat: 'full' })
  })
  it('unknown infrastructure → guesses smtp.<domain>:587', () => {
    expect(mapMxToSmtp('mail.self-hosted.example', 'self-hosted.example')).toEqual({ host: 'smtp.self-hosted.example', port: 587, secure: false, usernameFormat: 'full' })
  })
  it('Tencent/QQ MX → smtp.qq.com:465', () => {
    expect(mapMxToSmtp('mxbiz1.qq.com', 'acme.cn')).toEqual({ host: 'smtp.qq.com', port: 465, secure: true, usernameFormat: 'full' })
  })
  it('NetEase MX → smtp.163.com:465', () => {
    expect(mapMxToSmtp('163mx00.mxmail.netease.com', 'acme.cn')).toEqual({ host: 'smtp.163.com', port: 465, secure: true, usernameFormat: 'full' })
  })
  it('Alibaba mxhichina MX → smtp.mxhichina.com:465', () => {
    expect(mapMxToSmtp('mxn.mxhichina.com', 'acme.cn')).toEqual({ host: 'smtp.mxhichina.com', port: 465, secure: true, usernameFormat: 'full' })
  })
  it('Pepipost/Netcore MX → smtp.pepipost.com:587', () => {
    expect(mapMxToSmtp('mx.pepipost.com', 'acme.in')).toEqual({ host: 'smtp.pepipost.com', port: 587, secure: false, usernameFormat: 'full' })
  })
})

describe('authRequiredInstructions — provider-specific guidance on auth rejection', () => {
  it('QQ → enable POP3/IMAP/SMTP + 16-char Authorization Code', () => {
    expect(authRequiredInstructions('u@qq.com')).toMatch(/QQ Mail[\s\S]*Authorization Code/i)
  })
  it('NetEase 163/126 → enable IMAP/SMTP + Authorization Code', () => {
    expect(authRequiredInstructions('u@163.com')).toMatch(/NetEase[\s\S]*Authorization Code/i)
    expect(authRequiredInstructions('u@126.com')).toMatch(/NetEase/i)
  })
  it('Naver → enable SMTP under mail settings', () => {
    expect(authRequiredInstructions('u@naver.com')).toMatch(/Naver[\s\S]*SMTP/i)
  })
  it('generic (Gmail / unknown / malformed) → app-specific password guidance', () => {
    expect(authRequiredInstructions('u@gmail.com')).toMatch(/app-specific password/i)
    expect(authRequiredInstructions('malformed')).toMatch(/app-specific password/i)
  })
})

describe('autodetectSMTP — curated table fast-path (offline, no network)', () => {
  it('Gmail resolves from the table with its app-password URL', async () => {
    const r = await autodetectSMTP('me@gmail.com')
    expect(r).toMatchObject({ host: 'smtp.gmail.com', port: 465, secure: true, source: 'table', known: true, usernameFormat: 'full' })
    expect(r?.appPasswordUrl).toContain('apppasswords')
  })
  it('iCloud resolves from the table to STARTTLS:587', async () => {
    const r = await autodetectSMTP('me@icloud.com')
    expect(r).toMatchObject({ host: 'smtp.mail.me.com', port: 587, secure: false, source: 'table', known: true })
  })
  it('a curated local-part provider (BSNL) surfaces usernameFormat local', async () => {
    const r = await autodetectSMTP('u@bsnl.in')
    expect(r).toMatchObject({ host: 'mail.bsnl.in', port: 587, secure: false, source: 'table', known: true, usernameFormat: 'local' })
  })
  it('returns null for a malformed address', async () => {
    expect(await autodetectSMTP('not-an-email')).toBeNull()
  })
})

// TRDD-P7XKV3N9: the single source of truth for the SMTP login id, shared by the verify
// path (verifyCredentials) and the send path (lib/mailer). An explicit userid must win
// over the usernameFormat derivation so a provider whose login is neither the full email
// nor its local-part can authenticate.
describe('resolveAuthUser — explicit login id wins over usernameFormat derivation', () => {
  it("'full' with no explicit userid → the full email", () => {
    expect(resolveAuthUser('mario@example.com', 'full')).toBe('mario@example.com')
  })
  it("'local' with no explicit userid → the local-part only", () => {
    expect(resolveAuthUser('mario@alice.it', 'local')).toBe('mario')
  })
  it('an explicit userid overrides the full-address derivation', () => {
    expect(resolveAuthUser('mario@corp.example', 'full', 'mario.rossi.login')).toBe('mario.rossi.login')
  })
  it('an explicit userid overrides even the local-part derivation', () => {
    expect(resolveAuthUser('mario@alice.it', 'local', 'weird-login-id')).toBe('weird-login-id')
  })
  it('trims surrounding whitespace on the explicit userid', () => {
    expect(resolveAuthUser('mario@corp.example', 'full', '  spaced.login  ')).toBe('spaced.login')
  })
  it('an empty / whitespace-only explicit userid falls through to the derivation', () => {
    expect(resolveAuthUser('mario@alice.it', 'local', '')).toBe('mario')
    expect(resolveAuthUser('mario@alice.it', 'local', '   ')).toBe('mario')
    expect(resolveAuthUser('mario@example.com', 'full', undefined)).toBe('mario@example.com')
  })
})
