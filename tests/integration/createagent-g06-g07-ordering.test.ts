/**
 * CreateAgent — G06/G07 title-and-team ordering (observable effects)
 *
 * Background (SCEN-003, SCEN-007, SCEN-010, SCEN-020):
 *   The governance pipeline must correctly handle the interaction between
 *   a requested governanceTitle and teamId when both are supplied at
 *   creation time. The three decision paths in G06 + G07 are:
 *
 *     1. Team-required title (member, chief-of-staff, orchestrator,
 *        architect, integrator) + teamId → G06 DEFERS the title,
 *        G07 joins the team, G07b re-applies the requested title.
 *     2. Standalone title (manager, autonomous, maintainer) + teamId →
 *        G06 applies the title directly, G07 adds to team afterwards.
 *     3. No title, no team → G06 defaults to AUTONOMOUS (R9.13 guarantees
 *        every persisted agent has a role-plugin).
 *
 * Scope of this suite: verify the G01–G03 + G06 ops-log markers that
 * CreateAgent emits for each branch. ChangeTitle/ChangeTeam are called
 * internally (same module), which vi.spyOn cannot reliably intercept,
 * so these tests focus on the observable ops-log strings that document
 * the decision actually taken. Full end-to-end behaviour is exercised
 * by the browser scenarios (SCEN-020, SCEN-007, SCEN-010).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Hoist mock refs so they are in scope when vi.mock() rewrites imports.
// The `registryStore` bridges createAgent() / getAgent() / updateAgent()
// so ChangeTitle (called internally by CreateAgent G06) can locate the
// just-created agent. Without it, ChangeTitle's Gate 1 fails with
// "Agent not found" and G06 rolls back the creation.
const {
  mockGetAgentByName,
  mockLoadAgents,
  mockCreateAgent,
  mockDeleteAgent,
  mockUpdateAgent,
  mockGetAgent,
  mockLoadSecurityConfig,
  mockCheckIbctScope,
  mockDetectClientType,
  mockGetClientCapabilities,
  mockHasKP,
  mockRm,
  mockGetManagerId,
  mockUpdateTeam,
  registryStore,
  teamStore,
} = vi.hoisted(() => {
  const store = new Map<string, { id: string; name: string; program?: string; workingDirectory?: string; governanceTitle?: string | null; roleMissing?: boolean }>()
  // A STATEFUL team double, because the compensation under test is a round trip: G07 joins and its
  // undo leaves. A `getTeam: () => undefined` stub can only ever exercise the WARN branch, which is
  // exactly why G07's undo sat written-but-undriven when it was first shipped.
  const teams = new Map<string, { id: string; name: string; agentIds: string[]; chiefOfStaffId?: string | null }>()
  return {
    registryStore: store,
    teamStore: teams,
    mockGetManagerId: vi.fn(() => null as string | null),
    mockUpdateTeam: vi.fn(async (id: string, patch: Record<string, unknown>) => {
      const existing = teams.get(id)
      if (!existing) return undefined
      const updated = { ...existing, ...patch } as { id: string; name: string; agentIds: string[] }
      teams.set(id, updated)
      return updated
    }),
    mockGetAgentByName: vi.fn(),
    mockLoadAgents: vi.fn(() => Array.from(store.values())),
    mockCreateAgent: vi.fn(),
    mockDeleteAgent: vi.fn(async (id: string) => { store.delete(id) }),
    mockUpdateAgent: vi.fn(async (id: string, patch: Record<string, unknown>) => {
      const existing = store.get(id)
      if (!existing) return null
      const updated = { ...existing, ...patch }
      store.set(id, updated)
      // Return the PATCHED record so ChangeTitle Gate 14's in-memory check
      // (g14Updated.governanceTitle === effectiveTitle) sees the new value.
      // Returning `existing` would leak the pre-patch reference and the
      // gate would short-circuit with "in-memory post-write mismatch".
      return updated
    }),
    mockGetAgent: vi.fn((id: string) => store.get(id)),
    mockLoadSecurityConfig: vi.fn(() => ({
      agentCreation: { maxAgentsPerHost: 100, minIntervalSeconds: 0 },
    })),
    mockCheckIbctScope: vi.fn(() => null),
    mockDetectClientType: vi.fn(() => 'claude'),
    mockGetClientCapabilities: vi.fn(() => ({
      plugins: true, skills: true, agents: true, hooks: true,
    })),
    mockHasKP: vi.fn(() => true),
    // The workdir removal is the compensation the retrofit ADDED (TRDD-DQ6XN2VP): before it,
    // a failed G06/G07b deleted the registry row and left ~/agents/<name>/ on disk. A pure
    // no-op double could not tell "the undo removed it" from "the undo was never written", so
    // this is a spy the parity test asserts on rather than a stub that swallows the call.
    mockRm: vi.fn(async () => undefined),
  }
})

vi.mock('@/lib/agent-registry', () => ({
  getAgentByName: mockGetAgentByName,
  loadAgents: mockLoadAgents,
  createAgent: mockCreateAgent,
  deleteAgent: mockDeleteAgent,
  updateAgent: mockUpdateAgent,
  getAgent: mockGetAgent,
  saveAgents: vi.fn(),
}))

vi.mock('@/lib/security-config', () => ({
  loadSecurityConfig: mockLoadSecurityConfig,
}))

vi.mock('@/lib/ibct-scope-check', () => ({
  checkIbctScope: mockCheckIbctScope,
}))

vi.mock('@/lib/client-capabilities', () => ({
  getClientCapabilities: mockGetClientCapabilities,
  detectClientType: mockDetectClientType,
}))

vi.mock('@/lib/amp-keys', () => ({
  generateKeyPair: vi.fn(async () => ({
    privateKey: 'p', publicKey: 'u', fingerprint: 'f0123456789abcdef0',
  })),
  saveKeyPair: vi.fn(),
  hasKeyPair: mockHasKP,
}))

// All ChangeTitle/ChangeTeam calls inside CreateAgent point at the same
// module's internal bindings (not re-resolved through the module's own
// exports). To avoid exercising the full title/team pipelines — which
// would require mocking governance.json, team-registry, role-plugin
// install, marketplaces, etc. — we mock the deepest primitives those
// pipelines touch so they fail gracefully and CreateAgent's ops log
// still reflects the branch taken.
vi.mock('@/lib/team-registry', () => ({
  // Backed by `teamStore` so a join is READ BACK by the leave. The previous constant stubs
  // (`getTeam: () => undefined`) could only produce G07's WARN branch, so the join/leave round
  // trip — the compensation the retrofit added — had no way to be exercised at all.
  loadTeams: vi.fn(() => Array.from(teamStore.values())),
  saveTeams: vi.fn((teams: { id: string; name: string; agentIds: string[] }[]) => {
    teamStore.clear()
    for (const t of teams) teamStore.set(t.id, t)
  }),
  getTeam: vi.fn((id: string) => teamStore.get(id)),
  getTeamsForAgent: vi.fn((agentId: string) =>
    Array.from(teamStore.values()).filter(t => t.agentIds.includes(agentId))),
  isAgentInAnyTeam: vi.fn((agentId: string) =>
    Array.from(teamStore.values()).some(t => t.agentIds.includes(agentId))),
  blockAllTeams: vi.fn(),
  unblockAllTeams: vi.fn(),
  // ChangeTitle Gates 11/12/13b call updateTeam to clear/set
  // chiefOfStaffId/orchestratorId on team transitions. ChangeTeam (called
  // from CreateAgent G07 for the team-required-title branch) also relies
  // on this. Without it, "No updateTeam export defined" is thrown and the
  // pipeline collapses before G07/G07b ops are logged.
  updateTeam: mockUpdateTeam,
  deleteTeam: vi.fn(async () => undefined),
  addTeam: vi.fn(async () => undefined),
}))

// Governance primitives consulted by ChangeTitle. Stubbed to a
// no-manager/no-COS world so the pipeline can proceed past governance
// checks without touching governance.json.
vi.mock('@/lib/governance', () => ({
  isManager: vi.fn(() => false),
  // Hoisted so ONE test can seed a MANAGER: team ops are manager-gated (R9/R10), so with a
  // manager-less host ChangeTeam refuses at its G01b and never reaches the join.
  getManagerId: mockGetManagerId,
  isChiefOfStaffAnywhere: vi.fn(() => false),
  setManager: vi.fn(async () => undefined),
  removeManager: vi.fn(async () => undefined),
  loadGovernance: vi.fn(() => ({ managerId: null, chiefsOfStaff: {} })),
  saveGovernance: vi.fn(),
}))

vi.mock('@/lib/governance-sync', () => ({
  broadcastGovernanceSync: vi.fn(),
}))

vi.mock('@/lib/governance-request-registry', () => ({
  loadGovernanceRequests: vi.fn(() => []),
  rejectGovernanceRequest: vi.fn(),
  approveGovernanceRequest: vi.fn(),
  createGovernanceRequest: vi.fn(),
}))

vi.mock('@/services/governance-service', () => ({
  transferManager: vi.fn(),
  assignCOS: vi.fn(),
  removeCOS: vi.fn(),
}))

vi.mock('@/services/role-plugin-service', () => ({
  createPersona: vi.fn(async () => ({ success: true })),
  listRolePlugins: vi.fn(async () => []),
  getPluginsForTitle: vi.fn(() => []),
  installPluginLocally: vi.fn(async () => ({ success: true })),
  uninstallPluginLocally: vi.fn(async () => ({ success: true })),
}))

vi.mock('@/services/plugin-storage-service', () => ({
  findNativePluginForClient: vi.fn(async () => null),
  emitForClient: vi.fn(async () => null),
  convertAndStorePlugin: vi.fn(),
  getUniversalIR: vi.fn(async () => null),
}))

vi.mock('child_process', () => ({
  execFileSync: vi.fn(() => '/usr/bin/claude'),
  execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb?: (err: Error | null, stdout: string, stderr: string) => void) => {
    if (typeof cb === 'function') cb(new Error('stub'), '', '')
  }),
}))

vi.mock('fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  stat: vi.fn(async () => {
    const err = new Error('ENOENT') as Error & { code?: string }
    err.code = 'ENOENT'
    throw err
  }),
  readFile: vi.fn(async () => ''),
  writeFile: vi.fn(async () => undefined),
  // G03's undo removes a workdir this pipeline created. Left out of the double, `rm` would be
  // `undefined` and the undo would die with a TypeError — which the runner reports as an
  // UNREVERTABLE gate, so every rollback test would fail for a fixture reason wearing the
  // costume of a product bug.
  rm: mockRm,
  readdir: vi.fn(async () => [] as string[]),
  rmdir: vi.fn(async () => undefined),
}))

// ChangeTitle Gates 14 + 22 verify that the registry write landed by reading
// ~/.aimaestro/agents/registry.json from disk via fs.readFileSync. Without a
// readFileSync mock that mirrors registryStore, Gate 14 throws + the catch
// returns "G14: registry verification failed", which short-circuits the
// pipeline before G07 ("No team requested") is logged. Mirror the in-memory
// store so the on-disk view matches whatever updateAgent has just written.
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn((p: string) => {
    if (typeof p === 'string' && p.endsWith('registry.json')) {
      return JSON.stringify(Array.from(registryStore.values()))
    }
    return ''
  }),
  promises: {
    readFile: vi.fn(async () => ''),
    writeFile: vi.fn(async () => undefined),
  },
}))

describe('CreateAgent — G06/G07 ordering (ops-log regression)', () => {
  beforeEach(() => {
    vi.resetModules()
    registryStore.clear()
    teamStore.clear()
    mockGetManagerId.mockReset().mockReturnValue(null)
    mockUpdateTeam.mockClear()
    mockGetAgentByName.mockReset()
    mockLoadAgents.mockClear()
    mockCreateAgent.mockReset()
    // mockReset (NOT mockClear) — `vi.clearAllMocks()` in afterEach clears CALLS but not
    // IMPLEMENTATIONS, so a `mockRejectedValue` set by a rollback test used to leak into
    // every test after it. Vitest 4's mockReset restores the impl passed to `vi.fn(impl)`,
    // which is exactly the hoisted default both of these want back.
    mockDeleteAgent.mockReset()
    mockUpdateAgent.mockReset()
    mockRm.mockClear()
    mockCheckIbctScope.mockReset().mockReturnValue(null)
    mockDetectClientType.mockReset().mockReturnValue('claude')
    mockGetClientCapabilities.mockReset().mockReturnValue({
      plugins: true, skills: true, agents: true, hooks: true,
    })

    mockCreateAgent.mockImplementation(async (input: { name: string; program?: string; workingDirectory?: string }) => {
      const agent = {
        id: `agent-${input.name}-uuid`,
        name: input.name,
        program: input.program || 'claude',
        workingDirectory: input.workingDirectory || '',
        governanceTitle: null,
      }
      registryStore.set(agent.id, agent)
      return agent
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  /**
   * Regression gate for SCEN-003 / SCEN-020: team-required title + teamId
   * MUST NOT trigger a G06 title assignment. G06 must log a DEFER marker
   * and let G07/G07b apply the title after the team join. If a future
   * refactor ever drops the `titleNeedsTeamFirst` check, G06 would call
   * ChangeTitle too early and Gate 9 would reject it because the agent
   * isn't in the team yet — silently producing an AUTONOMOUS agent.
   */
  it('team-required title + teamId → ops log shows G06 DEFER', async () => {
    const { CreateAgent } = await import('@/services/element-management-service')
    const result = await CreateAgent({
      name: 'member-alpha',
      client: 'claude',
      governanceTitle: 'member',
      teamId: 'team-xyz',
      authContext: { isSystemOwner: true as const },
    })

    // Lookup the G06 ops line — it must start with DEFER, not with an
    // immediate ChangeTitle result.
    const g06Line = result.operations.find(o => o.startsWith('G06:'))
    expect(g06Line).toBeDefined()
    expect(g06Line).toMatch(/DEFER/i)
    expect(g06Line).toMatch(/team/i)
    // G06 must NOT say the title was set here
    expect(g06Line).not.toMatch(/Title set to MEMBER/)

    // And the agent record was created — createAgent was invoked
    expect(mockCreateAgent).toHaveBeenCalledTimes(1)
  })

  /**
   * Standalone title: the G06 ops line must show the title name in caps
   * without a DEFER marker. This is the happy path for MANAGER,
   * AUTONOMOUS, MAINTAINER — titles that don't require team membership.
   */
  it('standalone title (manager) → ops log shows G06 applied directly', async () => {
    const { CreateAgent } = await import('@/services/element-management-service')
    const result = await CreateAgent({
      name: 'mgr-alpha',
      client: 'claude',
      governanceTitle: 'manager',
      authContext: { isSystemOwner: true as const },
    })

    const g06Line = result.operations.find(o => o.startsWith('G06:'))
    expect(g06Line).toBeDefined()
    // MANAGER is standalone, no DEFER
    expect(g06Line).not.toMatch(/DEFER/i)
    expect(mockCreateAgent).toHaveBeenCalledTimes(1)
  })

  /**
   * No-title branch (R9.13 fallback). Every persisted agent MUST carry a
   * role-plugin — omitting `governanceTitle` should route through the
   * AUTONOMOUS default in G06. The ops log MUST show the R9.13 marker so
   * a future audit can verify the fallback ran.
   */
  it('no title + no team → G06 defaults to AUTONOMOUS (R9.13 fallback)', async () => {
    const { CreateAgent } = await import('@/services/element-management-service')
    const result = await CreateAgent({
      name: 'solo-alpha',
      client: 'claude',
      authContext: { isSystemOwner: true as const },
    })

    const g06Line = result.operations.find(o => o.startsWith('G06:'))
    expect(g06Line).toBeDefined()
    expect(g06Line).toMatch(/AUTONOMOUS/i)
    expect(g06Line).toMatch(/R9\.13/)

    // And G07 must record that no team was requested
    const g07Line = result.operations.find(o => o.startsWith('G07:'))
    expect(g07Line).toBeDefined()
    expect(g07Line).toMatch(/no team/i)
  })

  /**
   * Name validation gate (G01). Bad names must fail fast BEFORE any
   * filesystem or registry work. This catches regressions where the
   * validation regex is relaxed and slashes/spaces/Unicode leak through.
   */
  it('G01: rejects invalid name, no createAgent call', async () => {
    const { CreateAgent } = await import('@/services/element-management-service')
    const result = await CreateAgent({
      name: 'bad name with spaces',
      client: 'claude',
      authContext: { isSystemOwner: true as const },
    })
    expect(result.success).toBe(false)
    expect(result.agentId).toBeNull()
    expect(result.error).toMatch(/Invalid agent name/i)
    expect(mockCreateAgent).not.toHaveBeenCalled()
  })

  /**
   * Name uniqueness gate (G01b) — SCEN-016 regression. A live (non-
   * tombstoned) agent with the same name must block creation. Soft-
   * deleted entries must NOT block (tested elsewhere).
   */
  it('G01b: rejects when name already exists in registry', async () => {
    mockGetAgentByName.mockReturnValue({ id: 'existing-id', name: 'dup' })
    const { CreateAgent } = await import('@/services/element-management-service')
    const result = await CreateAgent({
      name: 'dup',
      client: 'claude',
      authContext: { isSystemOwner: true as const },
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/already exists/i)
    expect(mockCreateAgent).not.toHaveBeenCalled()
  })

  /**
   * R51.5 — a FAILED rollback may never be reported as "nothing was created".
   *
   * G06 rolls back a half-created agent by deleting it, and honestly records
   * `ROLLBACK ALSO FAILED` in the ops trace when that delete throws. But `result.agentId
   * = null` used to run in BOTH branches, so on a failed rollback the caller was handed
   * `agentId: null` — "no agent exists" — while the orphan sat in the registry. Callers
   * read the return value, not the ops prose, so that orphan was the one record nobody
   * would ever clean up: invisible by construction. (G07c was worse still: its error
   * string asserted "so no agent was created" unconditionally.)
   *
   * The fix keeps agentId SET when the revert fails and swaps the message for
   * invalidStateMessage, which names the orphan and says manual repair is required.
   */
  it('R51.5: a G06 rollback that FAILS keeps the orphan addressable — it must not report "no agent created"', async () => {
    // Make ChangeTitle fail (its verified registry write cannot land), then make the
    // compensating delete fail too — the two-failure case the old code mis-reported.
    mockUpdateAgent.mockRejectedValue(new Error('registry write refused'))
    mockDeleteAgent.mockRejectedValue(new Error('registry locked'))

    const { CreateAgent } = await import('@/services/element-management-service')
    const result = await CreateAgent({
      name: 'orphan-alpha',
      client: 'claude',
      governanceTitle: 'manager', // standalone title → G06 applies it directly
      authContext: { isSystemOwner: true as const },
    })

    expect(result.success).toBe(false)
    // The rollback was attempted and failed — pin the REASON, not just the outcome.
    //
    // The LINE this lands on moved when CreateAgent was retrofitted onto runGateSequence
    // (TRDD-DQ6XN2VP): the failure is reported against the gate whose COMPENSATION failed (G04,
    // the registry write) rather than against the gate that failed (G06). That is strictly more
    // accurate — G06's own undo had nothing to do with the stuck delete — and the runner's
    // wording is `ROLLBACK FAILED`, not the hand-rolled `ROLLBACK ALSO FAILED`.
    expect(result.operations.some(o => /^G04: ROLLBACK FAILED/.test(o))).toBe(true)
    // THE POINT: the orphan stays addressable.
    expect(result.agentId).not.toBeNull()
    expect(result.error).toMatch(/INVALID STATE/i)
    // The runner names an unrevertable gate as "<id> (<error>)", so "G04 (registry locked)" alone
    // would not say WHICH agent survived. G04's undo re-throws with the record in the message —
    // that is what keeps R51.5's promise that the orphan stays findable.
    expect(result.error).toMatch(/orphan-alpha/)
    // And it must NOT claim nothing happened — asserted on the VERDICT, which is the head of the
    // message, not on a substring anywhere in it.
    //
    // ChangeTitle is itself an R51 transaction now (TRDD-DQ6XN2VP), so when its own gates roll back
    // cleanly it returns R51.3's "…SO NO CHANGES WERE MADE TO THE SYSTEM" — and CreateAgent quotes
    // that verbatim as the `Cause:` of its own R51.5 CRITICAL. Both claims are true and they are
    // about different systems: the inner one made no changes, the outer one did and could not undo
    // them. A bare substring check cannot tell them apart, so anchor to the start.
    expect(result.error).not.toMatch(/^THE COMMAND FAILED TO ACCOMPLISH/)
  })

  /**
   * ROLLBACK PARITY — the guarantee the retrofit ADDED, not one it preserved.
   *
   * Every one of the four hand-rolled rollbacks deleted the registry row and stopped there,
   * so a failed creation left `~/agents/<name>/` on disk with its seeded rules inside. The
   * next attempt at the same name then took the "Reusing orphaned folder" branch — a different
   * code path, entered because of a failure nobody was told about.
   *
   * Under the runner G03 records whether IT created the directory and removes it on the way
   * back out. The two assertions are deliberately paired: the row is gone AND the directory is
   * gone. Asserting only the row is what the old code already did.
   */
  it('R51.5 parity: a rollback removes the workdir this pipeline created, not just the registry row', async () => {
    mockUpdateAgent.mockRejectedValue(new Error('registry write refused'))

    const { CreateAgent } = await import('@/services/element-management-service')
    const result = await CreateAgent({
      name: 'reverted-alpha',
      client: 'claude',
      governanceTitle: 'manager',
      authContext: { isSystemOwner: true as const },
    })

    expect(result.success).toBe(false)
    // The revert landed, so the caller is told the truth: nothing survives.
    expect(result.agentId).toBeNull()
    expect(result.error).toMatch(/NO CHANGES WERE MADE/i)
    expect(result.error).not.toMatch(/INVALID STATE/i)
    expect(mockDeleteAgent).toHaveBeenCalled()
    // THE NEW HALF: the directory G03 created is removed, recursively, because by rollback time
    // it holds whatever the later gates wrote into it.
    const rmCalls = mockRm.mock.calls as unknown as [string, { recursive?: boolean }][]
    expect(
      rmCalls.some(([p, o]) => typeof p === 'string' && p.endsWith('/agents/reverted-alpha') && o?.recursive === true),
      `expected the workdir to be removed; rm was called with: ${JSON.stringify(rmCalls)}`,
    ).toBe(true)
    // And the ops carry the runner's own audit of the unwind.
    expect(result.operations.some(o => o === 'G04: reverted')).toBe(true)
    expect(result.operations.some(o => o === 'G03: reverted')).toBe(true)
  })

  /**
   * G07's TEAM-LEAVE compensation — the gap that made the retrofit worth doing, and the one that
   * shipped WRITTEN BUT UNDRIVEN because every other test in this file lands on G07's WARN branch.
   *
   * Before the retrofit, a failure after the team join deleted the registry row and left the team
   * slot pointing at it: a member id referencing a record that no longer exists, which no later
   * operation reconciles. Asserting that is only possible once the join genuinely SUCCEEDS, which
   * is why this test seeds a real team and a MANAGER (team ops are manager-gated, R9/R10) instead
   * of the file's default manager-less, teamless world.
   *
   * The abort is G07c's R9.13 hard reject — the real-world case, not a contrived one: the
   * role-plugin install fails whenever the server cannot reach GitHub, and the pipeline must
   * refuse rather than persist an agent that can never be woken.
   */
  it('G07 undo: a gate that aborts AFTER a successful team join takes the agent back out of the team', async () => {
    teamStore.set('team-live', { id: 'team-live', name: 'Live Team', agentIds: [] })
    mockGetManagerId.mockReturnValue('agent-mgr')
    // G07c reads `roleMissing` off the registry row and refuses. Overlaid on the live record so
    // ChangeTitle still sees a coherent agent through G06/G07b.
    mockGetAgent.mockImplementation((id: string) => {
      const a = registryStore.get(id)
      return a ? { ...a, roleMissing: true } : undefined
    })

    const { CreateAgent } = await import('@/services/element-management-service')
    const result = await CreateAgent({
      name: 'left-the-team',
      client: 'claude',
      governanceTitle: 'member',
      teamId: 'team-live',
      authContext: { isSystemOwner: true as const },
    })

    // NON-VACUITY, and it is the whole reason this test exists: the join must have LANDED. Without
    // this the assertions below hold just as well for the WARN branch, where there is no
    // membership to reverse and the undo is a no-op — which is precisely how the compensation
    // stayed unpinned.
    expect(
      result.operations.some(o => /^G07: Added to team/.test(o)),
      `G07 did not join — this test would be about the WARN branch. ops:\n${result.operations.join('\n')}`,
    ).toBe(true)
    expect(result.operations.some(o => /^G07c: DENIED/.test(o))).toBe(true)
    expect(result.success).toBe(false)

    // THE POINT — asserted on the MEMBERSHIP WRITES, not on the log. Two earlier attempts at this
    // assertion were VACUOUS and only a neuter said so:
    //   - `G07: reverted` is the runner's line for a compensation that did not THROW, and an empty
    //     undo does not throw either — so it passed with the undo disabled.
    //   - `not.toContain(result.agentId)` compared against NULL, because a clean rollback is
    //     exactly the case where the pipeline nulls agentId. Nothing contains null.
    // `updateTeam` is where membership actually moves (ChangeTeam G06 on the way in, G04c on the
    // way out), so the call sequence is the fact: the id goes in, then it comes out.
    const AGENT_ID = 'agent-left-the-team-uuid'   // deterministic in this fixture's createAgent double
    const memberships = mockUpdateTeam.mock.calls
      .map(c => (c as unknown as [string, { agentIds?: string[] }])[1])
      .filter(p => Array.isArray(p?.agentIds))
      .map(p => p.agentIds as string[])
    expect(
      memberships.length,
      `expected a join AND a leave write; saw ${memberships.length}: ${JSON.stringify(memberships)}`,
    ).toBeGreaterThanOrEqual(2)
    expect(memberships[0], 'the join did not add the agent').toContain(AGENT_ID)
    expect(memberships[memberships.length - 1], 'the undo did not remove the agent').not.toContain(AGENT_ID)
    // End state, read from the store rather than from the call log.
    expect(teamStore.get('team-live')!.agentIds).not.toContain(AGENT_ID)
  })

  /**
   * R51.5 at G07b — the FOURTH rollback site, and the one the original fix missed.
   *
   * `4520ef9a` gave G06 (both branches) and G07c the two-branch shape above, and left
   * G07b setting `result.agentId = null` unconditionally. Nothing reddened, because the
   * R51.5 test drives G06 only: a fix applied at three of four sites looks identical to a
   * complete one until someone reaches the fourth.
   *
   * G07b's orphan is the worst of the four. It is reached only on the team path, so by
   * the time the revert fails the agent has ALREADY JOINED the team — an untitled member
   * the caller has been told does not exist.
   */
  it('R51.5: a G07b rollback that FAILS keeps the orphan addressable — the team-path site the G06 fix missed', async () => {
    // ChangeTitle('member') fails on its own governance gate (the mocked world has no
    // team to join), so the failure under test is G07b's, not a rejected registry write.
    // Only the COMPENSATION is sabotaged.
    mockDeleteAgent.mockRejectedValue(new Error('registry locked'))

    const { CreateAgent } = await import('@/services/element-management-service')
    const result = await CreateAgent({
      name: 'orphan-teamed',
      client: 'claude',
      governanceTitle: 'member',   // team-required → G06 DEFERs, G07 joins, G07b re-titles
      teamId: 'team-xyz',
      authContext: { isSystemOwner: true as const },
    })

    // NON-VACUITY: prove G07b actually ran and failed. Without this the assertions below
    // would pass just as well for a pipeline that died at G06.
    const g07b = result.operations.find(o => o.startsWith('G07b:'))
    expect(g07b, 'G07b must have run — otherwise this test is about a different gate').toBeDefined()
    expect(g07b).toMatch(/FAILED — Title assignment after team join failed/)
    // The rollback failure is reported against the gate whose COMPENSATION failed, which is G04.
    expect(result.operations.some(o => /^G04: ROLLBACK FAILED/.test(o))).toBe(true)

    expect(result.success).toBe(false)
    // THE POINT: the orphan stays addressable.
    expect(result.agentId).not.toBeNull()
    expect(result.error).toMatch(/INVALID STATE/i)
    expect(result.error).toMatch(/orphan-teamed/)
    // DROPPED, and the drop is the finding: this used to assert the message named `team-xyz`,
    // because the hand-rolled G07b hardcoded "joined team <id>" into it whether or not the join
    // had succeeded — and it never left the team on the way out, so the claim was doing double
    // duty as an apology. Under the runner G07 records the join and its undo reverses it, so a
    // team is named ONLY when one is genuinely still occupied. Here ChangeTeam WARNed (the mocked
    // world has no team), nothing was joined, and a message naming the team would now be false.
    expect(result.operations.some(o => /^G07: WARN — ChangeTeam failed/.test(o))).toBe(true)
  })

  /**
   * The positive control for the test above: same gate, same failure, WORKING revert.
   * Without it, "agentId is not null" could be true because the branch never forked —
   * this proves the two arms differ and that `agentId: null` is still correct when the
   * rollback really landed.
   */
  it('R51.5 control: a G07b rollback that SUCCEEDS does report agentId null, with no INVALID STATE', async () => {
    const { CreateAgent } = await import('@/services/element-management-service')
    const result = await CreateAgent({
      name: 'reverted-teamed',
      client: 'claude',
      governanceTitle: 'member',
      teamId: 'team-xyz',
      authContext: { isSystemOwner: true as const },
    })

    const g07b = result.operations.find(o => o.startsWith('G07b:'))
    expect(g07b, 'G07b must have run').toBeDefined()
    expect(g07b).toMatch(/FAILED — Title assignment after team join failed/)
    // The revert landed, so the runner's audit says `reverted`, not `ROLLBACK FAILED`. The line
    // moved from G07b to G04 for the same reason as in the test above: it belongs to the gate
    // whose compensation ran, not to the gate that failed.
    expect(result.operations.some(o => o === 'G04: reverted')).toBe(true)
    expect(result.operations.some(o => /ROLLBACK FAILED/.test(o))).toBe(false)

    expect(result.success).toBe(false)
    expect(result.agentId).toBeNull()
    expect(result.error).not.toMatch(/INVALID STATE/i)
    expect(mockDeleteAgent).toHaveBeenCalled()
  })
})
