/**
 * team.orchestratorId grants kanban-write and orchestratorOverAssignee in lib/authorization.ts. These tests
 * pin what may be SET as an orchestrator at the shared choke point (updateTeam / validateTeamMutation):
 * a live agent, never the MANAGER. Membership is deliberately NOT enforced here: createNewTeam seats the
 * orchestrator on a team whose agentIds never contained it (the dedicated route checks membership).
 * fs is an in-memory map; the agent registry is the REAL lib/agent-registry reading that map.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
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

import { updateTeam, validateTeamMutation, loadTeams } from '@/lib/team-registry'
import type { Team } from '@/types/team'

const TEAMS_FILE = statePath('teams', 'teams.json')
const REGISTRY_FILE = statePath('agents', 'registry.json')
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

describe('validateTeamMutation orchestrator = MANAGER', () => {
  it('refuses setting the MANAGER as orchestrator with 409', () => {
    /** R4.3: MANAGER is a host-level singleton in no team */
    const result = validateTeamMutation([makeTeam()], 'team-1', { orchestratorId: MANAGER }, MANAGER)
    expect(result).toEqual({ valid: false, error: "The MANAGER cannot be a team's Orchestrator", code: 409 })
  })

  it('accepts re-setting the same orchestrator id even when it equals managerId (no re-validation)', () => {
    /** An unchanged orchestrator is never re-validated */
    const result = validateTeamMutation([makeTeam({ orchestratorId: MANAGER })], 'team-1', { orchestratorId: MANAGER }, MANAGER)
    expect(result.valid).toBe(true)
  })
})

describe('updateTeam orchestrator must be a live agent', () => {
  it('refuses an orchestrator id no agent holds with 404', async () => {
    /** unknown id */
    seedAgents([])
    seedTeams([makeTeam()])
    await expect(updateTeam('team-1', { orchestratorId: 'ghost' }, MANAGER))
      .rejects.toMatchObject({ message: 'Orchestrator agent not found', code: 404 })
    expect(loadTeams()[0].orchestratorId).toBeUndefined()
  })

  it('refuses a soft-deleted agent as orchestrator with 404', async () => {
    /** the real getAgent excludes agents carrying deletedAt */
    seedAgents([{ id: 'dead-agent', name: 'dead', deletedAt: '2025-01-01T00:00:00.000Z' }])
    seedTeams([makeTeam({ agentIds: ['dead-agent'] })])
    await expect(updateTeam('team-1', { orchestratorId: 'dead-agent' }, MANAGER))
      .rejects.toMatchObject({ message: 'Orchestrator agent not found', code: 404 })
  })

  it('accepts a live member as orchestrator', async () => {
    /** control */
    seedAgents([{ id: 'live-agent', name: 'live' }])
    seedTeams([makeTeam({ agentIds: ['live-agent'] })])
    const updated = await updateTeam('team-1', { orchestratorId: 'live-agent' }, MANAGER)
    expect(updated?.orchestratorId).toBe('live-agent')
  })

  it('accepts a live agent that is not yet in agentIds (create path seats the orchestrator first)', async () => {
    /** pins that membership is intentionally not enforced at this choke point */
    seedAgents([{ id: 'live-agent', name: 'live' }])
    seedTeams([makeTeam()])
    const updated = await updateTeam('team-1', { orchestratorId: 'live-agent' }, MANAGER)
    expect(updated?.orchestratorId).toBe('live-agent')
  })

  it('refuses the MANAGER as orchestrator through updateTeam with 409', async () => {
    /** the check reaches the real write path, not only the pure validator */
    seedAgents([{ id: MANAGER, name: 'mgr' }])
    seedTeams([makeTeam()])
    await expect(updateTeam('team-1', { orchestratorId: MANAGER }, MANAGER))
      .rejects.toMatchObject({ code: 409 })
  })

  it('accepts an update that does not touch orchestratorId on a team whose orchestrator no longer exists', async () => {
    /** the unchanged orchestrator is not re-validated */
    seedAgents([])
    seedTeams([makeTeam({ orchestratorId: 'ghost' })])
    const updated = await updateTeam('team-1', { description: 'new description' }, MANAGER)
    expect(updated?.description).toBe('new description')
    expect(updated?.orchestratorId).toBe('ghost')
  })

  it('accepts re-setting the SAME nonexistent orchestrator id', async () => {
    /** compensations restoring an equal value cannot newly fail */
    seedAgents([])
    seedTeams([makeTeam({ orchestratorId: 'ghost' })])
    const updated = await updateTeam('team-1', { orchestratorId: 'ghost' }, MANAGER)
    expect(updated?.orchestratorId).toBe('ghost')
  })

  it('accepts setting orchestratorId to null', async () => {
    /** clearing the slot is never blocked */
    seedAgents([])
    seedTeams([makeTeam({ orchestratorId: 'ghost' })])
    const updated = await updateTeam('team-1', { orchestratorId: null }, MANAGER)
    expect(updated?.orchestratorId).toBeNull()
  })
})
