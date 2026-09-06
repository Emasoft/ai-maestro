/**
 * R31 incomplete-team freeze wired into DeleteAgent and ChangeTitle — TRDD-0KMDJVON,
 * acceptance box 3 (2 of its remaining 3 unwired call sites: DeleteAgent, ChangeTitle —
 * `createNewTeam` is covered separately by tests/unit/create-team-freezes-incomplete.test.ts;
 * `ChangeTeam` is wired identically in `services/element-management-service.ts`'s G04e/G07b
 * gates but has no dedicated case here) and box 5's first half ("deleting a member from a
 * complete team re-freezes it while the COS stays awake").
 *
 * WHY THE REAL `lib/team-registry.ts` — a mock of `freezeIncompleteTeam`/`isTeamComplete`
 * would only prove the new gates CALL those functions, never that a real roster mutation
 * actually flips a real team's completeness and hibernates the right agents. So this file
 * fakes the ecosystem HOME (0-IMPACT — never the developer's real `~/.aimaestro/`) and lets
 * `loadTeams`/`saveTeams`/`getTeam`/`freezeIncompleteTeam`/`isTeamComplete` run for real
 * against a scratch temp directory, exactly like the sibling `createNewTeam` file does.
 *
 * Only the DATA SOURCES around the two pipelines are mocked: agent-registry (a disk-mirrored
 * Map fixture borrowed from tests/helpers/drive-delete-agent.ts, since G08b/G14/G22 all
 * re-verify their writes with the REAL `fs`), governance / group-registry / session-persistence
 * / amp-auth / aid-token / governance-request-registry / ledger-emit / agents-transfer-service
 * (inert stubs, also borrowed from that helper), agents-core-service (`wakeAgent` — a local spy
 * so "who got woken" is an observation, not an inference), agent-runtime (`listSessions`), and
 * `child_process` (tmux `kill-session` — a local spy so "who got hibernated" is an observation
 * and no real subprocess is ever spawned).
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { rmSync } from 'fs'
import { seedAgent } from '@/tests/helpers/drive-delete-agent'
import type { Team } from '@/types/team'

const H = vi.hoisted(() => {
  const os = require('os') as typeof import('os')
  const fs = require('fs') as typeof import('fs')
  const path = require('path') as typeof import('path')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-roster-refreeze-'))
  return {
    FAKE_HOME: path.join(root, 'home'),
    FAKE_STATE: path.join(root, 'state'),
    registry: new Map<string, Record<string, unknown>>(),
    killedSessionNames: [] as string[],
    wokenIds: [] as string[],
    /** Flipped on to force DeleteAgent's G08 (registry delete) to fail — the injection point
     *  for the "a later gate failing after the freeze" case (c). */
    failRegistryDelete: false,
  }
})

const HELPER = '@/tests/helpers/drive-delete-agent'

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, homedir: () => H.FAKE_HOME, default: { ...actual, homedir: () => H.FAKE_HOME } }
})
vi.mock('@/lib/ecosystem-constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ecosystem-constants')>()
  const { fakeEcosystemPaths } = await import('@/tests/helpers/fake-ecosystem-home')
  return fakeEcosystemPaths(actual, H.FAKE_HOME, H.FAKE_STATE)
})

// `@/lib/team-registry` runs FOR REAL for every store the R31 gates read/write (it resolves its
// own storage path — `getStateDir()` — at import time, which the ecosystem-constants fake above
// already redirects) — only `freezeIncompleteTeam` is wrapped in a vi.fn so ONE test below can
// force it to throw exactly once (fail-fast, TRDD-0KMDJVON row43), without disturbing the real
// implementation every other test in this file relies on.
vi.mock('@/lib/team-registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/team-registry')>()
  return {
    ...actual,
    freezeIncompleteTeam: vi.fn((...args: Parameters<typeof actual.freezeIncompleteTeam>) =>
      actual.freezeIncompleteTeam(...args)
    ),
  }
})

vi.mock('@/lib/agent-registry', async () => {
  const h = await import(HELPER)
  const base = h.registryMock(H.registry as never, h.registryPath(H.FAKE_STATE))
  return {
    ...base,
    deleteAgent: async (id: string, hard: boolean) => {
      if (H.failRegistryDelete) return false
      return base.deleteAgent(id, hard)
    },
  }
})

vi.mock('@/lib/governance', async () => (await import(HELPER)).stubs.governance())
vi.mock('@/lib/ledger-emit', async () => (await import(HELPER)).stubs.ledgerEmit())
vi.mock('@/lib/aid-ledger-authority', () => ({ recordAidRevocation: async () => undefined }))
vi.mock('@/services/agents-transfer-service', async () => (await import(HELPER)).stubs.agentsTransfer())
vi.mock('@/lib/group-registry', async () => (await import(HELPER)).stubs.groupRegistry())
vi.mock('@/lib/governance-request-registry', async () => (await import(HELPER)).stubs.governanceRequests())
vi.mock('@/lib/session-persistence', async () => (await import(HELPER)).stubs.sessionPersistence())
vi.mock('@/lib/amp-auth', async () => (await import(HELPER)).stubs.ampAuth())
vi.mock('@/lib/aid-token', async () => (await import(HELPER)).stubs.aidToken())

// `listSessions: async () => []` means "track nothing as live" — every hibernated id is a wake
// candidate to the new gates' compensations, same simplification the sibling create-team test uses.
vi.mock('@/lib/agent-runtime', () => ({
  getRuntime: () => ({
    sessionExists: async () => false,
    killSession: async () => undefined,
    listSessions: async () => [],
  }),
}))

vi.mock('@/services/agents-core-service', () => ({
  wakeAgent: async (id: string) => {
    H.wokenIds.push(id)
    return { data: { woken: true }, status: 200 }
  },
}))

// `hibernateTeamAgentSession` (lib/team-registry.ts) shells out to real tmux via `execFile` —
// this is the ONLY thing standing between "who got hibernated" and an actual subprocess.
vi.mock('child_process', () => ({
  execFile: (
    _cmd: string,
    args: string[],
    _opts: unknown,
    callback: (err: Error | null, result?: { stdout: string; stderr: string }) => void
  ) => {
    if (args[0] === 'kill-session' && args[1] === '-t') H.killedSessionNames.push(args[2])
    callback(null, { stdout: '', stderr: '' })
  },
}))

const OWNER_CTX = { isSystemOwner: true, agentId: null, governanceTitle: null } as never

const COS_ID = 'agent-cos'
const ARCH_ID = 'agent-arch'
const ORCH_ID = 'agent-orch'
const INT_ID = 'agent-int'
const MEMBER_ID = 'agent-member'

const COS_NAME = 'cos-agent'
const ARCH_NAME = 'arch-agent'
const ORCH_NAME = 'orch-agent'
const INT_NAME = 'int-agent'
const MEMBER_NAME = 'member-agent'

/** A team holding a live agent for all 5 R12.1 titles — complete, never frozen at seed time. */
async function seedCompleteTeam(teamId: string): Promise<void> {
  seedAgent(H.registry as never, H.FAKE_HOME, H.FAKE_STATE, { id: COS_ID, name: COS_NAME, governanceTitle: 'chief-of-staff' })
  seedAgent(H.registry as never, H.FAKE_HOME, H.FAKE_STATE, { id: ARCH_ID, name: ARCH_NAME, governanceTitle: 'architect' })
  seedAgent(H.registry as never, H.FAKE_HOME, H.FAKE_STATE, { id: ORCH_ID, name: ORCH_NAME, governanceTitle: 'orchestrator' })
  seedAgent(H.registry as never, H.FAKE_HOME, H.FAKE_STATE, { id: INT_ID, name: INT_NAME, governanceTitle: 'integrator' })
  seedAgent(H.registry as never, H.FAKE_HOME, H.FAKE_STATE, { id: MEMBER_ID, name: MEMBER_NAME, governanceTitle: 'member' })

  const team: Team = {
    id: teamId,
    name: 'R31 Refreeze Team',
    type: 'closed',
    agentIds: [COS_ID, ARCH_ID, ORCH_ID, INT_ID, MEMBER_ID],
    chiefOfStaffId: COS_ID,
    orchestratorId: ORCH_ID,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as Team
  // saveTeams is the REAL lib/team-registry.ts writer — it lands on the faked state dir.
  const { saveTeams } = await import('@/lib/team-registry')
  saveTeams([team])
}

beforeEach(() => {
  vi.clearAllMocks()
  H.registry.clear()
  H.killedSessionNames = []
  H.wokenIds = []
  H.failRegistryDelete = false
})

afterAll(() => {
  rmSync(H.FAKE_HOME, { recursive: true, force: true })
  rmSync(H.FAKE_STATE, { recursive: true, force: true })
})

describe('roster mutations re-evaluate R31 team completeness (TRDD-0KMDJVON)', () => {
  it('DeleteAgent of a non-COS member of a complete team freezes it, hibernates the rest, and spares the COS', async () => {
    const TEAM_ID = 'team-delete-member'
    await seedCompleteTeam(TEAM_ID)
    const { DeleteAgent } = await import('@/services/element-management-service')
    const { loadTeams } = await import('@/lib/team-registry')

    const result = await DeleteAgent(MEMBER_ID, { authContext: OWNER_CTX, hard: false })

    expect(result.success).toBe(true)
    expect(result.operations).toContain(
      'G04b: Team "R31 Refreeze Team" now incomplete after removal — frozen, 3 agent(s) hibernated, COS spared',
    )
    // Every remaining non-COS agent was hibernated — the COS was never touched.
    expect(H.killedSessionNames.slice().sort()).toEqual([ARCH_NAME, INT_NAME, ORCH_NAME].sort())
    expect(H.killedSessionNames).not.toContain(COS_NAME)

    const onDisk = loadTeams().find(t => t.id === TEAM_ID) as Team
    expect(onDisk.frozen).toBe(true)
    expect(onDisk.agentIds).toEqual([COS_ID, ARCH_ID, ORCH_ID, INT_ID])
  })

  it('ChangeTitle that moves the last MEMBER off its team-required title freezes the now-incomplete team', async () => {
    const TEAM_ID = 'team-title-move'
    await seedCompleteTeam(TEAM_ID)
    const { ChangeTitle } = await import('@/services/element-management-service')
    const { loadTeams } = await import('@/lib/team-registry')

    // 'architect' is not a SINGLETON_TEAM_TITLE, so this is legal even with ARCH already holding
    // it — and it leaves NOBODY on the roster holding 'member', which is what R31 must catch.
    const result = await ChangeTitle(MEMBER_ID, 'architect', { authContext: OWNER_CTX, skipPluginSync: true })

    expect(result.success).toBe(true)
    expect(result.operations).toContain(
      'G23: Team "R31 Refreeze Team" is now incomplete — frozen, 4 agent(s) hibernated, COS spared',
    )
    // The re-titled agent itself is now a non-COS team member too — it gets hibernated with the rest.
    expect(H.killedSessionNames.slice().sort()).toEqual([ARCH_NAME, INT_NAME, MEMBER_NAME, ORCH_NAME].sort())
    expect(H.killedSessionNames).not.toContain(COS_NAME)

    const onDisk = loadTeams().find(t => t.id === TEAM_ID) as Team
    expect(onDisk.frozen).toBe(true)
  })

  it('a later gate failing after the freeze wakes every agent the freeze hibernated and clears the frozen flag', async () => {
    const TEAM_ID = 'team-rollback'
    await seedCompleteTeam(TEAM_ID)
    H.failRegistryDelete = true // forces DeleteAgent's G08 to throw, well after G04b's freeze
    const { DeleteAgent } = await import('@/services/element-management-service')
    const { loadTeams } = await import('@/lib/team-registry')

    const result = await DeleteAgent(MEMBER_ID, { authContext: OWNER_CTX, hard: false })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/GATE NUMBER \d+ \(G08\)/)
    // The freeze DID run for real before the simulated throw — every non-COS teammate was hibernated.
    expect(H.killedSessionNames.slice().sort()).toEqual([ARCH_NAME, INT_NAME, ORCH_NAME].sort())
    // ...and the rollback woke exactly those, and only those.
    expect(new Set(H.wokenIds)).toEqual(new Set([ARCH_ID, ORCH_ID, INT_ID]))
    expect(result.operations).toContain('G04b: reverted')

    const onDisk = loadTeams().find(t => t.id === TEAM_ID) as Team
    expect(onDisk.frozen).not.toBe(true)
    // G04's own undo restores the roster too, so MEMBER is back — parity with the un-frozen state.
    expect(onDisk.agentIds).toEqual([COS_ID, ARCH_ID, ORCH_ID, INT_ID, MEMBER_ID])
  })

  it('a throwing freeze fails the DeleteAgent pipeline instead of being swallowed (fail-fast)', async () => {
    const TEAM_ID = 'team-delete-throw'
    await seedCompleteTeam(TEAM_ID)
    const { DeleteAgent } = await import('@/services/element-management-service')
    const { freezeIncompleteTeam, loadTeams } = await import('@/lib/team-registry')
    const { getAgent } = await import('@/lib/agent-registry')

    // G04b's freeze call itself throws — this used to be swallowed by an inner try/catch
    // (WARN-only, delete reported success with the WARN op appended). Fail-fast now means the
    // throw propagates through `runGateSequence`, which unwinds G04's roster removal.
    vi.mocked(freezeIncompleteTeam).mockImplementationOnce(() => {
      throw new Error('simulated freeze failure')
    })

    const result = await DeleteAgent(MEMBER_ID, { authContext: OWNER_CTX, hard: false })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/GATE NUMBER \d+ \(G04b\)/)
    expect(result.error).toMatch(/simulated freeze failure/)
    // The freeze threw before any hibernation happened — nothing to wake.
    expect(H.killedSessionNames).toEqual([])
    expect(H.wokenIds).toEqual([])
    // The agent was never actually removed — G04's own undo restored the roster and the agent
    // is still present in the registry (the pipeline was rolled back, not merely warned about).
    const onDisk = loadTeams().find(t => t.id === TEAM_ID) as Team
    expect(onDisk.agentIds).toContain(MEMBER_ID)
    expect(getAgent(MEMBER_ID)).not.toBeNull()
  })
})
