import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * TRDD-32PK69ND follow-up: setup-verify mints a session cookie, so its Secure flag must follow
 * the request scheme exactly like auth/login. Persistence layers are stubbed (no filesystem
 * touched); buildSessionCookie is the REAL one, so the flag is what is under test.
 */
beforeEach(() => {
  vi.resetModules()
  vi.doMock('@/lib/governance', () => ({ loadGovernance: () => ({ passwordHash: null }), setUserAvatar: async () => {} }))
  vi.doMock('@/services/governance-service', () => ({ setGovernancePassword: async () => ({}) }))
  vi.doMock('@/lib/setup-bootstrap', () => ({ verifySetupCode: () => ({ ok: true }) }))
  vi.doMock('@/lib/session-auth', async (orig) => ({ ...(await orig<object>()), createSession: async () => 'tok' }))
})
afterEach(() => { vi.restoreAllMocks() })

const mk = (url: string) => new NextRequest(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ code: '123456', password: 'longenough1', userName: 'me' }),
})

describe('POST /api/auth/setup-verify session cookie', () => {
  it('is Secure on https and not on http', async () => {
    const { POST } = await import('@/app/api/auth/setup-verify/route')
    const https = await POST(mk('https://localhost/api/auth/setup-verify'))
    expect(https.headers.get('set-cookie')).toMatch(/; Secure/)
    const http = await POST(mk('http://localhost/api/auth/setup-verify'))
    expect(http.headers.get('set-cookie')).toMatch(/aim_session=tok/)
    expect(http.headers.get('set-cookie')).not.toMatch(/Secure/)
  })
})
