/**
 * Regression test for the kanban field-drop (TRDD-903b7a20 fix-queue #9, the
 * `trdd-verify-implemented` finding): the Next.js POST /api/teams/[id]/tasks
 * route VALIDATED the TRDD-v2 task fields (severity / effort / parentTask / npt
 * / eht / supersedes / relevantRules / releaseVia) but never spread them into
 * the params passed to createTeamTask — so a kanban task created in FULL
 * (Next.js) mode silently lost them, even though the headless-router mirror
 * (services/headless-router.ts:2099-2106) forwarded them correctly and the
 * whole downstream chain (CreateTaskParams -> createTeamTask ->
 * ghProject.createTask trddMetadataLabels) already supported them. Pure
 * Next-route-vs-headless drift. This test asserts the Next route now forwards
 * the 8 end-to-end-supported fields, matching headless.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockCreateTeamTask } = vi.hoisted(() => ({ mockCreateTeamTask: vi.fn() }))

vi.mock('@/services/teams-service', () => ({
  createTeamTask: mockCreateTeamTask,
  listTeamTasks: vi.fn(),
}))
vi.mock('@/lib/agent-auth', () => ({
  authenticateFromRequest: vi.fn(() => ({ agentId: '11111111-1111-4111-8111-111111111111' })),
  buildAuthContext: vi.fn(() => ({ isSystemOwner: true })),
}))

import { POST as tasksPOST } from '@/app/api/teams/[id]/tasks/route'

const TEAM_ID = '22222222-2222-4222-8222-222222222222'
const REF = '33333333-3333-4333-8333-333333333333'

function makeReq(body: Record<string, unknown>) {
  return new Request(`http://localhost/api/teams/${TEAM_ID}/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCreateTeamTask.mockResolvedValue({ data: { task: { id: 'new' } }, status: 201 })
})

describe('POST /api/teams/[id]/tasks — forwards TRDD-v2 fields (kanban field-drop regression)', () => {
  it('spreads all 8 end-to-end TRDD-v2 fields into createTeamTask params', async () => {
    const req = makeReq({
      subject: 'kanban task',
      severity: 'HIGH',
      effort: 'L',
      parentTask: REF,
      npt: [REF],
      eht: [REF],
      supersedes: [REF],
      relevantRules: ['7', '27'],
      releaseVia: 'publish',
    })
    const res = await tasksPOST(req as never, { params: Promise.resolve({ id: TEAM_ID }) } as never)
    expect(res.status).toBe(201)
    expect(mockCreateTeamTask).toHaveBeenCalledTimes(1)
    const [calledTeamId, params] = mockCreateTeamTask.mock.calls[0]
    expect(calledTeamId).toBe(TEAM_ID)
    expect(params).toMatchObject({
      subject: 'kanban task',
      severity: 'HIGH',
      effort: 'L',
      parentTask: REF,
      npt: [REF],
      eht: [REF],
      supersedes: [REF],
      relevantRules: ['7', '27'],
      releaseVia: 'publish',
    })
  })

  it('omits TRDD-v2 fields that were not provided (no undefined injection)', async () => {
    const req = makeReq({ subject: 'minimal task' })
    const res = await tasksPOST(req as never, { params: Promise.resolve({ id: TEAM_ID }) } as never)
    expect(res.status).toBe(201)
    const [, params] = mockCreateTeamTask.mock.calls[0]
    expect(params).not.toHaveProperty('severity')
    expect(params).not.toHaveProperty('npt')
    expect(params.subject).toBe('minimal task')
  })
})
