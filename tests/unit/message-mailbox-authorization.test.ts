/**
 * SECURITY REGRESSION (CRITICAL) — the agent-scoped single-message route let any
 * authenticated caller act on ANY agent's mailbox, and its POST verb sent mail
 * AS that agent.
 *
 * All four verbs of `app/api/agents/[id]/messages/[messageId]` called
 * `authenticateFromRequest` and then DISCARDED the result. The path `id` was the
 * only thing selecting the mailbox, so one valid agent token reached every
 * mailbox on the host by UUID.
 *
 * POST is the sharp one. It is not "mark read" — it is `forwardMessage`, and its
 * `agentId` becomes `forwardFromUI`'s `fromAgent`, which lands verbatim in the
 * forwarded message's `from` / `fromAlias` / `forwardedBy`, is written to THAT
 * agent's sent folder, is the identity the governance filter is evaluated
 * against, and — for a cross-host recipient — is signed with the HOST key so the
 * remote accepts it. That is sender FORGERY. Pointed back at the caller
 * (`{to: <self>}`), the same verb is an arbitrary-mailbox READ.
 *
 * The sibling `sendMessage` already carries the identical fix, commented
 * SVC2-MAJ-06: "the path-id `agentId` ... became both `from` and `senderAgentId`
 * and the caller's verified identity was never compared." Forward was missed.
 *
 * A mailbox is authorized by OWNERSHIP, not by the title matrix: no governance
 * title — not MANAGER, not the owner's own COS — reads or mutates another
 * agent's mail. That is what `listMessages` and `messages-service` already do
 * (`denyForeignMailbox`), so no new AuthAction is introduced. Inventing
 * `manage-messages` would have created two mechanisms for one capability — the
 * same split-brain the parent audit rejected for `manage-amp-address`.
 *
 * THE ASSERTION THAT MATTERS: the store is never touched. Routes and services
 * here are REAL; only the storage libs are mocked. So a denial is proved by
 * `forwardFromUI` / `deleteAgentMessage` never being called — not merely by a
 * 403 status, which a future refactor could return after the side effect.
 *
 * FALSIFIED, and the first attempt was WRONG. Disabling the ROUTE guard alone
 * left all 16 original tests green: the service guard silently covered for it,
 * so the route guard was asserted by nothing. Two layers that produce the same
 * 403 are indistinguishable from outside — a suite that only drives the HTTP
 * surface cannot tell which one is load-bearing, and would keep passing as they
 * are removed one at a time.
 *
 * The `layer isolation` block below fixes that with fault injection: each test
 * hands the route an AuthContext that DISABLES one guard, so the other is the
 * only thing left. Neither injected state is reachable in production (under the
 * user-authority model `isSystemOwner === !agentId`); they exist solely to prove
 * each layer refuses on its own. Now: disable the route guard → the route-layer
 * test fails; disable the service guard → the service-layer and direct-call
 * tests fail; disable both → nearly everything fails.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockRouteAuth,
  mockAgentAuth,
  mockStore,
  mockSend,
  mockGlobalMessages,
} = vi.hoisted(() => ({
  mockRouteAuth: { requireAuth: vi.fn(), enforceAuth: vi.fn() },
  mockAgentAuth: { authenticateFromRequest: vi.fn(), buildAuthContext: vi.fn() },
  mockStore: {
    getAgentMessage: vi.fn(),
    markAgentMessageAsRead: vi.fn(),
    archiveAgentMessage: vi.fn(),
    deleteAgentMessage: vi.fn(),
    listAgentInboxMessages: vi.fn(),
    listAgentSentMessages: vi.fn(),
    getAgentMessageStats: vi.fn(),
  },
  mockSend: { forwardFromUI: vi.fn() },
  mockGlobalMessages: { forwardMessage: vi.fn() },
}))

vi.mock('@/lib/route-auth', () => mockRouteAuth)
vi.mock('@/lib/agent-auth', () => mockAgentAuth)
vi.mock('@/lib/agent-messaging', () => mockStore)
vi.mock('@/lib/message-send', () => mockSend)
vi.mock('@/lib/validation', () => ({ isValidUuid: () => true }))
vi.mock('@/services/messages-service', () => mockGlobalMessages)
// Registry / infra reached by the REAL agents-messaging-service at import time.
vi.mock('@/lib/agent-registry', () => ({
  getAgent: vi.fn(() => ({ id: 'x', name: 'x' })),
  getAgentAMPAddresses: vi.fn(),
  addAMPAddress: vi.fn(),
  removeAMPAddress: vi.fn(),
  updateAMPAddress: vi.fn(),
  getAgentEmailAddresses: vi.fn(),
  addEmailAddress: vi.fn(),
  removeEmailAddress: vi.fn(),
  updateEmailAddress: vi.fn(),
  getEmailIndex: vi.fn(),
  findAgentByEmail: vi.fn(),
}))
vi.mock('@/lib/webhook-service', () => ({ emitEmailChanged: vi.fn() }))
vi.mock('@/lib/hosts-config', () => ({
  getHosts: vi.fn(() => []),
  getSelfHostId: vi.fn(() => 'self'),
  isSelf: vi.fn(() => true),
}))
vi.mock('@/lib/host-sync', () => ({ getPublicUrl: vi.fn(() => 'http://localhost:23000') }))
// The services are REAL — they carry the defence-in-depth half of the guard.

import { GET, PATCH, DELETE, POST } from '@/app/api/agents/[id]/messages/[messageId]/route'
import { POST as FORWARD } from '@/app/api/messages/forward/route'
import { forwardMessage as forwardMessageService } from '@/services/agents-messaging-service'
import { NextRequest } from 'next/server'

const MEMBER = 'agent-member-1'
const MANAGER = 'agent-manager-1'
const COS = 'agent-cos-1'
const TARGET = 'agent-target-1'
const MSG = 'msg-1'

/** Authenticate the agent-scoped route as `agentId`; omit for the system owner. */
function asAgent(agentId?: string) {
  const context = { agentId, isSystemOwner: !agentId }
  mockRouteAuth.requireAuth.mockReturnValue({ ok: true, agentId, context })
  mockAgentAuth.authenticateFromRequest.mockReturnValue({ agentId })
  mockAgentAuth.buildAuthContext.mockReturnValue(context)
}

const url = (id: string) => new URL(`http://localhost:23000/api/agents/${id}/messages/${MSG}`)
const params = (id: string) => ({ params: { id, messageId: MSG } as never })

const get = (id: string) => GET(new NextRequest(url(id)), params(id))
const patch = (id: string) =>
  PATCH(new NextRequest(url(id), { method: 'PATCH', body: JSON.stringify({ action: 'read' }) } as never), params(id))
const del = (id: string) => DELETE(new NextRequest(url(id), { method: 'DELETE' } as never), params(id))
const forward = (id: string, to = 'someone-else') =>
  POST(new NextRequest(url(id), { method: 'POST', body: JSON.stringify({ to }) } as never), params(id))

/** Every storage primitive this route family can reach. */
function storeUntouched() {
  expect(mockStore.getAgentMessage).not.toHaveBeenCalled()
  expect(mockStore.markAgentMessageAsRead).not.toHaveBeenCalled()
  expect(mockStore.archiveAgentMessage).not.toHaveBeenCalled()
  expect(mockStore.deleteAgentMessage).not.toHaveBeenCalled()
  expect(mockSend.forwardFromUI).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  mockStore.getAgentMessage.mockResolvedValue({ id: MSG, subject: 'secret' })
  mockStore.markAgentMessageAsRead.mockResolvedValue(true)
  mockStore.deleteAgentMessage.mockResolvedValue(true)
  mockSend.forwardFromUI.mockResolvedValue({ message: { id: 'fwd-1' }, notified: true })
  mockGlobalMessages.forwardMessage.mockResolvedValue({ data: { ok: true }, status: 200 })
})

describe('an agent may not touch another agent\'s mailbox — any verb', () => {
  it('GET another mailbox is 403 and never reads the message', async () => {
    asAgent(MEMBER)
    expect((await get(TARGET)).status).toBe(403)
    storeUntouched()
  })

  it('PATCH another mailbox is 403 and never marks it read', async () => {
    asAgent(MEMBER)
    expect((await patch(TARGET)).status).toBe(403)
    storeUntouched()
  })

  it('DELETE another mailbox is 403 and never deletes', async () => {
    asAgent(MEMBER)
    expect((await del(TARGET)).status).toBe(403)
    storeUntouched()
  })

  it('POST (forward) from another mailbox is 403 — no message is sent AS them', async () => {
    asAgent(MEMBER)
    expect((await forward(TARGET)).status).toBe(403)
    // The forgery primitive itself. A 403 with forwardFromUI already called
    // would mean the message was sent and the caller merely told "no".
    expect(mockSend.forwardFromUI).not.toHaveBeenCalled()
    storeUntouched()
  })

  it('forwarding a foreign message TO YOURSELF is refused — it was a read primitive', async () => {
    asAgent(MEMBER)
    expect((await forward(TARGET, MEMBER)).status).toBe(403)
    expect(mockSend.forwardFromUI).not.toHaveBeenCalled()
  })
})

describe('no governance title is exempt — a mailbox is owned, not governed', () => {
  it.each([
    ['MANAGER', MANAGER],
    ['CHIEF-OF-STAFF', COS],
  ])('%s is denied another agent\'s mailbox', async (_title, agentId) => {
    asAgent(agentId)
    expect((await get(TARGET)).status).toBe(403)
    expect((await del(TARGET)).status).toBe(403)
    expect((await forward(TARGET)).status).toBe(403)
    storeUntouched()
  })
})

describe('the legitimate callers still work', () => {
  it('an agent reads, marks-read, deletes and forwards from its OWN mailbox', async () => {
    asAgent(MEMBER)
    expect((await get(MEMBER)).status).toBe(200)
    expect(mockStore.getAgentMessage).toHaveBeenCalledWith(MEMBER, MSG, 'inbox')

    expect((await patch(MEMBER)).status).toBe(200)
    expect(mockStore.markAgentMessageAsRead).toHaveBeenCalledWith(MEMBER, MSG)

    expect((await del(MEMBER)).status).toBe(200)
    expect(mockStore.deleteAgentMessage).toHaveBeenCalledWith(MEMBER, MSG)

    await forward(MEMBER)
    // Self-delete and self-forward are ALLOWED, unlike the command queue's
    // cancel. Cancelling a queued command PREVENTS execution (a live control
    // plane); deleting a delivered message does not un-deliver it — the hook
    // already surfaced it, the sender keeps its own `sent/` copy that this route
    // cannot reach, and the durable record of a directive is the git-tracked
    // TRDD, not the recipient's inbox. The session-scoped twin `removeMessage`
    // already permits self-delete, so forbidding it here would only move an
    // attacker one path over.
    expect(mockSend.forwardFromUI).toHaveBeenCalledWith(
      expect.objectContaining({ fromAgent: MEMBER, originalMessageId: MSG }),
    )
  })

  it('the system owner (web UI) may act on any mailbox', async () => {
    asAgent(undefined)
    expect((await get(TARGET)).status).toBe(200)
    expect((await del(TARGET)).status).toBe(200)
    expect(mockStore.deleteAgentMessage).toHaveBeenCalledWith(TARGET, MSG)
  })
})

describe('layer isolation — each guard refuses on its own (fault injection)', () => {
  /**
   * Drive the route with a deliberately inconsistent AuthContext so that exactly
   * one of the two guards can fire. Neither state occurs in production; they are
   * the only way to tell the layers apart from the HTTP surface, because both
   * return an identical 403.
   */
  function withSplitIdentity(routeAgentId: string | undefined, ctx: Record<string, unknown>) {
    mockRouteAuth.requireAuth.mockReturnValue({ ok: true, agentId: routeAgentId, context: ctx })
  }

  it('the ROUTE guard alone refuses when the service guard is disarmed', async () => {
    // `isSystemOwner: true` makes the service's denyForeignMailbox return null,
    // so only the route's own `auth.agentId !== id` check can produce the 403.
    withSplitIdentity(MEMBER, { agentId: MEMBER, isSystemOwner: true })
    expect((await forward(TARGET)).status).toBe(403)
    expect(mockSend.forwardFromUI).not.toHaveBeenCalled()
    expect((await del(TARGET)).status).toBe(403)
    expect((await get(TARGET)).status).toBe(403)
    expect((await patch(TARGET)).status).toBe(403)
    storeUntouched()
  })

  it('the SERVICE guard alone refuses when the route guard is disarmed', async () => {
    // No `agentId` on the route result, so the route's guard is a no-op; the
    // threaded context still carries the real identity and the service refuses.
    withSplitIdentity(undefined, { agentId: MEMBER, isSystemOwner: false })
    expect((await forward(TARGET)).status).toBe(403)
    expect(mockSend.forwardFromUI).not.toHaveBeenCalled()
    expect((await del(TARGET)).status).toBe(403)
    expect((await get(TARGET)).status).toBe(403)
    storeUntouched()
  })

  it('the route threads auth.context — without it the service guard is a no-op', async () => {
    // The service treats a missing context as "internal caller, route is
    // authoritative". So dropping the `auth.context` argument at any call site
    // would silently disarm the service layer. Assert it arrives: a foreign
    // mailbox is refused even with the route guard disarmed (previous test), and
    // that can only happen if the context was passed.
    withSplitIdentity(undefined, { agentId: MEMBER, isSystemOwner: false })
    expect((await get(TARGET)).status).toBe(403)
  })
})

describe('defence-in-depth: the SERVICE refuses even if a route forgets', () => {
  it('forwardMessage() called directly with a foreign mailbox is 403, and sends nothing', async () => {
    const result = await forwardMessageService(TARGET, MSG, { to: 'x' }, {
      agentId: MEMBER,
      isSystemOwner: false,
    })
    expect(result.status).toBe(403)
    expect(mockSend.forwardFromUI).not.toHaveBeenCalled()
  })

  it('an authenticated caller with no resolvable identity owns no mailbox', async () => {
    // Fail closed: `!authContext.agentId && !isSystemOwner` must refuse rather
    // than fall through to "undefined !== TARGET is false" style comparisons.
    const result = await forwardMessageService(TARGET, MSG, { to: 'x' }, {
      isSystemOwner: false,
    })
    expect(result.status).toBe(403)
    expect(mockSend.forwardFromUI).not.toHaveBeenCalled()
  })

  it('no authContext = internal caller; the route guard is authoritative', async () => {
    // Headless/internal callers pass no context. This is the documented contract
    // of every sibling guard, asserted so a "tighten it" change is deliberate.
    await forwardMessageService(MEMBER, MSG, { to: 'x' })
    expect(mockSend.forwardFromUI).toHaveBeenCalled()
  })
})

describe('POST /api/messages/forward — the sender is the caller, not the body', () => {
  const fwdReq = (body: Record<string, unknown>) =>
    FORWARD(new NextRequest(new URL('http://localhost:23000/api/messages/forward'), {
      method: 'POST',
      body: JSON.stringify(body),
    } as never))

  it('an agent\'s claimed fromSession is overridden with its verified identity', async () => {
    asAgent(MEMBER)
    await fwdReq({ messageId: MSG, fromSession: TARGET, toSession: 'someone' })
    expect(mockGlobalMessages.forwardMessage).toHaveBeenCalledWith(
      expect.objectContaining({ fromSession: MEMBER }),
    )
  })

  it('the system owner keeps the supplied fromSession', async () => {
    asAgent(undefined)
    await fwdReq({ messageId: MSG, fromSession: TARGET, toSession: 'someone' })
    expect(mockGlobalMessages.forwardMessage).toHaveBeenCalledWith(
      expect.objectContaining({ fromSession: TARGET }),
    )
  })

  it('the authContext is threaded so the service guard is not a no-op', async () => {
    asAgent(MEMBER)
    await fwdReq({ messageId: MSG, fromSession: TARGET, toSession: 'someone' })
    expect(mockGlobalMessages.forwardMessage).toHaveBeenCalledWith(
      expect.objectContaining({ authContext: expect.objectContaining({ agentId: MEMBER }) }),
    )
  })

  it('the UI\'s own payload is no longer rejected by a check on fields the service ignores', async () => {
    // The route required `body.to` and `body.message`; the service reads neither.
    // Both Message Centers post {messageId, fromSession, toSession, forwardNote},
    // so the legitimate caller 400'd while an attacker passed by adding two
    // ignored keys. The guard checked the wrong contract entirely.
    asAgent(undefined)
    const res = await fwdReq({ messageId: MSG, fromSession: TARGET, toSession: 'someone' })
    expect(res.status).not.toBe(400)
    expect(mockGlobalMessages.forwardMessage).toHaveBeenCalled()
  })
})
