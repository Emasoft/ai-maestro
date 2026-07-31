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
  const FAKE_STATE = path.join(root, 'state')
  const registry = new Map<string, Record<string, unknown>>()
  // The SAME path `registryPath(FAKE_STATE)` builds and `statePath('agents','registry.json')`
  // resolves to — G14 and G22 both re-read it with the real `fs`.
  const regFile = path.join(FAKE_STATE, 'agents', 'registry.json')
  // A test-supplied perturbation, re-applied after EVERY registry flush (see the mock wrapper).
  const perturb: { run: (() => void) | null } = { run: null }
  return {
    FAKE_HOME: path.join(root, 'home'),
    FAKE_STATE,
    BIN: path.join(root, 'bin'),
    registry,
    perturb,
    /** Overwrite registry.json verbatim — the disk half of a G22 drift, including a non-array. */
    writeDisk: (body: unknown) => {
      fs.mkdirSync(path.dirname(regFile), { recursive: true })
      fs.writeFileSync(regFile, JSON.stringify(body, null, 2), 'utf-8')
    },
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

// The registry mock, wrapped so an armed perturbation is RE-APPLIED after every flush.
//
// Applying it once is not enough: `updateAgent` mirrors the whole store to registry.json, and
// G16b calls it again (programArgs) AFTER the arming point, which would rewrite the file and
// silently undo a disk corruption — leaving G22 to pass and the test to assert nothing. Re-applying
// makes the injection independent of how many later gates happen to write.
vi.mock('@/lib/agent-registry', async () => {
  const h = await import(HELPER)
  const real = h.registryMock(H.registry as never, h.registryPath(H.FAKE_STATE))
  return {
    ...real,
    updateAgent: async (id: string, patch: Record<string, unknown>) => {
      const updated = await (real.updateAgent as (i: string, p: unknown) => Promise<unknown>)(id, patch)
      H.perturb.run?.()
      return updated
    },
  }
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
  H.perturb.run = null
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
    // The COMPENSABLE forms specifically (R51, TRDD-DQ6XN2VP): both do the identical revocation,
    // but only these hand back a restore handle, so reverting either gate to the count-only
    // wrapper — which is what ChangeTitle used to call — reds this assertion.
    expect(H.world.calls).toContain('revokeTokensForAgentCompensable')      // G14b
    expect(H.world.calls).toContain('revokeTokensFromIssuerCompensable')    // G14e
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
 * These pinned what the pipeline did BEFORE the R51 retrofit — and the file said so, predicting
 * that the retrofit would change one of them. It did, and the change landed HERE rather than
 * silently: the first test's whole subject, "the mild residue", NO LONGER EXISTS.
 *
 * The injection point was MEASURED, not assumed: the plan called for a failure at G11's
 * `updateTeam`, and G11/G12/G13b are all gated on `oldTitle === 'chief-of-staff' | 'orchestrator'`
 * or `newTitle === 'orchestrator' | 'chief-of-staff'`, so `updateTeam` is NEVER CALLED on a
 * manager→autonomous demotion. Probing all four post-G10 collaborators is what found the two that
 * are reachable — and the one that matters is not the one that fails.
 */
describe('ChangeTitle window — what a mid-pipeline failure actually leaves behind', () => {
  /**
   * THE RETROFIT'S PAYOFF, OBSERVED. `removeManager()` is the first thing G10 does and it is NOT
   * individually wrapped, so its failure aborts the pipeline. Under the old hand-rolled driver the
   * title write from G14 SURVIVED that abort — a real residue (a stale manager pointer beside an
   * already-demoted title), documented here as "mild" because the alternative ordering left the
   * host with no manager and every team blocked.
   *
   * With `runGateSequence` driving, there is no residue to grade: G14's undo restores the title, so
   * the system is byte-for-byte what it was before the call and the caller is told exactly that
   * (R51.3). "Mild residue" was the best available answer to a question that no longer has to be
   * asked.
   */
  it('reverts the title write when removeManager fails — the residue the old driver left is gone', async () => {
    const { driveChangeTitle } = await import(HELPER)
    H.world.failOn = { removeManager: 1 }

    const result = await driveChangeTitle(AGENT_ID, 'autonomous')

    expect(result.success).toBe(false)
    // G14's write is REVERTED — this is the assertion the old driver could not make.
    expect(H.registry.get(AGENT_ID)?.governanceTitle).toBe('manager')
    // …and governance is untouched, as it always was under the G14-first ordering.
    expect(H.world.managerId).toBe(AGENT_ID)
    expect(H.world.teams[0].blocked).toBe(false)
    // The rollback COMPLETED, so the caller gets R51.3's claim and not R51.5's CRITICAL.
    expect(result.error).toMatch(/NO CHANGES WERE MADE TO THE SYSTEM/)
    expect(result.error).not.toMatch(/INVALID STATE/)
  })

  /**
   * THE FINDING THIS FILE WAS WRITTEN FOR, now FIXED — the DEFERRED FAIL.
   *
   * G10 is a CASCADE: remove the manager, then block every team, because a team must not operate
   * without one. Only the second half was wrapped, so a `blockAllTeams` failure let the pipeline
   * continue and return `success: true` over a host with NO manager and UNBLOCKED teams — the exact
   * state the cascade exists to prevent, reported as a clean success, traced only by an op nobody
   * reads. R51.3's forbidden lie, in production, on the governance-critical pipeline.
   *
   * THE OBVIOUS FIX IS WRONG, AND THAT IS THE POINT OF THIS TEST. "Un-wrap `blockAllTeams` so its
   * failure aborts" is a SECURITY REGRESSION as a standalone change: G14 has already written the
   * new title (deliberately first — TRDD-EE5YX5LF), so an abort at G10 skips G14b/G14e and leaves a
   * demoted MANAGER holding AID tokens that EMBED "manager", and the retry cannot repair it because
   * Gate 6 sees the title already changed and returns success before reaching revocation. The
   * tokens would be stranded for good.
   *
   * So the fix withholds the VERDICT, not the WORK: every alignment gate still runs (they align the
   * agent with the title G14 wrote), and the terminal converts success into a failure NAMING the
   * residue. The residue is real and is NOT repaired here — reporting it honestly is the whole
   * change. Abort-at-G10 becomes correct only once the retrofit makes G14's write compensable.
   */
  it('withholds the verdict on a half-executed G10 — and still runs the alignment gates', async () => {
    const { driveChangeTitle } = await import(HELPER)
    H.world.failOn = { blockAllTeams: 1 }

    const result = await driveChangeTitle(AGENT_ID, 'autonomous')

    // The verdict is the fix: no more success over a host the cascade was meant to protect.
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/G10 cascade broken/)
    expect(result.error).toMatch(/UNBLOCKED with no MANAGER/)

    // The residue is REAL and deliberately NOT repaired — this fix reports, it does not compensate.
    expect(H.world.managerId).toBeNull()           // first half of the cascade LANDED
    expect(H.world.teams[0].blocked).toBe(false)   // second half did NOT

    // THE LOAD-BEARING ASSERTION — what makes this a DEFERRED fail and not an abort at G10.
    // Both token stores were still drained, so no stale-title credential outlives the demotion.
    // An abort-at-G10 implementation passes every assertion above and FAILS these two.
    expect(H.world.calls).toContain('revokeTokensForAgentCompensable')
    expect(H.world.calls).toContain('revokeTokensFromIssuerCompensable')

    // The op is no longer a WARN nobody reads — it names the broken invariant.
    expect((result.operations ?? []).some((op: string) => /G10: CASCADE BROKEN/.test(op))).toBe(true)
  })
})

/**
 * G22 — THE FINAL VERIFICATION GATE, WHICH HAD NO TEST AT ALL (TRDD-DFP0HWRX).
 *
 * Measured 2026-07-31 at commit `4ee79582`: neutering BOTH of G22's drift checks
 * (`if (false && …)`) left the FULL suite green — 310 files, 4437 passed, zero red. The gate's own
 * comment records why it exists: it was promoted from a silent WARN because callers claimed success
 * while `governanceTitle` stayed null in registry.json (SCEN-007 P0-003, SCEN-020 BUG-001,
 * SCEN-002 P0-001). So THREE separate scenario runs found the bug, the fix landed — and the test did
 * not. That is the general trap in its sharpest form: THE GUARD THAT EXISTS BECAUSE A FALSE SUCCESS
 * SHIPPED IS THE ONE MOST LIKELY TO HAVE NO TEST, because the incident is treated as the evidence.
 * A scenario run does not execute in `yarn test` and cannot red on a future edit.
 *
 * WHY THESE NEED A NEW INJECTION MECHANISM. `failOn` forces a collaborator to THROW, which aborts
 * before G22; a post-condition gate can only be reached by letting the write SUCCEED and then
 * perturbing the stores behind the pipeline's back. Hence `world.after` (fire after a call
 * succeeds) plus the re-applying `updateAgent` wrapper above.
 *
 * THE INJECTION POINT WAS MEASURED, NOT ASSUMED. G14 checks its write twice — the RETURN VALUE of
 * `updateAgent` for memory, then a fresh `readFileSync` for disk — so a perturbation applied inside
 * `updateAgent` reds G14, never G22, and the test would pin the wrong gate. G14e
 * (`revokeTokensFromIssuerCompensable`) is the last mocked collaborator that provably runs after G14
 * completes, and between it and G22 there are ZERO `getAgent` calls — G22 is the only reader of the
 * cache from that point on, so corrupting it cannot derail an intermediate gate.
 *
 * THE ANCHOR IS THE NAME THE PIPELINE ACTUALLY CALLS. When ChangeTitle moved to the compensable
 * revocation for R51, the count-only stub stopped being invoked — and because the harness recorded
 * only that one, the hook silently never fired and all three tests below passed over a pipeline
 * nothing had perturbed. A hook keyed on a call that no longer happens is indistinguishable from a
 * gate that found no drift, which is exactly the failure these tests exist to catch.
 */
describe('ChangeTitle G22 — the final verification gate', () => {
  /**
   * Arm `fn` at G14e, and keep it armed for every later registry flush.
   *
   * Anchoring to a call the happy-path test already asserts
   * (`revokeTokensFromIssuerCompensable`) is what makes "the perturbation ran" an observation
   * rather than an assumption — `after` fires only on success, so the hook running proves the gate
   * ran, and the parity test above independently proves that name is the one the pipeline calls.
   */
  function perturbAfterG14e(fn: () => void): void {
    H.world.after = { revokeTokensFromIssuerCompensable: () => { H.perturb.run = fn; fn() } }
  }

  /** Every registry row, with the agent's title forced to `title` — the shape registry.json holds. */
  function rowsWithTitle(title: string | null): Record<string, unknown>[] {
    return [...H.registry.values()].map(a => ((a.id as string) === AGENT_ID ? { ...a, governanceTitle: title } : a))
  }

  /**
   * THE POSITIVE CONTROL — NOT OPTIONAL, and deliberately first.
   *
   * G22 is a POST-CONDITION: any fixture that fails earlier never reaches it, and all three abort
   * tests below would then pass for the wrong reason. Asserting the gate's own success op is what
   * proves the pipeline arrives there at all.
   */
  it('is REACHED on a clean change and reports the verified title', async () => {
    const { driveChangeTitle } = await import(HELPER)

    const result = await driveChangeTitle(AGENT_ID, 'autonomous')

    expect(result.error ?? null).toBeNull()
    expect((result.operations ?? []).some((op: string) =>
      /^G22: Final title verified in cache \+ registry\.json: "autonomous"$/.test(op))).toBe(true)
  })

  /** Half one: the in-memory registry disagrees with what was just written. */
  it('aborts when the in-memory registry title drifts after the write', async () => {
    const { driveChangeTitle } = await import(HELPER)
    // Cache goes stale; disk stays CORRECT, so only the first check can fire.
    perturbAfterG14e(() => {
      const rec = H.registry.get(AGENT_ID)
      if (rec) H.registry.set(AGENT_ID, { ...rec, governanceTitle: 'manager' })
      H.writeDisk(rowsWithTitle('autonomous'))
    })

    const result = await driveChangeTitle(AGENT_ID, 'autonomous')

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/G22: Final in-memory title drift/)
    expect(result.error).toMatch(/registry shows "manager", expected "autonomous"/)
  })

  /**
   * Half two: the CASE THE THREE SCENARIOS ACTUALLY HIT — the cache agreed and the FILE did not,
   * which is the entire reason G22 re-reads from disk rather than trusting `getAgent`.
   *
   * It also pins the try-narrowing. During the R51 retrofit this check was moved OUT of the `try`
   * that guards the disk read: harmless while it was a `return`, but as a `throw` that same `catch`
   * would swallow it and re-report the generic "Final verification failed", losing the specific
   * message. Asserting the SPECIFIC string is what makes that regression loud.
   */
  it('aborts when registry.json on disk drifts, with the specific message the try-narrowing preserves', async () => {
    const { driveChangeTitle } = await import(HELPER)
    // Cache untouched (so the first check passes); only the file lies.
    perturbAfterG14e(() => H.writeDisk(rowsWithTitle('manager')))

    const result = await driveChangeTitle(AGENT_ID, 'autonomous')

    expect(result.success).toBe(false)
    // NOT the generic "verification failed" — that would mean the catch swallowed this check.
    expect(result.error).toMatch(/G22: Final on-disk title drift/)
    expect(result.error).toMatch(/registry\.json shows "manager", expected "autonomous"/)
    // Proof the perturbation landed AFTER G14 and this is G22's abort, not G14's re-read.
    expect((result.operations ?? []).some((op: string) => /^G14: Set governanceTitle/.test(op))).toBe(true)
  })

  /**
   * The third arm: the read itself fails. A registry.json holding a non-array parses fine and then
   * throws on `.find` — the exact case the gate's comment names, and the reason `.find` is
   * deliberately left INSIDE the try. (A non-array is used rather than `chmod`, which passes
   * vacuously when the suite runs as root.)
   */
  it('aborts when registry.json is unreadable as an agent array', async () => {
    const { driveChangeTitle } = await import(HELPER)
    perturbAfterG14e(() => H.writeDisk({ agents: [...H.registry.values()] }))   // an OBJECT, not an array

    const result = await driveChangeTitle(AGENT_ID, 'autonomous')

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/G22: Final verification failed/)
    expect(result.error).toMatch(/is not a function/)
  })
})
