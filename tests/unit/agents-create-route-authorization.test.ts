/**
 * POST /api/agents — the AUTHORIZATION gate (TRDD-F1SL03CK).
 *
 * The route's own comment called creation "a privileged mutation" and then checked only
 * `authenticateFromRequest` — WHO the caller is, never WHETHER they may. Authentication
 * standing in for authorization. There was no `create-agent` action in the RBAC enum at
 * all, so R30.1 ("the CHIEF-OF-STAFF requires the MANAGER's approval/mandate to create
 * agents") was law with no enforcement, and any authenticated agent of any title could
 * mint agents.
 *
 * WHY THIS ALTITUDE. tests/authorization.test.ts pins the DECISION at the `authorize()`
 * boundary. That is a different claim from "the route asks" — a correct matrix wired to
 * nothing denies nobody. This drives the exported POST handler directly, so the route's
 * own call is the thing under test.
 *
 * `authorize` is deliberately NOT mocked. Mocking the guard to prove the guard is a test
 * that survives the guard's deletion; only `agent-auth` (to inject a title) and the
 * service (to observe whether anything ran) are doubled.
 *
 * THE DENIAL ASSERTION IS THAT NOTHING RAN. A bare `status === 403` would pass against a
 * route that creates the agent and refuses afterwards. So each denial also asserts
 * `CreateAgent` was never called — for creation, "refused after the fact" is not a refusal.
 *
 * NEUTER RUN (observed): removing the `if (!authz.allowed)` block from the route reddens
 * both denial cases and leaves the two grants green — the split that proves these pin the
 * route's gate rather than the handler merely existing. Restored byte-identical.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockAgentAuth, mockService } = vi.hoisted(() => ({
  mockAgentAuth: { authenticateFromRequest: vi.fn(), buildAuthContext: vi.fn(() => ({})) },
  mockService: { CreateAgent: vi.fn() },
}))

vi.mock('@/lib/agent-auth', () => mockAgentAuth)
vi.mock('@/services/element-management-service', () => mockService)

import { POST } from '@/app/api/agents/route'

/** A caller the REAL authorize() will resolve without touching the registry. */
const asAgent = (governanceTitle: string) => ({
  agentId: 'caller-1',
  governanceTitle,
  teamId: 'team-a',
})

function post(body: unknown = { name: 'new-agent', workingDirectory: '/tmp/x' }) {
  return new Request('http://localhost:23000/api/agents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAgentAuth.buildAuthContext.mockReturnValue({})
  mockService.CreateAgent.mockResolvedValue({ success: true, agentId: 'created-1' })
})

describe('POST /api/agents — create-agent authorization', () => {
  it('a MEMBER is DENIED with 403, and NOTHING is created', async () => {
    mockAgentAuth.authenticateFromRequest.mockReturnValue(asAgent('member'))

    const res = await POST(post())

    expect(res.status).toBe(403)
    // The property that matters: the refusal happened BEFORE any creation.
    expect(mockService.CreateAgent).not.toHaveBeenCalled()
    // Pin the reason too — `403` alone is satisfied by any earlier unrelated refusal.
    expect((await res.json()).error).toMatch(/Only MANAGER and CHIEF-OF-STAFF can create agents/)
  })

  it('an AUTONOMOUS agent is DENIED — the hole was every title, not just MEMBER', async () => {
    mockAgentAuth.authenticateFromRequest.mockReturnValue(asAgent('autonomous'))

    const res = await POST(post())

    expect(res.status).toBe(403)
    expect(mockService.CreateAgent).not.toHaveBeenCalled()
  })

  it('a MANAGER is ALLOWED and reaches CreateAgent', async () => {
    mockAgentAuth.authenticateFromRequest.mockReturnValue(asAgent('manager'))

    const res = await POST(post())

    // POSITIVE CONTROL. Without it, both denials above would pass against a route that
    // refuses EVERYONE — including a typo'd action name that matches no matrix rule.
    expect(mockService.CreateAgent).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(201)
  })

  it('a CHIEF-OF-STAFF is ALLOWED at this layer — R30.2 makes it normal team operation', async () => {
    mockAgentAuth.authenticateFromRequest.mockReturnValue(asAgent('chief-of-staff'))

    const res = await POST(post())

    // Whether it holds a MANDATE for this act is the portfolio gate's separate question.
    // If this ever flips to 403, team creation breaks: a COS creates the base members.
    expect(mockService.CreateAgent).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(201)
  })

  it('an unauthenticated caller is refused by the AUTH gate, before authorization', async () => {
    mockAgentAuth.authenticateFromRequest.mockReturnValue({ error: 'token_invalid', status: 401 })

    const res = await POST(post())

    expect(res.status).toBe(401)
    expect(mockService.CreateAgent).not.toHaveBeenCalled()
  })
})
