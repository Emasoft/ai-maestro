/**
 * The agent-teardown POST-CONDITION (TRDD-KERM18NX).
 *
 * The property under test is NOT "each gate ran" — that is what the old shape already claimed while
 * a deleted agent's PersistedSession row survived and kept resurrecting its workdir. It is: does the
 * verifier notice when a store STILL claims the agent, and does it refuse to call an unknown state
 * clean?
 *
 * 0-IMPACT: every store module is mocked. No registry, no tmux, no filesystem writes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  getAgent: vi.fn(),
  loadPersistedSessions: vi.fn(),
  sessionExists: vi.fn(),
  loadTeams: vi.fn(),
  loadGroups: vi.fn(),
  getKeysForAgent: vi.fn(),
  countTokensForAgent: vi.fn(),
  loadGovernanceRequests: vi.fn(),
}))

vi.mock('@/lib/agent-registry', () => ({ getAgent: h.getAgent }))
vi.mock('@/lib/session-persistence', () => ({ loadPersistedSessions: h.loadPersistedSessions }))
vi.mock('@/lib/agent-runtime', () => ({ getRuntime: () => ({ sessionExists: h.sessionExists }) }))
vi.mock('@/lib/team-registry', () => ({ loadTeams: h.loadTeams }))
vi.mock('@/lib/group-registry', () => ({ loadGroups: h.loadGroups }))
vi.mock('@/lib/amp-auth', () => ({ getKeysForAgent: h.getKeysForAgent }))
vi.mock('@/lib/aid-token', () => ({ countTokensForAgent: h.countTokensForAgent }))
vi.mock('@/lib/governance-request-registry', () => ({ loadGovernanceRequests: h.loadGovernanceRequests }))

import { verifyAgentRemoved, formatVerification, AGENT_STORES } from '@/lib/agent-teardown'

const CTX = {
  agentId: 'agent-1',
  agentName: 'ghost',
  sessionName: 'ghost',
  // Outside ~/agents/ on purpose so the two filesystem probes stay inert unless a test opts in.
  workingDirectory: '/tmp/not-managed/ghost',
  expectFolderGone: false,
  hard: true,
}

/** All stores answer "I do not have it". */
function allClean() {
  h.getAgent.mockReturnValue(undefined)
  h.loadPersistedSessions.mockReturnValue([])
  h.sessionExists.mockResolvedValue(false)
  h.loadTeams.mockReturnValue([])
  h.loadGroups.mockReturnValue([])
  h.getKeysForAgent.mockReturnValue([])
  h.countTokensForAgent.mockReturnValue(0)
  h.loadGovernanceRequests.mockReturnValue({ requests: [] })
}

beforeEach(() => {
  vi.clearAllMocks()
  allClean()
})

describe('teardown verification — the clean case', () => {
  it('reports clean and says how many stores it actually probed', async () => {
    const v = await verifyAgentRemoved(CTX)
    expect(v.clean).toBe(true)
    expect(v.residue).toEqual([])
    // A "verification" that probed nothing is not a verification — pin the count to the manifest.
    expect(v.probed).toBe(AGENT_STORES.length)
    expect(formatVerification(v)).toContain('verified clean')
  })
})

describe('teardown verification — each store is actually asked', () => {
  it('detects a surviving PersistedSession row (THE regression that started this)', async () => {
    // This exact row outliving the agent is what made deleted workdirs regrow forever.
    h.loadPersistedSessions.mockReturnValue([{ id: 'ghost', agentId: 'agent-1', workingDirectory: '/x' }])
    const v = await verifyAgentRemoved(CTX)
    expect(v.clean).toBe(false)
    expect(v.residue.map((r) => r.store)).toContain('persisted-session')
    expect(formatVerification(v)).toContain('INCOMPLETE')
  })

  it('matches a persisted row by agentId even when the row id differs from the name', async () => {
    h.loadPersistedSessions.mockReturnValue([{ id: 'renamed-later', agentId: 'agent-1' }])
    const v = await verifyAgentRemoved(CTX)
    expect(v.residue.map((r) => r.store)).toContain('persisted-session')
  })

  it('detects a live registry row after a HARD delete', async () => {
    h.getAgent.mockReturnValue({ id: 'agent-1', name: 'ghost' })
    const v = await verifyAgentRemoved({ ...CTX, hard: true })
    expect(v.residue.map((r) => r.store)).toContain('registry')
  })

  it('accepts a tombstone after a SOFT delete, but not a live row', async () => {
    h.getAgent.mockReturnValue({ id: 'agent-1', deletedAt: '2026-07-25T00:00:00Z' })
    expect((await verifyAgentRemoved({ ...CTX, hard: false })).clean).toBe(true)

    h.getAgent.mockReturnValue({ id: 'agent-1', deletedAt: null })
    const v = await verifyAgentRemoved({ ...CTX, hard: false })
    expect(v.residue.map((r) => r.store)).toContain('registry')
  })

  it('detects a still-running tmux session', async () => {
    h.sessionExists.mockResolvedValue(true)
    const v = await verifyAgentRemoved(CTX)
    expect(v.residue.map((r) => r.store)).toContain('tmux-session')
  })

  it('detects team membership AND a held COS slot', async () => {
    h.loadTeams.mockReturnValue([{ name: 'T1', agentIds: ['agent-1'] }])
    expect((await verifyAgentRemoved(CTX)).residue.map((r) => r.store)).toContain('teams')

    h.loadTeams.mockReturnValue([{ name: 'T2', agentIds: [], chiefOfStaffId: 'agent-1' }])
    const v = await verifyAgentRemoved(CTX)
    expect(v.residue.find((r) => r.store === 'teams')?.detail).toContain('T2')
  })

  it('detects a surviving group subscription', async () => {
    h.loadGroups.mockReturnValue([{ name: 'G1', subscriberIds: ['agent-1'] }])
    expect((await verifyAgentRemoved(CTX)).residue.map((r) => r.store)).toContain('groups')
  })

  it('detects un-revoked AMP keys and AID tokens', async () => {
    h.getKeysForAgent.mockReturnValue([{ id: 'k1' }])
    h.countTokensForAgent.mockReturnValue(2)
    const stores = (await verifyAgentRemoved(CTX)).residue.map((r) => r.store)
    expect(stores).toContain('amp-keys')
    expect(stores).toContain('aid-tokens')
  })

  it('counts only PENDING governance requests', async () => {
    h.loadGovernanceRequests.mockReturnValue({
      requests: [
        { status: 'rejected', agentId: 'agent-1' },
        { status: 'pending', targetAgentId: 'agent-1' },
      ],
    })
    const v = await verifyAgentRemoved(CTX)
    expect(v.residue.find((r) => r.store === 'governance-requests')?.detail).toContain('1 pending')
  })
})

describe('teardown verification — fail-closed', () => {
  it('treats a THROWING probe as residue, never as clean', async () => {
    // An unreadable store is where we know least. Reporting it clean is the exact failure this
    // module exists to end, so uncertainty must resolve to "not verified".
    h.loadPersistedSessions.mockImplementation(() => {
      throw new Error('sessions.json is corrupt')
    })
    const v = await verifyAgentRemoved(CTX)
    expect(v.clean).toBe(false)
    const r = v.residue.find((x) => x.store === 'persisted-session')
    expect(r?.detail).toContain('probe failed')
    expect(r?.detail).toContain('corrupt')
  })

  it('one broken probe does not stop the others from being asked', async () => {
    h.loadTeams.mockImplementation(() => {
      throw new Error('boom')
    })
    h.sessionExists.mockResolvedValue(true)
    const stores = (await verifyAgentRemoved(CTX)).residue.map((r) => r.store)
    expect(stores).toContain('teams')
    expect(stores).toContain('tmux-session')
  })
})

describe('teardown verification — filesystem probes respect the pipeline contract', () => {
  it('ignores the workdir when the caller did not ask for it to be deleted', async () => {
    const v = await verifyAgentRemoved({ ...CTX, workingDirectory: '/tmp', expectFolderGone: false })
    expect(v.residue.map((r) => r.store)).not.toContain('workdir')
  })

  it('ignores a workdir OUTSIDE ~/agents/ even when deletion was requested', async () => {
    // G03-SAFETY refuses to delete an adopted folder (~/Code/<project>). That refusal is policy,
    // not residue — flagging it would train readers to ignore the residue list.
    const v = await verifyAgentRemoved({
      ...CTX,
      workingDirectory: '/tmp',
      expectFolderGone: true,
    })
    expect(v.residue.map((r) => r.store)).not.toContain('workdir')
  })
})

describe('the manifest is pinned', () => {
  it('covers exactly the stores DeleteAgent is responsible for', async () => {
    // A store added to the delete path without a manifest row is invisible to the post-condition —
    // which is precisely how the PersistedSession gap survived. Changing this list is a deliberate
    // act: add the gate AND the row, then update this pin.
    expect(AGENT_STORES.map((s) => s.id).sort()).toEqual(
      [
        'aid-tokens',
        'amp-keys',
        'governance-requests',
        'groups',
        'persisted-session',
        'registry',
        'teams',
        'tmux-session',
        'transcript-dir',
        'workdir',
      ].sort(),
    )
  })

  it('every store declares what it owns, so a residue report is actionable', () => {
    for (const s of AGENT_STORES) {
      expect(s.owns.length).toBeGreaterThan(0)
      expect(typeof s.claims).toBe('function')
    }
  })
})
