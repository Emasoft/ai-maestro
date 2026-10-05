import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'http'

/**
 * TRDD-A50RC5G8 — headless DELETE /api/agents/:id with a HARD request is served by the SAME Next.js handler as full
 * mode (delegateNextRoute), so the sudo layer and the owner-only rule apply. Requests go through the real
 * createHeadlessRouter().handle(); only the identity seam and the sudo token store are replaced, and DeleteAgent is
 * wrapped at its module boundary solely to observe whether (and how) it was called.
 */
const m = vi.hoisted(() => ({
  authenticateAgent: vi.fn() as import('vitest').Mock<(...a: any[]) => any>,
  deleteAgent: vi.fn() as import('vitest').Mock<(...a: any[]) => any>,
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
vi.mock('../../services/element-management-service', async (orig) => {
  const actual = await orig<typeof import('../../services/element-management-service')>()
  return { ...actual, DeleteAgent: (...a: unknown[]) => m.deleteAgent(...a) }
})

const ID = '33333333-3333-4333-8333-333333333333'
const OWNER = {}
const MANAGER = { agentId: '11111111-1111-4111-8111-111111111111', governanceTitle: 'manager' }

async function del(query: string, headers: Record<string, string> = {}) {
  const req = {
    url: `/api/agents/${ID}${query}`, method: 'DELETE',
    headers: { authorization: 'Bearer aim_tk_AAAAAAAAAAAAAAAAAAAAAAAA', ...headers },
    [Symbol.asyncIterator]: async function* () { /* no body */ },
    on(event: string, cb: (...a: unknown[]) => void) { if (event === 'end') cb(); return this },
  } as unknown as IncomingMessage
  const out: { status?: number; body?: string | Buffer } = {}
  const res = {
    writeHead(s: number) { out.status = s; return this }, setHeader() { return this },
    end(p?: string | Buffer) { out.body = p }, headersSent: false,
  } as unknown as ServerResponse
  const { createHeadlessRouter } = await import('../../services/headless-router')
  await createHeadlessRouter().handle(req, res)
  return { status: out.status, json: JSON.parse(out.body ? out.body.toString() : 'null') }
}

beforeEach(() => {
  m.authenticateAgent.mockReset()
  m.deleteAgent.mockReset()
  m.deleteAgent.mockImplementation(async (_id: string, o: { hard?: boolean }) => ({ success: true, hard: !!o.hard }))
})

describe('TRDD-A50RC5G8 — headless hard delete needs the sudo confirmation', () => {
  it('owner HARD delete WITHOUT a sudo token is refused 403 sudo_required (missing) and DeleteAgent is not called', async () => {
    /** The gate the in-table headless handler lacked */
    m.authenticateAgent.mockReturnValue(OWNER)
    const out = await del('?hard=true')
    expect(out.status).toBe(403)
    expect(out.json).toMatchObject({ error: 'sudo_required', reason: 'missing', route: 'DELETE /api/agents/[id]' })
    expect(m.deleteAgent).not.toHaveBeenCalled()
  })
  it('POSITIVE CONTROL — owner HARD delete WITH an accepted token calls DeleteAgent once with hard=true', async () => {
    /** The refusals are decisions, not a dead route */
    m.authenticateAgent.mockReturnValue(OWNER)
    const out = await del('?hard=true', { 'x-sudo-token': 'good-token' })
    expect(out.status).toBe(200)
    expect(out.json).toEqual({ success: true, hard: true })
    expect(m.deleteAgent).toHaveBeenCalledTimes(1)
    expect(m.deleteAgent.mock.calls[0][0]).toBe(ID)
    expect(m.deleteAgent.mock.calls[0][1]).toMatchObject({ hard: true })
  })
  it('owner asking hard in the twin spelling hard=YES without a token is refused 403 sudo_required', async () => {
    /** Hard is read as the twin reads it, not as the old strict === 'true' */
    m.authenticateAgent.mockReturnValue(OWNER)
    const out = await del('?hard=YES')
    expect(out.status).toBe(403)
    expect(out.json.error).toBe('sudo_required')
    expect(m.deleteAgent).not.toHaveBeenCalled()
  })
  it('a MANAGER agent asking HARD is refused 403 "reserved to the user" by the real DeleteAgent, no hard delete happens', async () => {
    /** Full mode has no agent hard path: the refusal lives inside DeleteAgent, so it is observed passing through */
    m.authenticateAgent.mockReturnValue(MANAGER)
    const actual = await vi.importActual<typeof import('../../services/element-management-service')>('../../services/element-management-service')
    m.deleteAgent.mockImplementation((...a: unknown[]) => (actual.DeleteAgent as (...x: unknown[]) => unknown)(...a))
    const out = await del('?hard=true')
    expect(out.status).toBe(403)
    expect(String(out.json.error)).toContain('reserved to the user')
    expect(m.deleteAgent).toHaveBeenCalledTimes(1)
    expect(m.deleteAgent.mock.calls[0][1]).toMatchObject({ hard: true, authContext: { isSystemOwner: false } })
  })
})

describe('TRDD-A50RC5G8 — headless soft delete is unchanged', () => {
  it('owner SOFT delete without a token still works: DeleteAgent called once with hard=false', async () => {
    /** Soft keeps the in-table behaviour */
    m.authenticateAgent.mockReturnValue(OWNER)
    const out = await del('')
    expect(out.status).toBe(200)
    expect(out.json).toEqual({ success: true, hard: false })
    expect(m.deleteAgent).toHaveBeenCalledTimes(1)
    expect(m.deleteAgent.mock.calls[0][1]).toMatchObject({ hard: false })
  })
  it('a MANAGER agent SOFT delete still works: DeleteAgent called once with hard=false', async () => {
    /** Managers may soft-kill */
    m.authenticateAgent.mockReturnValue(MANAGER)
    const out = await del('?hard=false')
    expect(out.status).toBe(200)
    expect(m.deleteAgent).toHaveBeenCalledTimes(1)
    expect(m.deleteAgent.mock.calls[0][1]).toMatchObject({ hard: false })
  })
})

describe('TRDD-A50RC5G8 — a HARD request is never silently downgraded to soft', () => {
  it.each(['true', '1', 'yes', 'TRUE'])('owner hard=%s without a token: DeleteAgent is never called (in particular never with hard=false)', async (v) => {
    /** The hard flag lives in the query string in both router and twin; delegating reads no body, so the twin sees it */
    m.authenticateAgent.mockReturnValue(OWNER)
    const out = await del(`?hard=${v}`)
    expect(out.status).toBe(403)
    expect(out.json.error).toBe('sudo_required')
    expect(m.deleteAgent.mock.calls.filter((c) => !c[1].hard)).toEqual([])
    expect(m.deleteAgent).not.toHaveBeenCalled()
  })
  it.each(['true', '1', 'yes'])('MANAGER hard=%s is refused 403 "reserved to the user"; no DeleteAgent call carries hard=false', async (v) => {
    /** Before this change hard=1/yes reached the service as hard:false (silent soft); now the request is refused */
    m.authenticateAgent.mockReturnValue(MANAGER)
    const actual = await vi.importActual<typeof import('../../services/element-management-service')>('../../services/element-management-service')
    m.deleteAgent.mockImplementation((...a: unknown[]) => (actual.DeleteAgent as (...x: unknown[]) => unknown)(...a))
    const out = await del(`?hard=${v}`)
    expect(out.status).toBe(403)
    expect(String(out.json.error)).toContain('reserved to the user')
    expect(m.deleteAgent.mock.calls.filter((c) => !c[1].hard)).toEqual([])
  })
})
