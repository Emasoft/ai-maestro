/**
 * Governance drift tests — the two R1 sub-rules whose guard lives in
 * `services/teams-service.ts` (`docs/GOVERNANCE-ENFORCEMENT-MAP.md` rows R1.3 and R1.4).
 *
 * Both are driven through the REAL exported `createNewTeam`, and both assert a
 * POST-CONDITION the guard produces — not that a collaborator was called. Delete the
 * guard and the named test goes red; that is the only property that makes a row's
 * "ENFORCED" honest.
 *
 * THE TWO RULES HAVE DIFFERENT SHAPES, and reading them the same way is the mistake
 * this file exists to avoid:
 *
 *   - **R1.4** ("Teams require a MANAGER to exist on the host before they can be
 *     created") is a MUST, enforced as a REFUSAL — `if (!getManagerId()) return 400`.
 *     A refusal test is the right instrument.
 *
 *   - **R1.3** ("Every team **SHOULD** have a COS assigned") is a SHOULD, and it is NOT
 *     enforced by refusing a COS-less create — that would turn a SHOULD into a MUST and
 *     break the sidebar's one-field create dialog. It is enforced by AUTO-CREATION: when
 *     the caller names no `chiefOfStaffId`, `createNewTeam` mints a `cos-<teamslug>`
 *     agent and assigns it. So the honest assertion is the post-condition "the persisted
 *     team ends up with a COS", and a refusal test here would assert a behaviour the rule
 *     never claims. R1.3's second half ("the COS manages membership and external
 *     communication") is descriptive of the COS role and is enforced by the R6 comm
 *     graph + `lib/team-acl`, which carry their own rows — it is not a second obligation
 *     on team creation.
 *
 * WHAT IS MOCKED, AND WHY IT IS ENVIRONMENT RATHER THAN THE GUARD
 * --------------------------------------------------------------
 * The guards under test are `getManagerId()`'s refusal and the auto-COS block, both
 * INSIDE teams-service; nothing here stubs either. What is stubbed is what surrounds
 * them: `element-management-service` (an 8 000-line module reached by dynamic import for
 * the R40 foreign-user gate and the ChangeTitle tail), the governance websocket
 * broadcast, and `child_process` (so nothing can reach the developer's tmux). Crucially,
 * the R40 gate is stubbed to ALLOW — it runs BEFORE R1.4's gate, and a refusal test that
 * let it deny would pass with R1.4's own guard deleted. That is the complementary-neuter
 * discipline: each refusal test must let every OTHER gate pass.
 *
 * The team registry, the governance store, the agent registry and the R28 portfolio
 * check are all REAL, writing into a temp state dir.
 *
 * NEUTER RECORD (2026-07-30) — three mutations, each reddening a DIFFERENT test, because
 * one neuter can only certify the half of a file it happens to reach:
 *
 *   A. delete `if (!existingManagerId) return 400`
 *      → ONLY "refuses with 400 …" fails (1 of 5).
 *   B. `if (!cosId)` → `if (false && !cosId)` (never auto-create)
 *      → "mints cos-<teamslug> …" AND the containment test fail (2 of 5). The containment
 *        test is deliberately coupled: the claim it checks is that the auto-COS `mkdir`
 *        landed in the FAKE home, and with the block disabled there is no mkdir to check.
 *   C. `if (!cosId)` → `if (true)` (auto-create UNCONDITIONALLY)
 *      → ONLY "keeps an explicitly supplied COS …" fails (1 of 5).
 *
 * B and C are what make the pair honest: B alone would leave "a guard that clobbers the
 * caller's COS" undetected, and C alone would leave "a guard that never runs" undetected.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { rmSync, existsSync } from 'fs'
import path from 'path'

// ============================================================================
// Hoisted fake $HOME + state dir. `vi.hoisted` runs before the mock factories AND before
// this file's static imports, which matters because governance/team-registry resolve
// their file paths from `getStateDir()` at MODULE level.
// ============================================================================
const { FAKE_HOME, FAKE_STATE } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fsSync = require('fs')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const osSync = require('os')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pathSync = require('path')
  const home = fsSync.mkdtempSync(pathSync.join(osSync.tmpdir(), 'r1svc-home-'))
  const state = fsSync.mkdtempSync(pathSync.join(osSync.tmpdir(), 'r1svc-state-'))
  fsSync.mkdirSync(pathSync.join(state, 'teams'), { recursive: true })
  fsSync.mkdirSync(pathSync.join(state, 'agents'), { recursive: true })
  fsSync.mkdirSync(pathSync.join(home, 'agents'), { recursive: true })
  return { FAKE_HOME: home, FAKE_STATE: state }
})

// 0-IMPACT layer 1 — `os.homedir()`, for anything resolving $HOME through a STATIC
// import. `lib/workdir-path-policy.ts` is exactly that (`const HOME = homedir()` at module
// level), and the real `createAgent` refuses any workdir outside $HOME — so without this
// the auto-COS create would be rejected for the wrong reason.
vi.mock('os', async importOriginal => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, default: { ...actual, homedir: () => FAKE_HOME }, homedir: () => FAKE_HOME }
})

// 0-IMPACT layer 2 — the ecosystem PATH functions. `lib/ecosystem-constants.ts` resolves
// homedir() through a RUNTIME require inside each function body, which layer 1 does NOT
// reliably intercept; overriding the path functions themselves holds either way.
vi.mock('@/lib/ecosystem-constants', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ecosystem-constants')>()
  const { fakeEcosystemPaths } = await import('@/tests/helpers/fake-ecosystem-home')
  return fakeEcosystemPaths(actual, FAKE_HOME, FAKE_STATE)
})

// ENVIRONMENT, not guards.
//
// `assertForeignUserMayCall` is the R40 gate that runs BEFORE R1.4's; it is stubbed to
// ALLOW so that a 400 can only have come from R1.4 itself. `ChangeTitle` is the tail that
// titles the COS and the members — it drives the whole element-management pipeline
// (plugin installs, workdir invariants), which is neither under test here nor safe to run
// against a fake home. Both are reached by DYNAMIC import inside teams-service, so this
// factory must export them by name.
vi.mock('@/services/element-management-service', () => ({
  assertForeignUserMayCall: async () => null,
  ChangeTitle: async () => ({ success: true, ops: [] }),
}))

// A governance broadcast is a websocket fan-out to live clients — environment, not guard.
// It MUST return a promise: callers attach `.catch()` to the result, so a `() => {}` stub
// kills every write on `undefined.catch`.
vi.mock('@/lib/governance-sync', () => ({ broadcastGovernanceSync: async () => {} }))

// Nothing in the create path should shell out, but `blockAllTeams`-style helpers reach for
// tmux through execFile. Stubbed so a stray call can never touch the developer's sessions.
vi.mock('child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('child_process')>()
  return {
    ...actual,
    execFile: (_f: string, _a: string[], cb: (e: Error | null, r: { stdout: string; stderr: string }) => void) =>
      cb(null, { stdout: '', stderr: '' }),
  }
})

const TEAMS_FILE = path.join(FAKE_STATE, 'teams', 'teams.json')
const REGISTRY_FILE = path.join(FAKE_STATE, 'agents', 'registry.json')
const GOVERNANCE_FILE = path.join(FAKE_STATE, 'governance.json')

/**
 * One module graph per test, imported together.
 *
 * `saveTeams` diffs against a module-level `_prevTeams` to build its ledger patch, and
 * teams-service captures `getManagerId` from its own static import — so the service and
 * the stores it reads MUST come from the same freshly-reset graph or the service would
 * see a different governance module than the test wrote to.
 */
async function freshGraph() {
  vi.resetModules()
  const [service, governance, teamRegistry, agentRegistry] = await Promise.all([
    import('@/services/teams-service'),
    import('@/lib/governance'),
    import('@/lib/team-registry'),
    import('@/lib/agent-registry'),
  ])
  return { service, governance, teamRegistry, agentRegistry }
}

beforeEach(() => {
  for (const f of [TEAMS_FILE, REGISTRY_FILE, GOVERNANCE_FILE]) {
    if (existsSync(f)) rmSync(f)
    if (existsSync(f + '.ledger.json')) rmSync(f + '.ledger.json')
  }
  // The ledgers governance/teams write alongside their stores. Left behind, a ledger from
  // a previous test anchors on entries whose store no longer exists.
  for (const f of ['governance.ledger.json', path.join('teams', 'teams.ledger.json')]) {
    const p = path.join(FAKE_STATE, f)
    if (existsSync(p)) rmSync(p)
  }
})

/** Register a real MANAGER agent and record it in the real governance store. */
async function installManager(graph: Awaited<ReturnType<typeof freshGraph>>) {
  const manager = await graph.agentRegistry.createAgent({
    name: 'r1-manager',
    program: 'claude',
    taskDescription: 'MANAGER fixture for the R1.4 gate',
    createSession: false,
  })
  await graph.governance.setManager(manager.id)
  return manager
}

describe('R1.4 — a team cannot be created before a MANAGER exists on the host', () => {
  it('refuses with 400 and leaves the registry untouched when there is no MANAGER', async () => {
    const { service, governance, teamRegistry } = await freshGraph()

    // PRE-CONDITION. Without it, the refusal below could be satisfied by a host that
    // happens to have a manager and is failing for some entirely different reason.
    expect(governance.getManagerId()).toBeNull()

    const res = await service.createNewTeam({ name: 'Managerless Team' })

    expect(res.status).toBe(400)
    expect(res.error).toMatch(/Teams require an existing MANAGER first/i)
    // A guard that refuses AFTER writing is worse than one that does not refuse at all —
    // the caller sees an error and the team exists anyway.
    expect(teamRegistry.loadTeams()).toHaveLength(0)
  })

  it('POSITIVE CONTROL — the SAME call succeeds once a MANAGER exists', async () => {
    // This is the vacuity control for the test above: it proves the 400 came from the
    // manager check specifically, and not from a mis-wired mock, a missing state dir, or
    // any of the three gates that run before it.
    const graph = await freshGraph()
    await installManager(graph)

    const res = await graph.service.createNewTeam({ name: 'Managed Team' })

    expect(res.error).toBeUndefined()
    expect(res.status).toBe(201)
    expect(graph.teamRegistry.loadTeams().map(t => t.name)).toEqual(['Managed Team'])
  })
})

describe('R1.3 — every team ends up with a COS, auto-created when the caller names none', () => {
  it('mints cos-<teamslug> and assigns it when no chiefOfStaffId was supplied', async () => {
    const graph = await freshGraph()
    await installManager(graph)

    const res = await graph.service.createNewTeam({ name: 'Alpha Team' })
    expect(res.status).toBe(201)

    // The post-condition, read back from the REAL registry rather than from the service's
    // return value — the auto-COS block's whole job is to persist the assignment, and a
    // block that computed a COS without saving it would still satisfy an in-memory check.
    const teamId = res.data!.team.id
    const persisted = graph.teamRegistry.getTeam(teamId)
    expect(persisted?.chiefOfStaffId, 'no COS was assigned — R1.3 auto-creation did not run').toBeTruthy()

    // The COS must be a real agent, named for the team, and a MEMBER of it. Any one of
    // those missing means the team has a dangling reference rather than a chief of staff.
    const cos = graph.agentRegistry.getAgent(persisted!.chiefOfStaffId!)
    expect(cos?.name).toBe('cos-alpha-team')
    expect(persisted!.agentIds).toContain(persisted!.chiefOfStaffId)
  })

  it('keeps an explicitly supplied COS instead of minting a second one', async () => {
    // The complementary half. A block that auto-created UNCONDITIONALLY would satisfy the
    // test above while silently overwriting the COS the caller chose — the same
    // self-exclusion shape as R2.3's rename check.
    const graph = await freshGraph()
    await installManager(graph)
    const chosen = await graph.agentRegistry.createAgent({
      name: 'r1-chosen-cos',
      program: 'claude',
      taskDescription: 'an AUTONOMOUS agent the caller picks as COS',
      createSession: false,
    })

    const res = await graph.service.createNewTeam({ name: 'Beta Team', chiefOfStaffId: chosen.id })
    expect(res.status).toBe(201)

    const persisted = graph.teamRegistry.getTeam(res.data!.team.id)
    expect(persisted?.chiefOfStaffId).toBe(chosen.id)
    // And no `cos-beta-team` was minted alongside it.
    expect(graph.agentRegistry.loadAgents().map(a => a.name)).not.toContain('cos-beta-team')
  })
})

describe('0-IMPACT containment holds', () => {
  it('every write landed in the temp state dir and the fake home', async () => {
    // The containment is itself a claim, and an unverified containment claim is how a
    // suite quietly writes to the developer's home. `fakeEcosystemPaths` throws at setup
    // if handed a non-temp path; this asserts the other end — that the files the stores
    // actually wrote are the sandboxed ones, and that the auto-COS workdir was minted
    // under the FAKE home rather than the real one.
    const graph = await freshGraph()
    await installManager(graph)
    await graph.service.createNewTeam({ name: 'Containment Check' })

    expect(existsSync(TEAMS_FILE)).toBe(true)
    const { getStateDir } = await import('@/lib/ecosystem-constants')
    expect(getStateDir()).toBe(FAKE_STATE)
    expect(existsSync(path.join(FAKE_HOME, 'agents', 'cos-containment-check'))).toBe(true)
    const os = await import('os')
    expect(os.homedir()).toBe(FAKE_HOME)
  })
})
