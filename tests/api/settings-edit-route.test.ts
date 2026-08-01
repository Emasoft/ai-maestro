/**
 * TRDD-RYFP030K — `app/api/settings/edit/route.ts`, the HTTP transport over
 * `lib/settings-gate.ts`.
 *
 * TWO gates stack, checked in this order (console FIRST — same reasoning as
 * `app/api/governance/password/invalidate/route.ts`: a remote caller must get ONE
 * uniform answer and never learn whether it merely failed authorization vs. failed
 * presence): `isConsolePeer` (real — it is a pure header read, no mock needed, same
 * technique as `tests/unit/password-reset.test.ts`) and `enforceSystemOwner` (mocked,
 * same technique as `tests/api/marketplaces-route-refuses-to-clobber-settings.test.ts`,
 * since real session-cookie verification is its own module's concern).
 *
 * Everything past the two gates runs REAL — real `lib/settings-gate.ts`, real
 * `lib/json-io.ts`, a real mkdtemp file — for the same reason `json-io-update.test.ts`
 * does: these are filesystem properties a mock cannot discriminate. Per the STATE
 * block's incident note, `guardRealUserSettings()` is the tripwire that would catch a
 * resolution bug quietly falling back to the developer's own `~/.claude/settings.json`.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { NextRequest } from 'next/server'
import { guardRealUserSettings } from '../helpers/real-home-untouched'

const CONSOLE_PEER = '127.0.0.1'
const REMOTE_PEER = '100.64.0.1' // Tailscale CGNAT — on the VPN, but NOT the console

const { mockEnforceSystemOwner } = vi.hoisted(() => ({ mockEnforceSystemOwner: vi.fn() }))

vi.mock('@/lib/route-auth', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  enforceSystemOwner: mockEnforceSystemOwner,
}))

function getReq(peer: string | null, path?: string): NextRequest {
  const url = new URL('http://localhost:23000/api/settings/edit')
  if (path !== undefined) url.searchParams.set('path', path)
  return new NextRequest(url, {
    method: 'GET',
    headers: peer ? { 'x-aim-peer': peer } : {},
  })
}

function postReq(peer: string | null, body: unknown): NextRequest {
  return new NextRequest('http://localhost:23000/api/settings/edit', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(peer ? { 'x-aim-peer': peer } : {}),
    },
    body: JSON.stringify(body),
  })
}

async function loadRoute() {
  return import('@/app/api/settings/edit/route')
}

describe('POST/GET /api/settings/edit', () => {
  let assertHomeUntouched: () => void
  let dir: string
  let target: string

  beforeAll(() => { assertHomeUntouched = guardRealUserSettings() })
  afterAll(() => { assertHomeUntouched() })

  beforeEach(() => {
    vi.clearAllMocks()
    mockEnforceSystemOwner.mockReturnValue(null) // authorized by default
    dir = mkdtempSync(join(tmpdir(), 'aim-settings-route-'))
    mkdirSync(join(dir, '.claude'), { recursive: true })
    target = join(dir, '.claude', 'settings.local.json')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  describe('console gate — checked BEFORE authorization', () => {
    it('GET from a REMOTE peer is refused 403 console_required, and owner auth is never consulted', async () => {
      const { GET } = await loadRoute()
      const res = await GET(getReq(REMOTE_PEER, target))
      expect(res.status).toBe(403)
      expect((await res.json()).error).toBe('console_required')
      expect(mockEnforceSystemOwner).not.toHaveBeenCalled()
    })

    it('POST from a REMOTE peer is refused 403 console_required, and owner auth is never consulted', async () => {
      const { POST } = await loadRoute()
      const res = await POST(postReq(REMOTE_PEER, { path: target, ops: [{ op: 'set', keyPath: ['a'], value: 1 }] }))
      expect(res.status).toBe(403)
      expect((await res.json()).error).toBe('console_required')
      expect(mockEnforceSystemOwner).not.toHaveBeenCalled()
    })

    it('no x-aim-peer header at all is treated as NOT the console (fail closed)', async () => {
      const { GET } = await loadRoute()
      const res = await GET(getReq(null, target))
      expect(res.status).toBe(403)
    })
  })

  describe('owner gate — console peer, but enforceSystemOwner refuses', () => {
    it('GET is refused with whatever enforceSystemOwner returns', async () => {
      const { NextResponse } = await import('next/server')
      mockEnforceSystemOwner.mockReturnValue(NextResponse.json({ error: 'Forbidden — system owner only' }, { status: 403 }))
      const { GET } = await loadRoute()
      const res = await GET(getReq(CONSOLE_PEER, target))
      expect(res.status).toBe(403)
      expect((await res.json()).error).toBe('Forbidden — system owner only')
    })
  })

  describe('happy path — console peer + authorized owner, real filesystem', () => {
    it('GET on a missing file reports ok:false reason:missing, 404', async () => {
      const { GET } = await loadRoute()
      const res = await GET(getReq(CONSOLE_PEER, target))
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ ok: false, reason: 'missing', error: undefined })
    })

    it('GET requires a path query param', async () => {
      const { GET } = await loadRoute()
      const res = await GET(getReq(CONSOLE_PEER))
      expect(res.status).toBe(400)
    })

    it('POST set creates the file, and a follow-up GET reads it back', async () => {
      const { POST, GET } = await loadRoute()
      const postRes = await POST(postReq(CONSOLE_PEER, {
        path: target,
        ops: [{ op: 'set', keyPath: ['enabledPlugins', 'foo@bar'], value: true }],
      }))
      expect(postRes.status).toBe(200)
      const postBody = await postRes.json()
      expect(postBody.success).toBe(true)
      expect(postBody.changed).toBe(true)

      expect(JSON.parse(readFileSync(target, 'utf-8'))).toEqual({ enabledPlugins: { 'foo@bar': true } })

      const getRes = await GET(getReq(CONSOLE_PEER, target))
      expect(getRes.status).toBe(200)
      expect(await getRes.json()).toEqual({ ok: true, data: { enabledPlugins: { 'foo@bar': true } } })
    })

    it('POST rejects a malformed ops array with 400 and touches nothing', async () => {
      const { POST } = await loadRoute()
      const res = await POST(postReq(CONSOLE_PEER, { path: target, ops: [{ op: 'rename', keyPath: ['a'] }] }))
      expect(res.status).toBe(400)
    })

    it('POST rejects a path outside the allowed shape with 400 and touches nothing', async () => {
      const { POST } = await loadRoute()
      const outside = join(dir, 'not-claude', 'settings.json')
      const res = await POST(postReq(CONSOLE_PEER, { path: outside, ops: [{ op: 'set', keyPath: ['a'], value: 1 }] }))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(/refusing to edit/)
    })

    it('POST on an unreadable target answers 409 and names the cause, not a generic 500', async () => {
      writeFileSync(target, '{ not json', 'utf-8')
      const { POST } = await loadRoute()
      const res = await POST(postReq(CONSOLE_PEER, { path: target, ops: [{ op: 'set', keyPath: ['a'], value: 1 }] }))
      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body.errorType).toBe('unreadable-settings')
      expect(body.error).toMatch(/does not parse/)
      // The corrupt file must be left exactly as it was — refused, not clobbered.
      expect(readFileSync(target, 'utf-8')).toBe('{ not json')
    })

    it('GET on an unreadable target answers 409 with reason unreadable', async () => {
      writeFileSync(target, '{ not json', 'utf-8')
      const { GET } = await loadRoute()
      const res = await GET(getReq(CONSOLE_PEER, target))
      expect(res.status).toBe(409)
      expect((await res.json()).reason).toBe('unreadable')
    })
  })
})
