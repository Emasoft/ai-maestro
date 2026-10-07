/**
 * TRDD-A50RC5G8: DeleteAgent's soft-only refusal for an agent caller ("hard delete and folder deletion are reserved
 * to the user ...") matched none of the DELETE route's status keywords and surfaced as HTTP 500. It is a permission
 * refusal, so it must be 403. The service says so in an explicit `status` field and the route PREFERS that field to
 * matching the message text (a reworded refusal must not silently become a 500). The service is doubled; the route's
 * mapping is the thing under test. The second case feeds the same status with a message that matches no keyword, so it
 * can only pass through the field. The 500 control proves an unrecognised failure still maps to 500.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockAgentAuth, mockService } = vi.hoisted(() => ({
  mockAgentAuth: {
    authenticateFromRequest: vi.fn(() => ({ agentId: 'mgr-1', governanceTitle: 'manager' })),
    buildAuthContext: vi.fn(() => ({ agentId: 'mgr-1', isSystemOwner: false, governanceTitle: 'manager' })),
  },
  mockService: { DeleteAgent: vi.fn() },
}))

vi.mock('@/lib/agent-auth', () => mockAgentAuth)
vi.mock('@/services/element-management-service', () => mockService)
vi.mock('@/lib/sudo-guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sudo-guard')>()),
  requireSudoToken: () => null,
}))

import { DELETE } from '@/app/api/agents/[id]/route'

const ID = '123e4567-e89b-42d3-a456-426614174000'
const call = (qs: string) =>
  DELETE(new NextRequest(`http://localhost:23000/api/agents/${ID}${qs}`, { method: 'DELETE' }), { params: Promise.resolve({ id: ID }) })

beforeEach(() => mockService.DeleteAgent.mockReset())

describe('DELETE /api/agents/[id] — refusal status mapping', () => {
  it('the soft-only refusal for an agent caller with ?hard=true is 403', async () => {
    mockService.DeleteAgent.mockResolvedValue({
      success: false, operations: [],
      error: 'hard delete and folder deletion are reserved to the user (TRDD-A50RC5G8); an agent may only soft-delete',
      status: 403,
    })
    const res = await call('?hard=true')
    expect(res.status).toBe(403)
    expect(mockService.DeleteAgent.mock.calls[0][1]).toMatchObject({ hard: true })
  })

  it('the status comes from the explicit field, not from the message text', async () => {
    mockService.DeleteAgent.mockResolvedValue({ success: false, operations: [], error: 'reworded refusal', status: 403 })
    expect((await call('?hard=true')).status).toBe(403)
  })

  it('CONTROL: an unrecognised failure is still 500', async () => {
    mockService.DeleteAgent.mockResolvedValue({ success: false, operations: [], error: 'disk exploded' })
    expect((await call('')).status).toBe(500)
  })
})
