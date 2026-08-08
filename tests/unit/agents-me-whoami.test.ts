/**
 * GET /api/agents/me — the agent WHOAMI behind the CLIs' `<self>` (TRDD-COOLOZ1N ruling 2).
 *
 * Pins the self-only-by-construction contract:
 *   (a) identity comes from auth.agentId ONLY — no request shape can name another agent;
 *   (b) a system-owner (no agentId) is refused 400, not given someone else's identity;
 *   (c) auth errors pass through with their own status;
 *   (d) a stale credential for a deleted agent is 404, never a fabricated identity.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockAuth, mockRegistry } = vi.hoisted(() => ({
  mockAuth: { authenticateFromRequest: vi.fn() },
  mockRegistry: { getAgent: vi.fn() },
}))

vi.mock('@/lib/agent-auth', () => mockAuth)
vi.mock('@/lib/agent-registry', () => mockRegistry)

import { GET } from '@/app/api/agents/me/route'
import { NextRequest } from 'next/server'

function req(query = ''): NextRequest {
  return new NextRequest(new URL(`http://localhost:23000/api/agents/me${query}`), { method: 'GET' })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.authenticateFromRequest.mockReturnValue({ agentId: 'A' })
  mockRegistry.getAgent.mockReturnValue({ id: 'A', name: 'alpha', label: 'Alpha' })
})

describe('GET /api/agents/me', () => {
  it('returns the CALLER identity, derived from auth.agentId only', async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'A', name: 'alpha' })
    expect(mockRegistry.getAgent).toHaveBeenCalledWith('A')
  })

  it('no request shape can name another agent — a query naming B still resolves the caller', async () => {
    // Self-only-by-construction: the route must not read any request parameter.
    const res = await GET(req('?agent=B&id=B&q=B'))
    expect(res.status).toBe(200)
    expect((await res.json()).id).toBe('A')
    expect(mockRegistry.getAgent).toHaveBeenCalledTimes(1)
    expect(mockRegistry.getAgent).toHaveBeenCalledWith('A')
  })

  it('refuses a system-owner caller with 400 no_self_agent', async () => {
    mockAuth.authenticateFromRequest.mockReturnValue({}) // session cookie: no agentId
    const res = await GET(req())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('no_self_agent')
  })

  it('passes an auth error through with its own status', async () => {
    mockAuth.authenticateFromRequest.mockReturnValue({ error: 'invalid_token', status: 401 })
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('invalid_token')
  })

  it('a stale credential for a deleted agent is 404, never a fabricated identity', async () => {
    mockRegistry.getAgent.mockReturnValue(undefined)
    const res = await GET(req())
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('agent_not_found')
  })
})
