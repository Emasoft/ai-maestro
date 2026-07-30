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
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

// A fake $HOME so the `plugin-records` probe can be driven against a SEEDED store. Without it that
// probe reads the developer's real ~/.claude/plugins/installed_plugins.json, and since no real
// record points at this file's fixture workdir it would answer "clean" for a reason the fixture
// never established — the vacuous-gate shape. Read-only either way, but a probe nothing exercises
// positively is a probe that could be broken in any way and still let the suite pass.
const HOME_ = vi.hoisted(() => {
  // `require` inline: vi.hoisted runs above every static import, so the `fs`/`path` bindings at the
  // top of this file are not initialised yet.
  const { mkdtempSync } = require('fs') as typeof import('fs')
  const { join: j } = require('path') as typeof import('path')
  const root = (process.env.TMPDIR || '/tmp').replace(/\/$/, '')
  return { FAKE_HOME: mkdtempSync(j(root, 'aim-teardown-')) }
})

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  const homedir = () => HOME_.FAKE_HOME
  return { ...actual, homedir, default: { ...actual, homedir } }
})

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

  // Both cases above are `not.toContain` — they pass whenever the probe returns null, for ANY
  // reason, so on their own they cannot tell a working probe from a broken one. These two are the
  // positive controls that make the pair above mean something.
  it('DETECTS a workdir that survived a delete-with-folder', async () => {
    const dir = join(HOME_.FAKE_HOME, 'agents', 'survivor')
    mkdirSync(dir, { recursive: true })
    const v = await verifyAgentRemoved({ ...CTX, workingDirectory: dir, expectFolderGone: true })
    expect(v.residue.map((r) => r.store)).toContain('workdir')
  })

  it('does NOT report a surviving transcript dir as residue — it is policy, not residue (TRDD-0GCIMQ9F)', async () => {
    // The INVERSE of what this test asserted until 2026-07-30, and the inversion is the point.
    // DeleteAgent used to recursively delete `~/.claude/projects/<slug>/` — the user's own
    // conversation history, in another tool's directory, outside both of our roots. Shape A removed
    // it: Claude Code owns transcript retention, and a second deleter of someone else's data can
    // only ever be the one that deleted too much.
    //
    // So a surviving transcript dir is now EXPECTED. This test exists so a future audit reading
    // "the transcript dir was not cleaned up" cannot restore the purge without reddening a test that
    // says why. The workdir deliberately carries both '.' and '_' — the characters an earlier slug
    // rule mangled — so the directory really is the one a probe would have found.
    const dir = join(HOME_.FAKE_HOME, 'agents', 'ghost_v1.2')
    mkdirSync(join(HOME_.FAKE_HOME, '.claude', 'projects', dir.replace(/\//g, '-')), { recursive: true })
    // The workdir is created too, and NOT incidentally: without it the residue list comes back
    // EMPTY and `not.toContain` passes because nothing was reported at all — which is the same
    // vacuous pass a deleted probe would produce. Seeding a store that DOES claim makes the
    // assertion below about the transcript store specifically. (Caught by this guard failing.)
    mkdirSync(dir, { recursive: true })
    const v = await verifyAgentRemoved({ ...CTX, workingDirectory: dir, expectFolderGone: true })
    const stores = v.residue.map((r) => r.store)
    expect(stores).toContain('workdir')
    expect(stores).not.toContain('transcript-dir')
  })
})

describe('the plugin-records probe — driven against a seeded store (TRDD-AQTGAY60)', () => {
  // Under the fake $HOME, so `managedRoot` and the store path both resolve inside the fixture.
  const MANAGED = join(HOME_.FAKE_HOME, 'agents', 'ghost')
  const SIBLING = join(HOME_.FAKE_HOME, 'agents', 'other')
  const STORE = join(HOME_.FAKE_HOME, '.claude', 'plugins', 'installed_plugins.json')
  const KEY = 'ai-maestro-plugin@ai-maestro-plugins'
  const HARD = { ...CTX, workingDirectory: MANAGED, expectFolderGone: true, hard: true }

  function seedStore(plugins: Record<string, unknown>): void {
    mkdirSync(join(HOME_.FAKE_HOME, '.claude', 'plugins'), { recursive: true })
    writeFileSync(STORE, JSON.stringify({ version: 1, plugins }, null, 2), 'utf-8')
  }

  it('detects a local record left behind for the deleted workdir (G09b did not run)', async () => {
    // THE positive control this probe never had: every other store has a "detects a surviving X"
    // test, and until now this one only ever returned early at the expectFolderGone guard.
    seedStore({ [KEY]: [{ scope: 'local', projectPath: MANAGED }] })
    const v = await verifyAgentRemoved(HARD)
    expect(v.clean).toBe(false)
    expect(v.residue.find((r) => r.store === 'plugin-records')?.detail).toContain(`${KEY}(1)`)
  })

  it('does NOT count a user-scope row even when it carries this workdir path', async () => {
    // The row is seeded WITH `projectPath` on purpose. A today-shaped user row has none, so
    // `projectPath === workdir` already excludes it and a test using that shape would pass with
    // the `scope === 'local'` check DELETED — measured, not assumed (neuter B reddened nothing).
    // This is the "future record shape" the probe's own comment names as the reason the check
    // exists, and it is the only seed that actually pins that line.
    seedStore({ [KEY]: [{ scope: 'user', projectPath: MANAGED, version: '2.8.0' }] })
    expect((await verifyAgentRemoved(HARD)).clean).toBe(true)
  })

  it('does NOT count another agent record for the same plugin', async () => {
    seedStore({ [KEY]: [{ scope: 'local', projectPath: SIBLING }] })
    expect((await verifyAgentRemoved(HARD)).clean).toBe(true)
  })

  it('leaves the SAME record alone after a soft delete — the workdir survives, so it is TRUE', async () => {
    // The split G09b is scoped on, checked from the verifier side: a soft delete keeps the folder,
    // so a record asserting "installed for this directory" is a fact, not residue. A probe that
    // flagged it would make every soft delete report INCOMPLETE forever.
    seedStore({ [KEY]: [{ scope: 'local', projectPath: MANAGED }] })
    const soft = { ...CTX, workingDirectory: MANAGED, expectFolderGone: false, hard: false }
    expect((await verifyAgentRemoved(soft)).clean).toBe(true)
  })

  it('stays inert for a workdir outside ~/agents/, whose records G03-SAFETY keeps true', async () => {
    seedStore({ [KEY]: [{ scope: 'local', projectPath: '/tmp/not-managed/ghost' }] })
    const outside = { ...CTX, workingDirectory: '/tmp/not-managed/ghost', expectFolderGone: true }
    expect((await verifyAgentRemoved(outside)).clean).toBe(true)
  })

  it('reports an unreadable store as residue rather than clean (fail-closed)', async () => {
    seedStore({})
    writeFileSync(STORE, '{ this is not json', 'utf-8')
    const v = await verifyAgentRemoved(HARD)
    expect(v.residue.map((r) => r.store)).toContain('plugin-records')
  })

  it('0-IMPACT: the fixture store is inside the temp $HOME, never the developer own', () => {
    expect(STORE.startsWith(HOME_.FAKE_HOME)).toBe(true)
    expect(HOME_.FAKE_HOME).not.toBe(process.env.HOME)
  })

  // The temp dir is deliberately NOT removed: /tmp is swept by the OS, and tearing it down here
  // would delete the evidence if one of the cases above failed mid-run.
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
        // TRDD-AQTGAY60: had no gate AND no probe, so 93 of 101 local records on the dev host
        // pointed at deleted agents while every one of those deletes reported CLEAN.
        'plugin-records',
        'registry',
        'teams',
        'tmux-session',
        // NO 'transcript-dir' — asserted by ABSENCE, deliberately (TRDD-0GCIMQ9F, Shape A). The
        // purge it probed for deleted the user's own conversation history outside our roots and is
        // gone; a probe for it would mark every hard delete incomplete forever. Adding it back
        // reddens this list.
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
