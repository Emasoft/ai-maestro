/**
 * SECURITY REGRESSION — GET /api/agents/[id]/subconscious made NO auth call, and
 * reading it STARTED (and, at the time, evicted) live agents.
 *
 * `getSubconsciousStatus` called `agentRegistry.getAgent(agentId)`. That function
 * never returns null: it CONSTRUCTS an in-memory `Agent`, runs `initialize()`
 * (cerebellum + subconscious + voice subsystems, then `start()`), and — until the
 * cap was removed in TRDD-QC8R79G5 — called `evictIfNeeded()` BEFORE doing so.
 * So a caller sweeping arbitrary UUIDs evicted
 * real agents from the registry, one per request. That — not the route's name —
 * is the primitive it reached.
 *
 * Three consequences, all previously believed otherwise:
 *
 *  1. The service's `if (!agent) return 404` was DEAD CODE. `getAgent` always
 *     resolves an Agent, for any id, registered or not.
 *  2. `exists: true` / `initialized: true` were hardcoded, and could not have been
 *     anything else: the construct made them true on the way to reading them. The
 *     endpoint that REPORTS whether a subconscious runs was what STARTED it, and
 *     `AgentSubconsciousIndicator` polls it every 30s for the viewed agent.
 *  3. `POST /api/agents/[id]/subconscious` is GONE. `triggerSubconsciousAction`
 *     returned `Unknown action` — 400 — for every possible input once
 *     TRDD-70a521d9 deleted the RAG subsystem, and had zero callers. It sat on
 *     the dangerous-primitive debt ledger described as "drives another agent's
 *     background process": a description read off its name. The right AuthAction
 *     for a dead endpoint is no endpoint.
 *
 * The service now asks the two questions separately: the FILE registry answers
 * "does this agent exist" (source of truth, loaded or not), and `getExistingAgent`
 * — Map.get + LRU touch — answers "is it loaded". Neither constructs. The 404 is
 * live for the first time, and `initialized` reports a fact.
 *
 * An agent may read its own status; the system owner (the dashboard indicator,
 * the only caller) may read any. No new AuthAction — same ownership rule as the
 * mailbox routes, for the same reason: this is per-object state, not a
 * title-graph capability.
 *
 * FALSIFIED per layer, because two guards returning the same 403 cover for each
 * other and a suite driving only the HTTP surface cannot tell them apart:
 * disable the route guard → the route-layer test fails; disable the service
 * guard → the service-layer and direct-call tests fail.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockRouteAuth, mockRegistry, mockAgentRegistry } = vi.hoisted(() => ({
  mockRouteAuth: { requireAuth: vi.fn(), enforceAuth: vi.fn() },
  // Both accessors are mocked so a regression to the constructing one is VISIBLE
  // as a call, rather than silently passing through an un-mocked import.
  mockRegistry: { agentRegistry: { getAgent: vi.fn(), getExistingAgent: vi.fn() } },
  mockAgentRegistry: { getAgent: vi.fn() },
}))

vi.mock('@/lib/route-auth', () => mockRouteAuth)
vi.mock('@/lib/agent', () => mockRegistry)
vi.mock('@/lib/agent-registry', () => mockAgentRegistry)
vi.mock('@/lib/validation', () => ({ isValidUuid: () => true }))
// The service is REAL — it carries the defence-in-depth half of the guard.

import * as subconsciousRoute from '@/app/api/agents/[id]/subconscious/route'
import { getSubconsciousStatus } from '@/services/agents-subconscious-service'
import { NextRequest } from 'next/server'

const MEMBER = 'agent-member-1'
const MANAGER = 'agent-manager-1'
const TARGET = 'agent-target-1'

function asAgent(agentId?: string) {
  mockRouteAuth.requireAuth.mockReturnValue({
    ok: true,
    agentId,
    context: { agentId, isSystemOwner: !agentId },
  })
}

const get = (id: string) =>
  subconsciousRoute.GET(
    new NextRequest(new URL(`http://localhost:23000/api/agents/${id}/subconscious`)),
    { params: { id } as never },
  )

/**
 * A denial that still looked the agent up leaks existence; one that constructed it
 * evicted a live agent. Neither registry may be touched on a refusal.
 */
function registryUntouched() {
  expect(mockRegistry.agentRegistry.getExistingAgent).not.toHaveBeenCalled()
  expect(mockAgentRegistry.getAgent).not.toHaveBeenCalled()
  expect(mockRegistry.agentRegistry.getAgent).not.toHaveBeenCalled()
}

/** The construct-and-evict primitive must be unreachable from this service, always. */
function neverConstructed() {
  expect(mockRegistry.agentRegistry.getAgent).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAgentRegistry.getAgent.mockReturnValue({ id: TARGET, name: 'target' })
  mockRegistry.agentRegistry.getExistingAgent.mockReturnValue({
    getSubconscious: () => ({ getStatus: () => ({ isRunning: true }) }),
  })
})

describe('the POST verb no longer exists', () => {
  it('the route module exports no POST handler', () => {
    // `triggerSubconsciousAction` could not succeed for any input, had no
    // callers, and its presence is what put this route on the debt ledger.
    expect('POST' in subconsciousRoute).toBe(false)
    expect(subconsciousRoute).toHaveProperty('GET')
  })

  it('the service no longer exports triggerSubconsciousAction', async () => {
    const svc = await import('@/services/agents-subconscious-service')
    expect('triggerSubconsciousAction' in svc).toBe(false)
  })
})

describe('an agent may read only its own subconscious status', () => {
  it('reading another agent is 403 and never constructs/evicts an Agent', async () => {
    asAgent(MEMBER)
    expect((await get(TARGET)).status).toBe(403)
    registryUntouched()
  })

  it('MANAGER is not exempt — this is per-object state, not a title capability', async () => {
    asAgent(MANAGER)
    expect((await get(TARGET)).status).toBe(403)
    registryUntouched()
  })

  it('an agent reading its OWN status succeeds', async () => {
    asAgent(MEMBER)
    expect((await get(MEMBER)).status).toBe(200)
    expect(mockRegistry.agentRegistry.getExistingAgent).toHaveBeenCalledWith(MEMBER)
    neverConstructed()
  })

  it('the system owner (dashboard) may read any agent', async () => {
    asAgent(undefined)
    expect((await get(TARGET)).status).toBe(200)
    expect(mockRegistry.agentRegistry.getExistingAgent).toHaveBeenCalledWith(TARGET)
    neverConstructed()
  })

  it('an unauthenticated request never reaches the registry', async () => {
    mockRouteAuth.requireAuth.mockReturnValue({
      ok: false,
      error: new Response(null, { status: 401 }),
    })
    const res = await get(TARGET)
    expect(res.status).toBe(401)
    registryUntouched()
  })
})

describe('layer isolation — each guard refuses on its own (fault injection)', () => {
  /** Inconsistent contexts, unreachable in production, so exactly one guard can fire. */
  function withSplitIdentity(routeAgentId: string | undefined, ctx: Record<string, unknown>) {
    mockRouteAuth.requireAuth.mockReturnValue({ ok: true, agentId: routeAgentId, context: ctx })
  }

  it('the ROUTE guard alone refuses when the service guard is disarmed', async () => {
    withSplitIdentity(MEMBER, { agentId: MEMBER, isSystemOwner: true })
    expect((await get(TARGET)).status).toBe(403)
    registryUntouched()
  })

  it('the SERVICE guard alone refuses when the route guard is disarmed', async () => {
    withSplitIdentity(undefined, { agentId: MEMBER, isSystemOwner: false })
    expect((await get(TARGET)).status).toBe(403)
    registryUntouched()
  })
})

describe('defence-in-depth: the SERVICE refuses even if a route forgets', () => {
  it('a foreign agentId is 403 and constructs nothing', async () => {
    const result = await getSubconsciousStatus(TARGET, { agentId: MEMBER, isSystemOwner: false })
    expect(result.status).toBe(403)
    registryUntouched()
  })

  it('an authenticated caller with no resolvable identity owns no agent', async () => {
    const result = await getSubconsciousStatus(TARGET, { isSystemOwner: false })
    expect(result.status).toBe(403)
    registryUntouched()
  })

  it('no authContext = internal caller; the route guard is authoritative', async () => {
    const result = await getSubconsciousStatus(TARGET)
    expect(result.status).toBe(200)
    expect(mockRegistry.agentRegistry.getExistingAgent).toHaveBeenCalledWith(TARGET)
    neverConstructed()
  })
})

describe('reading never loads: the construct-and-evict primitive is gone', () => {
  it('an authorized read uses getExistingAgent, never getAgent', async () => {
    const result = await getSubconsciousStatus(TARGET)
    expect(result.status).toBe(200)
    neverConstructed()
  })

  it('an agent absent from the FILE registry is a live 404, not a fabricated Agent', async () => {
    // Before the fix this returned 200: `getAgent` resolved an Agent for any id,
    // so the `if (!agent) return 404` branch could never be taken.
    mockAgentRegistry.getAgent.mockReturnValue(null)
    const result = await getSubconsciousStatus('no-such-agent')
    expect(result.status).toBe(404)
    expect(mockRegistry.agentRegistry.getExistingAgent).not.toHaveBeenCalled()
    neverConstructed()
  })

  it('a registered agent that is NOT loaded reports initialized:false, not a lie', async () => {
    mockRegistry.agentRegistry.getExistingAgent.mockReturnValue(undefined)
    const result = await getSubconsciousStatus(TARGET)
    expect(result.status).toBe(200)
    expect(result.data).toMatchObject({ exists: true, initialized: false, isRunning: false, status: null })
    neverConstructed()
  })

  it('a loaded agent reports initialized:true and its real isRunning', async () => {
    const result = await getSubconsciousStatus(TARGET)
    expect(result.data).toMatchObject({ exists: true, initialized: true, isRunning: true })
  })

  it('a loaded agent whose subconscious is absent still reports initialized:true', async () => {
    // `initialized` is about the Agent being in memory, not about its subsystems.
    mockRegistry.agentRegistry.getExistingAgent.mockReturnValue({ getSubconscious: () => null })
    const result = await getSubconsciousStatus(TARGET)
    expect(result.data).toMatchObject({ exists: true, initialized: true, isRunning: false, status: null })
  })
})
