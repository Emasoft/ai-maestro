import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * TRDD-BZW1QAZ5 — the full-mode metadata route maps a failed ChangeMetadata result refusal-first:
 * `denied` -> 403 even when the reason text says "not found", then /not found/i -> 404, else 400.
 * The service, the registry and auth are doubled so nothing touches the developer's real state.
 */
const m = vi.hoisted(() => ({ changeMetadata: vi.fn() as import('vitest').Mock<(...a: any[]) => any> }))

vi.mock('@/services/element-management-service', () => ({
  ChangeMetadata: (...a: unknown[]) => m.changeMetadata(...a),
}))
vi.mock('@/lib/agent-registry', () => ({ getAgent: vi.fn(() => null) }))
vi.mock('@/lib/agent-auth', () => ({
  authenticateFromRequest: () => ({}),
  buildAuthContext: () => ({ isSystemOwner: true }),
}))

const ID = '33333333-3333-4333-8333-333333333333'
const DENIED = { success: false, operations: [], error: 'target agent not found in the registry', denied: true }
const NOT_FOUND = { success: false, operations: [], error: 'Agent x not found' }
const INVALID = { success: false, operations: [], error: 'Metadata must be a plain object' }

async function call(method: 'PATCH' | 'DELETE', result: unknown) {
  m.changeMetadata.mockResolvedValue(result)
  const { NextRequest } = await import('next/server')
  const route = await import('../../app/api/agents/[id]/metadata/route')
  const req = new NextRequest(`http://localhost/api/agents/${ID}/metadata`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(method === 'PATCH' ? { body: JSON.stringify({ a: 1 }) } : {}),
  })
  const res = await route[method](req, { params: Promise.resolve({ id: ID }) })
  const error = ((await res.json()) as { error?: string }).error
  return { status: res.status, error }
}

beforeEach(() => {
  m.changeMetadata.mockReset()
})

describe.each(['PATCH', 'DELETE'] as const)('metadata route %s maps a failed result refusal-first', (method) => {
  it('a denied result whose text says "not found" answers 403', async () => {
    expect(await call(method, DENIED)).toEqual({ status: 403, error: DENIED.error })
  })
  it('a non-denied "not found" result answers 404', async () => {
    expect(await call(method, NOT_FOUND)).toEqual({ status: 404, error: NOT_FOUND.error })
  })
  it('any other non-denied failure answers 400', async () => {
    expect(await call(method, INVALID)).toEqual({ status: 400, error: INVALID.error })
  })
})
