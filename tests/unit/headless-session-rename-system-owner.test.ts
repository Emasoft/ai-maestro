import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'http'

/**
 * TRDD-OYNUJRSB — the HEADLESS twin of PATCH /api/sessions/[id]/rename is owner-only too.
 *
 * `services/headless-router.ts` REIMPLEMENTS this route, so a guard added only to the Next.js
 * handler is half-applied by construction. That is not a hypothetical: `GET /api/sessions/restore`
 * shipped the identical gap in both modes and needed two fixes and two independent tests
 * (TRDD-R268J32X, commit d6f78e2b). Neither mode's test can see the other's regression, so the
 * ruling is pinned TWICE — this file is the headless half of the pair whose Next half is
 * `tests/unit/session-rename-system-owner.test.ts`.
 *
 * The headless handler carried `authenticateAgent` (SVC2-MAJ-12) and stopped there, and its own
 * comment said "authenticate before renaming a tmux session" — which it did, faithfully. It never
 * asked WHOSE session it is, and `renameSession` has no ownership check to make up the difference.
 *
 * NEUTER RUN — see the recorded result at the bottom of this file.
 */

const mockAuthenticateAgent = vi.fn()
const mockBuildAuthContext = vi.fn()

vi.mock('../../lib/agent-auth', async (orig) => {
  const actual = await orig<typeof import('../../lib/agent-auth')>()
  return {
    ...actual,
    authenticateAgent: (...a: unknown[]) => mockAuthenticateAgent(...a),
    buildAuthContext: (...a: unknown[]) => mockBuildAuthContext(...a),
    // The router's semantic credential gate runs BEFORE the handler; let it through so this
    // test measures the handler's own authorization and not the gate ahead of it.
    authenticateFromRequestAsync: vi.fn(async () => ({ agentId: undefined, error: undefined })),
  }
})

// renameSession must never be REACHED on a refused call — a 403 returned after tmux has already
// renamed the session is not a refusal, the peer is already orphaned.
const mockRename = vi.fn()
vi.mock('../../services/sessions-service', async (orig) => {
  const actual = await orig<typeof import('../../services/sessions-service')>()
  return { ...actual, renameSession: (...a: unknown[]) => mockRename(...a) }
})

function drive(body: unknown) {
  const chunks = [Buffer.from(JSON.stringify(body))]
  const req = {
    url: '/api/sessions/victim-agent/rename',
    method: 'PATCH',
    // The bearer must satisfy the router's STRUCTURAL credential gate, which runs before any
    // handler and matches /^Bearer\s+(aim_tk_|…)[A-Za-z0-9_\-.]{24,}$/ — TWENTY-FOUR chars after the prefix,
    // not ten (SVC2-MIN-13 raised the floor). A short token is rejected there with
    // `auth_required`, and the test would then be measuring that gate instead of the handler's
    // authorization — reporting a pass whatever the handler does. Measured: both a bare
    // 'Bearer tok' and a 10-char payload produce exactly that false reading.
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

const MEMBER = { agentId: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', governanceTitle: 'member', teamId: null }
const OWNER = { agentId: undefined, governanceTitle: undefined, teamId: null }

describe('TRDD-OYNUJRSB — session rename is owner-only (headless mode)', () => {
  beforeEach(() => {
    mockAuthenticateAgent.mockReset()
    mockBuildAuthContext.mockReset()
    mockRename.mockReset()
    mockRename.mockResolvedValue({ status: 200, data: { success: true } })
  })

  it('refuses a MEMBER renaming another agent\'s session, and names the REASON', async () => {
    /** Validates the headless twin authorizes rather than merely authenticating */
    mockAuthenticateAgent.mockReturnValue(MEMBER)
    mockBuildAuthContext.mockReturnValue({ isSystemOwner: false, agentId: MEMBER.agentId })
    const { createHeadlessRouter } = await import('../../services/headless-router')
    const { req, res, out } = drive({ name: 'hijacked' })

    await createHeadlessRouter().handle(req, res)

    expect(out.status).toBe(403)
    // The reason, not merely a non-200: this handler's own body validation can produce other
    // failures, so a status-only assertion could pass with the gate deleted.
    expect(out.body).toMatch(/system owner only/i)
    expect(mockRename).not.toHaveBeenCalled()
  })

  it('POSITIVE CONTROL — the system owner still renames', async () => {
    /** Validates the gate can say yes, so the refusal above is a decision and not a blanket 403 */
    mockAuthenticateAgent.mockReturnValue(OWNER)
    mockBuildAuthContext.mockReturnValue({ isSystemOwner: true, agentId: undefined })
    const { createHeadlessRouter } = await import('../../services/headless-router')
    const { req, res, out } = drive({ name: 'renamed-by-owner' })

    await createHeadlessRouter().handle(req, res)

    expect(out.status).toBe(200)
    expect(mockRename).toHaveBeenCalledWith('victim-agent', 'renamed-by-owner')
  })
})
