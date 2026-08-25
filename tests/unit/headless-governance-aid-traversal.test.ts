/**
 * Headless-router AID-path TRAVERSAL pins (TRDD-IBKR7F74).
 *
 * The auth-mirror suite proves the REJECTION paths (credential-less and forged
 * tokens die before the handler). Nothing there can prove that a VALID agent
 * token actually traverses the new password-optional branches into the service
 * — the review fork named that gap as this change's weakest link. This file
 * pins the traversal: `@/lib/agent-auth` is mocked to succeed (the documented
 * seam for valid-path tests, per the mirror suite's own header) and the
 * cross-host governance service is spied, so each test asserts WHICH arguments
 * crossed the boundary — `password === null` (approve/reject) and
 * `opts.aidVerifiedRequester` (submit).
 *
 * DELIBERATELY A SEPARATE FILE: adding these mocks to the mirror suite would
 * arm every rejection test there at once (the shared-fixture arming-mock trap).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import { Readable } from 'stream'

const AGENT_UUID = '11111111-1111-4111-8111-111111111111'
const REQ_UUID = '00000000-0000-4000-8000-000000000000'
// Shape-valid so the router's structural credential gate passes; identity comes
// from the agent-auth mock below, not from this string being a real token.
const BEARER = 'Bearer aim_tk_AAAAAAAAAAAAAAAAAAAAAAAA'

const mockApprove = vi.fn()
const mockReject = vi.fn()
const mockSubmit = vi.fn()
vi.mock('@/services/cross-host-governance-service', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  approveCrossHostRequest: (...a: unknown[]) => mockApprove(...a),
  rejectCrossHostRequest: (...a: unknown[]) => mockReject(...a),
  submitCrossHostRequest: (...a: unknown[]) => mockSubmit(...a),
}))

vi.mock('@/lib/agent-auth', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  // Both layers: the router's SEMANTIC gate validates via the async variant
  // before any handler runs; the handlers themselves use the sync one.
  authenticateAgent: () => ({ agentId: AGENT_UUID }),
  authenticateFromRequestAsync: async () => ({ authenticated: true, agentId: AGENT_UUID }),
}))

import { createHeadlessRouter } from '@/services/headless-router'

function makeReq(method: string, url: string, headers: Record<string, string>, body = '') {
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v
  const req = Readable.from(body ? [Buffer.from(body)] : []) as never as {
    method: string; url: string; headers: Record<string, string>
  }
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

const router = createHeadlessRouter()

async function call(method: string, url: string, body?: object) {
  const res = makeRes()
  const payload = body === undefined ? '' : JSON.stringify(body)
  await router.handle(
    makeReq(method, url, { Authorization: BEARER, 'Content-Type': 'application/json' }, payload),
    res,
  )
  return res
}

beforeEach(() => {
  vi.clearAllMocks()
  mockApprove.mockResolvedValue({ data: { id: REQ_UUID }, status: 200 })
  mockReject.mockResolvedValue({ data: { id: REQ_UUID }, status: 200 })
  mockSubmit.mockResolvedValue({ data: { id: REQ_UUID }, status: 201 })
})

describe('headless AID-path traversal (valid agent token, no password)', () => {
  it('approve with NO password reaches the service with password === null and the authed agent id', async () => {
    /** The branch under review: !body.password + auth.agentId must produce the AID call, not a 400 */
    const res = await call('POST', `/api/v1/governance/requests/${REQ_UUID}/approve`, {})
    expect(res.statusCode).toBe(200)
    expect(mockApprove).toHaveBeenCalledWith(REQ_UUID, AGENT_UUID, null)
  })

  it('approve WITH a password keeps the password path (string crosses the boundary)', async () => {
    /** Positive control the other direction: a supplied password must NOT be nulled */
    await call('POST', `/api/v1/governance/requests/${REQ_UUID}/approve`, { password: 'pw' })
    expect(mockApprove).toHaveBeenCalledWith(REQ_UUID, AGENT_UUID, 'pw')
  })

  it('reject with NO password reaches the service with password === null', async () => {
    const res = await call('POST', `/api/v1/governance/requests/${REQ_UUID}/reject`, { reason: 'withdrawing' })
    expect(res.statusCode).toBe(200)
    expect(mockReject).toHaveBeenCalledWith(REQ_UUID, AGENT_UUID, null, 'withdrawing')
  })

  it('submit with NO password vouches via opts and FORCES requestedBy to the authed agent', async () => {
    /** The IDOR double-lock at the transport: body-asserted requestedBy must be overwritten */
    const res = await call('POST', '/api/v1/governance/requests', {
      type: 'add-to-team',
      targetHostId: 'host-remote',
      requestedBy: 'someone-else',
      requestedByRole: 'manager',
      payload: { agentId: AGENT_UUID },
    })
    expect(res.statusCode).toBe(201)
    expect(mockSubmit).toHaveBeenCalledTimes(1)
    const [params, opts] = mockSubmit.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>]
    expect(params.requestedBy).toBe(AGENT_UUID)
    expect(opts).toEqual({ aidVerifiedRequester: AGENT_UUID })
  })

  it('submit WITH a password stays on the raw passthrough (no opts vouching)', async () => {
    /** The password path must never gain the vouching a body cannot legitimately carry */
    await call('POST', '/api/v1/governance/requests', {
      type: 'add-to-team',
      password: 'pw',
      targetHostId: 'host-remote',
      requestedBy: 'manager-agent',
      requestedByRole: 'manager',
      payload: { agentId: AGENT_UUID },
    })
    const args = mockSubmit.mock.calls[0] as unknown[]
    expect(args.length).toBe(1)
  })
})
