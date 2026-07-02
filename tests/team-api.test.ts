import { describe, it, expect, vi, beforeEach } from 'vitest'

// Note: team-api tests mock 'fs' directly at the module level below, not via
// team-registry — the fs mock intercepts all filesystem calls from any module
// (including team-registry) that the route handlers import.

// ============================================================================
// Mocks
// ============================================================================

let fsStore: Record<string, string> = {}

vi.mock('fs', () => {
  const fns = {
    existsSync: vi.fn((filePath: string) => filePath in fsStore),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn((filePath: string) => {
      if (filePath in fsStore) return fsStore[filePath]
      throw new Error(`ENOENT: no such file or directory, open '${filePath}'`)
    }),
    writeFileSync: vi.fn((filePath: string, data: string) => {
      fsStore[filePath] = data
    }),
    renameSync: vi.fn((oldPath: string, newPath: string) => {
      if (oldPath in fsStore) {
        fsStore[newPath] = fsStore[oldPath]
        delete fsStore[oldPath]
      }
    }),
    unlinkSync: vi.fn((filePath: string) => {
      delete fsStore[filePath]
    }),
    copyFileSync: vi.fn(),
  }
  return { default: fns, ...fns }
})

let uuidCounter = 0
vi.mock('uuid', () => ({
  v4: vi.fn(() => {
    uuidCounter++
    return `uuid-${uuidCounter}`
  }),
}))

vi.mock('@/lib/file-lock', () => ({
  withLock: vi.fn((_name: string, fn: () => unknown) => Promise.resolve(fn())),
}))

// Mock governance module - getManagerId returns a manager so team creation works (R9 governance requires MANAGER)
vi.mock('@/lib/governance', () => ({
  getManagerId: vi.fn(() => 'test-manager-id'),
  isManager: vi.fn((agentId: string) => agentId === 'test-manager-id'),
  isChiefOfStaffAnywhere: vi.fn(() => false),
  loadGovernance: vi.fn(() => ({ managerId: 'test-manager-id', passwordHash: null, createdAt: null, updatedAt: null })),
  verifyPassword: vi.fn(() => Promise.resolve(true)),
}))

// Mock team-acl module - checkTeamAccess allows all access by default in tests
vi.mock('@/lib/team-acl', () => ({
  checkTeamAccess: vi.fn(() => ({ allowed: true })),
}))

// Mock agent-registry module - loadAgents returns empty array for basic team tests
vi.mock('@/lib/agent-registry', () => ({
  loadAgents: vi.fn(() => []),
  getAgent: vi.fn(() => null),
  updateAgent: vi.fn(),
}))

// Mock agent-auth module - in tests, trust X-Agent-Id directly (no real API keys in test environment)
// Returns governanceTitle='manager' for the test manager ID so that authorize() works without filesystem lookups
vi.mock('@/lib/agent-auth', () => ({
  authenticateFromRequest: vi.fn((request: { headers: { get(name: string): string | null } }) => {
    const agentId = request.headers.get('X-Agent-Id')
    if (!agentId) return {}
    // Test convention: agents with 'manager' in their ID get the manager governance title
    const isManager = agentId.includes('manager')
    return isManager ? { agentId, governanceTitle: 'manager' } : { agentId }
  }),
  buildAuthContext: vi.fn((authResult: { agentId?: string; governanceTitle?: string; teamId?: string | null }) => ({
    agentId: authResult.agentId,
    isSystemOwner: !authResult.agentId,
    governanceTitle: authResult.governanceTitle,
    teamId: authResult.teamId,
  })),
  authenticateAgent: vi.fn((authHeader: string | null, agentIdHeader: string | null) => {
    if (!agentIdHeader) return {}
    const isManager = agentIdHeader.includes('manager')
    return isManager ? { agentId: agentIdHeader, governanceTitle: 'manager' } : { agentId: agentIdHeader }
  }),
}))

// Mock authorization — MANAGER is allowed, others denied
vi.mock('@/lib/authorization', () => ({
  authorize: vi.fn((auth: { agentId?: string; governanceTitle?: string }, action: string) => {
    if (!auth.agentId) return { allowed: true }
    if (auth.governanceTitle === 'manager') return { allowed: true }
    return { allowed: false, reason: `Only MANAGER can ${action}` }
  }),
}))

// Mock validation module - isValidUuid accepts synthetic test UUIDs (uuid-1, uuid-2, etc.)
vi.mock('@/lib/validation', () => ({
  isValidUuid: vi.fn(() => true),
}))

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { createTeam, loadTeams, updateTeam, getTeam } from '@/lib/team-registry'
import { GET as getTeamRoute, PUT as updateTeamRoute, DELETE as deleteTeamRoute } from '@/app/api/teams/[id]/route'
import { GET as listTeamsRoute, POST as createTeamRoute } from '@/app/api/teams/route'
import { getManagerId, isManager } from '@/lib/governance'
import { checkTeamAccess } from '@/lib/team-acl'
import { isValidUuid } from '@/lib/validation'
import { NextRequest } from 'next/server'

// ============================================================================
// Helpers
// ============================================================================

function makeRequest(url: string, options: Record<string, unknown> = {}): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:23000'), options as any)
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  fsStore = {}
  uuidCounter = 0
  vi.clearAllMocks()
})

// ============================================================================
// GET /api/teams - List all teams
// ============================================================================

describe('GET /api/teams', () => {
  it('returns empty array when no teams', async () => {
    const res = await listTeamsRoute()

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.teams).toEqual([])
  })

  it('returns all teams', async () => {
    await createTeam({ name: 'Team A', agentIds: [] })
    await createTeam({ name: 'Team B', agentIds: [] })

    const res = await listTeamsRoute()
    const data = await res.json()
    expect(data.teams).toHaveLength(2)
  })
})

// ============================================================================
// POST /api/teams - Create team
// ============================================================================

describe('POST /api/teams', () => {
  it('creates team with name and agents', async () => {
    // PR #28 introduced strict zod schema requiring agentIds to be RFC 4122 UUIDs.
    // Use crypto.randomUUID() to generate valid v4 UUIDs the schema accepts.
    const a1 = crypto.randomUUID()
    const a2 = crypto.randomUUID()
    const req = makeRequest('/api/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Team', agentIds: [a1, a2] }),
    })
    const res = await createTeamRoute(req)

    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.team.name).toBe('New Team')
    // agentIds preserved as provided (registry uses them as-is)
    expect(data.team.agentIds).toContain(a1)
    expect(data.team.agentIds).toContain(a2)
  })

  it('creates team with empty agentIds', async () => {
    const req = makeRequest('/api/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Empty Team', agentIds: [] }),
    })
    const res = await createTeamRoute(req)

    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.team.agentIds).toEqual([])
  })

  it('creates team without agentIds field (defaults to empty)', async () => {
    const req = makeRequest('/api/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'No Agents Field' }),
    })
    const res = await createTeamRoute(req)

    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.team.agentIds).toEqual([])
  })

  it('returns 400 when name is missing', async () => {
    const req = makeRequest('/api/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentIds: ['a1'] }),
    })
    const res = await createTeamRoute(req)

    expect(res.status).toBe(400)
  })

  it('returns 400 when agentIds is not an array', async () => {
    const req = makeRequest('/api/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Bad', agentIds: 'not-array' }),
    })
    const res = await createTeamRoute(req)

    expect(res.status).toBe(400)
  })

  // CC-004: Verify managerId is passed through to createTeam when getManagerId returns a value
  it('passes managerId from governance to createTeam', async () => {
    vi.mocked(getManagerId).mockReturnValue('manager-uuid')
    // vi.spyOn on dynamic import works in Vitest because await import() returns
    // the same module instance as the route's static import when vi.mock is active.
    const spy = vi.spyOn(await import('@/lib/team-registry'), 'createTeam')

    const req = makeRequest('/api/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Managed Team', agentIds: [] }),
    })
    const res = await createTeamRoute(req)

    expect(res.status).toBe(201)
    // createTeam should have received managerId as its second argument
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][1]).toBe('manager-uuid')

    spy.mockRestore()
    vi.mocked(getManagerId).mockReturnValue('test-manager-id')
  })
})

// ============================================================================
// GET /api/teams/[id] - Get single team
// ============================================================================

describe('GET /api/teams/[id]', () => {
  // CC-002: Verify the 400 response path when isValidUuid returns false
  it('returns 400 for invalid UUID format', async () => {
    vi.mocked(isValidUuid).mockReturnValueOnce(false)

    const req = makeRequest('/api/teams/not-a-valid-uuid')
    const res = await getTeamRoute(req, makeParams('not-a-valid-uuid') as any)

    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('Invalid team ID format')
  })

  it('returns 404 for non-existent team', async () => {
    const req = makeRequest('/api/teams/non-existent')
    const res = await getTeamRoute(req, makeParams('non-existent') as any)

    expect(res.status).toBe(404)
  })

  it('returns team when it exists', async () => {
    const team = await createTeam({ name: 'Find Me', agentIds: [] })

    const req = makeRequest(`/api/teams/${team.id}`)
    const res = await getTeamRoute(req, makeParams(team.id) as any)

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.team.name).toBe('Find Me')
  })
})

// ============================================================================
// PUT /api/teams/[id] - Update team (including new fields)
// ============================================================================

describe('PUT /api/teams/[id]', () => {
  it('returns 404 for non-existent team', async () => {
    const req = makeRequest('/api/teams/non-existent', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated' }),
    })
    const res = await updateTeamRoute(req, makeParams('non-existent') as any)

    expect(res.status).toBe(404)
  })

  it('updates team name', async () => {
    const team = await createTeam({ name: 'Original', agentIds: [] })

    const req = makeRequest(`/api/teams/${team.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated' }),
    })
    const res = await updateTeamRoute(req, makeParams(team.id) as any)

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.team.name).toBe('Updated')
  })

  // PR #28 (ace5152d) introduced UpdateTeamSchema as strict() omitting
  // `instructions`, `lastActivityAt`, and `lastMeetingAt`. The route now
  // rejects unknown fields with HTTP 400 — these fields can no longer be
  // updated through the generic PUT. The registry-level `updateTeam`
  // still accepts them (used by dedicated callers/services).
  it('rejects instructions in PUT body (strict schema)', async () => {
    const team = await createTeam({ name: 'Instructions Team', agentIds: [] })

    const req = makeRequest(`/api/teams/${team.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instructions: '# Team Guidelines\n\nFollow these rules.' }),
    })
    const res = await updateTeamRoute(req, makeParams(team.id) as any)

    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('Validation failed')
  })

  it('rejects lastActivityAt in PUT body (strict schema)', async () => {
    const team = await createTeam({ name: 'Activity Team', agentIds: [] })
    const ts = '2025-06-15T10:30:00.000Z'

    const req = makeRequest(`/api/teams/${team.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lastActivityAt: ts }),
    })
    const res = await updateTeamRoute(req, makeParams(team.id) as any)

    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('Validation failed')
  })

  it('persists instructions to storage via registry updateTeam', async () => {
    // The route's PUT no longer accepts `instructions` (strict schema), but
    // the registry-level updateTeam continues to support it for service-layer
    // callers. Verify persistence at the registry boundary.
    const team = await createTeam({ name: 'Persist', agentIds: [] })

    await updateTeam(team.id, { instructions: 'Saved' })

    const teams = loadTeams()
    expect(teams[0].instructions).toBe('Saved')
  })

  // CC-005: PUT must strip chiefOfStaffId and type from body (only dedicated endpoints can change these)
  it('ignores chiefOfStaffId and type in body', async () => {
    const team = await createTeam({ name: 'Original Team', agentIds: [], type: 'closed' })
    // vi.spyOn on dynamic import works in Vitest because await import() returns
    // the same module instance as the route's static import when vi.mock is active.
    const spy = vi.spyOn(await import('@/lib/team-registry'), 'updateTeam')

    // PR #28: chiefOfStaffId in PUT body must be a UUID per the strict zod schema
    // (route's defense-in-depth strips it before reaching the registry, but the
    // schema validates it first).
    const cosUuid = crypto.randomUUID()
    const req = makeRequest(`/api/teams/${team.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'closed', chiefOfStaffId: cosUuid, name: 'Updated Name' }),
    })
    const res = await updateTeamRoute(req, makeParams(team.id) as any)

    expect(res.status).toBe(200)
    const data = await res.json()
    // Name should be updated
    expect(data.team.name).toBe('Updated Name')
    // type and chiefOfStaffId must NOT have been changed
    expect(data.team.type).toBe('closed')
    // SF-038 (P8): createTeam now defaults chiefOfStaffId to null (not undefined)
    expect(data.team.chiefOfStaffId).toBeNull()

    // Verify updateTeam was called WITHOUT type or chiefOfStaffId in the updates object
    expect(spy).toHaveBeenCalledTimes(1)
    const updateArgs = spy.mock.calls[0][1]
    expect(updateArgs).not.toHaveProperty('type')
    expect(updateArgs).not.toHaveProperty('chiefOfStaffId')

    spy.mockRestore()
  })

  // CC-003: ACL denial path - checkTeamAccess returns { allowed: false } for PUT
  it('returns 403 when ACL denies access', async () => {
    const team = await createTeam({ name: 'ACL Denied Team', agentIds: [] })
    // Toggle checkTeamAccess to deny access for this test
    vi.mocked(checkTeamAccess).mockReturnValueOnce({ allowed: false, reason: 'Not a member' })

    const req = makeRequest(`/api/teams/${team.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Id': 'outsider-agent' },
      body: JSON.stringify({ name: 'Should Not Update' }),
    })
    const res = await updateTeamRoute(req, makeParams(team.id) as any)

    expect(res.status).toBe(403)
    const data = await res.json()
    expect(data.error).toContain('Not a member')
  })
})

// ============================================================================
// DELETE /api/teams/[id] - Delete team
// ============================================================================

describe('DELETE /api/teams/[id]', () => {
  it('returns 404 for non-existent team', async () => {
    const req = makeRequest('/api/teams/non-existent', { method: 'DELETE' })
    const res = await deleteTeamRoute(req, makeParams('non-existent') as any)

    expect(res.status).toBe(404)
  })

  it('deletes team and returns success when requested by MANAGER', async () => {
    /** After governance simplification, all teams are closed and deletion requires MANAGER or COS identity */
    const team = await createTeam({ name: 'Delete Me', agentIds: [] })
    vi.mocked(getManagerId).mockReturnValue('manager-agent')

    const req = makeRequest(`/api/teams/${team.id}`, {
      method: 'DELETE',
      headers: { 'X-Agent-Id': 'manager-agent' },
    })
    const res = await deleteTeamRoute(req, makeParams(team.id) as any)

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(loadTeams()).toHaveLength(0)

    vi.mocked(getManagerId).mockReturnValue(null)
  })

  // CC-006: Closed team deletion guard - non-authorized agent gets 403
  it('returns 403 when non-authorized agent deletes closed team', async () => {
    const team = await createTeam({ name: 'Closed Team', agentIds: ['cos-agent'], type: 'closed', chiefOfStaffId: 'cos-agent' })
    vi.mocked(isManager).mockReturnValue(false)

    const req = makeRequest(`/api/teams/${team.id}`, {
      method: 'DELETE',
      headers: { 'X-Agent-Id': 'random-agent' },
    })
    const res = await deleteTeamRoute(req, makeParams(team.id) as any)

    expect(res.status).toBe(403)
    const data = await res.json()
    expect(data.error).toContain('MANAGER')
  })

  // CC-006: Closed team deletion guard - COS is allowed
  it('denies COS from deleting team — only MANAGER can manage teams', async () => {
    const team = await createTeam({ name: 'COS Delete', agentIds: ['cos-agent'], type: 'closed', chiefOfStaffId: 'cos-agent' })
    vi.mocked(isManager).mockReturnValue(false)

    const req = makeRequest(`/api/teams/${team.id}`, {
      method: 'DELETE',
      headers: { 'X-Agent-Id': 'cos-agent' },
    })
    const res = await deleteTeamRoute(req, makeParams(team.id) as any)

    expect(res.status).toBe(403)
  })

  // CC-006: Closed team deletion guard - MANAGER is allowed
  it('allows MANAGER to delete closed team', async () => {
    // After governance simplification (2026-03-27), ALL teams are closed.
    // PR #28 batch 3 (ace5152d) added G03 in DeleteTeam: each team agent is
    // reverted to AUTONOMOUS via ChangeTitle, which itself verifies registry
    // persistence on disk (G14). Stubbing every step of that pipeline is
    // counter-productive for an API-shape test — the deletion-guard logic
    // we want to verify (MANAGER allowed) is fully exercised by an empty
    // agentIds team. The "closed team" attribute is type='closed', not the
    // presence of a COS.
    const team = await createTeam({ name: 'Mgr Delete', agentIds: [], type: 'closed' })
    // deleteTeamById checks getManagerId() === requestingAgentId, not isManager()
    vi.mocked(getManagerId).mockReturnValue('manager-agent')

    const req = makeRequest(`/api/teams/${team.id}`, {
      method: 'DELETE',
      headers: { 'X-Agent-Id': 'manager-agent' },
    })
    const res = await deleteTeamRoute(req, makeParams(team.id) as any)

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)

    // Restore default
    vi.mocked(getManagerId).mockReturnValue(null)
  })

  // DeleteTeam pipeline: non-MANAGER agents are denied by authorize()
  it('returns 403 when non-MANAGER agent attempts to delete', async () => {
    const team = await createTeam({ name: 'ACL Denied Delete', agentIds: [] })

    const req = makeRequest(`/api/teams/${team.id}`, {
      method: 'DELETE',
      headers: { 'X-Agent-Id': 'outsider-agent' },
    })
    const res = await deleteTeamRoute(req, makeParams(team.id) as any)

    expect(res.status).toBe(403)
    const data = await res.json()
    expect(data.error).toContain('MANAGER')
  })
})
