/**
 * ChangeTitle's partial-state window — TRDD-DQ6XN2VP, R51.
 *
 * ChangeTitle is the LAST hand-rolled pipeline with a real window, and nothing drives it through
 * a mid-pipeline failure. Eight test files call it; every one asserts authorization, ordering, or a
 * return value. None forces a gate to throw and then asks what was left behind.
 *
 * This file is the first caller of `tests/helpers/drive-change-title.ts`, and it starts with the
 * happy path ONLY — deliberately. A characterization test of the window is worthless until the
 * harness is proven to drive all 1219 lines: "the stores were left dirty" and "the pipeline died at
 * gate 2 for a reason I did not model" are the same observation from the outside. So the first
 * assertion here is that a title change SUCCEEDS end to end, and that the host-wide governance
 * mutations really happened — which is what makes a later rollback test non-vacuous.
 *
 * THE SCENARIO: a MANAGER, on no team, demoted to AUTONOMOUS while one team exists.
 *   - G09 admits it: `autonomous` is standalone, so the agent must be in NO team (R3).
 *   - G10 fires because the OLD title is manager: `removeManager()` then `blockAllTeams()`, which
 *     hibernates every team agent on the host. That pair IS the window — a failure after it leaves
 *     the host with no manager and every team blocked.
 *   - G14 (the registry write) runs BEFORE G10, deliberately (TRDD-EE5YX5LF). Do not "sort the
 *     gates" — a retrofit that does is caught by
 *     `tests/governance/r3-r9-team-governance.test.ts` ("a demotion whose title write FAILS must
 *     not have touched governance"), which pins the ordering by INJECTING a G14 failure. This file
 *     deliberately does NOT re-assert it from the happy path: a weaker second copy of one property
 *     only couples two files that were meant to fail independently.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import { existsSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'

const H = vi.hoisted(() => {
  const os = require('os') as typeof import('os')
  const fs = require('fs') as typeof import('fs')
  const path = require('path') as typeof import('path')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-changetitle-'))
  return {
    FAKE_HOME: path.join(root, 'home'),
    FAKE_STATE: path.join(root, 'state'),
    BIN: path.join(root, 'bin'),
    registry: new Map<string, Record<string, unknown>>(),
    // The governance world, shared by every mock.
    //
    // IT IS CREATED ONCE AND RESET IN PLACE — never reassigned. Each `vi.mock` factory closes over
    // the object it was handed the first time it ran, and that capture survives
    // `vi.resetModules()`. Replacing `H.world` with a fresh object per test therefore leaves the
    // mocks writing to the PREVIOUS one: the pipeline really did call `removeManager()`, and the
    // assertion read a world nothing had touched. `Object.assign` in beforeEach resets every field
    // while preserving identity, which is why the DeleteAgent harness mutates its `state` too.
    world: {
      managerId: null as string | null,
      teams: [],
      hibernatable: [],
      calls: [],
      aidTokens: 0,
      portfolioTokens: 0,
      failOn: {},
    } as unknown as import('@/tests/helpers/drive-change-title').ChangeTitleWorld,
  }
})

const HELPER = '@/tests/helpers/drive-change-title'

// LAYER 1 — `element-management-service` resolves `const HOME = homedir()` at MODULE LOAD.
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, homedir: () => H.FAKE_HOME, default: { ...actual, homedir: () => H.FAKE_HOME } }
})
// LAYER 2 — G14 verifies its own write by re-reading `statePath('agents','registry.json')` with the
// REAL `fs` (TRDD-N7X4KDQ2 moved it onto this seam). Without this, that read hits the developer's
// real registry, the synthetic agent is absent, and EVERY ChangeTitle dies at G14 — which would
// make everything downstream silently untestable.
vi.mock('@/lib/ecosystem-constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ecosystem-constants')>()
  const { fakeEcosystemPaths } = await import('@/tests/helpers/fake-ecosystem-home')
  return fakeEcosystemPaths(actual, H.FAKE_HOME, H.FAKE_STATE)
})

vi.mock('@/lib/agent-registry', async () => {
  const h = await import(HELPER)
  return h.registryMock(H.registry as never, h.registryPath(H.FAKE_STATE))
})
vi.mock('@/lib/governance', async () => (await import(HELPER)).governanceMock(H.world))
vi.mock('@/lib/team-registry', async () => (await import(HELPER)).teamRegistryMock(H.world))
vi.mock('@/lib/aid-token', async () => (await import(HELPER)).aidTokenMock(H.world))
vi.mock('@/lib/portfolio-store', async () => (await import(HELPER)).portfolioStoreMock(H.world))
vi.mock('@/lib/governance-request-registry', async () => (await import(HELPER)).stubs.governanceRequests())
vi.mock('@/lib/governance-sync', async () => (await import(HELPER)).stubs.governanceSync())
vi.mock('@/services/shared-state', async () => (await import(HELPER)).stubs.sharedState())
vi.mock('@/lib/ledger-emit', async () => (await import(HELPER)).stubs.ledgerEmit())
vi.mock('@/lib/portfolio-ledger', async () => (await import(HELPER)).stubs.portfolioLedger())
vi.mock('@/lib/ibct-scope-check', async () => (await import(HELPER)).stubs.ibctScopeCheck())
vi.mock('@/services/agents-core-service', async () => (await import(HELPER)).stubs.agentsCore())

const AGENT_ID = 'the-manager'
let restorePath: () => void

/** The plugin AUTONOMOUS requires — G15/G16 install it, G17 reads it back to enforce R9.13. */
const AUTONOMOUS_PLUGIN = 'ai-maestro-autonomous-agent'

function settingsOf(workdir: string): Record<string, Record<string, unknown>> {
  const file = join(workdir, '.claude', 'settings.local.json')
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) : {}
}

beforeAll(async () => {
  restorePath = (await import(HELPER)).installClaudeShim(H.BIN)
})

afterAll(() => {
  restorePath?.()
  rmSync(H.FAKE_HOME, { recursive: true, force: true })
  rmSync(H.FAKE_STATE, { recursive: true, force: true })
  rmSync(H.BIN, { recursive: true, force: true })
})

let workdir: string

beforeEach(async () => {
  vi.resetModules()
  const h = await import(HELPER)
  H.registry.clear()
  // A team EXISTS but does NOT contain the agent: G09 requires a standalone title to be on no team
  // (R3), while G10's blockAllTeams needs something to block — the exact shape of the window.
  Object.assign(H.world, h.newWorld({
    managerId: AGENT_ID,
    teams: [{ id: 'team-1', name: 'Team One', agentIds: ['someone-else'], chiefOfStaffId: 'someone-else', blocked: false }],
    hibernatable: ['someone-else'],
    aidTokens: 3,
    portfolioTokens: 2,
  }))
  workdir = h.seedAgent(H.registry as never, H.FAKE_HOME, H.FAKE_STATE, {
    id: AGENT_ID, name: AGENT_ID, governanceTitle: 'manager', program: 'claude',
  })
})

describe('ChangeTitle happy path (the harness drives the real pipeline)', () => {
  it('demotes a MANAGER to AUTONOMOUS end to end', async () => {
    const { driveChangeTitle } = await import(HELPER)

    const result = await driveChangeTitle(AGENT_ID, 'autonomous')

    // The pipeline is 1219 lines and every gate can return early with `result.error`; surfacing it
    // is what turns a failure here into a diagnosis instead of `expected false to be true`.
    expect(result.error ?? null).toBeNull()
    expect(result.success).toBe(true)
    expect(H.registry.get(AGENT_ID)?.governanceTitle).toBe('autonomous')
  })

  /**
   * The POSITIVE CONTROL for every rollback assertion this file will later grow: if the demotion
   * changed no host-wide state, a parity test would pass against a pipeline that does nothing.
   * These four are the window — the mutations a mid-pipeline failure would strand.
   */
  it('really performs the host-wide governance mutations — otherwise a parity test proves nothing', async () => {
    const { driveChangeTitle } = await import(HELPER)

    await driveChangeTitle(AGENT_ID, 'autonomous')

    expect(H.world.managerId).toBeNull()              // G10 removeManager
    expect(H.world.teams[0].blocked).toBe(true)       // G10 blockAllTeams — the fleet is asleep
    expect(H.world.calls).toContain('revokeTokensForAgent')      // G14b
    expect(H.world.calls).toContain('revokeTokensFromIssuer')    // G14e
  })

  /**
   * G16 shells out to `claude plugin install`, so the shim's write is the ONLY evidence the install
   * happened — and G17 reads that same file back to enforce R9.13. A no-op shim would make G16 look
   * successful, leave G17 nothing to find, and get a healthy agent "recovered" into
   * `roleMissing: true` + hibernated on every run. Asserting BOTH halves keeps that silent.
   */
  it('installs the AUTONOMOUS role-plugin, so R9.13 enforcement finds one and does not hibernate', async () => {
    const { driveChangeTitle } = await import(HELPER)

    await driveChangeTitle(AGENT_ID, 'autonomous')

    const enabled = (settingsOf(workdir).enabledPlugins ?? {}) as Record<string, boolean>
    expect(Object.keys(enabled).map(k => k.split('@')[0])).toContain(AUTONOMOUS_PLUGIN)
    expect(H.registry.get(AGENT_ID)?.roleMissing ?? false).toBe(false)
  })
})

/**
 * CHARACTERIZATION — these pin what the pipeline does TODAY, not what it should do.
 *
 * Read them as a description of the window, not as a specification. The R51 retrofit is expected to
 * CHANGE the second one, and this file is where that change becomes visible instead of silent.
 *
 * The injection point was MEASURED, not assumed: the plan called for a failure at G11's
 * `updateTeam`, and G11/G12/G13b are all gated on `oldTitle === 'chief-of-staff' | 'orchestrator'`
 * or `newTitle === 'orchestrator' | 'chief-of-staff'`, so `updateTeam` is NEVER CALLED on a
 * manager→autonomous demotion. Probing all four post-G10 collaborators is what found the two that
 * are reachable — and the one that matters is not the one that fails.
 */
describe('ChangeTitle window — CHARACTERIZATION of pre-retrofit behaviour', () => {
  /**
   * The G14-first ordering paying off, OBSERVED rather than argued. `removeManager()` is the first
   * thing G10 does and it is NOT individually wrapped, so its failure aborts the whole pipeline —
   * and because the title write already landed at G14, the residue is exactly the mild one the
   * ordering comment promises: a STALE MANAGER POINTER (visible, non-blocking, one call to repair),
   * never a host with no manager and every team blocked.
   */
  it('a failure at removeManager leaves the mild residue the G14-first ordering promises', async () => {
    const { driveChangeTitle } = await import(HELPER)
    H.world.failOn = { removeManager: 1 }

    const result = await driveChangeTitle(AGENT_ID, 'autonomous')

    expect(result.success).toBe(false)
    // The title DID land (G14 runs first) — that is the deliberate part.
    expect(H.registry.get(AGENT_ID)?.governanceTitle).toBe('autonomous')
    // …and governance is untouched: a stale pointer, not a decapitated host.
    expect(H.world.managerId).toBe(AGENT_ID)
    expect(H.world.teams[0].blocked).toBe(false)
  })

  /**
   * THE FINDING, and the reason this file exists.
   *
   * G10 is a CASCADE: remove the manager, then block every team, because a team must not operate
   * without one. Only the second half is wrapped (`catch { ops.push('G10: WARN — blockAllTeams
   * failed') }`), so when it fails the pipeline CONTINUES and returns `success: true` over a host
   * that now has NO manager and UNBLOCKED teams — the exact state the cascade exists to prevent,
   * reported to the caller as a clean success. Nothing downstream can detect it: the ops array
   * carries the WARN, and no caller reads ops.
   *
   * This is R51's "swallowing a per-item failure into console.warn converts one bad item into an
   * invalid system", in production, on the governance-critical pipeline. The retrofit must make
   * G10 atomic — either both halves land or neither does — at which point THIS TEST MUST BE
   * UPDATED, and its failure is the signal that the retrofit did its job.
   */
  it('reports SUCCESS over a half-executed G10 — manager gone, teams left unblocked', async () => {
    const { driveChangeTitle } = await import(HELPER)
    H.world.failOn = { blockAllTeams: 1 }

    const result = await driveChangeTitle(AGENT_ID, 'autonomous')

    expect(result.success).toBe(true)              // ← the problem, not the assertion's fault
    expect(H.world.managerId).toBeNull()           // first half of the cascade LANDED
    expect(H.world.teams[0].blocked).toBe(false)   // second half did NOT
    // The only trace is an op nobody reads.
    expect((result.operations ?? []).some((op: string) => /G10: WARN — blockAllTeams failed/.test(op))).toBe(true)
  })
})
