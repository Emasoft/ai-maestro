import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Owner ruling: agents may only soft-delete. Transfer in move mode hard-removes the local agent (no cemetery copy), so the
 * full-mode route refuses move for any agent caller. The route's POST is called directly; lib/sudo-guard.ts is REAL. Only the
 * identity seam, the sudo token store and the transfer service (observed, not executed) are replaced.
 */
const m = vi.hoisted(() => ({
  authenticateAgent: vi.fn() as import('vitest').Mock<(...a: any[]) => any>,
  transferAgent: vi.fn() as import('vitest').Mock<(...a: any[]) => any>,
}))

vi.mock('../../lib/sudo-auth', async (orig) => {
  const actual = await orig<typeof import('../../lib/sudo-auth')>()
  return { ...actual, verifyAndConsumeSudoToken: (t: string | null, ...r: never[]) => t === 'good-token' ? { ok: true } : (actual.verifyAndConsumeSudoToken as (...a: unknown[]) => unknown)(t, ...r) }
})
vi.mock('../../lib/agent-auth', async (orig) => {
  const actual = await orig<typeof import('../../lib/agent-auth')>()
  return {
    ...actual,
    authenticateAgent: (...a: unknown[]) => m.authenticateAgent(...a),
    authenticateFromRequest: (r: { headers: { get(n: string): string | null } }) =>
      m.authenticateAgent(r.headers.get('Authorization'), r.headers.get('X-Agent-Id'), r.headers.get('Cookie')),
    authenticateFromRequestAsync: vi.fn(async () => ({ agentId: undefined, error: undefined })),
  }
})
vi.mock('../../services/agents-transfer-service', () => ({ transferAgent: (...a: unknown[]) => m.transferAgent(...a) }))

const ID = '33333333-3333-4333-8333-333333333333'
const OWNER = {}
const MANAGER = { agentId: '11111111-1111-4111-8111-111111111111', governanceTitle: 'manager' }
const BASE = { targetHostId: 'h2', targetHostUrl: 'http://example.invalid:23000' }

async function post(body: unknown, headers: Record<string, string> = {}) {
  const { POST } = await import('../../app/api/agents/[id]/transfer/route')
  const req = new NextRequest(`http://localhost/api/agents/${ID}/transfer`, {
    method: 'POST', body: JSON.stringify(body),
    headers: { authorization: 'Bearer aim_tk_AAAAAAAAAAAAAAAAAAAAAAAA', 'content-type': 'application/json', ...headers },
  })
  const res = await POST(req, { params: Promise.resolve({ id: ID }) })
  return { status: res.status, json: await res.json() }
}

beforeEach(() => {
  m.authenticateAgent.mockReset()
  m.transferAgent.mockReset()
  m.transferAgent.mockResolvedValue({ data: { success: true }, status: 200 })
})

describe('transfer move mode is reserved to the system owner', () => {
  it('MANAGER agent + mode move is refused 403 move_reserved_to_owner and transferAgent is not called', async () => {
    /** The hard local removal is not an agent action */
    m.authenticateAgent.mockReturnValue(MANAGER)
    const out = await post({ ...BASE, mode: 'move' })
    expect(out.status).toBe(403)
    expect(out.json.error).toBe('move_reserved_to_owner')
    expect(m.transferAgent).not.toHaveBeenCalled()
  })
  it('MANAGER agent + mode clone reaches the service once', async () => {
    /** Copy mode keeps the local agent, so it stays open to agents */
    m.authenticateAgent.mockReturnValue(MANAGER)
    const out = await post({ ...BASE, mode: 'clone' })
    expect(out.status).toBe(200)
    expect(m.transferAgent).toHaveBeenCalledTimes(1)
  })
  it('MANAGER agent + mode absent reaches the service once: the service deletes only on mode === move, so absent is not move', async () => {
    /** Effective mode when absent is not move (services/agents-transfer-service.ts: `if (mode === 'move')`) */
    m.authenticateAgent.mockReturnValue(MANAGER)
    const out = await post(BASE)
    expect(out.status).toBe(200)
    expect(m.transferAgent).toHaveBeenCalledTimes(1)
  })
  it('an ORDINARY agent + mode move gets the guard refusal 403 aid_title_forbidden, not move_reserved_to_owner: the guard runs first', async () => {
    /** Pins the check order: sudo guard before the move refusal */
    m.authenticateAgent.mockReturnValue({ agentId: '22222222-2222-4222-8222-222222222222' })
    const out = await post({ ...BASE, mode: 'move' })
    expect(out.status).toBe(403)
    expect(out.json.error).toBe('aid_title_forbidden')
    expect(m.transferAgent).not.toHaveBeenCalled()
  })
  it('POSITIVE CONTROL — owner with an accepted sudo token + mode move reaches the service once', async () => {
    /** Move is reserved, not removed */
    m.authenticateAgent.mockReturnValue(OWNER)
    const out = await post({ ...BASE, mode: 'move' }, { 'x-sudo-token': 'good-token' })
    expect(out.status).toBe(200)
    expect(m.transferAgent).toHaveBeenCalledTimes(1)
    expect(m.transferAgent.mock.calls[0][1]).toEqual({ ...BASE, mode: 'move' })
  })
})

describe('transfer route rejects malformed bodies before the service', () => {
  const TOKEN = { 'x-sudo-token': 'good-token' }
  it('owner + token with body null is refused 400 and the service is not called', async () => {
    /** The service destructures the body and would throw (500) on null */
    m.authenticateAgent.mockReturnValue(OWNER)
    const out = await post(null, TOKEN)
    expect(out.status).toBe(400)
    expect(out.json.error).toBe('Request body must be a JSON object')
    expect(m.transferAgent).not.toHaveBeenCalled()
  })
  it('owner + token with an array body is refused 400 and the service is not called', async () => {
    /** An array is not a request object */
    m.authenticateAgent.mockReturnValue(OWNER)
    const out = await post([BASE], TOKEN)
    expect(out.status).toBe(400)
    expect(out.json.error).toBe('Request body must be a JSON object')
    expect(m.transferAgent).not.toHaveBeenCalled()
  })
  it('owner + token with mode teleport is refused 400 naming the allowed values and the service is not called', async () => {
    /** An unknown mode used to behave silently as a copy */
    m.authenticateAgent.mockReturnValue(OWNER)
    const out = await post({ ...BASE, mode: 'teleport' }, TOKEN)
    expect(out.status).toBe(400)
    expect(out.json.error).toContain('move')
    expect(out.json.error).toContain('clone')
    expect(m.transferAgent).not.toHaveBeenCalled()
  })
  it('MANAGER agent + mode teleport gets the 400 mode error: the mode check runs before the move refusal', async () => {
    /** Order: guard (passes for MANAGER), body checks, then move refusal */
    m.authenticateAgent.mockReturnValue(MANAGER)
    const out = await post({ ...BASE, mode: 'teleport' })
    expect(out.status).toBe(400)
    expect(out.json.error).toContain('clone')
    expect(m.transferAgent).not.toHaveBeenCalled()
  })
})
