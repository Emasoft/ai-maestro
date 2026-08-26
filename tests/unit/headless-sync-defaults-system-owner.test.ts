import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import { Readable } from 'stream'

/**
 * TRDD-DQVPODKW item 10, headless half — the sync-defaults headless handler is
 * system-owner only, judged by `buildAuthContext(auth).isSystemOwner` and NOT by
 * the bare `!auth.agentId` proxy.
 *
 * WHY THIS FILE EXISTS: the Next-route suite mocks `authenticateFromRequest`,
 * which the headless handler never calls (it calls `authenticateAgent`
 * directly), and the UNGUARDED_LEDGER detects guards by SOURCE SCAN — so before
 * this file, deleting the headless gate reddened ZERO tests (ledger text
 * standing in for behavior; the adversarial review named it the weakest link).
 * This drives the REAL `createHeadlessRouter().handle()`.
 *
 * Per the auth-mirror suite's header warning: since TRDD-8Q5EVGV1 the router
 * validates the credential at the blanket gate BEFORE dispatch, so
 * `authenticateFromRequestAsync` must be mocked to succeed or every case 401s
 * before the handler runs. `authenticateAgent` (the handler's own seam) is
 * mocked with the same identity; `buildAuthContext` stays REAL — its
 * isSystemOwner derivation is the behavior under test.
 */

const mockAuthAsync = vi.fn()
const mockAuthSync = vi.fn()
vi.mock('@/lib/agent-auth', async (orig) => {
  const actual = await orig<typeof import('@/lib/agent-auth')>()
  return {
    ...actual,
    authenticateFromRequestAsync: (...a: unknown[]) => mockAuthAsync(...a),
    authenticateAgent: (...a: unknown[]) => mockAuthSync(...a),
  }
})

const mockSync = vi.fn()
vi.mock('@/services/role-plugin-service', async (orig) => {
  const actual = await orig<typeof import('@/services/role-plugin-service')>()
  return { ...actual, syncDefaultRolePlugins: (...a: unknown[]) => mockSync(...a) }
})

function makeReq(method: string, url: string, headers: Record<string, string> = {}) {
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v
  const req = Readable.from([]) as never as { method: string; url: string; headers: Record<string, string> }
  req.method = method
  req.url = url
  req.headers = lower
  return req as never
}

function makeRes() {
  const res: any = new EventEmitter()
  res.headersSent = false
  res.statusCode = 0
  res._chunks = []
  res.setHeader = () => {}
  res.writeHead = (status: number) => { res.statusCode = status; res.headersSent = true; return res }
  res.write = (c: any) => { res._chunks.push(Buffer.from(c)); return true }
  res.end = (c?: any) => { if (c) res._chunks.push(Buffer.from(c)); res.finished = true }
  res.bodyJson = () => { try { return JSON.parse(Buffer.concat(res._chunks).toString('utf-8')) } catch { return null } }
  return res
}

const BEARER = { authorization: 'Bearer aim_tk_AAAAAAAAAAAAAAAAAAAAAAAA' }
const MEMBER = { agentId: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', governanceTitle: 'member', teamId: null }
// System owner under BOTH authority models (legacy: !agentId; R36/R37: maestro title)
const WEB_OWNER = { userId: 'user-1', userTitle: 'maestro' }

describe('TRDD-DQVPODKW — headless sync-defaults is system-owner only (behavioral)', () => {
  beforeEach(() => {
    mockAuthAsync.mockReset()
    mockAuthSync.mockReset()
    mockSync.mockReset()
    mockSync.mockResolvedValue({ synced: [], skipped: [], errors: [], available: [] })
  })

  it('refuses an authenticated AGENT with 403 and never runs the service', async () => {
    /** Validates the headless twin's gate behaviorally — before this file, deleting it reddened nothing */
    mockAuthAsync.mockResolvedValue(MEMBER)
    mockAuthSync.mockReturnValue(MEMBER)
    const { createHeadlessRouter } = await import('@/services/headless-router')
    const res = makeRes()
    await createHeadlessRouter().handle(makeReq('POST', '/api/agents/role-plugins/sync-defaults', BEARER), res)

    expect(res.statusCode).toBe(403)
    expect(String(res.bodyJson()?.error)).toMatch(/system owner only/i)
    expect(mockSync).not.toHaveBeenCalled()
  })

  it('POSITIVE CONTROL — the maestro web session passes the gate and the service runs', async () => {
    /** Validates the gate can say yes under the real buildAuthContext, so the denial is a decision */
    mockAuthAsync.mockResolvedValue(WEB_OWNER)
    mockAuthSync.mockReturnValue(WEB_OWNER)
    const { createHeadlessRouter } = await import('@/services/headless-router')
    const res = makeRes()
    await createHeadlessRouter().handle(makeReq('POST', '/api/agents/role-plugins/sync-defaults', BEARER), res)

    expect(res.statusCode).toBe(200)
    expect(mockSync).toHaveBeenCalled()
  })
})

/**
 * NEUTER RUN (2026-08-26 — OBSERVED via scripts/dev/neuter, restore verified by blob hash):
 *   s/if \(!buildAuthContext\(auth\)\.isSystemOwner\)/if (false)/   [headless-router.ts]
 *   → 1 red / 1 green, exactly as predicted:
 *       RED: refuses an authenticated AGENT with 403 and never runs the service
 *       green: the positive control (a deleted gate refuses nobody)
 *   HONEST LIMIT — now OBSERVED, not merely asserted (2026-08-26, second neuter run):
 *   s/if \(!buildAuthContext\(auth\)\.isSystemOwner\)/if (auth.agentId)/
 *   → 0 red / 2 green. Reverting the gate to the old bare-agentId proxy reddens NOTHING —
 *   this suite pins the gate's EXISTENCE only, not the buildAuthContext-vs-bare-agentId
 *   semantics: the MEMBER fixture has an agentId and the owner fixture does not, so both
 *   forms agree on these two callers. The case that separates them (a logged-in non-maestro
 *   web user under the R36/R37 model) needs the model ON, which buildAuthContext reads from
 *   real governance state; pinning it requires mocking isUserAuthorityModelEnabled — that
 *   gap rides with the router-wide class fix (TRDD-DQVPODKW card / TRDD-R268J32X).
 */
