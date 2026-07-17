import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import {
  VIEWER_HEADER,
  buildViewerPayload,
  signViewerToken,
  readEmbedKey,
  _resetEmbedKeyStateForTests,
} from '../../lib/analytics-viewer-token.mjs'

// AgentlensPro's CI-locked §B4 test vector (issue #4, shipped in npm 2.10.0). Pinning it here is
// the whole point: if this assertion ever fails, our stamper and their verifier have diverged —
// do NOT "fix" the expected string, find why the bytes changed. (TRDD-YY6M8Z16.)
const B4_KEY_HEX = '6b6579' // 3-byte demo key ("key"); the real key is 64 hex = 32 bytes
const B4_PAYLOAD = { v: 1, role: 'user', iat: 1752720000000, exp: 1752720060000, nonce: '0123456789abcdef' }
const B4_PAYLOAD_JSON = '{"v":1,"role":"user","iat":1752720000000,"exp":1752720060000,"nonce":"0123456789abcdef"}'
const B4_TOKEN =
  'eyJ2IjoxLCJyb2xlIjoidXNlciIsImlhdCI6MTc1MjcyMDAwMDAwMCwiZXhwIjoxNzUyNzIwMDYwMDAwLCJub25jZSI6IjAxMjM0NTY3ODlhYmNkZWYifQ.aj_Q93wQFqYwSQZgXU-KbWCMTbJH8K6mvEBdfouklpo'

describe('analytics-viewer-token — the AgentlensPro §B4 contract (TRDD-YY6M8Z16)', () => {
  afterEach(() => _resetEmbedKeyStateForTests())

  it('reproduces AgentlensPro §B4 vector byte-for-byte', () => {
    expect(signViewerToken(B4_PAYLOAD, Buffer.from(B4_KEY_HEX, 'hex'))).toBe(B4_TOKEN)
  })

  it('the header name is exactly X-Agentlens-Viewer', () => {
    expect(VIEWER_HEADER).toBe('X-Agentlens-Viewer')
  })

  it('emits base64url with no padding and only url-safe chars', () => {
    const tok = signViewerToken(B4_PAYLOAD, Buffer.from(B4_KEY_HEX, 'hex'))
    expect(tok).not.toMatch(/[+/=]/) // the 32-byte HMAC would base64-pad with "="; it is stripped
    expect(tok).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  })

  it('buildViewerPayload emits B3 key order and exp = iat + 60000', () => {
    const p = buildViewerPayload('user', 1752720000000, '0123456789abcdef')
    expect(Object.keys(p)).toEqual(['v', 'role', 'iat', 'exp', 'nonce'])
    expect(p).toEqual(B4_PAYLOAD)
    // key order is load-bearing: it must serialize to the exact bytes the vector's b64url encodes
    expect(JSON.stringify(p)).toBe(B4_PAYLOAD_JSON)
  })

  it('a built payload round-trips through the signer to the vector token', () => {
    const p = buildViewerPayload('user', 1752720000000, '0123456789abcdef')
    expect(signViewerToken(p, Buffer.from(B4_KEY_HEX, 'hex'))).toBe(B4_TOKEN)
  })

  it('different roles produce different tokens (the projection is maestro|user, never a raw title)', () => {
    const key = Buffer.from(B4_KEY_HEX, 'hex')
    const maestro = signViewerToken(buildViewerPayload('maestro', 1, 'aa'), key)
    const user = signViewerToken(buildViewerPayload('user', 1, 'aa'), key)
    expect(maestro).not.toBe(user)
  })

  describe('readEmbedKey — fail-closed key custody', () => {
    let dir: string
    const KEY64 = 'a'.repeat(64) // 32 bytes of 0xaa
    const keyPath = () => path.join(dir, 'embed-key')

    beforeEach(() => {
      dir = mkdtempSync(path.join(tmpdir(), 'aim-embedkey-'))
    })
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true })
      _resetEmbedKeyStateForTests()
    })

    it('returns the 32-byte key from a 0600 64-hex file', () => {
      writeFileSync(keyPath(), KEY64 + '\n')
      chmodSync(keyPath(), 0o600)
      const k = readEmbedKey(keyPath())
      expect(k).toBeInstanceOf(Buffer)
      expect(k?.length).toBe(32)
      expect(k?.toString('hex')).toBe(KEY64)
    })

    it('REFUSES a key file wider than 0600 (returns null — a shared secret must not be group/world readable)', () => {
      writeFileSync(keyPath(), KEY64 + '\n')
      chmodSync(keyPath(), 0o644)
      expect(readEmbedKey(keyPath())).toBeNull()
    })

    it('REFUSES a non-64-hex file (returns null)', () => {
      writeFileSync(keyPath(), 'not-hex-content\n')
      chmodSync(keyPath(), 0o600)
      expect(readEmbedKey(keyPath())).toBeNull()
    })

    it('returns null when the key file is absent', () => {
      expect(readEmbedKey(path.join(dir, 'does-not-exist'))).toBeNull()
    })
  })
})
