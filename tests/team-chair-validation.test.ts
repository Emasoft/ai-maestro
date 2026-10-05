/**
 * A team's chair (chiefOfStaffId) is the trust anchor for every COS grant in lib/authorization.ts
 * (TRDD-A50RC5G8). These tests pin what may be SET as a chair: not the MANAGER (GOVERNANCE R4.3),
 * not an id no live agent holds, not a soft-deleted agent. fs is an in-memory map; the agent
 * registry is the REAL lib/agent-registry reading that map, so the soft-delete filter is the real one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'
import { statePath } from '@/lib/ecosystem-constants'

let fsStore: Record<string, string> = {}

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn((p: string) => p in fsStore),
    mkdirSync: vi.fn(),
    statSync: vi.fn(() => ({ mtimeMs: Math.random() })),
    readFileSync: vi.fn((p: string) => {
      if (p in fsStore) return fsStore[p]
      throw new Error(`ENOENT: ${p}`)
    }),
    writeFileSync: vi.fn((p: string, d: string) => { fsStore[p] = d }),
    renameSync: vi.fn((a: string, b: string) => {
      if (a in fsStore) { fsStore[b] = fsStore[a]; delete fsStore[a] }
    }),
    unlinkSync: vi.fn((p: string) => { delete fsStore[p] }),
  },
}))

vi.mock('uuid', () => ({ v4: vi.fn(() => 'uuid-fixed') }))
vi.mock('@/lib/file-lock', () => ({
  withLock: vi.fn((_n: string, fn: () => unknown) => Promise.resolve(fn())),
}))

import { createTeam, updateTeam, validateTeamMutation, loadTeams } from '@/lib/team-registry'
import type { Team } from '@/types/team'

const TEAMS_FILE = path.join(statePath('teams'), 'teams.json')
const REGISTRY_FILE = path.join(statePath('agents'), 'registry.json')
const MANAGER = 'agent-manager'

function seedAgents(agents: Array<Record<string, unknown>>) {
  fsStore[REGISTRY_FILE] = JSON.stringify(agents)
}
function seedTeams(teams: Team[]) {
  fsStore[TEAMS_FILE] = JSON.stringify({ version: 1, teams })
}
function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: 'team-1', name: 'Alpha Team', type: 'closed', agentIds: [],
    createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  fsStore = {}
  vi.clearAllMocks()
})

describe('validateTeamMutation chair = MANAGER', () => {
  it('refuses setting the MANAGER as chair with 409', () => {
    /** R4.3: MANAGER is a host-level singleton in no team */
    const result = validateTeamMutation([makeTeam()], 'team-1', { chiefOfStaffId: MANAGER }, MANAGER)
    expect(result).toEqual({ valid: false, error: "The MANAGER cannot be a team's Chief-of-Staff", code: 409 })
  })

  it('accepts re-setting the same chair id even when it equals managerId (no re-validation)', () => {
    /** An unchanged chair is never re-validated, so a stale chair cannot break unrelated updates */
    const result = validateTeamMutation([makeTeam({ chiefOfStaffId: MANAGER, agentIds: [MANAGER] })], 'team-1', { chiefOfStaffId: MANAGER }, MANAGER)
    expect(result.valid).toBe(true)
  })
})

describe('createTeam/updateTeam chair must be a live agent', () => {
  it('refuses a chair id no agent holds with 404', async () => {
    /** createTeam: unknown id */
    seedAgents([])
    await expect(createTeam({ name: 'Beta Team', agentIds: [], chiefOfStaffId: 'ghost' }, MANAGER))
      .rejects.toMatchObject({ message: 'Chief-of-Staff agent not found', code: 404 })
    expect(loadTeams()).toEqual([])
  })

  it('refuses a soft-deleted agent as chair with 404', async () => {
    /** updateTeam: the real getAgent excludes agents carrying deletedAt */
    seedAgents([{ id: 'dead-agent', name: 'dead', deletedAt: '2025-01-01T00:00:00.000Z' }])
    seedTeams([makeTeam()])
    await expect(updateTeam('team-1', { chiefOfStaffId: 'dead-agent' }, MANAGER))
      .rejects.toMatchObject({ message: 'Chief-of-Staff agent not found', code: 404 })
    expect(loadTeams()[0].chiefOfStaffId).toBeUndefined()
  })

  it('accepts an existing untitled agent as chair', async () => {
    /** control: the check must not demand the chief-of-staff title (routes set the chair first, ChangeTitle after) */
    seedAgents([{ id: 'live-agent', name: 'live' }])
    const team = await createTeam({ name: 'Gamma Team', agentIds: [], chiefOfStaffId: 'live-agent' }, MANAGER)
    expect(team.chiefOfStaffId).toBe('live-agent')
  })

  it('accepts an existing AUTONOMOUS agent as chair', async () => {
    /** control: autonomous is the title an agent holds when it is promoted */
    seedAgents([{ id: 'auto-agent', name: 'auto', governanceTitle: 'autonomous' }])
    seedTeams([makeTeam()])
    const updated = await updateTeam('team-1', { chiefOfStaffId: 'auto-agent' }, MANAGER)
    expect(updated?.chiefOfStaffId).toBe('auto-agent')
  })

  it('accepts an update that does not touch chiefOfStaffId on a team whose chair no longer exists', async () => {
    /** control: proves the unchanged chair is not re-validated */
    seedAgents([])
    seedTeams([makeTeam({ chiefOfStaffId: 'ghost', agentIds: ['ghost'] })])
    const updated = await updateTeam('team-1', { description: 'new description' }, MANAGER)
    expect(updated?.description).toBe('new description')
    expect(updated?.chiefOfStaffId).toBe('ghost')
  })

  it('accepts re-setting the SAME chair id even when the agent no longer exists', async () => {
    /** control: unchanged chair is exempt, so rollbacks restoring an equal value cannot newly fail */
    seedAgents([])
    seedTeams([makeTeam({ chiefOfStaffId: 'ghost', agentIds: ['ghost'] })])
    const updated = await updateTeam('team-1', { chiefOfStaffId: 'ghost' }, MANAGER)
    expect(updated?.chiefOfStaffId).toBe('ghost')
  })

  it('accepts setting chiefOfStaffId to null', async () => {
    /** control: clearing the chair is never blocked */
    seedAgents([])
    seedTeams([makeTeam({ chiefOfStaffId: 'ghost', agentIds: ['ghost'] })])
    const updated = await updateTeam('team-1', { chiefOfStaffId: null }, MANAGER)
    expect(updated?.chiefOfStaffId).toBeNull()
  })
})
