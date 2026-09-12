/**
 * POST /api/agents — the strict-route sudo gate (TRDD-F1SL03CK EHT-1).
 *
 * `POST_/api/agents` is classified "strict" in security-registry.json, but
 * nothing enforced that classification — a registry claim with no guard
 * behind it. This pins the WIRING: requireSudoToken is called with the exact
 * route template, before CreateAgent runs, and its verdict is obeyed.
 *
 * `requireSudoToken` itself (subject/op binding, the AGENT-vs-USER split) is
 * covered by lib/sudo-guard.ts's own tests and sudo-op-binding.test.ts; this
 * file only proves the route calls it and respects the result, mirroring
 * tests/unit/session-patch-sudo-gate.test.ts's pattern for #54.
 *
 * NEUTER RUN (observed): commenting out the `requireSudoToken` call in the
 * route reddens all 3/3 tests (each asserts the call or its verdict) —
 * "no token → refused" (CreateAgent gets called), and the other two lose
 * their `requireSudoToken` call-count assertion (expected 1, got 0).
 * Restored byte-identical.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

const { mockAgentAuth, mockService, mockGuard } = vi.hoisted(() => ({
  mockAgentAuth: { authenticateFromRequest: vi.fn(), buildAuthContext: vi.fn(() => ({})) },
  mockService: { CreateAgent: vi.fn() },
  mockGuard: { requireSudoToken: vi.fn() },
}))

vi.mock('@/lib/agent-auth', () => mockAgentAuth)
vi.mock('@/services/element-management-service', () => mockService)
// importOriginal, not a wholesale mock — a wholesale mock throws at module
// load the day the route destructures a second export from this module.
vi.mock('@/lib/sudo-guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sudo-guard')>()),
  requireSudoToken: mockGuard.requireSudoToken,
}))

import { POST } from '@/app/api/agents/route'

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
  mockAgentAuth.authenticateFromRequest.mockReturnValue({
    agentId: undefined,
    governanceTitle: undefined,
  })
  mockAgentAuth.buildAuthContext.mockReturnValue({})
  mockService.CreateAgent.mockResolvedValue({ success: true, agentId: 'created-1' })
})

describe('POST /api/agents — sudo gate wiring', () => {
  it('the system-owner caller with NO sudo token is refused, and nothing is created', async () => {
    mockGuard.requireSudoToken.mockReturnValue(
      NextResponse.json({ error: 'sudo_required' }, { status: 403 }),
    )

    const res = await POST(post())

    expect(res.status).toBe(403)
    expect(mockGuard.requireSudoToken).toHaveBeenCalledWith(
      expect.anything(),
      'POST',
      '/api/agents',
    )
    // Fail closed — creation never ran.
    expect(mockService.CreateAgent).not.toHaveBeenCalled()
  })

  it('a fresh sudo token lets the request past the gate, to CreateAgent', async () => {
    mockGuard.requireSudoToken.mockReturnValue(null) // guard passed

    const res = await POST(post())

    expect(mockGuard.requireSudoToken).toHaveBeenCalledTimes(1)
    expect(mockService.CreateAgent).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(201)
  })

  it('an AID-bearer (agentId set) is never denied by the human sudo path — the guard call is what decides, not this test', async () => {
    // R32.1: agent callers never see the sudo modal; requireAidTitle decides
    // instead. This test only proves the route still defers to whatever the
    // (mocked) guard returns for that caller shape.
    mockAgentAuth.authenticateFromRequest.mockReturnValue({
      agentId: 'caller-1',
      governanceTitle: 'manager',
    })
    mockGuard.requireSudoToken.mockReturnValue(null)

    const res = await POST(post())

    expect(mockGuard.requireSudoToken).toHaveBeenCalledWith(
      expect.anything(),
      'POST',
      '/api/agents',
    )
    expect(res.status).toBe(201)
  })
})
