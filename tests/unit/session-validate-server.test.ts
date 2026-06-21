import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash } from 'crypto'
// The new .mjs validator server.mjs uses (it cannot import the TS validateSession
// under plain `node server.mjs`, but it shares globalThis with the Next routes).
import { validateSessionCookie, extractSessionToken } from '@/lib/session-validate-server.mjs'

// server.mjs's full-mode auth gates (hasCredential / wsHasCredential) used a
// PRESENCE-ONLY cookie regex, so any non-empty `aim_session=...` value — a forged
// cookie from a Tailscale peer or a local process — passed. This validator closes
// that bypass by checking the token against the SAME in-memory store
// lib/session-auth.ts owns (globalThis.__aiMaestroSessionsMap). Contract mirrored
// from lib/session-auth.ts: sha256(token) hex key; valid iff present AND
// Date.now() <= record.expires_at.

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
function seedSession(token: string, expiresAt: number): void {
  const g = globalThis as unknown as { __aiMaestroSessionsMap?: Map<string, unknown> }
  if (!g.__aiMaestroSessionsMap) g.__aiMaestroSessionsMap = new Map()
  g.__aiMaestroSessionsMap.set(hashToken(token), {
    token_hash: hashToken(token), created_at: Date.now(), expires_at: expiresAt,
  })
}

describe('session-validate-server (.mjs full-mode cookie validator)', () => {
  beforeEach(() => { (globalThis as unknown as { __aiMaestroSessionsMap?: unknown }).__aiMaestroSessionsMap = new Map() })
  afterEach(() => { delete (globalThis as unknown as { __aiMaestroSessionsMap?: unknown }).__aiMaestroSessionsMap })

  it('extractSessionToken pulls the aim_session value from a cookie header', () => {
    expect(extractSessionToken('foo=1; aim_session=abc123; bar=2')).toBe('abc123')
    expect(extractSessionToken('aim_session=xyz')).toBe('xyz')
    // Leading whitespace before the FIRST cookie-pair — parity with the canonical
    // split+trim extractor in lib/session-auth.ts (NIT-1 from the adversarial
    // verification of TRDD-ba9d6df2: the old `(?:^|;\s*)` anchor rejected this,
    // diverging from the browser routes; `(?:^|;)\s*` now accepts it, fail-closed).
    expect(extractSessionToken('  aim_session=ws123')).toBe('ws123')
    expect(extractSessionToken('\taim_session=tab456')).toBe('tab456')
    expect(extractSessionToken('other=1')).toBeNull()
    expect(extractSessionToken('')).toBeNull()
    expect(extractSessionToken(null)).toBeNull()
    expect(extractSessionToken(undefined)).toBeNull()
  })

  it('validates a live (unexpired) session token present in the shared global Map', () => {
    const token = 'live-token-deadbeef'
    seedSession(token, Date.now() + 60_000)
    expect(validateSessionCookie(`aim_session=${token}`)).toBe(true)
  })

  it('REJECTS a forged token that is not in the store (the bypass this fix closes)', () => {
    seedSession('real-token', Date.now() + 60_000)
    // A presence-only check PASSES this forged non-empty cookie; we must reject it.
    expect(validateSessionCookie('aim_session=forged-not-in-map')).toBe(false)
  })

  it('REJECTS an expired session and evicts it (mirrors validateSession lazy purge)', () => {
    const token = 'stale-token'
    seedSession(token, Date.now() - 1000) // already expired
    expect(validateSessionCookie(`aim_session=${token}`)).toBe(false)
    const g = globalThis as unknown as { __aiMaestroSessionsMap: Map<string, unknown> }
    expect(g.__aiMaestroSessionsMap.has(hashToken(token))).toBe(false) // evicted
  })

  it('REJECTS when no aim_session cookie is present', () => {
    seedSession('real-token', Date.now() + 60_000)
    expect(validateSessionCookie('other=1; foo=bar')).toBe(false)
    expect(validateSessionCookie('')).toBe(false)
    expect(validateSessionCookie(null)).toBe(false)
  })

  it('REJECTS when the global Map is absent (no sessions ever created)', () => {
    delete (globalThis as unknown as { __aiMaestroSessionsMap?: unknown }).__aiMaestroSessionsMap
    expect(validateSessionCookie('aim_session=anything')).toBe(false)
  })
})
