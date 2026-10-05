import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The creation helper is the system owner's wizard: its chat (creation-helper-service sendMessage)
 * and raw-materials route are already owner-only. These four handlers were authenticate-only
 * (session POST/DELETE/GET) or not authenticated at all (response GET), so any credential-bearing
 * agent could start/kill the accept-edits helper session or read its captured output.
 * Each handler must refuse an agent (403) and no caller (401) BEFORE reaching the service.
 */

const mockAuthenticate = vi.fn()
vi.mock('@/lib/agent-auth', async (orig) => {
  const actual = await orig<typeof import('@/lib/agent-auth')>()
  return { ...actual, authenticateFromRequest: (...a: unknown[]) => mockAuthenticate(...a) }
})

const svc = {
  createCreationHelper: vi.fn(async () => ({ status: 200, data: { success: true } })),
  deleteCreationHelper: vi.fn(async () => ({ status: 200, data: { success: true } })),
  getCreationHelperStatus: vi.fn(async () => ({ status: 200, data: { success: true } })),
  captureResponse: vi.fn(async () => ({ status: 200, data: { success: true } })),
}
vi.mock('@/services/creation-helper-service', async (orig) => {
  const actual = await orig<typeof import('@/services/creation-helper-service')>()
  return { ...actual, ...svc }
})

const MEMBER = { agentId: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', governanceTitle: 'member', teamId: null }
const OWNER = { agentId: undefined, governanceTitle: undefined, teamId: null }

const HANDLERS: { name: string; dir: string; method: 'POST' | 'DELETE' | 'GET'; service: keyof typeof svc }[] = [
  { name: 'session POST', dir: 'session', method: 'POST', service: 'createCreationHelper' },
  { name: 'session DELETE', dir: 'session', method: 'DELETE', service: 'deleteCreationHelper' },
  { name: 'session GET', dir: 'session', method: 'GET', service: 'getCreationHelperStatus' },
  { name: 'response GET', dir: 'response', method: 'GET', service: 'captureResponse' },
]

async function call(h: (typeof HANDLERS)[number]) {
  const mod = await import(`@/app/api/agents/creation-helper/${h.dir}/route`)
  const request = new Request(`http://localhost/api/agents/creation-helper/${h.dir}`, {
    method: h.method,
    headers: { authorization: 'Bearer tok' },
  }) as never
  return mod[h.method](request)
}

describe('creation-helper session and response routes are system-owner only', () => {
  beforeEach(() => {
    mockAuthenticate.mockReset()
    Object.values(svc).forEach((f) => f.mockClear())
  })

  for (const h of HANDLERS) {
    it(`${h.name}: an authenticated agent gets 403 and the service is not called`, async () => {
      mockAuthenticate.mockReturnValue(MEMBER)
      const res = await call(h)
      expect(res.status).toBe(403)
      expect(svc[h.service]).not.toHaveBeenCalled()
    })

    it(`${h.name}: an unauthenticated caller gets 401 and the service is not called`, async () => {
      mockAuthenticate.mockReturnValue({ error: 'Authentication required', status: 401 })
      const res = await call(h)
      expect(res.status).toBe(401)
      expect(svc[h.service]).not.toHaveBeenCalled()
    })

    it(`${h.name}: the system owner reaches the service once (positive control)`, async () => {
      mockAuthenticate.mockReturnValue(OWNER)
      const res = await call(h)
      expect(res.status).toBe(200)
      expect(svc[h.service]).toHaveBeenCalledTimes(1)
    })
  }
})
