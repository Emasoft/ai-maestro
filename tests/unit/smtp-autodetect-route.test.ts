/**
 * Route-level coverage for POST /api/governance/email/autodetect.
 *
 * The route (app/api/governance/email/autodetect/route.ts) validates the email,
 * then calls lib/smtp-autodetect.ts::autodetectSMTP(email, { verify: false }) and
 * returns the non-secret fields, or 404 when detection yields null.
 *
 * These tests exercise the REAL detection code — no mocks. The paths covered are
 * fully OFFLINE: a curated known provider short-circuits before any network, and
 * a domain-less address returns null before any network. parseIspdbSmtp is a pure
 * XML parser tested with a real Thunderbird autoconfig fragment.
 */
import { describe, it, expect } from 'vitest'
import { autodetectSMTP, parseIspdbSmtp } from '@/lib/smtp-autodetect'

describe('autodetectSMTP (real, offline paths the route relies on)', () => {
  it('resolves a curated known provider (Gmail) to its real SMTP settings without any network', async () => {
    // verify:false is exactly what the route passes; a table hit never touches the network.
    const detected = await autodetectSMTP('someone@gmail.com', { verify: false })
    expect(detected).not.toBeNull()
    expect(detected).toMatchObject({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      source: 'table',
      known: true,
      label: 'Gmail',
      usernameFormat: 'full',
    })
    // The route surfaces appPasswordUrl so the UI can link out — it must be present for Gmail.
    expect(detected!.appPasswordUrl).toContain('myaccount.google.com')
  })

  it('returns null for an address with no usable domain (the route\'s 404 path), offline', async () => {
    // "user@localhost" has no dot in the domain → emailDomain() returns null and
    // autodetectSMTP short-circuits BEFORE any DNS/HTTP lookup. Default verify=true
    // is safe here precisely because it never reaches the network.
    const detected = await autodetectSMTP('user@localhost')
    expect(detected).toBeNull()
  })
})

describe('parseIspdbSmtp (pure Thunderbird autoconfig parser)', () => {
  it('parses a real ISPDB autoconfig XML to the correct config and returns null on malformed input', () => {
    // A real Mozilla ISPDB-shaped fragment: <outgoingServer type="smtp"> with SSL socket
    // and a %EMAILADDRESS% username template (⇒ usernameFormat 'full').
    const xml = `<?xml version="1.0"?>
<clientConfig version="1.1">
  <emailProvider id="example.com">
    <outgoingServer type="smtp">
      <hostname>smtp.example.com</hostname>
      <port>465</port>
      <socketType>SSL</socketType>
      <username>%EMAILADDRESS%</username>
      <authentication>password-cleartext</authentication>
    </outgoingServer>
  </emailProvider>
</clientConfig>`
    expect(parseIspdbSmtp(xml)).toEqual({
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      usernameFormat: 'full',
    })

    // A local-part username template flips usernameFormat to 'local' (EU telco quirk).
    const localXml = xml.replace('%EMAILADDRESS%', '%EMAILLOCALPART%')
    expect(parseIspdbSmtp(localXml)?.usernameFormat).toBe('local')

    // No <outgoingServer> block → no config to parse → null (not a throw).
    expect(parseIspdbSmtp('<clientConfig><nothing/></clientConfig>')).toBeNull()
  })
})
