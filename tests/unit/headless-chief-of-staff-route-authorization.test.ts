import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'http'

/**
 * TRDD-A50RC5G8 — the HEADLESS twin of POST /api/teams/[id]/chief-of-staff authorizes the caller.
 *
 * The headless handler used to check ONLY the governance password, so any authenticated agent of any
 * title could chair a team (and the chair decides every chief-of-staff grant). It now mirrors the
 * full-mode route: an agent needs authorize('manage-team') (MANAGER only) and may not assign itself;
 * the human owner keeps the password path. '@/lib/authorization' is NOT mocked — the real matrix runs.
 * The password verifier is a stub: no real password value appears here.
 */

const m = vi.hoisted(() => ({
  authenticateAgent: vi.fn(),
  buildAuthContext: vi.fn((..._a: unknown[]) => ({})),
  verifyPassword: vi.fn(),
  getTeam: vi.fn(),
  updateTeam: vi.fn(),
  getAgent: vi.fn(),
  ChangeTitle: vi.fn(async (..._a: unknown[]) => ({})),
  checkAndRecordAttempt: vi.fn((..._a: unknown[]) => ({ allowed: true, retryAfterMs: 0 })),
  resetRateLimit: vi.fn((..._a: unknown[]) => undefined),
}))

vi.mock('../../lib/rate-limit', async (orig) => {
  const actual = await orig<typeof import('../../lib/rate-limit')>()
  return {
    ...actual,
    checkAndRecordAttempt: (...a: unknown[]) => m.checkAndRecordAttempt(...a),
    resetRateLimit: (...a: unknown[]) => m.resetRateLimit(...a),
  }
})

vi.mock('../../lib/agent-auth', async (orig) => {
  const actual = await orig<typeof import('../../lib/agent-auth')>()
  return {
    ...actual,
    authenticateAgent: (...a: unknown[]) => m.authenticateAgent(...a),
    buildAuthContext: (...a: unknown[]) => m.buildAuthContext(...a),
    // the router's semantic credential gate runs before the handler; let it through
    authenticateFromRequestAsync: vi.fn(async () => ({ agentId: undefined, error: undefined })),
  }
})
vi.mock('../../lib/governance', async (orig) => {
  const actual = await orig<typeof import('../../lib/governance')>()
  return {
    ...actual,
    verifyPassword: (...a: unknown[]) => m.verifyPassword(...a),
    loadGovernance: () => ({ passwordHash: 'stub-hash' }),
    getManagerId: () => '11111111-1111-4111-8111-111111111111',
  }
})
vi.mock('../../lib/team-registry', async (orig) => {
  const actual = await orig<typeof import('../../lib/team-registry')>()
  return {
    ...actual,
    getTeam: (...a: unknown[]) => m.getTeam(...a),
    updateTeam: (...a: unknown[]) => m.updateTeam(...a),
  }
})
vi.mock('../../lib/agent-registry', async (orig) => {
  const actual = await orig<typeof import('../../lib/agent-registry')>()
  return { ...actual, getAgent: (...a: unknown[]) => m.getAgent(...a) }
})
vi.mock('../../services/element-management-service', async (orig) => {
  const actual = await orig<typeof import('../../services/element-management-service')>()
  return { ...actual, ChangeTitle: (...a: unknown[]) => m.ChangeTitle(...a) }
})

const MANAGER = '11111111-1111-4111-8111-111111111111'
const MEMBER = '22222222-2222-4222-8222-222222222222'
const TARGET = '33333333-3333-4333-8333-333333333333'
const TEAM = '44444444-4444-4444-8444-444444444444'
const COS = '55555555-5555-4555-8555-555555555555'

function drive(body: unknown) {
  const chunks = [Buffer.from(JSON.stringify(body))]
  const req = {
    url: `/api/teams/${TEAM}/chief-of-staff`,
    method: 'POST',
    // must satisfy the router's structural credential gate (24+ chars after the prefix)
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

async function run(body: unknown) {
  const { createHeadlessRouter } = await import('../../services/headless-router')
  const d = drive(body)
  await createHeadlessRouter().handle(d.req, d.res)
  return d.out
}

describe('TRDD-A50RC5G8 — headless chief-of-staff route authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.getTeam.mockReturnValue({ id: TEAM, name: 'T', agentIds: [], chiefOfStaffId: COS })
    m.updateTeam.mockResolvedValue({ id: TEAM, chiefOfStaffId: TARGET })
    m.getAgent.mockReturnValue({ id: TARGET, name: 'CosBot' })
    m.verifyPassword.mockResolvedValue(true)
  })

  it('MEMBER agent with an accepted password is refused 403 before the password is touched', async () => {
    /** The original exploit: password alone must not make a member the chair */
    m.authenticateAgent.mockReturnValue({ agentId: MEMBER, governanceTitle: 'member' })
    const out = await run({ agentId: MEMBER, password: 'stub' })
    expect(out.status).toBe(403)
    expect(out.body).toMatch(/manager|forbidden|not authorized|denied/i)
    expect(m.updateTeam).not.toHaveBeenCalled()
    expect(m.verifyPassword).not.toHaveBeenCalled()
  })

  it('an unauthorized agent neither consumes nor resets the password attempt counter', async () => {
    /** The 403 happens before the limiter: no probing, no laundering of the owner's failures */
    m.authenticateAgent.mockReturnValue({ agentId: MEMBER, governanceTitle: 'member' })
    const out = await run({ agentId: TARGET, password: 'stub' })
    expect(out.status).toBe(403)
    expect(m.checkAndRecordAttempt).not.toHaveBeenCalled()
    expect(m.resetRateLimit).not.toHaveBeenCalled()
  })

  it('owner with a wrong password counts as a failed attempt and does not reset the counter', async () => {
    /** Owner path limiter behaviour unchanged: one recorded attempt, 401, no reset */
    m.authenticateAgent.mockReturnValue({})
    m.verifyPassword.mockResolvedValue(false)
    const out = await run({ agentId: TARGET, password: 'wrong-stub' })
    expect(out.status).toBe(401)
    expect(m.checkAndRecordAttempt).toHaveBeenCalledTimes(1)
    expect(m.resetRateLimit).not.toHaveBeenCalled()
    expect(m.updateTeam).not.toHaveBeenCalled()
  })

  it('POSITIVE CONTROL — MANAGER agent assigns another agent, 200, no password needed', async () => {
    /** The gate can say yes: updateTeam is called with the target id */
    m.authenticateAgent.mockReturnValue({ agentId: MANAGER, governanceTitle: 'manager' })
    const out = await run({ agentId: TARGET })
    expect(out.status).toBe(200)
    expect(m.updateTeam).toHaveBeenCalledWith(TEAM, { chiefOfStaffId: TARGET, type: 'closed' }, MANAGER)
    expect(m.verifyPassword).not.toHaveBeenCalled()
  })

  it('MANAGER agent assigning ITSELF is refused 403 with the self-assign message', async () => {
    /** Self-assign ban mirrors the full-mode route */
    m.authenticateAgent.mockReturnValue({ agentId: MANAGER, governanceTitle: 'manager' })
    const out = await run({ agentId: MANAGER })
    expect(out.status).toBe(403)
    expect(out.body).toContain('An agent cannot assign itself as Chief-of-Staff')
    expect(m.updateTeam).not.toHaveBeenCalled()
  })

  it('owner (no agent identity) with the stubbed password succeeds as before', async () => {
    /** Human path unchanged: password verified, then updateTeam */
    m.authenticateAgent.mockReturnValue({})
    const out = await run({ agentId: TARGET, password: 'stub' })
    expect(out.status).toBe(200)
    expect(m.verifyPassword).toHaveBeenCalledWith('stub')
    expect(m.updateTeam).toHaveBeenCalledWith(TEAM, { chiefOfStaffId: TARGET, type: 'closed' }, MANAGER)
  })

  // User-authority model ON shapes, quoted from lib/agent-auth.ts authenticateAgent: a web session / user-AID token
  // resolves to `{ userId, userTitle }` with NO agentId (`{ userId: sess.userId, userTitle }` and
  // `{ userId, userTitle: aidRecord.user_title ?? 'user' }`). The real authorize() runs (not mocked).
  it('model ON: the maestro shape { userId, userTitle: maestro } with the stubbed-correct password succeeds, 200', async () => {
    /** The active maestro keeps the owner password path */
    m.authenticateAgent.mockReturnValue({ userId: 'user-maestro', userTitle: 'maestro' })
    const out = await run({ agentId: TARGET, password: 'stub' })
    expect(out.status).toBe(200)
    expect(m.verifyPassword).toHaveBeenCalledWith('stub')
    expect(m.updateTeam).toHaveBeenCalledWith(TEAM, { chiefOfStaffId: TARGET, type: 'closed' }, MANAGER)
  })

  it('model ON: the maestro shape with a wrong password is refused 401 and nothing is written', async () => {
    /** The owner path still needs the password */
    m.authenticateAgent.mockReturnValue({ userId: 'user-maestro', userTitle: 'maestro' })
    m.verifyPassword.mockResolvedValue(false)
    const out = await run({ agentId: TARGET, password: 'wrong-stub' })
    expect(out.status).toBe(401)
    expect(m.updateTeam).not.toHaveBeenCalled()
  })

  it('model ON: a non-owner user { userId, userTitle: user } is refused 403 before the password and before updateTeam', async () => {
    /** A normal user has a session but no authority: it must not reach the password verifier */
    m.authenticateAgent.mockReturnValue({ userId: 'user-plain', userTitle: 'user' })
    const out = await run({ agentId: TARGET, password: 'stub' })
    expect(out.status).toBe(403)
    expect(m.verifyPassword).not.toHaveBeenCalled()
    expect(m.updateTeam).not.toHaveBeenCalled()
  })

  it('chief-of-staff-titled agent clearing the chair (null) is refused 403', async () => {
    /** Only MANAGER may clear the chair; a COS may not remove itself or anyone */
    m.authenticateAgent.mockReturnValue({ agentId: COS, governanceTitle: 'chief-of-staff' })
    const out = await run({ agentId: null, password: 'stub' })
    expect(out.status).toBe(403)
    expect(m.updateTeam).not.toHaveBeenCalled()
    expect(m.verifyPassword).not.toHaveBeenCalled()
  })
})