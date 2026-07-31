/**
 * Drive the REAL `ChangeTitle` pipeline against a temp home — TRDD-DQ6XN2VP.
 *
 * WHY THIS EXISTS
 * ---------------
 * `ChangeTitle` is the LAST pipeline with a real partial-state window (every other hand-rolled one
 * was measured 2026-07-31 to be a single mutating call with nothing abortable after it, or — for
 * `InstallElement` — mutations a compensation is forbidden to reverse). Its window is wide: G10
 * calls `removeManager()` and then `blockAllTeams()`, which HIBERNATES every team agent on the
 * host; G11/G12 null out team COS/ORCH pointers; G14b/G14e revoke AID and portfolio tokens. A
 * failure anywhere after G10 leaves the host with teams blocked and the fleet asleep.
 *
 * Nothing drives that today. Eight test files call `ChangeTitle`, and all of them assert
 * authorization, ordering, or a return value — none forces a mid-pipeline failure and looks at what
 * was left behind. This helper is the missing instrument, and it is deliberately SEPARATE from the
 * retrofit: a driver is additive, commits cleanly on its own, and is what makes the restructure
 * tractable in a later session.
 *
 * THE ORDER IS NOT THE LABEL ORDER — do not "sort the gates" when using this
 * -------------------------------------------------------------------------
 * G14 (the `updateAgent({governanceTitle})` write) is at `element-management-service.ts:2685` and
 * runs BEFORE G10-G13b at :2736-2847. That is deliberate, commented at :2651-2671, and pinned by a
 * test (TRDD-EE5YX5LF): running the most failure-prone gate FIRST turns its failure into a clean
 * no-op instead of a host with NO manager and every team blocked. It defends against PROCESS DEATH,
 * which no compensation covers, so it survives the retrofit rather than being replaced by it.
 *
 * CONTAINMENT — three layers, each load-bearing, and one of them is a subprocess
 * ----------------------------------------------------------------------------
 *  1. `os.homedir()` — `element-management-service.ts` resolves `const HOME = homedir()` at MODULE
 *     LOAD and derives `agentsRoot` from it.
 *  2. `@/lib/ecosystem-constants` — G14 verifies its own write by re-reading
 *     `statePath('agents','registry.json')` with the REAL `fs` (TRDD-N7X4KDQ2 moved it onto this
 *     seam for exactly this reason). Without layer 2 that read hits the developer's real registry,
 *     the synthetic agent is absent, and EVERY ChangeTitle fails at G14 — which silently makes
 *     everything downstream untestable.
 *  3. A `claude` PATH SHIM — G16's `installPluginLocally` SPAWNS `claude plugin install` as a child
 *     process. An in-process mock cannot reach a child; the shim can, because the child inherits
 *     `process.env.PATH`. Same precedent as the R20.28 installer test.
 *
 * WHY REAL `fs`: the properties under test are FILES (registry.json, settings.local.json). With
 * `fs` mocked, G14's disk verification and G14d's settings read are unobservable and the test would
 * assert against its own stubs.
 *
 * WHAT IS DELIBERATELY *NOT* MOCKED: `@/lib/client-capabilities` and `@/lib/program-args` are pure
 * functions with no I/O — stubbing them would replace real behaviour with a guess. A `claude` agent
 * never reaches `@/lib/client-plugin-adapters` or `@/services/plugin-storage-service` (both are
 * gated on `clientType !== 'claude'`), so those are left alone too.
 *
 * USAGE — the factories are per-file and hoisted, so a test writes its own `vi.mock` lines; this
 * module supplies their BODIES. The `await import()` must stay INSIDE each factory: `vi.mock` is
 * hoisted above every top-level import.
 */
import { mkdirSync, writeFileSync, chmodSync } from 'fs'
import { join } from 'path'

export { registryMock, registryPath, seedAgent } from '@/tests/helpers/drive-delete-agent'
export type { FakeAgent, FakeRegistryStore } from '@/tests/helpers/drive-delete-agent'

export interface FakeTeam {
  id: string
  name: string
  agentIds: string[]
  chiefOfStaffId?: string | null
  orchestratorId?: string | null
  blocked?: boolean
}

/**
 * Everything the governance half of the pipeline reads or writes, in one observable object.
 *
 * It is a WORLD rather than a pile of `vi.fn()`s because the assertion this harness exists for is
 * "what state was left behind" — which is a question about the stores as a whole, not about
 * whether a particular spy was called. `calls` is kept alongside because ORDER is the other half:
 * a rollback is only correct if it unwinds in reverse.
 */
export interface ChangeTitleWorld {
  managerId: string | null
  teams: FakeTeam[]
  /** Agent ids `blockAllTeams()` reports it hibernated. Seeded by the test. */
  hibernatable: string[]
  /** Every mocked mutation, in call order — `['removeManager', 'blockAllTeams', …]`. */
  calls: string[]
  /** Tokens each revocation reports. Non-zero proves the gate actually ran. */
  aidTokens: number
  portfolioTokens: number
  /**
   * Failure injection: `{ updateTeam: 2 }` throws on the SECOND `updateTeam` call.
   * This is how a mid-pipeline failure is forced at a chosen gate.
   */
  failOn: Record<string, number>
}

export function newWorld(over: Partial<ChangeTitleWorld> = {}): ChangeTitleWorld {
  return {
    managerId: null,
    teams: [],
    hibernatable: [],
    calls: [],
    aidTokens: 0,
    portfolioTokens: 0,
    failOn: {},
    ...over,
  }
}

/**
 * Record the call and throw when this is the nth one the test armed.
 *
 * Counting from `calls` rather than a separate tally is deliberate: the call log IS the counter, so
 * a mutation can never be recorded without being counted or counted without being recorded.
 */
function step(world: ChangeTitleWorld, name: string): void {
  world.calls.push(name)
  const nth = world.calls.filter(c => c === name).length
  if (world.failOn[name] === nth) {
    throw new Error(`[drive-change-title] injected failure: ${name} call #${nth}`)
  }
}

/** `@/lib/governance` — ACTIVE, unlike the DeleteAgent harness's inert stub, because G10/G13 are
 *  the gates under test and an `isManager: () => false` stub skips both. */
export function governanceMock(world: ChangeTitleWorld) {
  return {
    isManager: (id: string) => world.managerId === id,
    getManagerId: () => world.managerId,
    isChiefOfStaffAnywhere: (id: string) => world.teams.some(t => t.chiefOfStaffId === id),
    removeManager: async () => { step(world, 'removeManager'); world.managerId = null },
    setManager: async (id: string) => { step(world, 'setManager'); world.managerId = id },
    loadGovernance: () => ({ managerId: world.managerId, chiefsOfStaff: {} }),
    saveGovernance: () => undefined,
  }
}

/** `@/lib/team-registry` — the store G10/G11/G12/G13b mutate. `blockAllTeams` returns the
 *  hibernated ids because ChangeTitle reads `.length`, and because that return value IS the
 *  snapshot a future compensation needs in order to wake them again (R51.4). */
export function teamRegistryMock(world: ChangeTitleWorld) {
  return {
    loadTeams: () => world.teams,
    getTeam: (id: string) => world.teams.find(t => t.id === id),
    getTeamsForAgent: (id: string) => world.teams.filter(t => t.agentIds.includes(id)),
    isAgentInAnyTeam: (id: string) => world.teams.some(t => t.agentIds.includes(id)),
    saveTeams: () => undefined,
    updateTeam: async (id: string, patch: Partial<FakeTeam>) => {
      step(world, 'updateTeam')
      const team = world.teams.find(t => t.id === id)
      if (team) Object.assign(team, patch)
      return team
    },
    blockAllTeams: async () => {
      step(world, 'blockAllTeams')
      for (const t of world.teams) t.blocked = true
      return [...world.hibernatable]
    },
    unblockAllTeams: async () => {
      step(world, 'unblockAllTeams')
      for (const t of world.teams) t.blocked = false
      return world.teams.length
    },
    deleteTeam: async () => undefined,
    addTeam: async () => undefined,
  }
}

/** The two token stores G14b/G14e revoke. Both report a non-zero count so the gate is provably
 *  reached — a stub returning 0 makes "did it revoke?" and "was it skipped?" the same observation. */
export function aidTokenMock(world: ChangeTitleWorld) {
  return {
    revokeTokensForAgent: async () => { step(world, 'revokeTokensForAgent'); return world.aidTokens },
    revokeTokensForAgentCompensable: async () => ({ count: world.aidTokens, restore: async () => world.aidTokens }),
    countTokensForAgent: () => world.aidTokens,
  }
}

export function portfolioStoreMock(world: ChangeTitleWorld) {
  return {
    revokeTokensFromIssuer: async () => { step(world, 'revokeTokensFromIssuer'); return world.portfolioTokens },
    revokeTokensFromIssuerCompensable: async () => ({
      count: world.portfolioTokens,
      restore: async () => world.portfolioTokens,
    }),
  }
}

/** The inert collaborators — reached, but with nothing worth observing for THIS window. */
export const stubs = {
  governanceRequests: () => ({
    loadGovernanceRequests: () => ({ requests: [] }),
    rejectGovernanceRequest: async () => undefined,
    approveGovernanceRequest: async () => undefined,
    createGovernanceRequest: async () => undefined,
    saveGovernanceRequests: () => undefined,
  }),
  governanceSync: () => ({ broadcastGovernanceSync: async () => undefined }),
  sharedState: () => ({ broadcastGovernanceUpdate: () => undefined }),
  ledgerEmit: () => ({ emitAgentOp: async () => undefined }),
  portfolioLedger: () => ({ emitPortfolioOp: async () => undefined }),
  ibctScopeCheck: () => ({ checkIbctScope: () => ({ allowed: true as const }) }),
  /** G17's last resort. Returns the shape ChangeTitle reads (`?.data?.success`). */
  agentsCore: () => ({
    hibernateAgent: async () => ({ data: { success: true } }),
  }),
}

/**
 * Install a no-op `claude` on PATH and return the restore function.
 *
 * G16's `installPluginLocally` SPAWNS `claude plugin install`. Without this the child either fails
 * (noisy, and the pipeline then takes its G17 repair path for the wrong reason) or — far worse on a
 * developer machine — reaches the REAL CLI and mutates the real
 * `~/.claude/plugins/installed_plugins.json`, which no in-process mock can prevent.
 *
 * Exits 0 and prints nothing, so the pipeline sees a successful install.
 */
export function installClaudeShim(dir: string): () => void {
  mkdirSync(dir, { recursive: true })
  const shim = join(dir, 'claude')
  writeFileSync(shim, '#!/bin/sh\nexit 0\n', 'utf-8')
  chmodSync(shim, 0o755)
  const previous = process.env.PATH
  process.env.PATH = `${dir}:${previous ?? ''}`
  return () => { process.env.PATH = previous }
}

/**
 * Call the real pipeline as the system owner (`isSystemOwner` short-circuits the auth gate — the
 * same seam every internal caller uses). Imported dynamically so the mocks are all in place first.
 */
export async function driveChangeTitle(agentId: string, newTitle: string | null) {
  const { ChangeTitle } = await import('@/services/element-management-service')
  return ChangeTitle(agentId, newTitle, { authContext: { isSystemOwner: true } })
}
