import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'http'

/**
 * TRDD-BZW1QAZ5 — "clear metadata" keeps the SYSTEM-OWNED keys, identically in both server modes.
 * sessionSecretHash (lib/session-env.ts, session bootstrap) and the `amp` block (lib/agent-registry.ts + services/amp-service.ts
 * registration) are written by the server, never by the user; a user-facing "clear" used to wipe them too.
 *
 * Full mode = the REAL ChangeMetadata(..., { mode: 'clear' }). API-only mode = the DELETE handler driven through the REAL
 * createHeadlessRouter().handle(), which must reach that same function. Only the registry is replaced: a stateful fake that
 * reproduces lib/agent-registry.ts updateAgent's metadata semantics (MF-001: an EMPTY metadata object replaces entirely,
 * otherwise a spread-merge in which an undefined value drops the key; the JSON round trip mirrors saveAgents).
 */
const m = vi.hoisted(() => ({
  agent: { v: null as null | Record<string, any> },
  authenticateAgent: vi.fn() as import('vitest').Mock<(...a: any[]) => any>,
}))

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
// ChangeMetadata emits a ledger op after the write; double it so no test writes the developer's real ledger
vi.mock('@/lib/ledger-emit', () => ({ emitAgentOp: vi.fn() }))
vi.mock('../../lib/governance', async (orig) => {
  const actual = await orig<typeof import('../../lib/governance')>()
  return { ...actual, getManagerId: () => MANAGER_ID }
})
vi.mock('../../lib/agent-registry', async (orig) => {
  const actual = await orig<typeof import('../../lib/agent-registry')>()
  return {
    ...actual,
    getAgent: (...a: unknown[]) => m.agent.v ?? (actual.getAgent as (...x: unknown[]) => unknown)(...a),
    updateAgent: async (_id: string, updates: { metadata?: Record<string, unknown> }) => {
      if (!m.agent.v) return null
      const md = updates.metadata
      const merged = md && Object.keys(md).length === 0 ? {} : { ...m.agent.v.metadata, ...md }
      m.agent.v = JSON.parse(JSON.stringify({ ...m.agent.v, metadata: merged }))
      return m.agent.v
    },
  }
})

const MANAGER_ID = '11111111-1111-4111-8111-111111111111'
const MEMBER_ID = '22222222-2222-4222-8222-222222222222'
const TARGET = '33333333-3333-4333-8333-333333333333'
const HASH = 'fake-hash-structural-fixture'
const SYS_AUTH = { isSystemOwner: true } as const

function seed(metadata: Record<string, unknown>) {
  m.agent.v = { id: TARGET, name: 'target', workingDirectory: '/tmp/x', metadata: JSON.parse(JSON.stringify(metadata)) }
}

function drive(method: string, url: string, body?: unknown) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const req = {
    url, method,
    headers: { authorization: 'Bearer aim_tk_AAAAAAAAAAAAAAAAAAAAAAAA', 'content-type': 'application/json' },
    [Symbol.asyncIterator]: async function* () { for (const c of chunks) yield c },
    on(event: string, cb: (...a: unknown[]) => void) {
      if (event === 'data') chunks.forEach((c) => cb(c))
      if (event === 'end') cb()
      return this
    },
  } as unknown as IncomingMessage
  const out: { status?: number; body?: string | Buffer } = {}
  const res = {
    writeHead(s: number) { out.status = s; return this }, setHeader() { return this },
    end(p?: string | Buffer) { out.body = p }, headersSent: false,
  } as unknown as ServerResponse
  return { req, res, out }
}
async function headless(method: string, id = TARGET, body?: unknown) {
  const { createHeadlessRouter } = await import('../../services/headless-router')
  const d = drive(method, `/api/agents/${id}/metadata`, body)
  await createHeadlessRouter().handle(d.req, d.res)
  return d.out.status
}
const headlessClear = () => headless('DELETE')
/** full mode: the real Next route handler, called directly with a NextRequest */
async function fullRoute(method: 'DELETE' | 'PATCH', id = TARGET, body?: unknown) {
  const { NextRequest } = await import('next/server')
  const route = await import('../../app/api/agents/[id]/metadata/route')
  const req = new NextRequest(`http://localhost/api/agents/${id}/metadata`, {
    method,
    headers: { authorization: 'Bearer aim_tk_AAAAAAAAAAAAAAAAAAAAAAAA', 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const res = await route[method](req, { params: Promise.resolve({ id }) })
  return res.status
}

beforeEach(() => {
  m.agent.v = null
  m.authenticateAgent.mockReset()
  m.authenticateAgent.mockReturnValue({}) // the system owner
})

const WITH_SYSTEM = { note: 'x', sessionSecretHash: HASH, amp: { fingerprint: 'fp' } }

describe('TRDD-BZW1QAZ5 — metadata clear keeps system-owned keys (full mode: ChangeMetadata, clear)', () => {
  it('clear removes the user key and keeps sessionSecretHash and amp.fingerprint', async () => {
    seed(WITH_SYSTEM)
    const { ChangeMetadata } = await import('@/services/element-management-service')
    const r = await ChangeMetadata(TARGET, {}, SYS_AUTH, { mode: 'clear' })
    expect(r.success).toBe(true)
    expect(m.agent.v!.metadata).toEqual({ sessionSecretHash: HASH, amp: { fingerprint: 'fp' } })
  })
  it('clear on an agent with only user keys leaves none', async () => {
    seed({ note: 'x', other: 1 })
    const { ChangeMetadata } = await import('@/services/element-management-service')
    const r = await ChangeMetadata(TARGET, {}, SYS_AUTH, { mode: 'clear' })
    expect(r.success).toBe(true)
    expect(m.agent.v!.metadata).toEqual({})
  })
  it('clear on an agent whose ONLY keys are system-owned keeps them (an empty payload would be read as replace-all)', async () => {
    seed({ sessionSecretHash: HASH, amp: { fingerprint: 'fp' } })
    const { ChangeMetadata } = await import('@/services/element-management-service')
    const r = await ChangeMetadata(TARGET, {}, SYS_AUTH, { mode: 'clear' })
    expect(r.success).toBe(true)
    expect(m.agent.v!.metadata).toEqual({ sessionSecretHash: HASH, amp: { fingerprint: 'fp' } })
  })
  it('an EXPLICIT merge-mode update { sessionSecretHash: null } still nulls it', async () => {
    seed(WITH_SYSTEM)
    const { ChangeMetadata } = await import('@/services/element-management-service')
    const r = await ChangeMetadata(TARGET, { sessionSecretHash: null }, SYS_AUTH, { mode: 'merge' })
    expect(r.success).toBe(true)
    expect(m.agent.v!.metadata.sessionSecretHash).toBeNull()
    expect(m.agent.v!.metadata.note).toBe('x')
  })
})

describe('TRDD-BZW1QAZ5 — metadata clear keeps system-owned keys (API-only mode: DELETE through the real router)', () => {
  it('DELETE removes the user key and keeps sessionSecretHash and amp.fingerprint', async () => {
    seed(WITH_SYSTEM)
    expect(await headlessClear()).toBe(200)
    expect(m.agent.v!.metadata).toEqual({ sessionSecretHash: HASH, amp: { fingerprint: 'fp' } })
  })
  it('DELETE on an agent with only user keys leaves none', async () => {
    seed({ note: 'x', other: 1 })
    expect(await headlessClear()).toBe(200)
    expect(m.agent.v!.metadata).toEqual({})
  })
})

describe('TRDD-BZW1QAZ5 — merge mode still nulls an EXPLICITLY named system key, in BOTH modes (hibernate and bootstrap rely on it)', () => {
  it('API-only PATCH { sessionSecretHash: null } nulls it and keeps the rest', async () => {
    seed(WITH_SYSTEM)
    expect(await headless('PATCH', TARGET, { sessionSecretHash: null })).toBe(200)
    expect(m.agent.v!.metadata.sessionSecretHash).toBeNull()
    expect(m.agent.v!.metadata.amp).toEqual({ fingerprint: 'fp' })
  })
  it('full-mode PATCH { sessionSecretHash: null } nulls it and keeps the rest', async () => {
    seed(WITH_SYSTEM)
    expect(await fullRoute('PATCH', TARGET, { sessionSecretHash: null })).toBe(200)
    expect(m.agent.v!.metadata.sessionSecretHash).toBeNull()
    expect(m.agent.v!.metadata.amp).toEqual({ fingerprint: 'fp' })
  })
})

describe('TRDD-BZW1QAZ5 — PARITY: the same caller gets the same status from the full-mode route and the API-only DELETE', () => {
  // authorize() decides identically on both sides (the handler keeps its modify-agent lines; ChangeMetadata gate 0 repeats them with
  // the same context fields, so it never refuses what the handler admitted); the handler maps success:false like the route.
  const CLASSES: Array<[string, Record<string, unknown>, number]> = [
    ['system owner', {}, 200],
    ['an agent clearing ITS OWN metadata', { agentId: TARGET, governanceTitle: 'member' }, 400],
    ['a MANAGER clearing another agent', { agentId: MANAGER_ID, governanceTitle: 'manager' }, 200],
    ['an ordinary agent clearing another agent', { agentId: MEMBER_ID, governanceTitle: 'member' }, 400],
  ]
  for (const [name, auth, status] of CLASSES) {
    it(`${name}: both modes answer ${status}, and a refusal clears nothing`, async () => {
      seed(WITH_SYSTEM)
      m.authenticateAgent.mockReturnValue(auth)
      const full = await fullRoute('DELETE')
      const afterFull = JSON.stringify(m.agent.v!.metadata)
      seed(WITH_SYSTEM)
      const headlessStatus = await headlessClear()
      expect(full).toBe(status)
      expect(headlessStatus).toBe(full)
      if (status === 200) expect(afterFull).toBe(JSON.stringify({ sessionSecretHash: HASH, amp: { fingerprint: 'fp' } }))
      else expect(afterFull).toBe(JSON.stringify(WITH_SYSTEM))
    })
  }
  it('an agent id that does not exist: the same 404 in both modes', async () => {
    m.agent.v = null
    const missing = '44444444-4444-4444-8444-444444444444'
    expect(await fullRoute('DELETE', missing)).toBe(404)
    expect(await headless('DELETE', missing)).toBe(404)
  })
})
