/**
 * SECURITY REGRESSION — PATCH /api/agents/[id]/metrics validated NONE of its
 * three inputs: not WHO the caller was, not WHICH field they wrote, not WHAT
 * value they wrote.
 *
 *  1. WHO. The route called `enforceAuth`, which authenticates and DISCARDS the
 *     identity, so the path `id` alone selected the target. Any agent token
 *     rewrote any agent's metrics.
 *  2. WHICH FIELD. The `increment` branch returned before the whitelist below it
 *     was ever consulted, so `metric` reached `incrementAgentMetric` as an
 *     arbitrary key — precisely the "arbitrary key injection" the whitelist's own
 *     comment claimed to prevent. And the whitelist was itself wrong: five of its
 *     six names (totalConversations, totalTokens, lastActiveAt, sessionsCreated,
 *     commandsExecuted) are not fields of UpdateAgentMetricsRequest, so a full
 *     update of a REAL field filtered to `{}` and returned 200 unchanged.
 *  3. WHAT VALUE. `amount` was unvalidated. `incrementAgentMetric` does
 *     `existing + amount`, so `amount: "abc"` stores the STRING "0abc" into e.g.
 *     estimatedCost — which AgentProfile renders with `.toFixed(2)`. A string has
 *     no .toFixed. One PATCH left the target agent's profile tab permanently
 *     un-renderable, which is why "low blast radius; data integrity only" was the
 *     wrong severity call.
 *
 * WHY OWNERSHIP AND NOT `modify-agent`. Metrics are counters an agent reports
 * about ITSELF. `modify-agent` is absent from `SELF_DRIVE_ACTIONS`
 * (TRDD-D3RP7KQZ), so the universal self-target ban would deny an agent updating
 * its own metrics — the only caller the endpoint is for. Same inversion that
 * `element-inventory` would have shipped. MANAGER gets no exemption: a metric is
 * owned, not governed.
 *
 * UNFINISHED, NOT DEAD. Nothing calls this endpoint yet — but the reader half is
 * live: AgentProfile.tsx and zoom/AgentProfileTab.tsx render all eight metrics.
 * So it is authorized rather than deleted, unlike `triggerSubconsciousAction`.
 *
 * THE DENIAL ASSERTION IS THAT NOTHING IS WRITTEN. The two registry writers are
 * mocked and must never be called on a refusal — a 403 returned after the write
 * landed is not a refusal.
 *
 * FALSIFIED per layer (two guards that both yield 403 cover for each other, so a
 * suite driving only HTTP keeps passing as they are deleted one at a time):
 * route guard off → the route-layer test fails; service guard off → the
 * service-layer and direct-call tests fail.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockRouteAuth, mockRegistry } = vi.hoisted(() => ({
  mockRouteAuth: { requireAuth: vi.fn(), enforceAuth: vi.fn() },
  mockRegistry: {
    getAgent: vi.fn(),
    incrementAgentMetric: vi.fn(),
    updateAgentMetrics: vi.fn(),
  },
}))

vi.mock('@/lib/route-auth', () => mockRouteAuth)
vi.mock('@/lib/agent-registry', () => mockRegistry)
// The metrics service is REAL — it carries the defence-in-depth half.

import { GET, PATCH } from '@/app/api/agents/[id]/metrics/route'
import { updateMetrics } from '@/services/agents-metrics-service'
import { NextRequest } from 'next/server'

// Real UUIDs: the route runs isValidUuid BEFORE the ownership check.
const MEMBER = '11111111-1111-1111-1111-111111111111'
const MANAGER = '22222222-2222-2222-2222-222222222222'
const TARGET = '33333333-3333-3333-3333-333333333333'

/** The eight metrics AgentProfile.tsx and zoom/AgentProfileTab.tsx render. */
const UI_RENDERED_FIELDS = [
  'totalSessions', 'totalMessages', 'totalTasksCompleted', 'uptimeHours',
  'averageResponseTime', 'totalApiCalls', 'totalTokensUsed', 'estimatedCost',
] as const

/** The names the old whitelist allowed. Five of the six never existed. */
const PHANTOM_FIELDS = [
  'totalConversations', 'totalTokens', 'lastActiveAt', 'sessionsCreated', 'commandsExecuted',
] as const

function asAgent(agentId?: string) {
  mockRouteAuth.requireAuth.mockReturnValue({
    ok: true,
    agentId,
    context: { agentId, isSystemOwner: !agentId },
  })
}

const patch = (id: string, body: unknown) =>
  PATCH(
    new NextRequest(new URL(`http://localhost:23000/api/agents/${id}/metrics`), {
      method: 'PATCH',
      body: JSON.stringify(body),
    } as never),
    { params: Promise.resolve({ id }) },
  )

const get = (id: string) =>
  GET(
    new NextRequest(new URL(`http://localhost:23000/api/agents/${id}/metrics`)),
    { params: Promise.resolve({ id }) },
  )

/** The write primitives. A denial that still wrote is not a denial. */
function registryUntouched() {
  expect(mockRegistry.incrementAgentMetric).not.toHaveBeenCalled()
  expect(mockRegistry.updateAgentMetrics).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRegistry.getAgent.mockReturnValue({ id: MEMBER, metrics: { totalApiCalls: 1 } })
  mockRegistry.incrementAgentMetric.mockResolvedValue(true)
  mockRegistry.updateAgentMetrics.mockResolvedValue({ id: MEMBER, metrics: { totalApiCalls: 7 } })
})

describe('an agent may update only its own metrics', () => {
  const INC = { action: 'increment', metric: 'totalApiCalls' }

  it('updating another agent is 403 and writes nothing', async () => {
    asAgent(MEMBER)
    expect((await patch(TARGET, INC)).status).toBe(403)
    registryUntouched()
  })

  it('MANAGER is not exempt — a metric is owned, not governed', async () => {
    asAgent(MANAGER)
    expect((await patch(TARGET, INC)).status).toBe(403)
    registryUntouched()
  })

  it('an agent updating its OWN metrics succeeds — the case `modify-agent` would deny', async () => {
    asAgent(MEMBER)
    expect((await patch(MEMBER, { ...INC, amount: 5 })).status).toBe(200)
    expect(mockRegistry.incrementAgentMetric).toHaveBeenCalledWith(MEMBER, 'totalApiCalls', 5)
  })

  it('the system owner (web UI) may update any agent', async () => {
    asAgent(undefined)
    expect((await patch(TARGET, INC)).status).toBe(200)
    expect(mockRegistry.incrementAgentMetric).toHaveBeenCalledWith(TARGET, 'totalApiCalls', 1)
  })

  it('an unauthenticated request never reaches the registry', async () => {
    mockRouteAuth.requireAuth.mockReturnValue({ ok: false, error: new Response(null, { status: 401 }) })
    expect((await patch(TARGET, INC)).status).toBe(401)
    registryUntouched()
  })
})

describe('the GET is read-open by decision, but must verify the credential', () => {
  it('a verified caller may read another agent\'s metrics', async () => {
    // Deliberate: GET /api/agents/[id] already returns the whole record —
    // metrics included — to the same caller. An ownership gate here is theater.
    asAgent(MEMBER)
    expect((await get(TARGET)).status).toBe(200)
  })

  it('an unverified caller may not — middleware only matches the credential SHAPE', async () => {
    mockRouteAuth.requireAuth.mockReturnValue({ ok: false, error: new Response(null, { status: 401 }) })
    expect((await get(TARGET)).status).toBe(401)
    expect(mockRegistry.getAgent).not.toHaveBeenCalled()
  })
})

describe('layer isolation — each guard refuses on its own (fault injection)', () => {
  /** Inconsistent contexts, unreachable in production, so exactly one guard fires. */
  function withSplitIdentity(routeAgentId: string | undefined, ctx: Record<string, unknown>) {
    mockRouteAuth.requireAuth.mockReturnValue({ ok: true, agentId: routeAgentId, context: ctx })
  }

  const INC = { action: 'increment', metric: 'totalApiCalls' }

  it('the ROUTE guard alone refuses when the service guard is disarmed', async () => {
    withSplitIdentity(MEMBER, { agentId: MEMBER, isSystemOwner: true })
    expect((await patch(TARGET, INC)).status).toBe(403)
    registryUntouched()
  })

  it('the SERVICE guard alone refuses when the route guard is disarmed', async () => {
    withSplitIdentity(undefined, { agentId: MEMBER, isSystemOwner: false })
    expect((await patch(TARGET, INC)).status).toBe(403)
    registryUntouched()
  })
})

describe('the increment branch bypassed the whitelist that sat beneath it', () => {
  const selfCtx = { agentId: MEMBER, isSystemOwner: false }

  it('an arbitrary metric name is refused, not written into the registry', async () => {
    const res = await updateMetrics(MEMBER, { action: 'increment', metric: 'pwned' }, selfCtx)
    expect(res.status).toBe(400)
    registryUntouched()
  })

  it('`__proto__` is refused by name, not by luck', async () => {
    // incrementAgentMetric's `typeof existing === 'number'` guard happens to stop
    // it. Refuse it a layer earlier, where the reason is legible.
    const res = await updateMetrics(MEMBER, { action: 'increment', metric: '__proto__' }, selfCtx)
    expect(res.status).toBe(400)
    registryUntouched()
  })

  it('`action: increment` with no metric is refused, not silently turned into a full update', async () => {
    const res = await updateMetrics(MEMBER, { action: 'increment' }, selfCtx)
    expect(res.status).toBe(400)
    registryUntouched()
  })

  it('an unrecognized action is refused, not silently ignored', async () => {
    const res = await updateMetrics(MEMBER, { action: 'decrement', metric: 'totalApiCalls' }, selfCtx)
    expect(res.status).toBe(400)
    registryUntouched()
  })
})

describe('a metric is a number — a string amount used to brick the profile tab', () => {
  const selfCtx = { agentId: MEMBER, isSystemOwner: false }

  it.each(['abc', Infinity, NaN, null, {}])('amount %p is refused', async (amount) => {
    // `0 + "abc"` is "0abc"; AgentProfile calls estimatedCost.toFixed(2) on it.
    const res = await updateMetrics(
      MEMBER,
      { action: 'increment', metric: 'estimatedCost', amount } as never,
      selfCtx,
    )
    expect(res.status).toBe(400)
    registryUntouched()
  })

  it('amount 0 is preserved, not coerced to the default 1', async () => {
    const res = await updateMetrics(MEMBER, { action: 'increment', metric: 'totalApiCalls', amount: 0 }, selfCtx)
    expect(res.status).toBe(200)
    expect(mockRegistry.incrementAgentMetric).toHaveBeenCalledWith(MEMBER, 'totalApiCalls', 0)
  })

  it('a non-numeric value on the full-update path is refused too', async () => {
    const res = await updateMetrics(MEMBER, { totalMessages: 'abc' } as never, selfCtx)
    expect(res.status).toBe(400)
    registryUntouched()
  })
})

describe('the whitelist names fields that actually exist', () => {
  const selfCtx = { agentId: MEMBER, isSystemOwner: false }

  it.each(UI_RENDERED_FIELDS)('the profile renders %s, so a full update may write it', async (field) => {
    // Before the fix, seven of these eight filtered to {} and returned 200 with
    // the metrics unchanged — a silent no-op reporting success.
    const res = await updateMetrics(MEMBER, { [field]: 3 }, selfCtx)
    expect(res.status).toBe(200)
    expect(mockRegistry.updateAgentMetrics).toHaveBeenCalledWith(MEMBER, { [field]: 3 })
  })

  it.each(PHANTOM_FIELDS)('%s was in the old whitelist but is not a real field', async (field) => {
    const res = await updateMetrics(MEMBER, { [field]: 3 }, selfCtx)
    expect(res.status).toBe(400)
    registryUntouched()
  })

  it('an update naming no known field is refused rather than returning 200 unchanged', async () => {
    const res = await updateMetrics(MEMBER, { somethingElse: 1 }, selfCtx)
    expect(res.status).toBe(400)
    registryUntouched()
  })
})

describe('defence-in-depth: the SERVICE refuses even if a route forgets', () => {
  const INC = { action: 'increment', metric: 'totalApiCalls' }

  it('a foreign agentId is 403 and writes nothing', async () => {
    const res = await updateMetrics(TARGET, INC, { agentId: MEMBER, isSystemOwner: false })
    expect(res.status).toBe(403)
    registryUntouched()
  })

  it('an authenticated caller with no resolvable identity owns no metrics', async () => {
    const res = await updateMetrics(TARGET, INC, { isSystemOwner: false })
    expect(res.status).toBe(403)
    registryUntouched()
  })

  it('no authContext = internal caller; the route guard is authoritative', async () => {
    const res = await updateMetrics(TARGET, INC)
    expect(res.status).toBe(200)
    expect(mockRegistry.incrementAgentMetric).toHaveBeenCalledTimes(1)
  })

  it('authorization runs BEFORE the body is parsed — a foreign caller learns nothing', async () => {
    const res = await updateMetrics(TARGET, { action: 'garbage' }, { agentId: MEMBER, isSystemOwner: false })
    expect(res.status).toBe(403)
    expect(res.error).toContain('own metrics')
  })
})
