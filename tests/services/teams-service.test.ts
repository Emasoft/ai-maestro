/**
 * Teams Service Tests
 *
 * Tests the pure business logic in services/teams-service.ts.
 * Mocks all lib/ dependencies — service tests validate orchestration,
 * not filesystem I/O (which lib tests already cover).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeTeam, makeTask, makeDocument, makeAgent, resetFixtureCounter } from '../test-utils/fixtures'

// ============================================================================
// Mocks — vi.hoisted() ensures these are available when vi.mock() runs
// ============================================================================

const { mockTeams, mockGhProject, mockDocs, mockAgentRegistry, mockNotificationService, mockElementManagement, MockTeamValidationException } = vi.hoisted(() => {
  // TeamValidationException must be a real class so `instanceof` checks work in the service code
  class _MockTeamValidationException extends Error {
    code: number
    constructor(message: string, code: number) {
      super(message)
      this.name = 'TeamValidationException'
      this.code = code
    }
  }
  return {
  MockTeamValidationException: _MockTeamValidationException,
  mockTeams: {
    loadTeams: vi.fn(),
    createTeam: vi.fn(),
    getTeam: vi.fn(),
    updateTeam: vi.fn(),
    deleteTeam: vi.fn(),
    TeamValidationException: _MockTeamValidationException,
  },
  mockGhProject: {
    checkGhAuth: vi.fn(() => null),
    listTasks: vi.fn(),
    resolveTaskDeps: vi.fn(),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
  },
  mockDocs: {
    loadDocuments: vi.fn(),
    createDocument: vi.fn(),
    getDocument: vi.fn(),
    updateDocument: vi.fn(),
    deleteDocument: vi.fn(),
  },
  mockAgentRegistry: {
    getAgent: vi.fn(),
    loadAgents: vi.fn(() => []),
    updateAgent: vi.fn(),
  },
  mockNotificationService: {
    notifyAgent: vi.fn(),
  },
  // Dynamically imported by createNewTeam/updateTeamById/setTeamOrchestrator.
  // Mock so ChangeTitle resolves (the real module needs registry/auth wiring).
  mockElementManagement: {
    ChangeTitle: vi.fn(() => Promise.resolve({ success: true })),
    ChangeTeam: vi.fn(() => Promise.resolve({ success: true })),
  },
}})

vi.mock('@/lib/team-registry', () => mockTeams)
vi.mock('@/lib/github-project', () => mockGhProject)
vi.mock('@/lib/document-registry', () => mockDocs)
vi.mock('@/lib/agent-registry', () => mockAgentRegistry)
vi.mock('@/lib/notification-service', () => mockNotificationService)
vi.mock('@/services/element-management-service', () => mockElementManagement)

// Mock governance module - getManagerId returns a manager so team creation works (R9 governance requires MANAGER)
vi.mock('@/lib/governance', () => ({
  getManagerId: vi.fn(() => 'test-manager-id'),
  isManager: vi.fn(() => false),
  isChiefOfStaffAnywhere: vi.fn(() => false),
  verifyPassword: vi.fn(() => Promise.resolve(true)),
  loadGovernance: vi.fn(() => ({ passwordHash: null, managerId: 'test-manager-id' })),
}))

// Mock team-acl module - checkTeamAccess allows all access by default in service tests
vi.mock('@/lib/team-acl', () => ({
  checkTeamAccess: vi.fn(() => ({ allowed: true })),
}))

// Mock validation module - isValidUuid accepts synthetic test UUIDs
vi.mock('@/lib/validation', () => ({
  isValidUuid: vi.fn(() => true),
}))

// ============================================================================
// Import module under test (after mocks)
// ============================================================================

import {
  listAllTeams,
  createNewTeam,
  getTeamById,
  updateTeamById,
  setTeamOrchestrator,
  deleteTeamById,
  listTeamTasks,
  createTeamTask,
  updateTeamTask,
  deleteTeamTask,
  listTeamDocuments,
  createTeamDocument,
  getTeamDocument,
  updateTeamDocument,
  deleteTeamDocument,
  notifyTeamAgents,
} from '@/services/teams-service'
import { getManagerId } from '@/lib/governance'

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks()
  resetFixtureCounter()
})

// ============================================================================
// listAllTeams
// ============================================================================

describe('listAllTeams', () => {
  it('returns empty list when no teams exist', () => {
    mockTeams.loadTeams.mockReturnValue([])

    const result = listAllTeams()

    expect(result.status).toBe(200)
    expect(result.data?.teams).toEqual([])
  })

  it('returns populated list of teams', () => {
    const teams = [makeTeam({ name: 'Alpha' }), makeTeam({ name: 'Beta' })]
    mockTeams.loadTeams.mockReturnValue(teams)

    const result = listAllTeams()

    expect(result.status).toBe(200)
    expect(result.data?.teams).toHaveLength(2)
    expect(result.data?.teams[0].name).toBe('Alpha')
  })
})

// ============================================================================
// createNewTeam
// ============================================================================

describe('createNewTeam', () => {
  it('creates a team successfully', async () => {
    const team = makeTeam({ name: 'New Team' })
    mockTeams.createTeam.mockResolvedValue(team)

    const result = await createNewTeam({ name: 'New Team', agentIds: [] })

    expect(result.status).toBe(201)
    expect(result.data?.team.name).toBe('New Team')
    // createTeam now receives (data, managerId, agentNames); type is always 'closed'
    expect(mockTeams.createTeam).toHaveBeenCalledWith(
      { name: 'New Team', description: undefined, agentIds: [], type: 'closed', chiefOfStaffId: undefined },
      'test-manager-id',
      []
    )
  })

  it('creates a team with description and agentIds', async () => {
    const team = makeTeam({ name: 'Full Team', description: 'A team', agentIds: ['a1', 'a2'] })
    mockTeams.createTeam.mockResolvedValue(team)

    const result = await createNewTeam({ name: 'Full Team', description: 'A team', agentIds: ['a1', 'a2'] })

    expect(result.status).toBe(201)
    expect(mockTeams.createTeam).toHaveBeenCalledWith(
      { name: 'Full Team', description: 'A team', agentIds: ['a1', 'a2'], type: 'closed', chiefOfStaffId: undefined },
      'test-manager-id',
      []
    )
  })

  it('returns 400 when name is missing', async () => {
    const result = await createNewTeam({ name: '', agentIds: [] })

    expect(result.status).toBe(400)
    expect(result.error).toMatch(/name/i)
    expect(mockTeams.createTeam).not.toHaveBeenCalled()
  })

  it('returns 400 when name is not a string', async () => {
    const result = await createNewTeam({ name: null as any, agentIds: [] })

    expect(result.status).toBe(400)
    expect(result.error).toMatch(/name/i)
  })

  it('returns 400 when agentIds is not an array', async () => {
    const result = await createNewTeam({ name: 'Team', agentIds: 'not-array' as any })

    expect(result.status).toBe(400)
    expect(result.error).toMatch(/agentIds/i)
  })

  it('returns 500 when createTeam throws', async () => {
    mockTeams.createTeam.mockRejectedValue(new Error('disk full'))

    const result = await createNewTeam({ name: 'Fail', agentIds: [] })

    expect(result.status).toBe(500)
    expect(result.error).toBe('disk full')
  })

  it('defaults agentIds to empty array when not provided', async () => {
    const team = makeTeam({ name: 'No Agents' })
    mockTeams.createTeam.mockResolvedValue(team)

    await createNewTeam({ name: 'No Agents' })

    expect(mockTeams.createTeam).toHaveBeenCalledWith(
      { name: 'No Agents', description: undefined, agentIds: [], type: 'closed', chiefOfStaffId: undefined },
      'test-manager-id',
      []
    )
  })
})

// ============================================================================
// getTeamById
// ============================================================================

describe('getTeamById', () => {
  it('returns team when found', () => {
    const team = makeTeam({ id: 'team-123', name: 'Found' })
    mockTeams.getTeam.mockReturnValue(team)

    const result = getTeamById('team-123')

    expect(result.status).toBe(200)
    expect(result.data?.team.name).toBe('Found')
  })

  it('returns 404 when team not found', () => {
    mockTeams.getTeam.mockReturnValue(null)

    const result = getTeamById('nonexistent')

    expect(result.status).toBe(404)
    expect(result.error).toMatch(/not found/i)
  })
})

// ============================================================================
// updateTeamById
// ============================================================================

describe('updateTeamById', () => {
  it('updates team successfully', async () => {
    const team = makeTeam({ id: 'team-1', name: 'Updated' })
    mockTeams.updateTeam.mockResolvedValue(team)

    const result = await updateTeamById('team-1', { name: 'Updated' })

    expect(result.status).toBe(200)
    expect(result.data?.team.name).toBe('Updated')
  })

  it('passes all update fields', async () => {
    mockTeams.updateTeam.mockResolvedValue(makeTeam())

    await updateTeamById('team-1', {
      name: 'New Name',
      description: 'Desc',
      agentIds: ['a1'],
      lastMeetingAt: '2025-06-01T00:00:00Z',
      instructions: '# Rules',
      lastActivityAt: '2025-06-01T00:00:00Z',
    })

    // updateTeam now receives (id, updates, managerId, agentNames)
    expect(mockTeams.updateTeam).toHaveBeenCalledWith('team-1', {
      name: 'New Name',
      description: 'Desc',
      agentIds: ['a1'],
      lastMeetingAt: '2025-06-01T00:00:00Z',
      instructions: '# Rules',
      lastActivityAt: '2025-06-01T00:00:00Z',
    }, 'test-manager-id', [])
  })

  it('strips orchestratorId from the update — it is NOT forwarded to updateTeam (L2-H2 Gap 2)', async () => {
    /** The orchestrator slot is team authority; the general PUT must never set it. Like chiefOfStaffId, orchestratorId is stripped so the only path to the slot is the dedicated /orchestrator endpoint. */
    mockTeams.updateTeam.mockResolvedValue(makeTeam())

    await updateTeamById('team-1', { name: 'New Name', orchestratorId: 'attacker-self' } as any)

    // updateTeam receives name but NOT orchestratorId — confirm the field was stripped.
    const callArgs = mockTeams.updateTeam.mock.calls[0]
    expect(callArgs[0]).toBe('team-1')
    expect(callArgs[1]).toEqual({ name: 'New Name' })
    expect('orchestratorId' in (callArgs[1] as Record<string, unknown>)).toBe(false)
  })

  it('returns 404 when team not found', async () => {
    mockTeams.updateTeam.mockResolvedValue(null)

    const result = await updateTeamById('nope', { name: 'X' })

    expect(result.status).toBe(404)
  })

  it('returns 500 when updateTeam throws', async () => {
    mockTeams.updateTeam.mockRejectedValue(new Error('write error'))

    const result = await updateTeamById('team-1', { name: 'X' })

    expect(result.status).toBe(500)
    expect(result.error).toBe('write error')
  })
})

// ============================================================================
// setTeamOrchestrator (L2-H2, TRDD-f9f71e4a option b)
// ============================================================================

describe('setTeamOrchestrator', () => {
  it('returns 404 when the team does not exist', async () => {
    /** No team → no slot to set */
    mockTeams.getTeam.mockReturnValue(null)
    const result = await setTeamOrchestrator('team-1', 'a1')
    expect(result.status).toBe(404)
  })

  it('returns 400 when the team is blocked (no MANAGER on host)', async () => {
    /** R9.3 — mutations on blocked teams are rejected */
    mockTeams.getTeam.mockReturnValue(makeTeam({ id: 'team-1', blocked: true, agentIds: ['a1'] }))
    const result = await setTeamOrchestrator('team-1', 'a1')
    expect(result.status).toBe(400)
    expect(result.error).toMatch(/blocked/i)
  })

  it('rejects a non-existent agent (404)', async () => {
    /** Eligibility: the orchestrator must be a real registered agent */
    mockTeams.getTeam.mockReturnValue(makeTeam({ id: 'team-1', agentIds: ['a1'] }))
    mockAgentRegistry.loadAgents.mockReturnValue([makeAgent({ id: 'a1', name: 'member-one' })])
    const result = await setTeamOrchestrator('team-1', 'ghost-agent')
    expect(result.status).toBe(404)
    expect(result.error).toMatch(/not found/i)
  })

  it('rejects a FOREIGN agent that is not a member of this team (400)', async () => {
    /** Eligibility: the exploit the proposal flags — grafting an arbitrary agent into the team authority graph. A real agent that is NOT in agentIds is rejected. */
    mockTeams.getTeam.mockReturnValue(makeTeam({ id: 'team-1', agentIds: ['a1'] }))
    mockAgentRegistry.loadAgents.mockReturnValue([
      makeAgent({ id: 'a1', name: 'member-one' }),
      makeAgent({ id: 'foreign', name: 'outsider' }),
    ])
    const result = await setTeamOrchestrator('team-1', 'foreign')
    expect(result.status).toBe(400)
    expect(result.error).toMatch(/not a member/i)
    // The slot write must never happen for an ineligible agent.
    expect(mockTeams.updateTeam).not.toHaveBeenCalled()
    expect(mockElementManagement.ChangeTitle).not.toHaveBeenCalled()
  })

  it('sets the slot for an eligible in-team agent and applies the orchestrator title via ChangeTitle', async () => {
    /** Happy path: a real, in-team agent is seated AND titled ORCHESTRATOR through the same pipeline the create path uses */
    const team = makeTeam({ id: 'team-1', agentIds: ['a1'] })
    mockTeams.getTeam.mockReturnValue(team)
    mockAgentRegistry.loadAgents.mockReturnValue([makeAgent({ id: 'a1', name: 'member-one' })])
    mockTeams.updateTeam.mockResolvedValue({ ...team, orchestratorId: 'a1' })

    const result = await setTeamOrchestrator('team-1', 'a1', { isSystemOwner: true as const })

    expect(result.status).toBe(200)
    expect(mockTeams.updateTeam).toHaveBeenCalledWith('team-1', { orchestratorId: 'a1' }, expect.anything())
    expect(mockElementManagement.ChangeTitle).toHaveBeenCalledWith(
      'a1',
      'orchestrator',
      expect.objectContaining({ authContext: expect.objectContaining({ isSystemOwner: true }) }),
    )
  })

  it('rolls back the slot when applying the orchestrator title fails', async () => {
    /** If ChangeTitle throws, we must NOT leave an orchestrator seated without the governance title (the slot alone would grant kanban-write). The slot is cleared and a 500 returned. */
    const team = makeTeam({ id: 'team-1', agentIds: ['a1'] })
    mockTeams.getTeam.mockReturnValue(team)
    mockAgentRegistry.loadAgents.mockReturnValue([makeAgent({ id: 'a1', name: 'member-one' })])
    mockTeams.updateTeam.mockResolvedValue({ ...team, orchestratorId: 'a1' })
    mockElementManagement.ChangeTitle.mockRejectedValueOnce(new Error('pipeline boom'))

    const result = await setTeamOrchestrator('team-1', 'a1', { isSystemOwner: true as const })

    expect(result.status).toBe(500)
    expect(result.error).toMatch(/orchestrator title/i)
    // First call seats a1; rollback call clears the slot.
    expect(mockTeams.updateTeam).toHaveBeenCalledWith('team-1', { orchestratorId: 'a1' }, expect.anything())
    expect(mockTeams.updateTeam).toHaveBeenCalledWith('team-1', { orchestratorId: null }, expect.anything())
  })

  it('clears the slot when orchestratorId is null (no eligibility check, no title change)', async () => {
    /** Clearing the slot (null) is always allowed and does not re-title — the title lifecycle is driven separately by PATCH /api/agents/[id]/title */
    const team = makeTeam({ id: 'team-1', agentIds: ['a1'], orchestratorId: 'a1' })
    mockTeams.getTeam.mockReturnValue(team)
    mockTeams.updateTeam.mockResolvedValue({ ...team, orchestratorId: null })

    const result = await setTeamOrchestrator('team-1', null)

    expect(result.status).toBe(200)
    expect(mockTeams.updateTeam).toHaveBeenCalledWith('team-1', { orchestratorId: null }, expect.anything())
    expect(mockElementManagement.ChangeTitle).not.toHaveBeenCalled()
    expect(mockAgentRegistry.loadAgents).not.toHaveBeenCalled()
  })
})

// ============================================================================
// deleteTeamById
// ============================================================================

describe('deleteTeamById', () => {
  it('deletes team successfully when requestingAgentId is manager', async () => {
    mockTeams.getTeam.mockReturnValue(makeTeam({ id: 'team-1', type: 'closed', chiefOfStaffId: 'cos-1' }))
    vi.mocked(getManagerId).mockReturnValue('manager-1')
    mockTeams.deleteTeam.mockResolvedValue(true)

    const result = await deleteTeamById('team-1', 'manager-1')

    expect(result.status).toBe(200)
    expect(result.data?.success).toBe(true)
  })

  it('returns 404 when team not found', async () => {
    mockTeams.getTeam.mockReturnValue(null)

    const result = await deleteTeamById('nope')

    expect(result.status).toBe(404)
  })

  it('returns 401 when deleting team without requestingAgentId AND without authContext (anonymous request)', async () => {
    // SVC2-MAJ-10 / LIB2-CRIT-02 fix (2026-05-06): the previous test
    // expected the deprecated `requestingAgentId === undefined` shortcut
    // to fall through to a 400 "Agent identity required". After the
    // round-2 hardening, anonymous calls (no agentId AND no
    // system-owner authContext) fail closed at the team-acl layer,
    // which returns 401 with an "anonymous request" reason. The 400
    // path no longer exists by design.
    mockTeams.getTeam.mockReturnValue(makeTeam({ id: 'team-1', type: 'closed', chiefOfStaffId: 'cos-1' }))

    const result = await deleteTeamById('team-1')

    expect(result.status).toBe(401)
    expect(result.error).toMatch(/authenticated|anonymous|agent identity/i)
  })

  it('returns 403 when unauthorized agent tries to delete team', async () => {
    mockTeams.getTeam.mockReturnValue(makeTeam({ id: 'team-1', type: 'closed', chiefOfStaffId: 'cos-1' }))
    vi.mocked(getManagerId).mockReturnValue('manager-1')

    const result = await deleteTeamById('team-1', 'random-agent')

    expect(result.status).toBe(403)
    expect(result.error).toMatch(/MANAGER.*Chief-of-Staff/i)
  })

  it('allows COS to delete their own team', async () => {
    mockTeams.getTeam.mockReturnValue(makeTeam({ id: 'team-1', type: 'closed', chiefOfStaffId: 'cos-1' }))
    vi.mocked(getManagerId).mockReturnValue('manager-1')
    mockTeams.deleteTeam.mockResolvedValue(true)

    const result = await deleteTeamById('team-1', 'cos-1')

    expect(result.status).toBe(200)
    expect(result.data?.success).toBe(true)
  })
})

// ============================================================================
// listTeamTasks
// ============================================================================

describe('listTeamTasks', () => {
  const ghProjectRef = { owner: 'test', repo: 'test', number: 1 }

  it('returns resolved tasks for team with GitHub Project', async () => {
    const team = makeTeam({ id: 'team-1', githubProject: ghProjectRef } as any)
    const tasks = [makeTask({ teamId: 'team-1' })]
    const resolvedTasks = tasks.map(t => ({ ...t, blocks: [], isBlocked: false }))

    mockTeams.getTeam.mockReturnValue(team)
    mockGhProject.listTasks.mockResolvedValue(tasks)
    mockGhProject.resolveTaskDeps.mockReturnValue(resolvedTasks)

    const result = await listTeamTasks('team-1')

    expect(result.status).toBe(200)
    expect(result.data?.tasks).toHaveLength(1)
    expect(mockGhProject.resolveTaskDeps).toHaveBeenCalledWith(tasks)
  })

  it('returns empty tasks array when team has no GitHub Project', async () => {
    mockTeams.getTeam.mockReturnValue(makeTeam())

    const result = await listTeamTasks('team-1')

    expect(result.status).toBe(200)
    expect(result.data?.tasks).toEqual([])
  })

  it('returns 404 when team not found', async () => {
    mockTeams.getTeam.mockReturnValue(null)

    const result = await listTeamTasks('nope')

    expect(result.status).toBe(404)
  })
})

// ============================================================================
// createTeamTask
// ============================================================================

describe('createTeamTask', () => {
  const ghProjectRef = { owner: 'test', repo: 'test', number: 1 }

  it('creates task successfully via GitHub Project', async () => {
    const team = makeTeam({ id: 'team-1', githubProject: ghProjectRef } as any)
    const task = makeTask({ subject: 'Build API' })
    mockTeams.getTeam.mockReturnValue(team)
    mockGhProject.createTask.mockResolvedValue(task)

    const result = await createTeamTask('team-1', { subject: 'Build API' })

    expect(result.status).toBe(201)
    expect(result.data?.task.subject).toBe('Build API')
  })

  it('trims subject whitespace', async () => {
    const team = makeTeam({ id: 'team-1', githubProject: ghProjectRef } as any)
    mockTeams.getTeam.mockReturnValue(team)
    mockGhProject.createTask.mockResolvedValue(makeTask())

    await createTeamTask('team-1', { subject: '  Build API  ' })

    expect(mockGhProject.createTask).toHaveBeenCalledWith(
      ghProjectRef,
      'team-1',
      expect.objectContaining({ subject: 'Build API' })
    )
  })

  it('returns 404 when team not found', async () => {
    mockTeams.getTeam.mockReturnValue(null)

    const result = await createTeamTask('nope', { subject: 'X' })

    expect(result.status).toBe(404)
  })

  it('returns 400 when subject is missing', async () => {
    mockTeams.getTeam.mockReturnValue(makeTeam({ githubProject: ghProjectRef } as any))

    const result = await createTeamTask('team-1', { subject: '' })

    expect(result.status).toBe(400)
    expect(result.error).toMatch(/subject/i)
  })

  it('returns 400 when subject is whitespace only', async () => {
    mockTeams.getTeam.mockReturnValue(makeTeam({ githubProject: ghProjectRef } as any))

    const result = await createTeamTask('team-1', { subject: '   ' })

    expect(result.status).toBe(400)
  })

  it('returns 400 when blockedBy is not an array of strings', async () => {
    mockTeams.getTeam.mockReturnValue(makeTeam({ githubProject: ghProjectRef } as any))

    const result = await createTeamTask('team-1', { subject: 'X', blockedBy: [123 as any] })

    expect(result.status).toBe(400)
    expect(result.error).toMatch(/blockedBy/i)
  })

  it('returns 400 when team has no GitHub Project', async () => {
    mockTeams.getTeam.mockReturnValue(makeTeam())

    const result = await createTeamTask('team-1', { subject: 'X' })

    expect(result.status).toBe(400)
    expect(result.error).toMatch(/GitHub Project/i)
  })

  it('returns 500 when GitHub createTask throws', async () => {
    mockTeams.getTeam.mockReturnValue(makeTeam({ githubProject: ghProjectRef } as any))
    mockGhProject.createTask.mockRejectedValue(new Error('boom'))

    const result = await createTeamTask('team-1', { subject: 'X' })

    expect(result.status).toBe(500)
  })
})

// ============================================================================
// updateTeamTask
// ============================================================================

describe('updateTeamTask', () => {
  const ghProjectRef = { owner: 'test', repo: 'test', number: 1 }

  it('updates task successfully via GitHub Project', async () => {
    const team = makeTeam({ githubProject: ghProjectRef } as any)
    mockTeams.getTeam.mockReturnValue(team)
    mockGhProject.updateTask.mockResolvedValue(makeTask({ id: 't1', status: 'completed' }))

    const result = await updateTeamTask('team-1', 't1', { status: 'completed' })

    expect(result.status).toBe(200)
    expect(result.data?.task.status).toBe('completed')
    expect(result.data?.unblocked).toEqual([])
  })

  it('returns 404 when team not found', async () => {
    mockTeams.getTeam.mockReturnValue(null)

    const result = await updateTeamTask('nope', 't1', { subject: 'X' })

    expect(result.status).toBe(404)
    expect(result.error).toMatch(/team/i)
  })

  it('returns 400 when team has no GitHub Project', async () => {
    mockTeams.getTeam.mockReturnValue(makeTeam())

    const result = await updateTeamTask('team-1', 't1', { subject: 'X' })

    expect(result.status).toBe(400)
    expect(result.error).toMatch(/GitHub Project/i)
  })

  it('returns 400 for non-string blockedBy entries', async () => {
    const team = makeTeam({ githubProject: ghProjectRef } as any)
    mockTeams.getTeam.mockReturnValue(team)

    const result = await updateTeamTask('team-1', 't1', { blockedBy: [42 as any] })

    expect(result.status).toBe(400)
  })

  it('returns 404 when GitHub updateTask returns null', async () => {
    const team = makeTeam({ githubProject: ghProjectRef } as any)
    mockTeams.getTeam.mockReturnValue(team)
    mockGhProject.updateTask.mockResolvedValue(null)

    const result = await updateTeamTask('team-1', 't1', { subject: 'X' })

    expect(result.status).toBe(404)
  })

  it('returns 502 when GitHub updateTask throws', async () => {
    const team = makeTeam({ githubProject: ghProjectRef } as any)
    mockTeams.getTeam.mockReturnValue(team)
    mockGhProject.updateTask.mockRejectedValue(new Error('GitHub API error'))

    const result = await updateTeamTask('team-1', 't1', { subject: 'X' })

    expect(result.status).toBe(502)
  })
})

// ============================================================================
// deleteTeamTask
// ============================================================================

describe('deleteTeamTask', () => {
  const ghProjectRef = { owner: 'test', repo: 'test', number: 1 }

  it('deletes task successfully via GitHub Project', async () => {
    mockTeams.getTeam.mockReturnValue(makeTeam({ githubProject: ghProjectRef } as any))
    mockGhProject.deleteTask.mockResolvedValue(true)

    const result = await deleteTeamTask('team-1', 't1')

    expect(result.status).toBe(200)
    expect(result.data?.success).toBe(true)
  })

  it('returns 404 when team not found', async () => {
    mockTeams.getTeam.mockReturnValue(null)

    const result = await deleteTeamTask('nope', 't1')

    expect(result.status).toBe(404)
  })

  it('returns 400 when team has no GitHub Project', async () => {
    mockTeams.getTeam.mockReturnValue(makeTeam())

    const result = await deleteTeamTask('team-1', 't1')

    expect(result.status).toBe(400)
    expect(result.error).toMatch(/GitHub Project/i)
  })

  it('returns 404 when task not found on GitHub', async () => {
    mockTeams.getTeam.mockReturnValue(makeTeam({ githubProject: ghProjectRef } as any))
    mockGhProject.deleteTask.mockResolvedValue(false)

    const result = await deleteTeamTask('team-1', 'nope')

    expect(result.status).toBe(404)
  })
})

// ============================================================================
// listTeamDocuments
// ============================================================================

describe('listTeamDocuments', () => {
  it('returns documents for existing team', () => {
    const docs = [makeDocument({ title: 'API Guide' }), makeDocument({ title: 'Setup' })]
    mockTeams.getTeam.mockReturnValue(makeTeam())
    mockDocs.loadDocuments.mockReturnValue(docs)

    const result = listTeamDocuments('team-1')

    expect(result.status).toBe(200)
    expect(result.data?.documents).toHaveLength(2)
  })

  it('returns empty list when no documents', () => {
    mockTeams.getTeam.mockReturnValue(makeTeam())
    mockDocs.loadDocuments.mockReturnValue([])

    const result = listTeamDocuments('team-1')

    expect(result.status).toBe(200)
    expect(result.data?.documents).toEqual([])
  })

  it('returns 404 when team not found', () => {
    mockTeams.getTeam.mockReturnValue(null)

    const result = listTeamDocuments('nope')

    expect(result.status).toBe(404)
  })
})

// ============================================================================
// createTeamDocument
// ============================================================================

describe('createTeamDocument', () => {
  it('creates document successfully', async () => {
    const doc = makeDocument({ title: 'New Doc' })
    mockTeams.getTeam.mockReturnValue(makeTeam())
    mockDocs.createDocument.mockResolvedValue(doc)

    const result = await createTeamDocument('team-1', { title: 'New Doc' })

    expect(result.status).toBe(201)
    expect(result.data?.document.title).toBe('New Doc')
  })

  it('passes all fields to createDocument', async () => {
    mockTeams.getTeam.mockReturnValue(makeTeam())
    mockDocs.createDocument.mockResolvedValue(makeDocument())

    await createTeamDocument('team-1', { title: 'Doc', content: 'Body', pinned: true, tags: ['api'] })

    expect(mockDocs.createDocument).toHaveBeenCalledWith({
      teamId: 'team-1',
      title: 'Doc',
      content: 'Body',
      pinned: true,
      tags: ['api'],
    })
  })

  it('defaults content to empty string', async () => {
    mockTeams.getTeam.mockReturnValue(makeTeam())
    mockDocs.createDocument.mockResolvedValue(makeDocument())

    await createTeamDocument('team-1', { title: 'Doc' })

    expect(mockDocs.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({ content: '' })
    )
  })

  it('returns 404 when team not found', async () => {
    mockTeams.getTeam.mockReturnValue(null)

    const result = await createTeamDocument('nope', { title: 'X' })

    expect(result.status).toBe(404)
  })

  it('returns 400 when title is missing', async () => {
    mockTeams.getTeam.mockReturnValue(makeTeam())

    const result = await createTeamDocument('team-1', { title: '' })

    expect(result.status).toBe(400)
    expect(result.error).toMatch(/title/i)
  })

  it('returns 500 when createDocument throws', async () => {
    mockTeams.getTeam.mockReturnValue(makeTeam())
    mockDocs.createDocument.mockRejectedValue(new Error('boom'))

    const result = await createTeamDocument('team-1', { title: 'X' })

    expect(result.status).toBe(500)
  })
})

// ============================================================================
// getTeamDocument
// ============================================================================

describe('getTeamDocument', () => {
  it('returns document when found', () => {
    const doc = makeDocument({ id: 'doc-1', title: 'Found' })
    mockTeams.getTeam.mockReturnValue(makeTeam())
    mockDocs.getDocument.mockReturnValue(doc)

    const result = getTeamDocument('team-1', 'doc-1')

    expect(result.status).toBe(200)
    expect(result.data?.document.title).toBe('Found')
  })

  it('returns 404 when team not found', () => {
    mockTeams.getTeam.mockReturnValue(null)

    const result = getTeamDocument('nope', 'doc-1')

    expect(result.status).toBe(404)
    expect(result.error).toMatch(/team/i)
  })

  it('returns 404 when document not found', () => {
    mockTeams.getTeam.mockReturnValue(makeTeam())
    mockDocs.getDocument.mockReturnValue(null)

    const result = getTeamDocument('team-1', 'nope')

    expect(result.status).toBe(404)
    expect(result.error).toMatch(/document/i)
  })
})

// ============================================================================
// updateTeamDocument
// ============================================================================

describe('updateTeamDocument', () => {
  it('updates document successfully', async () => {
    const doc = makeDocument({ title: 'Updated' })
    mockTeams.getTeam.mockReturnValue(makeTeam())
    mockDocs.updateDocument.mockResolvedValue(doc)

    const result = await updateTeamDocument('team-1', 'doc-1', { title: 'Updated' })

    expect(result.status).toBe(200)
    expect(result.data?.document.title).toBe('Updated')
  })

  it('passes only provided fields', async () => {
    mockTeams.getTeam.mockReturnValue(makeTeam())
    mockDocs.updateDocument.mockResolvedValue(makeDocument())

    await updateTeamDocument('team-1', 'doc-1', { title: 'New Title' })

    expect(mockDocs.updateDocument).toHaveBeenCalledWith('team-1', 'doc-1', { title: 'New Title' })
  })

  it('passes pinned and tags when provided', async () => {
    mockTeams.getTeam.mockReturnValue(makeTeam())
    mockDocs.updateDocument.mockResolvedValue(makeDocument())

    await updateTeamDocument('team-1', 'doc-1', { pinned: true, tags: ['api'] })

    expect(mockDocs.updateDocument).toHaveBeenCalledWith('team-1', 'doc-1', { pinned: true, tags: ['api'] })
  })

  it('returns 404 when updateDocument returns null (document not found)', async () => {
    // Team must exist so the service reaches the updateDocument call
    mockTeams.getTeam.mockReturnValue(makeTeam())
    // updateDocument returns null to signal the document does not exist
    mockDocs.updateDocument.mockResolvedValue(null)

    const result = await updateTeamDocument('team-1', 'nope', { title: 'X' })

    expect(result.status).toBe(404)
  })

  it('returns 500 when updateDocument throws', async () => {
    mockTeams.getTeam.mockReturnValue(makeTeam())
    mockDocs.updateDocument.mockRejectedValue(new Error('write error'))

    const result = await updateTeamDocument('team-1', 'doc-1', { title: 'X' })

    expect(result.status).toBe(500)
  })
})

// ============================================================================
// deleteTeamDocument
// ============================================================================

describe('deleteTeamDocument', () => {
  it('deletes document successfully', async () => {
    mockTeams.getTeam.mockReturnValue(makeTeam())
    mockDocs.deleteDocument.mockResolvedValue(true)

    const result = await deleteTeamDocument('team-1', 'doc-1')

    expect(result.status).toBe(200)
    expect(result.data?.success).toBe(true)
  })

  it('returns 404 when document not found', async () => {
    mockTeams.getTeam.mockReturnValue(makeTeam())
    mockDocs.deleteDocument.mockResolvedValue(false)

    const result = await deleteTeamDocument('team-1', 'nope')

    expect(result.status).toBe(404)
  })
})

// ============================================================================
// notifyTeamAgents
// ============================================================================

describe('notifyTeamAgents', () => {
  it('notifies all agents successfully', async () => {
    const agent = makeAgent({ id: 'a1', name: 'backend' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockNotificationService.notifyAgent.mockResolvedValue({ success: true, notified: true })

    const result = await notifyTeamAgents({ agentIds: ['a1'], teamName: 'Team Alpha' })

    expect(result.status).toBe(200)
    expect(result.data?.results).toHaveLength(1)
    expect(mockNotificationService.notifyAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'a1',
        agentName: 'backend',
        fromName: 'AI Maestro',
      })
    )
  })

  it('handles agent not found gracefully', async () => {
    mockAgentRegistry.getAgent.mockReturnValue(null)

    const result = await notifyTeamAgents({ agentIds: ['nonexistent'], teamName: 'Team' })

    expect(result.status).toBe(200)
    expect(result.data?.results[0]).toEqual(
      expect.objectContaining({ agentId: 'nonexistent', success: false, reason: 'Agent not found' })
    )
  })

  it('handles partial failure (some agents not found)', async () => {
    const agent = makeAgent({ id: 'a1', name: 'backend' })
    mockAgentRegistry.getAgent
      .mockReturnValueOnce(agent)
      .mockReturnValueOnce(null)
    mockNotificationService.notifyAgent.mockResolvedValue({ success: true, notified: true })

    const result = await notifyTeamAgents({ agentIds: ['a1', 'a2'], teamName: 'Team' })

    expect(result.status).toBe(200)
    expect(result.data?.results).toHaveLength(2)
  })

  it('handles notification failure for an agent', async () => {
    const agent = makeAgent({ id: 'a1', name: 'backend' })
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockNotificationService.notifyAgent.mockRejectedValue(new Error('tmux gone'))

    const result = await notifyTeamAgents({ agentIds: ['a1'], teamName: 'Team' })

    expect(result.status).toBe(200)
    expect(result.data?.results[0]).toEqual(
      expect.objectContaining({ success: false })
    )
  })

  it('returns 400 when agentIds is missing', async () => {
    const result = await notifyTeamAgents({ agentIds: null as any, teamName: 'Team' })

    expect(result.status).toBe(400)
    expect(result.error).toMatch(/agentIds/i)
  })

  it('returns 400 when agentIds is not an array', async () => {
    const result = await notifyTeamAgents({ agentIds: 'not-array' as any, teamName: 'Team' })

    expect(result.status).toBe(400)
  })

  it('returns 400 when teamName is missing', async () => {
    const result = await notifyTeamAgents({ agentIds: ['a1'], teamName: '' })

    expect(result.status).toBe(400)
    expect(result.error).toMatch(/teamName/i)
  })

  it('returns 400 when teamName is not a string', async () => {
    const result = await notifyTeamAgents({ agentIds: ['a1'], teamName: 123 as any })

    expect(result.status).toBe(400)
  })

  it('uses agent name or alias for notification', async () => {
    const agent = makeAgent({ id: 'a1', name: '', alias: 'backend-alias' } as any)
    mockAgentRegistry.getAgent.mockReturnValue(agent)
    mockNotificationService.notifyAgent.mockResolvedValue({ success: true })

    await notifyTeamAgents({ agentIds: ['a1'], teamName: 'Team' })

    expect(mockNotificationService.notifyAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentName: 'backend-alias' })
    )
  })
})
