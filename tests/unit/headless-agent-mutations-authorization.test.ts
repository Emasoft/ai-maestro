import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'http'

/**
 * TRDD-BZW1QAZ5 — two headless agent mutations, driven through the REAL createHeadlessRouter().handle():
 *   - PATCH /api/agents/:id/metadata mirrors its twin: authenticate (401), then ChangeMetadata with the caller's
 *     AuthContext (its gate 0 enforces 'modify-agent'), status mapping 404/403/400 as the twin. It used to call
 *     updateAgentById with no requester.
 *   - PATCH /api/agents/:id keeps its in-table handler but passes updateAgentById the SAME arguments as the twin
 *     (`auth.agentId || null, buildAuthContext(auth)`), so a signed-in non-owner user is no longer read as the system
 *     owner by the Change* pipelines. It deliberately does NOT require a sudo token (open question for the owner).
 * Replaced at their module boundary: the identity seam (authenticateAgent / authenticateFromRequest), and the services,
 * wrapped only to observe calls. ChangeMetadata and updateAgentById/ChangeName are the REAL ones where their own
 * authorization is the thing under test (the registry read is stubbed). The Bearer value is a fake structural fixture.
 */
const m = vi.hoisted(() => ({
  authenticateAgent: vi.fn() as import('vitest').Mock<(...a: any[]) => any>,
  changeMetadata: vi.fn() as import('vitest').Mock<(...a: any[]) => any>,
  updateAgentById: vi.fn() as import('vitest').Mock<(...a: any[]) => any>,
  registryAgent: { v: null as null | Record<string, unknown> },
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
vi.mock('../../lib/governance', async (orig) => {
  const actual = await orig<typeof import('../../lib/governance')>()
  return { ...actual, getManagerId: () => MANAGER }
})
vi.mock('../../services/element-management-service', async (orig) => {
  const actual = await orig<typeof import('../../services/element-management-service')>()
  return { ...actual, ChangeMetadata: (...a: unknown[]) => m.changeMetadata(...a) }
})
vi.mock('../../services/agents-core-service', async (orig) => {
  const actual = await orig<typeof import('../../services/agents-core-service')>()
  return { ...actual, updateAgentById: (...a: unknown[]) => m.updateAgentById(...a) }
})

vi.mock('../../lib/agent-registry', async (orig) => {
  const actual = await orig<typeof import('../../lib/agent-registry')>()
  return {
    ...actual,
    getAgent: (...a: unknown[]) => m.registryAgent.v ?? (actual.getAgent as (...x: unknown[]) => unknown)(...a),
    updateAgent: async (...a: unknown[]) => m.registryAgent.v ?? (actual.updateAgent as (...x: unknown[]) => unknown)(...a),
  }
})
const MANAGER_ID = '11111111-1111-4111-8111-111111111111'
const MANAGER = MANAGER_ID
const MEMBER_ID = '22222222-2222-4222-8222-222222222222'
const TARGET = '33333333-3333-4333-8333-333333333333'
const MEMBER_AUTH = { agentId: MEMBER_ID, governanceTitle: 'member' }
const MANAGER_AUTH = { agentId: MANAGER_ID, governanceTitle: 'manager' }
const OWNER = {}


/** user-authority model ON for one test: a principal with a userId and no agentId is a non-owner only then */
async function withUserModelOn<T>(fn: () => Promise<T>): Promise<T> {
  const gov = await import('../../lib/governance')
  const spy = vi.spyOn(gov, 'isUserAuthorityModelEnabled').mockReturnValue(true)
  try { return await fn() } finally { spy.mockRestore() }
}

// user-authority model ON, signed-in user who is not the owner: a principal with a userId and NO agentId
const NON_OWNER_USER = { userId: 'u-1', userTitle: 'user' }

function drive(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  // a string body is sent as the raw request text (so a malformed-JSON case can be expressed); anything else is JSON-encoded
  const chunks = body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]
  const req = {
    url, method,
    headers: { authorization: 'Bearer aim_tk_AAAAAAAAAAAAAAAAAAAAAAAA', 'content-type': 'application/json', ...headers },
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
async function run(method: string, url: string, body?: unknown, headers?: Record<string, string>) {
  const { createHeadlessRouter } = await import('../../services/headless-router')
  const d = drive(method, url, body, headers)
  await createHeadlessRouter().handle(d.req, d.res)
  return { status: d.out.status, json: JSON.parse(d.out.body ? d.out.body.toString() : 'null') }
}

beforeEach(() => {
  for (const f of [m.authenticateAgent, m.changeMetadata, m.updateAgentById]) f.mockReset()
  m.registryAgent.v = null
  m.changeMetadata.mockResolvedValue({ success: true, operations: [] })
  m.updateAgentById.mockResolvedValue({ data: { agent: { id: TARGET } }, status: 200 })
})

const META = `/api/agents/${TARGET}/metadata`

describe('TRDD-BZW1QAZ5 — PATCH agents/:id/metadata (twin: authenticate, then ChangeMetadata with the caller context)', () => {
  it('no credentials: 401 with the authentication error and ChangeMetadata is not called', async () => {
    /** The gap: this used to write the metadata with no authentication at all */
    m.authenticateAgent.mockReturnValue({ error: 'Authentication required', status: 401 })
    const out = await run('PATCH', META, { k: 1 })
    expect(out.status).toBe(401)
    expect(out.json.error).toBe('Authentication required')
    expect(m.changeMetadata).not.toHaveBeenCalled()
    expect(m.updateAgentById).not.toHaveBeenCalled()
  })
  it('invalid credentials with no status field: 401 (the twin default) and ChangeMetadata is not called', async () => {
    /** `auth.status || 401` */
    m.authenticateAgent.mockReturnValue({ error: 'Invalid token' })
    const out = await run('PATCH', META, { k: 1 })
    expect(out.status).toBe(401)
    expect(m.changeMetadata).not.toHaveBeenCalled()
  })
  it('an authenticated MEMBER writing ANOTHER agent: the real ChangeMetadata gate 0 refuses it and no metadata is written', async () => {
    /** Authentication is not authorization; the refusal is the real modify-agent decision, not a stub. 403 via the ChangeMetadata `denied` flag (TRDD-BZW1QAZ5), not via the reason text, which matches no keyword */
    m.authenticateAgent.mockReturnValue(MEMBER_AUTH)
    const actual = await vi.importActual<typeof import('../../services/element-management-service')>('../../services/element-management-service')
    m.changeMetadata.mockImplementation((...a: unknown[]) => (actual.ChangeMetadata as (...x: unknown[]) => unknown)(...a))
    const out = await run('PATCH', META, { k: 1 })
    expect(out.status).toBe(403)
    expect(String(out.json.error)).toMatch(/cannot modify-agent/)
    expect(m.changeMetadata).toHaveBeenCalledTimes(1)
  })
  it('a signed-in NON-OWNER user (no agentId, model ON) is refused 403 by the real ChangeMetadata gate 0', async () => {
    /** Such a caller used to reach updateAgentById as a null requester, i.e. as if it were the owner */
    m.authenticateAgent.mockReturnValue(NON_OWNER_USER)
    const actual = await vi.importActual<typeof import('../../services/element-management-service')>('../../services/element-management-service')
    m.changeMetadata.mockImplementation((...a: unknown[]) => (actual.ChangeMetadata as (...x: unknown[]) => unknown)(...a))
    const out = await withUserModelOn(() => run('PATCH', META, { k: 1 }))
    expect(out.status).toBe(403)
    expect(String(out.json.error)).toMatch(/not authorized to modify-agent/)
  })
  it('POSITIVE CONTROL — a MANAGER reaches ChangeMetadata with its own context and merge mode', async () => {
    /** The gate can say yes, and the service gets the real caller */
    m.authenticateAgent.mockReturnValue(MANAGER_AUTH)
    const out = await run('PATCH', META, { k: 1 })
    expect(out.status).toBe(200)
    expect(m.changeMetadata).toHaveBeenCalledTimes(1)
    const c = m.changeMetadata.mock.calls[0]
    expect(c[0]).toBe(TARGET)
    expect(c[1]).toStrictEqual({ k: 1 })
    expect(c[2]).toMatchObject({ agentId: MANAGER_ID, isSystemOwner: false })
    expect(c[3]).toStrictEqual({ mode: 'merge' })
  })
  it('the system owner reaches ChangeMetadata with isSystemOwner true', async () => {
    /** The owner has no agentId and must still be allowed */
    m.authenticateAgent.mockReturnValue(OWNER)
    const out = await run('PATCH', META, { k: 1 })
    expect(out.status).toBe(200)
    expect(m.changeMetadata.mock.calls[0][2]).toMatchObject({ isSystemOwner: true })
  })
  it.each([
    ['Agent x not found', 404],
    ['denied by gate 0', 403],
    ['Metadata exceeds maximum size (64KB)', 400],
  ])('ChangeMetadata failure "%s" maps to %i as the twin maps it', async (error, status) => {
    /** The twin's error -> status mapping */
    m.authenticateAgent.mockReturnValue(OWNER)
    // TRDD-BZW1QAZ5: 403 follows the `denied` flag, not the wording
    m.changeMetadata.mockResolvedValue({ success: false, error, operations: [], ...(status === 403 ? { denied: true } : {}) })
    const out = await run('PATCH', META, { k: 1 })
    expect(out.status).toBe(status)
    expect(out.json.error).toBe(error)
  })
})

describe('TRDD-BZW1QAZ5 — a malformed JSON body is a client error, not a server error', () => {
  it('PATCH agents/:id/metadata with the body text `{not json`: 400 and the response does not echo the request text', async () => {
    /** readJsonBody rejects with status 400; the router catch must honour it instead of answering 500 */
    m.authenticateAgent.mockReturnValue(OWNER)
    const out = await run('PATCH', META, '{not json')
    expect(out.status).toBe(400)
    expect(JSON.stringify(out.json)).not.toContain('not json')
    expect(m.changeMetadata).not.toHaveBeenCalled()
  })
})

describe('TRDD-BZW1QAZ5 — PATCH agents/:id passes the twin AuthContext to updateAgentById (no sudo token, open question)', () => {
  const URL_ = `/api/agents/${TARGET}`
  it('no credentials: 401 and updateAgentById is not called', async () => {
    /** An authentication error never reaches the service */
    m.authenticateAgent.mockReturnValue({ error: 'Authentication required', status: 401 })
    const out = await run('PATCH', URL_, { label: 'x' })
    expect(out.status).toBe(401)
    expect(out.json.error).toBe('Authentication required')
    expect(m.updateAgentById).not.toHaveBeenCalled()
  })
  it('the system owner changing a Change*-owned field (name) reaches the service WITHOUT a sudo token, with an owner context', async () => {
    /** Keeps the old headless behaviour: no sudo gate here */
    m.authenticateAgent.mockReturnValue(OWNER)
    const out = await run('PATCH', URL_, { name: 'renamed' })
    expect(out.status).toBe(200)
    expect(m.updateAgentById.mock.calls[0][2]).toBeNull()
    expect(m.updateAgentById.mock.calls[0][3]).toMatchObject({ isSystemOwner: true })
  })
  it('an authorized agent (MANAGER) changing name reaches the service WITHOUT a sudo token, with its id and a non-owner context', async () => {
    /** The context the old handler never passed */
    m.authenticateAgent.mockReturnValue(MANAGER_AUTH)
    const out = await run('PATCH', URL_, { name: 'renamed' })
    expect(out.status).toBe(200)
    expect(m.updateAgentById.mock.calls[0][2]).toBe(MANAGER_ID)
    expect(m.updateAgentById.mock.calls[0][3]).toMatchObject({ agentId: MANAGER_ID, governanceTitle: 'manager', isSystemOwner: false })
  })
  it('a signed-in NON-OWNER user (model ON) reaches the service with isSystemOwner false and its user title', async () => {
    /** The old handler passed only agentId, so the Change* fallback context read this caller as the owner */
    m.authenticateAgent.mockReturnValue(NON_OWNER_USER)
    await withUserModelOn(() => run('PATCH', URL_, { label: 'x' }))
    expect(m.updateAgentById.mock.calls[0][3]).toMatchObject({ userId: 'u-1', userTitle: 'user' })
    expect(m.updateAgentById.mock.calls[0][3].isSystemOwner).toBe(false)
  })
  it('a signed-in NON-OWNER user (model ON) changing a Change*-owned field is refused by the real updateAgentById/ChangeName', async () => {
    /** End to end: the real service with a stubbed registry row; the refusal is ChangeName gate 0 (modify-agent), not a stub */
    m.authenticateAgent.mockReturnValue(NON_OWNER_USER)
    m.registryAgent.v = { id: TARGET, name: 'old', workingDirectory: '/tmp/x' }
    const actual = await vi.importActual<typeof import('../../services/agents-core-service')>('../../services/agents-core-service')
    m.updateAgentById.mockImplementation((...a: unknown[]) => (actual.updateAgentById as (...x: unknown[]) => unknown)(...a))
    const out = await withUserModelOn(() => run('PATCH', URL_, { name: 'renamed' }))
    expect(out.status).toBe(409)
    expect(String(out.json.error)).toMatch(/not authorized to modify-agent/)
  })
})

describe('TRDD-BZW1QAZ5 — DELETE agents/:id/metadata (authenticate + the twin modify-agent decision, clear goes through ChangeMetadata, mode clear)', () => {
  it('bad credentials: 401 and nothing is cleared', async () => {
    /** The gap: this used to wipe the metadata with no authentication at all */
    m.authenticateAgent.mockReturnValue({ error: 'Invalid token', status: 401 })
    const out = await run('DELETE', META)
    expect(out.status).toBe(401)
    expect(out.json.error).toBe('Invalid token')
    expect(m.changeMetadata).not.toHaveBeenCalled()
  })
  it('an authenticated MEMBER clearing ANOTHER agent: refused (403) and nothing is cleared', async () => {
    /** Authentication is not authorization. TRDD-BZW1QAZ5: the pre-check refuses with 403 whatever the wording of the reason */
    m.authenticateAgent.mockReturnValue(MEMBER_AUTH)
    const out = await run('DELETE', META)
    expect(out.status).toBe(403)
    expect(String(out.json.error)).toMatch(/cannot modify-agent/)
    expect(m.changeMetadata).not.toHaveBeenCalled()
  })
  it('the agent itself clearing its OWN metadata is refused (403) and nothing is cleared', async () => {
    /** The twin's rule, not mine: authorize() denies an agent reconfiguring itself ("No agent can modify itself via the AI Maestro API"); TRDD-BZW1QAZ5: a refusal is 403 whatever its wording */
    m.authenticateAgent.mockReturnValue({ agentId: TARGET, governanceTitle: 'member' })
    const out = await run('DELETE', META)
    expect(out.status).toBe(403)
    expect(String(out.json.error)).toMatch(/No agent can modify itself/)
    expect(m.changeMetadata).not.toHaveBeenCalled()
  })
  it('a MANAGER clears the metadata', async () => {
    /** The twin allows MANAGER through gate 0 */
    m.authenticateAgent.mockReturnValue(MANAGER_AUTH)
    const out = await run('DELETE', META)
    expect(out.status).toBe(200)
    expect(m.changeMetadata).toHaveBeenCalledWith(TARGET, {}, expect.anything(), { mode: 'clear' })
  })
  it('the system owner clears the metadata', async () => {
    /** The owner has no agentId and must still be allowed */
    m.authenticateAgent.mockReturnValue(OWNER)
    const out = await run('DELETE', META)
    expect(out.status).toBe(200)
    expect(m.changeMetadata).toHaveBeenCalledWith(TARGET, {}, expect.anything(), { mode: 'clear' })
  })
  it('a signed-in NON-OWNER user (model ON) is refused 403 and nothing is cleared', async () => {
    /** Such a caller used to wipe metadata as a null requester; this reason contains "authorized" so the mapping gives 403 */
    m.authenticateAgent.mockReturnValue(NON_OWNER_USER)
    const out = await withUserModelOn(() => run('DELETE', META))
    expect(out.status).toBe(403)
    expect(String(out.json.error)).toMatch(/not authorized to modify-agent/)
    expect(m.changeMetadata).not.toHaveBeenCalled()
  })
  it('a ChangeMetadata failure is mapped like the twin: "not found" 404, a denied (gate 0) failure 403, anything else 400, with the service text', async () => {
    /** The handler's status map is the PATCH sibling's and the twin route's; ChangeMetadata is the double here, so each reason is injected */
    m.authenticateAgent.mockReturnValue(OWNER)
    for (const [error, status] of [['Agent x not found', 404], ['not authorized to modify-agent', 403], ['Metadata must be a plain object', 400]] as const) {
      // the 403 comes from the `denied` flag (TRDD-BZW1QAZ5), so inject it exactly as ChangeMetadata gate 0 sets it
      m.changeMetadata.mockResolvedValueOnce({ success: false, operations: [], error, ...(status === 403 ? { denied: true } : {}) })
      const out = await run('DELETE', META)
      expect(out.status).toBe(status)
      expect(out.json.error).toBe(error)
    }
  })
})
