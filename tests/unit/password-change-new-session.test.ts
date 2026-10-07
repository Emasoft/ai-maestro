import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { EventEmitter } from 'events'
import { Readable } from 'stream'
import { NextRequest } from 'next/server'

/**
 * Owner ruling (TRDD-32PK69ND): "if the person changes the password all sessions are to be
 * considered expired and a new cookie must be created". setPassword() ends every session; the
 * password route must mint the changer a fresh one, on success only, and the headless forwarder
 * must pass that Set-Cookie through. HOME is jailed to /tmp before any import (governance and the
 * session store resolve homedir()); only the auth/sudo GATES are stubbed — they are not the subject.
 */

const OLD = 'old-password-123'
const NEW = 'new-password-456'

let dir: string

let callerAuth: { agentId?: string; error?: string } = {}
// When set, the caller's identity is derived from the REAL session store instead of callerAuth:
// owner only while the request's aim_session cookie is a live session. A fixed stub cannot see
// setPassword() deleting the very session that authenticated the request, which is how a route
// that re-checks the caller AFTER the change silently stops minting (review finding).
let liveSessions: { validateSession(t: string): boolean } | null = null

function stubGates() {
  vi.doMock('@/lib/route-auth', () => ({ enforceSystemOwner: () => null }))
  vi.doMock('@/lib/sudo-guard', () => ({ requireSudoToken: () => null }))
  vi.doMock('@/lib/agent-auth', async (orig) => ({
    ...(await orig<object>()),
    authenticateFromRequest: (req: Request) => {
      if (!liveSessions) return callerAuth
      const tok = /aim_session=([^;]+)/.exec(req.headers.get('cookie') ?? '')?.[1]
      return tok && liveSessions.validateSession(tok) ? {} : { error: 'unauthenticated' }
    },
    authenticateFromRequestAsync: async () => ({ agentId: undefined, error: undefined }),
  }))
}

function post(body: unknown) {
  return new NextRequest('http://localhost/api/governance/password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function tokenOf(setCookie: string | null | undefined): string {
  const m = /aim_session=([^;]+)/.exec(setCookie ?? '')
  expect(m).not.toBeNull()
  return m![1]
}

async function setup() {
  stubGates()
  const gov = await import('@/lib/governance')
  await gov.setPassword(OLD)
  const sess = await import('@/lib/session-auth')
  const oldToken = await sess.createSession()
  return { sess, oldToken }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aim-pwnew-'))
  vi.stubEnv('HOME', dir)
  vi.resetModules()
  callerAuth = {}
  liveSessions = null
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.doUnmock('@/lib/session-auth') // (h) mocks createSession; doMock survives resetModules
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

describe('password change ends every session and mints a new cookie', () => {
  it('(a) the old token is refused and Set-Cookie carries a VALID new token', async () => {
    const { sess, oldToken } = await setup()
    expect(sess.validateSession(oldToken)).toBe(true)
    const { POST } = await import('@/app/api/governance/password/route')

    const res = await POST(post({ password: NEW, currentPassword: OLD }))

    expect(res.status).toBe(200)
    expect(sess.validateSession(oldToken)).toBe(false)
    const fresh = tokenOf(res.headers.get('set-cookie'))
    expect(fresh).not.toBe(oldToken)
    expect(sess.validateSession(fresh)).toBe(true)
  })

  it('(f) identity from the REAL session store: the owner whose cookie authenticated the change still gets a new cookie', async () => {
    const { sess, oldToken } = await setup()
    liveSessions = sess
    const { POST } = await import('@/app/api/governance/password/route')
    const req = new NextRequest('http://localhost/api/governance/password', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `aim_session=${oldToken}` },
      body: JSON.stringify({ password: NEW, currentPassword: OLD }),
    })

    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(sess.validateSession(oldToken)).toBe(false)
    expect(sess.validateSession(tokenOf(res.headers.get('set-cookie')))).toBe(true)
  })

  it('(g) the new cookie carries Secure on an https request and not on http', async () => {
    await setup()
    const { POST } = await import('@/app/api/governance/password/route')
    const mk = (url: string, cur: string) => new NextRequest(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: cur === OLD ? NEW : OLD, currentPassword: cur }),
    })
    const https = await POST(mk('https://localhost/api/governance/password', OLD))
    expect(https.headers.get('set-cookie')).toMatch(/; Secure/)
    const http = await POST(mk('http://localhost/api/governance/password', NEW))
    expect(http.headers.get('set-cookie')).toMatch(/aim_session=/)
    expect(http.headers.get('set-cookie')).not.toMatch(/Secure/)
  })

  it('(h) the password changed but createSession throws: success status, login-required body, no cookie', async () => {
    stubGates()
    const gov = await import('@/lib/governance')
    await gov.setPassword(OLD)
    vi.doMock('@/lib/session-auth', async (orig) => ({
      ...(await orig<object>()),
      createSession: async () => { throw new Error('session store down') },
    }))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { POST } = await import('@/app/api/governance/password/route')

    const res = await POST(post({ password: NEW, currentPassword: OLD }))

    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toBeNull()
    const j = await res.json()
    expect(j.loginRequired).toBe(true)
    expect(j.sessionCreated).toBe(false)
    expect(await gov.verifyPassword(NEW)).toBe(true) // the change really happened
  })

  it('(b) a failed change (wrong current password only) sets no cookie and invalidates nothing', async () => {
    const { sess, oldToken } = await setup()
    const { POST } = await import('@/app/api/governance/password/route')

    const res = await POST(post({ password: NEW, currentPassword: 'wrong-password' }))

    expect(res.status).toBe(401)
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(sess.validateSession(oldToken)).toBe(true)
  })

  it('(d) an agent-authenticated caller never receives a Set-Cookie, even past the earlier gate', async () => {
    const { sess, oldToken } = await setup()
    callerAuth = { agentId: 'agent-1' }
    const { POST } = await import('@/app/api/governance/password/route')

    const res = await POST(post({ password: NEW, currentPassword: OLD }))

    expect(res.headers.get('set-cookie')).toBeNull()
    expect(sess.validateSession(oldToken)).toBe(false) // password changed, sessions ended
  })

  it('(e) an agent request through headless gets no Set-Cookie', async () => {
    await setup()
    callerAuth = { agentId: 'agent-1' }
    const { createHeadlessRouter } = await import('@/services/headless-router')
    const req: any = Readable.from([Buffer.from(JSON.stringify({ password: NEW, currentPassword: OLD }))])
    req.method = 'POST'
    req.url = '/api/governance/password'
    req.headers = { 'content-type': 'application/json', authorization: 'Bearer aim_tk_AAAAAAAAAAAAAAAAAAAAAAAA', 'x-agent-id': 'agent-1' }
    const res: any = new EventEmitter()
    res.headersSent = false
    res.setHeader = () => {}
    res.writeHead = (s: number, h: Record<string, string>) => { res.statusCode = s; res.headers = h; res.headersSent = true; return res }
    res.write = () => true
    res.end = () => {}

    await createHeadlessRouter().handle(req, res)

    expect(res.headers?.['Set-Cookie']).toBeUndefined()
  })

  it('(c) the headless forwarder preserves Set-Cookie', async () => {
    const { sess, oldToken } = await setup()
    const { createHeadlessRouter } = await import('@/services/headless-router')
    const req: any = Readable.from([Buffer.from(JSON.stringify({ password: NEW, currentPassword: OLD }))])
    req.method = 'POST'
    req.url = '/api/governance/password'
    req.headers = { 'content-type': 'application/json', authorization: 'Bearer aim_tk_AAAAAAAAAAAAAAAAAAAAAAAA' }
    const res: any = new EventEmitter()
    res.headersSent = false
    res._chunks = []
    res.setHeader = () => {}
    res.writeHead = (s: number, h: Record<string, string>) => { res.statusCode = s; res.headers = h; res.headersSent = true; return res }
    res.write = () => true
    res.end = (c?: any) => { if (c) res._chunks.push(Buffer.from(c)) }

    await createHeadlessRouter().handle(req, res)

    expect(res.statusCode).toBe(200)
    expect(sess.validateSession(oldToken)).toBe(false)
    expect(sess.validateSession(tokenOf(res.headers['Set-Cookie']))).toBe(true)
  })
})
