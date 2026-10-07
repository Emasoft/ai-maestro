import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { EventEmitter } from 'events'
import { Readable } from 'stream'

/**
 * Headless /api/help/agent ran its own copies of the handlers with no authentication, and its
 * DELETE handed DeleteAgent a hard-coded system-owner context. It now forwards to the Next route,
 * so a request the route refuses is refused in headless too, and the delete pipeline receives the
 * caller's identity, never an invented owner.
 */

let dir: string
const deleteAgent = vi.fn(async (..._a: unknown[]) => ({ success: true }))

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aim-helpagent-'))
  vi.stubEnv('HOME', dir)
  vi.resetModules()
  deleteAgent.mockClear()
  vi.doMock('@/services/element-management-service', async (orig) => ({ ...(await orig<object>()), DeleteAgent: deleteAgent }))
  vi.doMock('@/lib/agent-registry', async (orig) => ({ ...(await orig<object>()), getAgentByName: () => ({ id: 'assistant-id', name: '_aim-assistant' }) }))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.doUnmock('@/services/element-management-service')
  vi.doUnmock('@/lib/agent-registry')
  vi.doUnmock('@/lib/agent-auth')
  rmSync(dir, { recursive: true, force: true })
})

async function call(method: string, headers: Record<string, string> = {}) {
  const { createHeadlessRouter } = await import('@/services/headless-router')
  const req: any = Readable.from([])
  req.method = method
  req.url = '/api/help/agent'
  req.headers = headers
  const res: any = new EventEmitter()
  res.headersSent = false
  res.setHeader = () => {}
  res.writeHead = (s: number) => { res.statusCode = s; res.headersSent = true; return res }
  res.write = () => true
  res.end = () => {}
  await createHeadlessRouter().handle(req, res)
  return res.statusCode as number
}

const BEARER = { authorization: 'Bearer aim_tk_AAAAAAAAAAAAAAAAAAAAAAAA' }
function authAs(result: Record<string, unknown>) {
  vi.doMock('@/lib/agent-auth', async (orig) => ({
    ...(await orig<object>()),
    authenticateFromRequest: () => result,
    authenticateFromRequestAsync: async () => result,
  }))
}

// A request with NO credential was already refused by the headless router's own credential gate,
// so it cannot tell the old handlers from the new. The gap was a VALID credential of any agent.
describe('headless /api/help/agent hands the delete pipeline the real caller', () => {
  it('DELETE by an authenticated agent passes that agent, never an invented system owner', async () => {
    authAs({ agentId: 'agent-7' })
    expect(await call('DELETE', { ...BEARER, 'x-agent-id': 'agent-7' })).toBe(200)
    expect(deleteAgent).toHaveBeenCalledTimes(1)
    const ctx = (deleteAgent.mock.calls[0][1] as { authContext: { isSystemOwner?: boolean; agentId?: string } }).authContext
    expect(ctx.isSystemOwner).not.toBe(true)
    expect(ctx.agentId).toBe('agent-7')
  })

  it('DELETE by the system owner still passes an owner context', async () => {
    authAs({})
    expect(await call('DELETE', BEARER)).toBe(200)
    const ctx = (deleteAgent.mock.calls[0][1] as { authContext: { isSystemOwner?: boolean } }).authContext
    expect(ctx.isSystemOwner).toBe(true)
  })

  it('a credential the route rejects never reaches the delete pipeline', async () => {
    vi.doMock('@/lib/agent-auth', async (orig) => ({
      ...(await orig<object>()),
      authenticateFromRequest: () => ({ error: 'revoked', status: 401 }),
      authenticateFromRequestAsync: async () => ({}), // the router's own gate lets it through
    }))
    expect(await call('DELETE', BEARER)).toBe(401)
    expect(deleteAgent).not.toHaveBeenCalled()
  })
})
