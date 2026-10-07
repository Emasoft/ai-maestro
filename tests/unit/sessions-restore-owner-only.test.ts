import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { EventEmitter } from 'events'
import { Readable } from 'stream'

/**
 * TRDD-SHGIKNLN — POST and DELETE /api/sessions/restore are system-owner only (Next route).
 * They authenticated and nothing more, so any agent credential could re-spawn every persisted
 * tmux session or delete persisted-session records. The headless half is pinned in
 * tests/unit/headless-router-auth-mirror.test.ts; neither test sees the other's regression.
 */

const mockAuthenticate = vi.fn()
vi.mock('@/lib/agent-auth', async (orig) => {
  const actual = await orig<typeof import('@/lib/agent-auth')>()
  return {
    ...actual,
    authenticateFromRequest: (...a: unknown[]) => mockAuthenticate(...a),
    // The headless router authenticates through these two.
    authenticateAgent: (...a: unknown[]) => mockAuthenticate(...a),
    authenticateFromRequestAsync: async (...a: unknown[]) => mockAuthenticate(...a),
  }
})
const restore = vi.fn(async () => ({ data: { restored: 1 }, status: 200 }))
const del = vi.fn(async () => ({ data: { success: true }, status: 200 }))
vi.mock('@/services/sessions-service', async (orig) => ({
  ...(await orig<object>()),
  listRestorableSessions: vi.fn(),
  restoreSessions: (...a: unknown[]) => restore(...(a as [])),
  deletePersistedSession: (...a: unknown[]) => del(...(a as [])),
}))

const post = () => new Request('http://localhost/api/sessions/restore', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ all: true }),
}) as never
const delReq = () => new Request('http://localhost/api/sessions/restore?sessionId=s1', { method: 'DELETE' }) as never

// HOME is jailed: the real sessions-service and the whole headless router are imported here.
let home: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'aim-restore-owner-'))
  vi.stubEnv('HOME', home)
  mockAuthenticate.mockReset(); restore.mockClear(); del.mockClear()
})
afterEach(() => { vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }) })

describe('sessions/restore mutations are system-owner only', () => {
  it('an authenticated AGENT cannot restore, and the service is never reached', async () => {
    mockAuthenticate.mockReturnValue({ agentId: 'agent-1' })
    const { POST } = await import('@/app/api/sessions/restore/route')
    const res = await POST(post())
    expect(res.status).toBe(403)
    expect(restore).not.toHaveBeenCalled()
  })

  it('an authenticated AGENT cannot delete a persisted session', async () => {
    mockAuthenticate.mockReturnValue({ agentId: 'agent-1' })
    const { DELETE } = await import('@/app/api/sessions/restore/route')
    const res = await DELETE(delReq())
    expect(res.status).toBe(403)
    expect(del).not.toHaveBeenCalled()
  })

  it('POSITIVE CONTROL: the system owner can do both', async () => {
    mockAuthenticate.mockReturnValue({})
    const { POST, DELETE } = await import('@/app/api/sessions/restore/route')
    expect((await POST(post())).status).toBe(200)
    expect((await DELETE(delReq())).status).toBe(200)
    expect(restore).toHaveBeenCalledTimes(1)
    expect(del).toHaveBeenCalledWith('s1')
  })
})

// The headless router REIMPLEMENTS these two handlers; a guard only in the route leaves
// MAESTRO_MODE=headless open.
async function headless(method: string, url: string, body?: unknown) {
  const { createHeadlessRouter } = await import('@/services/headless-router')
  const req: any = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
  req.method = method
  req.url = url
  req.headers = { 'content-type': 'application/json', authorization: 'Bearer aim_tk_AAAAAAAAAAAAAAAAAAAAAAAA' }
  const res: any = new EventEmitter()
  res.headersSent = false
  res.setHeader = () => {}
  res.writeHead = (s: number) => { res.statusCode = s; res.headersSent = true; return res }
  res.write = () => true
  res.end = () => {}
  await createHeadlessRouter().handle(req, res)
  return res.statusCode as number
}

describe('sessions/restore mutations are system-owner only (headless router)', () => {
  it('an authenticated AGENT is refused on POST, and the restore service never runs', async () => {
    mockAuthenticate.mockReturnValue({ agentId: 'agent-1' })
    expect(await headless('POST', '/api/sessions/restore', { all: true })).toBe(403)
    expect(restore).not.toHaveBeenCalled()
  })

  it('an authenticated AGENT is refused on DELETE, and the delete service never runs', async () => {
    mockAuthenticate.mockReturnValue({ agentId: 'agent-1' })
    expect(await headless('DELETE', '/api/sessions/restore?sessionId=s1')).toBe(403)
    expect(del).not.toHaveBeenCalled()
  })

  it('POSITIVE CONTROL: the system owner reaches both services', async () => {
    mockAuthenticate.mockReturnValue({})
    expect(await headless('POST', '/api/sessions/restore', { all: true })).toBe(200)
    expect(await headless('DELETE', '/api/sessions/restore?sessionId=s1')).toBe(200)
    expect(restore).toHaveBeenCalledTimes(1)
    expect(del).toHaveBeenCalledWith('s1')
  })
})
