import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { NextRequest, NextResponse } from 'next/server'

/**
 * /api/auth/dev-token (TRDD-A9335BZ6) — the owner's only mint/status/pause/
 * revoke surface for the dev-mode login token. Load-bearing claims: mint
 * requires BOTH the governance password AND a verified WebAuthn assertion
 * (neither alone is sufficient — no password-only fallback); the minted
 * token is returned exactly once and GET never exposes it; DELETE revokes.
 * The owner gate, password check, and WebAuthn verification are stubbed
 * (their own suites cover them); `lib/dev-mode-token.ts` + governance.json
 * run REAL against a throwaway $HOME so the mint/status/revoke assertions
 * are true, not mocked.
 */
const PASSWORD = 'correct-horse-battery-staple'
const ASSERTION = {
  id: 'cred-1',
  rawId: 'cred-1',
  response: {
    clientDataJSON: 'x',
    authenticatorData: 'y',
    signature: 'z',
  },
  clientExtensionResults: {},
  type: 'public-key',
}

function makeReq(method: string, body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/auth/dev-token', {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function mockDeps(opts: {
  gateDenied?: boolean
  passwordOk?: boolean
  hasCredentials?: boolean
  assertionOk?: boolean
}) {
  const verifyPassword = vi.fn(async () => opts.passwordOk !== false)
  const hasRegisteredCredentials = vi.fn(() => opts.hasCredentials !== false)
  const verifyWebAuthnAuthentication = vi.fn(async () => {
    if (opts.assertionOk === false) throw new Error('webauthn_verification_failed')
    return { newCounter: 1 }
  })
  const generateWebAuthnAuthenticationOptions = vi.fn(async () => ({ challenge: 'chal' }))

  vi.doMock('@/lib/route-auth', () => ({
    enforceSystemOwner: vi.fn(() =>
      opts.gateDenied ? NextResponse.json({ error: 'Forbidden' }, { status: 403 }) : null
    ),
  }))
  vi.doMock('@/lib/governance', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/governance')>()
    return { ...actual, verifyPassword }
  })
  vi.doMock('@/lib/webauthn-server', () => ({
    hasRegisteredCredentials,
    verifyWebAuthnAuthentication,
    generateWebAuthnAuthenticationOptions,
  }))
  vi.doMock('@/lib/rate-limit', () => ({
    checkAndRecordAttempt: vi.fn(() => ({ allowed: true })),
    resetRateLimit: vi.fn(),
  }))
  vi.doMock('@/lib/kill-switch', () => ({
    isLockedDown: vi.fn(() => false),
    recordAuthFailure: vi.fn(),
    recordAuthSuccess: vi.fn(),
  }))
  return { verifyPassword, hasRegisteredCredentials, verifyWebAuthnAuthentication }
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aim-dev-token-'))
  vi.stubEnv('HOME', dir)
  vi.resetModules()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

async function loadRoute() {
  return await import('@/app/api/auth/dev-token/route')
}

describe('POST /api/auth/dev-token', () => {
  it('refuses on wrong password (no webauthn check, no mint)', async () => {
    const { verifyWebAuthnAuthentication } = mockDeps({ passwordOk: false })
    const { POST } = await loadRoute()
    const res = await POST(makeReq('POST', { password: PASSWORD, assertion: ASSERTION }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('invalid_password')
    expect(verifyWebAuthnAuthentication).not.toHaveBeenCalled()
  })

  it('refuses when no passkey is registered — no password-only fallback', async () => {
    mockDeps({ hasCredentials: false })
    const { POST } = await loadRoute()
    const res = await POST(makeReq('POST', { password: PASSWORD, assertion: ASSERTION }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('no_passkeys_registered')
  })

  it('refuses when the assertion verification fails', async () => {
    mockDeps({ assertionOk: false })
    const { POST } = await loadRoute()
    const res = await POST(makeReq('POST', { password: PASSWORD, assertion: ASSERTION }))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('webauthn_verification_failed')
  })

  it('mints and returns the token exactly once; GET status never exposes it', async () => {
    mockDeps({})
    const { POST, GET } = await loadRoute()
    const res = await POST(makeReq('POST', { password: PASSWORD, assertion: ASSERTION }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.token).toBe('string')
    expect(body.token.startsWith('am-')).toBe(true)

    const statusRes = await GET(makeReq('GET'))
    const status = await statusRes.json()
    expect(status).toEqual(
      expect.objectContaining({ enabled: true, issued: true })
    )
    expect(status.token).toBeUndefined()
    expect(JSON.stringify(status)).not.toContain(body.token)
  })

  it('403s the whole route when the owner gate denies', async () => {
    mockDeps({ gateDenied: true })
    const { POST } = await loadRoute()
    const res = await POST(makeReq('POST', { password: PASSWORD, assertion: ASSERTION }))
    expect(res.status).toBe(403)
  })
})

describe('GET /api/auth/dev-token?challenge=1', () => {
  it('returns WebAuthn authentication options when a passkey is registered', async () => {
    mockDeps({})
    const { GET } = await loadRoute()
    const res = await GET(new NextRequest('http://localhost/api/auth/dev-token?challenge=1'))
    expect(res.status).toBe(200)
    expect((await res.json()).challenge).toBe('chal')
  })

  it('404s when no passkey is registered', async () => {
    mockDeps({ hasCredentials: false })
    const { GET } = await loadRoute()
    const res = await GET(new NextRequest('http://localhost/api/auth/dev-token?challenge=1'))
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/auth/dev-token', () => {
  it('toggles enabled without destroying an existing token', async () => {
    mockDeps({})
    const { POST, PATCH } = await loadRoute()
    await POST(makeReq('POST', { password: PASSWORD, assertion: ASSERTION }))

    const res = await PATCH(makeReq('PATCH', { enabled: false }))
    const body = await res.json()
    expect(body.enabled).toBe(false)
    expect(body.issued).toBe(true)
  })
})

describe('DELETE /api/auth/dev-token', () => {
  it('revokes the token', async () => {
    mockDeps({})
    const { POST, DELETE, GET } = await loadRoute()
    await POST(makeReq('POST', { password: PASSWORD, assertion: ASSERTION }))

    const res = await DELETE(makeReq('DELETE'))
    expect((await res.json()).success).toBe(true)

    const status = await (await GET(makeReq('GET'))).json()
    expect(status.issued).toBe(false)
  })
})
