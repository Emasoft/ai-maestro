import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { NextRequest } from 'next/server'

/**
 * `POST /api/auth/login` — the `devToken` branch (TRDD-A9335BZ6, unit3).
 *
 * `$HOME` is stubbed to a throwaway dir before any import, because
 * governance computes its file path at MODULE LOAD — otherwise this test
 * would mint a real dev token into the developer's own
 * `~/.aimaestro/governance.json`.
 */

function makeReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aim-login-devtoken-'))
  vi.stubEnv('HOME', dir)
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

async function loadRoute() {
  return (await import('@/app/api/auth/login/route')).POST
}

describe('POST /api/auth/login — devToken branch', () => {
  it('a valid dev token mints a session cookie', async () => {
    const { mintDevToken } = await import('@/lib/dev-mode-token')
    const token = await mintDevToken()
    const POST = await loadRoute()

    const res = await POST(makeReq({ devToken: token }))

    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    expect(res.headers.get('Set-Cookie')).toMatch(/^aim_session=/)
  })

  it('a wrong dev token 401s with "Invalid token"', async () => {
    const { mintDevToken } = await import('@/lib/dev-mode-token')
    await mintDevToken()
    const POST = await loadRoute()

    const res = await POST(makeReq({ devToken: 'am-not-the-real-token' }))

    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Invalid token')
    expect(res.headers.get('Set-Cookie')).toBeNull()
  })

  it('a body carrying BOTH password and devToken 400s', async () => {
    const POST = await loadRoute()
    const res = await POST(makeReq({ password: 'x', devToken: 'am-y' }))
    expect(res.status).toBe(400)
  })

  it('a body carrying NEITHER field 400s', async () => {
    const POST = await loadRoute()
    const res = await POST(makeReq({}))
    expect(res.status).toBe(400)
  })

  it('the password branch is unchanged: correct password still mints a session', async () => {
    const g = await import('@/lib/governance')
    await g.setPassword('correct-horse-battery-staple')
    const POST = await loadRoute()

    const res = await POST(makeReq({ password: 'correct-horse-battery-staple' }))

    expect(res.status).toBe(200)
    expect(res.headers.get('Set-Cookie')).toMatch(/^aim_session=/)
  })
})

/**
 * NEUTER RECORD — TRDD-A9335BZ6 unit3
 *
 * Made the devToken branch accept any string (`isDevToken ? true : ...`
 * in place of the real `verifyDevToken` call).
 *   Reds 1:
 *     × a wrong dev token 401s with "Invalid token"
 *   Every other test in this file stays green, including "a valid dev
 *   token mints a session cookie" (a correct token still passes a
 *   permissive check) — which is exactly the property the neuter proves:
 *   only the wrong-token case can distinguish a real check from a stub.
 * Restored; full file green again (5/5).
 */
