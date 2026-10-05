import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Readable } from 'stream'
import type { IncomingMessage, ServerResponse } from 'http'

/**
 * TRDD-BZW1QAZ5 — headless POST /api/agents/:id/transfer and headless PATCH /api/agents/:id carrying an execution-affecting
 * field (program, programArgs, workingDirectory) are served by the SAME Next.js handlers full mode runs, so the sudo layer
 * applies. Requests go through the real createHeadlessRouter().handle() as a REAL Readable (a stream can be consumed once, so
 * the body hand-over after readJsonBody is exercised for real). Only the identity seam and the sudo token store are replaced;
 * the two services are wrapped at their module boundary solely to observe whether they were called.
 */
const m = vi.hoisted(() => ({
  authenticateAgent: vi.fn() as import('vitest').Mock<(...a: any[]) => any>,
  transferAgent: vi.fn() as import('vitest').Mock<(...a: any[]) => any>,
  updateAgentById: vi.fn() as import('vitest').Mock<(...a: any[]) => any>,
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
vi.mock('../../services/agents-transfer-service', async (orig) => {
  const actual = await orig<typeof import('../../services/agents-transfer-service')>()
  return { ...actual, transferAgent: (...a: unknown[]) => m.transferAgent(...a) }
})
vi.mock('../../services/agents-core-service', async (orig) => {
  const actual = await orig<typeof import('../../services/agents-core-service')>()
  return { ...actual, updateAgentById: (...a: unknown[]) => m.updateAgentById(...a) }
})

const ID = '33333333-3333-4333-8333-333333333333'
const OWNER = {}
const MANAGER = { agentId: '11111111-1111-4111-8111-111111111111', governanceTitle: 'manager' }
const ORDINARY = { agentId: '22222222-2222-4222-8222-222222222222' }

async function call(method: string, path: string, rawBody: string | null, headers: Record<string, string> = {}) {
  const req = Object.assign(Readable.from(rawBody === null ? [] : [Buffer.from(rawBody)]), {
    url: path, method,
    headers: { authorization: 'Bearer aim_tk_AAAAAAAAAAAAAAAAAAAAAAAA', ...headers },
  }) as unknown as IncomingMessage
  const out: { status?: number; body?: string | Buffer } = {}
  const res = {
    writeHead(s: number) { out.status = s; return this }, setHeader() { return this },
    end(p?: string | Buffer) { out.body = p }, headersSent: false,
  } as unknown as ServerResponse
  const { createHeadlessRouter } = await import('../../services/headless-router')
  await createHeadlessRouter().handle(req, res)
  return { status: out.status, json: JSON.parse(out.body ? out.body.toString() : 'null') }
}
const transfer = (body: unknown, headers: Record<string, string> = {}, id = ID) =>
  call('POST', `/api/agents/${id}/transfer`, typeof body === 'string' ? body : JSON.stringify(body), headers)
const patch = (body: unknown, headers: Record<string, string> = {}) =>
  call('PATCH', `/api/agents/${ID}`, body === null ? null : JSON.stringify(body), headers)

const SUDO = { 'x-sudo-token': 'good-token' }
const XFER = { targetHostId: 'h2', targetHostUrl: 'http://example.invalid:23000', mode: 'move' }

beforeEach(() => {
  m.authenticateAgent.mockReset()
  m.transferAgent.mockReset()
  m.updateAgentById.mockReset()
  m.transferAgent.mockResolvedValue({ data: { transferred: true }, status: 200 })
  m.updateAgentById.mockResolvedValue({ data: { agent: { id: ID } }, status: 200 })
})

describe('TRDD-BZW1QAZ5 — headless transfer needs the sudo confirmation', () => {
  it('system owner WITHOUT a sudo token is refused 403 sudo_required and transferAgent is not called', async () => {
    /** The gate the in-table handler lacked */
    m.authenticateAgent.mockReturnValue(OWNER)
    const out = await transfer(XFER)
    expect(out.status).toBe(403)
    expect(out.json).toMatchObject({ error: 'sudo_required', route: 'POST /api/agents/[id]/transfer' })
    expect(m.transferAgent).not.toHaveBeenCalled()
  })
  it('a MANAGER agent without a token reaches the service ONCE: agents face no sudo gate (R32), the twin authorizes them by title', async () => {
    /** Parity with full mode, disclosed: the gate the owner path gets is not an agent gate */
    m.authenticateAgent.mockReturnValue(MANAGER)
    const out = await transfer(XFER)
    expect(out.status).toBe(200)
    expect(m.transferAgent).toHaveBeenCalledTimes(1)
  })
  it('an ordinary agent without a token is refused 403 aid_title_forbidden by the twin and transferAgent is not called', async () => {
    /** The twin title check now applies in headless */
    m.authenticateAgent.mockReturnValue(ORDINARY)
    const out = await transfer(XFER)
    expect(out.status).toBe(403)
    expect(out.json.error).toBe('aid_title_forbidden')
    expect(m.transferAgent).not.toHaveBeenCalled()
  })
  it.each(['move', 'clone', undefined])('the old in-table handler cannot be reached: valid credentials, no token, mode=%s -> transferAgent never called', async (mode) => {
    /** Whatever the body says, the service is behind the gate */
    m.authenticateAgent.mockReturnValue(OWNER)
    const out = await transfer({ ...XFER, mode })
    expect(out.status).toBe(403)
    expect(m.transferAgent).not.toHaveBeenCalled()
  })
  it('POSITIVE CONTROL — system owner WITH an accepted token reaches the service once with the id and the whole body', async () => {
    /** The feature is gated, not removed */
    m.authenticateAgent.mockReturnValue(OWNER)
    const out = await transfer(XFER, SUDO)
    expect(out.status).toBe(200)
    expect(out.json).toEqual({ transferred: true })
    expect(m.transferAgent).toHaveBeenCalledTimes(1)
    expect(m.transferAgent.mock.calls[0][0]).toBe(ID)
    expect(m.transferAgent.mock.calls[0][1]).toEqual(XFER)
  })
  it('with a token, a non-UUID agent id is refused 400 by the twin and transferAgent is not called', async () => {
    /** The twin UUID check now applies in headless */
    m.authenticateAgent.mockReturnValue(OWNER)
    const out = await transfer(XFER, SUDO, 'not-a-uuid')
    expect(out.status).toBe(400)
    expect(m.transferAgent).not.toHaveBeenCalled()
  })
  it('with a token, an unparseable JSON body is refused 400 by the twin and transferAgent is not called', async () => {
    /** The twin JSON guard now applies in headless */
    m.authenticateAgent.mockReturnValue(OWNER)
    const out = await transfer('{not json', SUDO)
    expect(out.status).toBe(400)
    expect(m.transferAgent).not.toHaveBeenCalled()
  })
})

describe('TRDD-BZW1QAZ5 — headless agent update with an execution-affecting field needs the sudo confirmation', () => {
  it.each([
    ['program', { program: 'codex' }],
    ['programArgs', { programArgs: '--flag' }],
    ['workingDirectory', { workingDirectory: '/tmp/x' }],
    ['program set to null (key present; the service reads it)', { program: null }],
  ])('owner, body with %s, no token: refused 403 sudo_required and updateAgentById is not called', async (_n, body) => {
    /** Each execution field is gated */
    m.authenticateAgent.mockReturnValue(OWNER)
    const out = await patch(body)
    expect(out.status).toBe(403)
    expect(out.json).toMatchObject({ error: 'sudo_required', route: 'PATCH /api/agents/[id]' })
    expect(m.updateAgentById).not.toHaveBeenCalled()
  })
  it('a MANAGER agent with program and no token reaches updateAgentById ONCE: agents face no sudo gate (R32), the twin handles them', async () => {
    /** Parity with full mode, disclosed: the delegation changes nothing for agent callers */
    m.authenticateAgent.mockReturnValue(MANAGER)
    const out = await patch({ program: 'codex' })
    expect(out.status).toBe(200)
    expect(m.updateAgentById).toHaveBeenCalledTimes(1)
  })
  it('an ordinary agent with workingDirectory and no token is refused 403 and updateAgentById is not called', async () => {
    /** Same for an untitled agent */
    m.authenticateAgent.mockReturnValue(ORDINARY)
    const out = await patch({ workingDirectory: '/tmp/x' })
    expect(out.status).toBe(403)
    expect(m.updateAgentById).not.toHaveBeenCalled()
  })
  it('a mixed body (name + programArgs) without a token is refused as a whole: no plain field is applied', async () => {
    /** Never apply the plain fields and refuse the rest */
    m.authenticateAgent.mockReturnValue(OWNER)
    const out = await patch({ name: 'renamed', programArgs: '--flag' })
    expect(out.status).toBe(403)
    expect(m.updateAgentById).not.toHaveBeenCalled()
  })
  it('POSITIVE CONTROL — owner with an accepted token and program reaches updateAgentById once and succeeds', async () => {
    /** The feature is gated, not removed */
    m.authenticateAgent.mockReturnValue(OWNER)
    const out = await patch({ program: 'codex' }, SUDO)
    expect(out.status).toBe(200)
    expect(m.updateAgentById).toHaveBeenCalledTimes(1)
    expect(m.updateAgentById.mock.calls[0][0]).toBe(ID)
    expect(m.updateAgentById.mock.calls[0][1]).toEqual({ program: 'codex' })
  })
  it('POSITIVE CONTROL — a mixed body with an accepted token reaches updateAgentById ONCE with BOTH fields', async () => {
    /** The body is delegated as a whole, intact after readJsonBody consumed the stream */
    m.authenticateAgent.mockReturnValue(OWNER)
    const out = await patch({ name: 'renamed', programArgs: '--flag' }, SUDO)
    expect(out.status).toBe(200)
    expect(m.updateAgentById).toHaveBeenCalledTimes(1)
    expect(m.updateAgentById.mock.calls[0][1]).toEqual({ name: 'renamed', programArgs: '--flag' })
  })
})

describe('TRDD-BZW1QAZ5 — headless agent update without an execution-affecting field is handled as before', () => {
  it.each([
    ['name', { name: 'renamed' }],
    ['title', { title: 'x' }],
    ['label', { label: 'x' }],
  ])('owner, body with only %s, no token: NOT delegated, updateAgentById called once', async (_n, body) => {
    /** Plain bodies keep the in-table path (no sudo layer here) */
    m.authenticateAgent.mockReturnValue(OWNER)
    const out = await patch(body)
    expect(out.status).toBe(200)
    expect(m.updateAgentById).toHaveBeenCalledTimes(1)
    expect(m.updateAgentById.mock.calls[0][1]).toEqual(body)
  })
  it('an empty body is not delegated: updateAgentById called once', async () => {
    /** No keys, no execution field */
    m.authenticateAgent.mockReturnValue(OWNER)
    const out = await patch(null)
    expect(out.status).toBe(200)
    expect(m.updateAgentById).toHaveBeenCalledTimes(1)
  })
  it.each([
    ['Program', { Program: 'codex' }],
    ['PROGRAMARGS', { PROGRAMARGS: '--x' }],
    ['workingdirectory', { workingdirectory: '/tmp/x' }],
  ])('another casing (%s) is not delegated: the service reads only the exact key, so it does not act on it', async (_n, body) => {
    /** Detector and service agree: exact-key reads (body.program etc.) never see another casing */
    m.authenticateAgent.mockReturnValue(OWNER)
    const out = await patch(body)
    expect(out.status).toBe(200)
    expect(m.updateAgentById).toHaveBeenCalledTimes(1)
  })
  it.each([
    ['agent wrapper', { agent: { program: 'codex' } }],
    ['updates wrapper', { updates: { workingDirectory: '/tmp/x' } }],
  ])('a field inside a %s is not delegated: the service unwraps nothing, so it does not act on it', async (_n, body) => {
    /** The service reads body.<field> at the top level only */
    m.authenticateAgent.mockReturnValue(OWNER)
    const out = await patch(body)
    expect(out.status).toBe(200)
    expect(m.updateAgentById).toHaveBeenCalledTimes(1)
  })
})
