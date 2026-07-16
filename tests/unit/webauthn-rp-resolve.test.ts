import { describe, it, expect, afterEach } from 'vitest'
import { resolveWebAuthnRp, getAllowedTsHost } from '@/lib/webauthn-server'

// TRDD-OC9ELGSO P2 — host-derived WebAuthn rpId/origin against a strict,
// fail-closed allow-list. localhost is the always-on default so single-operator
// behaviour is byte-identical to the previous hardcode; a configured `*.ts.net`
// host is the only other permitted relying party; everything else is rejected.
describe('resolveWebAuthnRp — host-derived rpId + origin (allow-listed, fail-closed)', () => {
  const TS_HOST = 'mac.tail1234.ts.net'

  it('resolves localhost:23000 to the historical localhost / http origin', () => {
    // The byte-identical guarantee: this MUST equal the old hardcode
    // (RP_ID='localhost', ORIGIN='http://localhost:23000').
    expect(resolveWebAuthnRp('localhost:23000')).toEqual({
      rpId: 'localhost',
      origin: 'http://localhost:23000',
    })
  })

  it('keeps http scheme for localhost on a non-default port (secure context without TLS)', () => {
    expect(resolveWebAuthnRp('localhost:3000')).toEqual({
      rpId: 'localhost',
      origin: 'http://localhost:3000',
    })
  })

  it('returns the localhost default when no Host header is threaded (undefined/null/empty)', () => {
    const expected = { rpId: 'localhost', origin: 'http://localhost:23000' }
    expect(resolveWebAuthnRp(undefined, TS_HOST)).toEqual(expected)
    expect(resolveWebAuthnRp(null, TS_HOST)).toEqual(expected)
    expect(resolveWebAuthnRp('   ', TS_HOST)).toEqual(expected)
  })

  it('resolves an allow-listed *.ts.net host to that rpId + an https origin', () => {
    expect(resolveWebAuthnRp(`${TS_HOST}:23000`, TS_HOST)).toEqual({
      rpId: TS_HOST,
      origin: `https://${TS_HOST}:23000`,
    })
  })

  it('emits an https origin without a port when the allow-listed *.ts.net host carries none', () => {
    expect(resolveWebAuthnRp(TS_HOST, TS_HOST)).toEqual({
      rpId: TS_HOST,
      origin: `https://${TS_HOST}`,
    })
  })

  it('matches host and configured allow-list case-insensitively', () => {
    expect(resolveWebAuthnRp(`${TS_HOST.toUpperCase()}:23000`, TS_HOST.toUpperCase())).toEqual({
      rpId: TS_HOST,
      origin: `https://${TS_HOST}:23000`,
    })
  })

  it('REJECTS a bare IPv4 host — an IP is never a valid WebAuthn RP_ID', () => {
    expect(() => resolveWebAuthnRp('100.99.233.43:23000', TS_HOST)).toThrow(/webauthn_host_not_allowed/)
  })

  it('REJECTS a non-allow-listed hostname (anti RP-spoofing)', () => {
    expect(() => resolveWebAuthnRp('evil.example.com:23000', TS_HOST)).toThrow(/webauthn_host_not_allowed/)
  })

  it('REJECTS a *.ts.net host that is NOT the configured one', () => {
    expect(() => resolveWebAuthnRp('other.tail1234.ts.net:23000', TS_HOST)).toThrow(/webauthn_host_not_allowed/)
  })

  it('with an EMPTY allow-list only localhost resolves — a *.ts.net host is rejected', () => {
    // localhost still works with no ts host configured...
    expect(resolveWebAuthnRp('localhost:23000')).toEqual({
      rpId: 'localhost',
      origin: 'http://localhost:23000',
    })
    // ...but the *.ts.net host has nothing to match against ⇒ rejected.
    expect(() => resolveWebAuthnRp(`${TS_HOST}:23000`)).toThrow(/webauthn_host_not_allowed/)
  })

  it('IGNORES a malformed allow-list entry (must never widen beyond localhost)', () => {
    // A non-`*.ts.net` "allowed" value cannot be matched — the request is still rejected.
    expect(() => resolveWebAuthnRp('100.99.233.43:23000', '100.99.233.43')).toThrow(/webauthn_host_not_allowed/)
    expect(() => resolveWebAuthnRp('evil.example.com:23000', 'evil.example.com')).toThrow(/webauthn_host_not_allowed/)
  })

  it('REJECTS an unparseable Host header (fail closed, never silently defaulted)', () => {
    // An unterminated IPv6 bracket makes `new URL` throw ⇒ the parse-catch fires.
    expect(() => resolveWebAuthnRp('[', TS_HOST)).toThrow(/webauthn_host_not_allowed/)
  })
})

describe('getAllowedTsHost — env-configured allow-list (empty by default)', () => {
  const KEY = 'AIM_WEBAUTHN_TS_HOST'
  const original = process.env[KEY]

  afterEach(() => {
    if (original === undefined) delete process.env[KEY]
    else process.env[KEY] = original
  })

  it('returns undefined when the env var is unset (⇒ localhost-only, identical to today)', () => {
    delete process.env[KEY]
    expect(getAllowedTsHost()).toBeUndefined()
  })

  it('returns a valid *.ts.net host, lowercased and trimmed', () => {
    process.env[KEY] = '  Mac.Tail1234.TS.NET  '
    expect(getAllowedTsHost()).toBe('mac.tail1234.ts.net')
  })

  it('IGNORES a malformed value (a bare IP or non-ts.net domain) — fail closed to localhost', () => {
    process.env[KEY] = '100.99.233.43'
    expect(getAllowedTsHost()).toBeUndefined()
    process.env[KEY] = 'evil.example.com'
    expect(getAllowedTsHost()).toBeUndefined()
    process.env[KEY] = ''
    expect(getAllowedTsHost()).toBeUndefined()
  })
})
