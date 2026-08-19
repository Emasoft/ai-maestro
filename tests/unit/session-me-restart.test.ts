/**
 * SECURITY tests for POST /api/sessions/me/restart (TRDD-4P1M8I18 Phase 2).
 *
 * The route is the SELF-ONLY-BY-CONSTRUCTION agent self-restart. These tests
 * pin the four security invariants (Never relax security strictness):
 *   (a) an agent restarts its OWN session;
 *   (b) NO request shape (body / query) reaches ANOTHER agent — the route reads
 *       only auth.agentId and derives the session from the caller's own record;
 *   (c) the existing [id]/restart self-deny for agents is UNCHANGED — this route
 *       ADDS a capability, it does not loosen the shared `restart-session` action;
 *   (d) a system-owner without an agent session is refused.
 * Plus the gate parity (401 / 404 / 409 no-session / 403 manager / 409 subagents
 * / 400 bad args) and the outcome mapping (504 / 500).
 *
 * The real pure helpers of lib/session-restart run; only the tmux-touching
 * runRestartSequence is mocked — 0-IMPACT, no real tmux.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockAuth, mockRegistry, mockRuntime, mockRestart, mockGov, mockTeam, mockSafe, mockLaunchArgs } = vi.hoisted(() => ({
  mockAuth: { authenticateFromRequest: vi.fn() },
  mockRegistry: { getAgent: vi.fn() },
  mockRuntime: { sessionExistsSync: vi.fn() },
  mockRestart: { runRestartSequence: vi.fn() },
  mockGov: { getManagerId: vi.fn() },
  mockTeam: { isAgentInAnyTeam: vi.fn() },
  // sessionProgramRunning joined the module 2026-08-20 (the stale-HIGH escape): the route
  // destructures it, so a factory lacking it throws at import — return null (unknown) so the
  // gate mock's own verdict decides, exactly as before.
  mockSafe: { readSubagentCount: vi.fn(), evaluateExitGate: vi.fn(), sessionProgramRunning: vi.fn(() => null) },
  // TRDD-GZ1KOHNR: default passthrough so these restart-flow tests reach the
  // relaunch path; the --agent enforcement itself is unit-tested separately.
  mockLaunchArgs: {
    resolveLaunchArgs: vi.fn(
      async (_a: string | undefined, _p: string, args: string): Promise<{ kind: 'ok'; args: string } | { kind: 'refuse'; reason: string }> => ({ kind: 'ok', args }),
    ),
  },
}))

vi.mock('@/lib/agent-auth', () => mockAuth)
vi.mock('@/lib/agent-registry', () => mockRegistry)
vi.mock('@/lib/agent-runtime', () => mockRuntime)
vi.mock('@/lib/governance', () => mockGov)
vi.mock('@/lib/team-registry', () => mockTeam)
vi.mock('@/lib/session-safe-state', () => mockSafe)
vi.mock('@/services/agent-launch-args', () => mockLaunchArgs)
// Keep the REAL pure helpers (isValidProgramArgs, resolveRestartBin,
// sanitizePersonaName, buildRelaunchCommand); mock only the tmux sequence.
vi.mock('@/lib/session-restart', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/session-restart')>()
  return { ...actual, runRestartSequence: mockRestart.runRestartSequence }
})

import { POST } from '@/app/api/sessions/me/restart/route'
import { authorize } from '@/lib/authorization'
import { NextRequest } from 'next/server'

function req(body?: Record<string, unknown>, query = ''): NextRequest {
  return new NextRequest(new URL(`http://localhost:23000/api/sessions/me/restart${query}`), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  // Happy-path defaults — the caller "alpha" is a healthy, non-team, live agent.
  mockAuth.authenticateFromRequest.mockReturnValue({ agentId: 'A' })
  mockRegistry.getAgent.mockReturnValue({
    id: 'A',
    name: 'alpha',
    sessions: [{ index: 0, status: 'online' }],
    program: 'claude',
    programArgs: '',
    workingDirectory: '/w',
  })
  mockRuntime.sessionExistsSync.mockReturnValue(true)
  mockGov.getManagerId.mockReturnValue('mgr') // a MANAGER exists → gate passes
  mockTeam.isAgentInAnyTeam.mockReturnValue(false)
  mockSafe.readSubagentCount.mockReturnValue(0)
  mockSafe.evaluateExitGate.mockReturnValue({ blocked: false, subagentCount: 0 })
  mockRestart.runRestartSequence.mockResolvedValue({ status: 'ok', command: 'claude --name "alpha"' })
})

describe('me/restart — invariant (a): an agent restarts its OWN session', () => {
  it('returns 200 and restarts the caller\'s own session name', async () => {
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, sessionName: 'alpha' })
    // The session name passed to the sequence is the CALLER's own (computeSessionName('alpha', 0)).
    expect(mockRestart.runRestartSequence).toHaveBeenCalledOnce()
    expect(mockRestart.runRestartSequence.mock.calls[0][0]).toBe('alpha')
  })
})

describe('me/restart — invariant (b): no request shape reaches another agent', () => {
  it('ignores body-supplied target fields; still restarts ONLY the caller\'s own session', async () => {
    // A hostile body naming another agent's session, id, and target.
    const res = await POST(req({ sessionName: 'victim', agentId: 'B', target: 'victim', id: 'victim' }))
    expect(res.status).toBe(200)
    // The route read NONE of those — the session is derived from auth.agentId → 'alpha'.
    expect(mockRestart.runRestartSequence.mock.calls[0][0]).toBe('alpha')
    expect(mockRestart.runRestartSequence.mock.calls[0][0]).not.toBe('victim')
    // getAgent was consulted ONLY for the authenticated caller, never 'B'.
    expect(mockRegistry.getAgent).toHaveBeenCalledWith('A')
    expect(mockRegistry.getAgent).not.toHaveBeenCalledWith('B')
  })
})

describe('me/restart — invariant (c): [id]/restart self-deny for agents is unchanged', () => {
  it('authorize() still denies an agent the shared restart-session action on itself', () => {
    const decision = authorize({ agentId: 'X', governanceTitle: 'member' }, 'restart-session', 'X')
    expect(decision.allowed).toBe(false)
    // restart-session is NOT a SELF_DRIVE action — self falls to the universal deny.
    expect(decision.reason).toMatch(/cannot modify itself|No agent can modify itself/i)
  })
})

describe('me/restart — invariant (d): a system-owner without an agent session is refused', () => {
  it('returns 400 no_self_agent when the caller has no agentId', async () => {
    mockAuth.authenticateFromRequest.mockReturnValue({}) // system-owner: no agentId, no error
    const res = await POST(req())
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'no_self_agent' })
    expect(mockRestart.runRestartSequence).not.toHaveBeenCalled()
  })
})

describe('me/restart — gates and outcome mapping', () => {
  it('401 on an auth error', async () => {
    mockAuth.authenticateFromRequest.mockReturnValue({ error: 'bad token', status: 401 })
    expect((await POST(req())).status).toBe(401)
    expect(mockRestart.runRestartSequence).not.toHaveBeenCalled()
  })

  it('404 when the caller\'s agent record is missing', async () => {
    mockRegistry.getAgent.mockReturnValue(null)
    expect((await POST(req())).status).toBe(404)
  })

  it('409 no_live_session when the agent has no live tmux session', async () => {
    mockRuntime.sessionExistsSync.mockReturnValue(false)
    const res = await POST(req())
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'no_live_session' })
    expect(mockRestart.runRestartSequence).not.toHaveBeenCalled()
  })

  it('403 when a team agent has no MANAGER on the host (parity with [id]/restart)', async () => {
    mockGov.getManagerId.mockReturnValue(null)
    mockTeam.isAgentInAnyTeam.mockReturnValue(true)
    expect((await POST(req())).status).toBe(403)
    expect(mockRestart.runRestartSequence).not.toHaveBeenCalled()
  })

  it('409 subagents_running when the exit gate is blocked (no ?force)', async () => {
    mockSafe.evaluateExitGate.mockReturnValue({ blocked: true, subagentCount: 2 })
    const res = await POST(req())
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'subagents_running', subagentCount: 2 })
  })

  it('400 on programArgs with disallowed characters', async () => {
    const res = await POST(req({ programArgs: 'evil; rm -rf' }))
    expect(res.status).toBe(400)
    expect(mockRestart.runRestartSequence).not.toHaveBeenCalled()
  })

  it('504 on a restart timeout', async () => {
    mockRestart.runRestartSequence.mockResolvedValue({ status: 'timeout' })
    expect((await POST(req())).status).toBe(504)
  })

  it('500 on a restart exec error (generic message, detail logged)', async () => {
    mockRestart.runRestartSequence.mockResolvedValue({ status: 'error', detail: 'tmux blew up' })
    const res = await POST(req())
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ error: 'Session restart failed' })
  })
})
