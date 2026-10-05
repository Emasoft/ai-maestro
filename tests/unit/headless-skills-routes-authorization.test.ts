import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'http'

/**
 * TRDD-BZW1QAZ5 — the four headless skills mutations (PUT skills/settings, PATCH/POST/DELETE skills) mirror their
 * full-mode twins: 401 on an authentication error, then authorize(auth, 'manage-skills', id) -> 403, then the service
 * receives `auth.agentId || null`. Drives the REAL createHeadlessRouter().handle() and the REAL authorize(); only
 * authenticateAgent (the handler's identity seam) and the four skills services are replaced, at their module boundary.
 * Every refusal also asserts the service was NOT called. 'manage-skills' allows: the target itself, a MANAGER over any
 * agent, a CHIEF-OF-STAFF over its own team, and the system owner; a MEMBER on ANOTHER agent is refused.
 * The credentials are fixtures: the Bearer value is a fake token that only satisfies the router's structural shape check.
 */

const m = vi.hoisted(() => {
  type AnyFn = (...a: any[]) => any
  return {
    authenticateAgent: vi.fn<AnyFn>(),
    saveSkillSettings: vi.fn<AnyFn>(),
    updateSkills: vi.fn<AnyFn>(),
    addSkill: vi.fn<AnyFn>(),
    removeSkill: vi.fn<AnyFn>(),
  }
})

vi.mock('../../lib/agent-auth', async (orig) => {
  const actual = await orig<typeof import('../../lib/agent-auth')>()
  return {
    ...actual,
    authenticateAgent: (...a: unknown[]) => m.authenticateAgent(...a),
    // the router's semantic credential gate runs before the handler; let it through so the HANDLER's own check is what is tested
    authenticateFromRequestAsync: vi.fn(async () => ({ agentId: undefined, error: undefined })),
  }
})
vi.mock('../../lib/governance', async (orig) => {
  const actual = await orig<typeof import('../../lib/governance')>()
  return { ...actual, getManagerId: () => MANAGER }
})
vi.mock('../../services/agents-skills-service', async (orig) => ({
  ...(await orig<object>()),
  saveSkillSettings: (...a: unknown[]) => m.saveSkillSettings(...a),
  updateSkills: (...a: unknown[]) => m.updateSkills(...a),
  addSkill: (...a: unknown[]) => m.addSkill(...a),
  removeSkill: (...a: unknown[]) => m.removeSkill(...a),
}))

const MANAGER = '11111111-1111-4111-8111-111111111111'
const MEMBER = '22222222-2222-4222-8222-222222222222'
const TARGET = '33333333-3333-4333-8333-333333333333'
const MEMBER_AUTH = { agentId: MEMBER, governanceTitle: 'member' }
const MANAGER_AUTH = { agentId: MANAGER, governanceTitle: 'manager' }
const OWNER = {}

type Verb = { name: string; method: string; url: string; body?: unknown; spy: () => import('vitest').Mock<(...a: never[]) => unknown>; arg: (c: unknown[]) => unknown }
const verbs: Verb[] = [
  { name: 'PUT skills/settings', method: 'PUT', url: `/api/agents/${TARGET}/skills/settings`, body: { settings: { a: 1 } }, spy: () => m.saveSkillSettings, arg: (c) => c[2] },
  { name: 'PATCH skills', method: 'PATCH', url: `/api/agents/${TARGET}/skills`, body: { add: [] }, spy: () => m.updateSkills, arg: (c) => c[2] },
  { name: 'POST skills', method: 'POST', url: `/api/agents/${TARGET}/skills`, body: { skill: { id: 's' } }, spy: () => m.addSkill, arg: (c) => c[2] },
  { name: 'DELETE skills', method: 'DELETE', url: `/api/agents/${TARGET}/skills?skill=s`, spy: () => m.removeSkill, arg: (c) => c[3] },
]

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
  const out: { status?: number; body?: string } = {}
  const res = {
    writeHead(status: number) { out.status = status; return this },
    setHeader() { return this },
    end(payload?: string) { out.body = payload },
    headersSent: false,
  } as unknown as ServerResponse
  return { req, res, out }
}
async function run(method: string, url: string, body?: unknown) {
  const { createHeadlessRouter } = await import('../../services/headless-router')
  const d = drive(method, url, body)
  await createHeadlessRouter().handle(d.req, d.res)
  return d.out
}

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset()
  for (const f of [m.saveSkillSettings, m.updateSkills, m.addSkill, m.removeSkill]) f.mockResolvedValue({ data: { ok: true }, status: 200 })
})

for (const v of verbs) {
  describe(`TRDD-BZW1QAZ5 — ${v.name} (twin: authenticate, authorize manage-skills, then the service)`, () => {
    it('no credentials: 401 with the authentication error and the service is not called', async () => {
      /** The gap: this used to run the mutation with a null requester, i.e. ungoverned */
      m.authenticateAgent.mockReturnValue({ error: 'Authentication required', status: 401 })
      const out = await run(v.method, v.url, v.body)
      expect(out.status).toBe(401)
      expect(JSON.parse(out.body || '{}').error).toBe('Authentication required')
      expect(v.spy()).not.toHaveBeenCalled()
    })
    it('invalid credentials with no status field: 401 (the twin default) and the service is not called', async () => {
      /** `auth.status || 401` */
      m.authenticateAgent.mockReturnValue({ error: 'Invalid token' })
      const out = await run(v.method, v.url, v.body)
      expect(out.status).toBe(401)
      expect(JSON.parse(out.body || '{}').error).toBe('Invalid token')
      expect(v.spy()).not.toHaveBeenCalled()
    })
    it('an authenticated MEMBER managing ANOTHER agent: 403 with the authorize() reason and the service is not called', async () => {
      /** Authentication is not authorization */
      m.authenticateAgent.mockReturnValue(MEMBER_AUTH)
      const out = await run(v.method, v.url, v.body)
      expect(out.status).toBe(403)
      expect(JSON.parse(out.body || '{}').error).toBe('member cannot manage-skills other agents')
      expect(v.spy()).not.toHaveBeenCalled()
    })
    it('POSITIVE CONTROL — a MANAGER (manage-skills on any agent) reaches the service with its own agent id', async () => {
      /** The gate can say yes, and the service governance gets the real caller */
      m.authenticateAgent.mockReturnValue(MANAGER_AUTH)
      const out = await run(v.method, v.url, v.body)
      expect(out.status).toBe(200)
      expect(v.spy()).toHaveBeenCalledTimes(1)
      expect(v.arg(v.spy().mock.calls[0] as unknown[])).toBe(MANAGER)
    })
    it('the system owner reaches the service with a null requester', async () => {
      /** `auth.agentId || null`: the owner has no agentId and must still be allowed */
      m.authenticateAgent.mockReturnValue(OWNER)
      const out = await run(v.method, v.url, v.body)
      expect(out.status).toBe(200)
      expect(v.spy()).toHaveBeenCalledTimes(1)
      expect(v.arg(v.spy().mock.calls[0] as unknown[])).toBeNull()
    })
  })
}

describe('TRDD-BZW1QAZ5 — twin body/query validation kept', () => {
  it('PUT skills/settings: a non-object body.settings is 400 after authorization and the service is not called', async () => {
    /** SF-044 of the twin */
    m.authenticateAgent.mockReturnValue(MANAGER_AUTH)
    const out = await run('PUT', `/api/agents/${TARGET}/skills/settings`, { settings: [] })
    expect(out.status).toBe(400)
    expect(m.saveSkillSettings).not.toHaveBeenCalled()
  })
  it('PUT skills/settings: the service receives body.settings, not the wrapper', async () => {
    /** The twin's payload contract */
    m.authenticateAgent.mockReturnValue(MANAGER_AUTH)
    await run('PUT', `/api/agents/${TARGET}/skills/settings`, { settings: { a: 1 } })
    expect(m.saveSkillSettings.mock.calls[0][1]).toStrictEqual({ a: 1 })
  })
  it('DELETE skills without ?skill= is 400 and the service is not called', async () => {
    /** The twin's missing-parameter refusal */
    m.authenticateAgent.mockReturnValue(MANAGER_AUTH)
    const out = await run('DELETE', `/api/agents/${TARGET}/skills`)
    expect(out.status).toBe(400)
    expect(m.removeSkill).not.toHaveBeenCalled()
  })
})
