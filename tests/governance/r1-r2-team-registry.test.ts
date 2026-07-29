/**
 * Governance drift tests — team-registry sub-rules that have a REAL guard but were
 * never pinned by any test (`docs/GOVERNANCE-ENFORCEMENT-MAP.md` rows R1.5, R2.1, R2.3).
 *
 * Every test calls the REAL exported function and asserts the REFUSAL the guard
 * produces. Delete or weaken the guard and the named test goes red — that is the only
 * property that makes a row's "ENFORCED" honest. A test that asserts a constant table,
 * or that mocks the guard's own module, would survive the guard's deletion and is
 * therefore excluded here.
 *
 * NOT pinned in this file — reported rather than faked:
 *
 *   - **R2.2** ("enforced BOTH server-side (409) and client-side (inline error before
 *     POST)"). The server half is the same `validateTeamMutation` line R2.1 pins; the
 *     CLIENT half lives in `components/sidebar/TeamListView.tsx` and needs the jsdom
 *     environment, which is a per-FILE setting and cannot coexist with the fs tests
 *     here. Marking R2.2 proven off the server half alone would be claiming a
 *     two-part rule is pinned when half of it is not.
 *
 *   - **R8.1** ("all team writes take `withLock`"). The failure it prevents is a
 *     read-modify-write interleaving, and in ONE process it cannot happen: the callback
 *     `createTeam` hands to `withLock` is SYNCHRONOUS, so `Promise.all` over three
 *     creates serialises with or without the lock. An in-process concurrency test would
 *     therefore pass against a deleted lock — a test that pins nothing. The real risk is
 *     cross-PROCESS (a server and a CLI, or two servers), so the honest test spawns two
 *     processes; it needs its own harness (`$HOME` redirection, since `getStateDir()`
 *     has no env override) and is filed rather than approximated. Asserting `withLock`
 *     was *called* would be mocking the guard to prove the guard.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import path from 'path'

// ============================================================================
// Hoisted fake $HOME + state dir. `vi.hoisted` runs before the mock factories AND
// before this file's static imports, which matters because team-registry resolves
// TEAMS_FILE from `getStateDir()` at MODULE level.
// ============================================================================
const { FAKE_HOME, FAKE_STATE } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fsSync = require('fs')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const osSync = require('os')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pathSync = require('path')
  const home = fsSync.mkdtempSync(pathSync.join(osSync.tmpdir(), 'r1r2-home-'))
  const state = fsSync.mkdtempSync(pathSync.join(osSync.tmpdir(), 'r1r2-state-'))
  fsSync.mkdirSync(pathSync.join(state, 'teams'), { recursive: true })
  return { FAKE_HOME: home, FAKE_STATE: state }
})

// 0-IMPACT layer 1 — `os.homedir()`, for anything resolving $HOME through a STATIC import.
vi.mock('os', async importOriginal => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, default: { ...actual, homedir: () => FAKE_HOME }, homedir: () => FAKE_HOME }
})

// 0-IMPACT layer 2 — the ecosystem PATH functions. `lib/ecosystem-constants.ts` resolves
// homedir() through a RUNTIME require inside each function body, which layer 1 does NOT
// reliably intercept; overriding the path functions themselves holds either way. Every
// other export stays REAL via the spread, because mocking those would test the mock.
vi.mock('@/lib/ecosystem-constants', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ecosystem-constants')>()
  const { fakeEcosystemPaths } = await import('@/tests/helpers/fake-ecosystem-home')
  return fakeEcosystemPaths(actual, FAKE_HOME, FAKE_STATE)
})

// ENVIRONMENT, not guards. `blockAllTeams` hibernates every team agent by killing its
// tmux session through a dynamically-imported `child_process.execFile`. Unmocked, this
// test would kill the DEVELOPER'S OWN running sessions — the loudest possible 0-IMPACT
// violation. Both the lookup and the exec are stubbed so the loop is inert either way.
vi.mock('child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('child_process')>()
  return {
    ...actual,
    execFile: (_f: string, _a: string[], cb: (e: Error | null, r: { stdout: string; stderr: string }) => void) =>
      cb(null, { stdout: '', stderr: '' }),
  }
})
vi.mock('@/lib/agent-registry', () => ({ getAgent: () => null }))

// A governance broadcast is a websocket fan-out to live clients — environment, not guard.
// It MUST return a promise: the callers treat it as fire-and-forget and attach `.catch()`
// to the result. A `() => {}` stub returns undefined and every create/update dies on
// `undefined.catch` — which is what the first run of this file did.
vi.mock('@/lib/governance-sync', () => ({ broadcastGovernanceSync: async () => {} }))

const TEAMS_FILE = path.join(FAKE_STATE, 'teams', 'teams.json')

/**
 * A registry with NO module state carried over.
 *
 * `saveTeams` diffs against a module-level `_prevTeams` to build its ledger patch, so a
 * second test importing the same instance would diff against the previous test's teams.
 * Resetting modules per test makes each case start from a genuinely empty registry.
 */
async function freshRegistry() {
  vi.resetModules()
  return await import('@/lib/team-registry')
}

beforeEach(() => {
  if (existsSync(TEAMS_FILE)) rmSync(TEAMS_FILE)
  mkdirSync(path.dirname(TEAMS_FILE), { recursive: true })
})

describe('R2.1 — team names are unique, case-INSENSITIVELY', () => {
  it('refuses a second team whose name differs only in case, with 409', async () => {
    const reg = await freshRegistry()
    await reg.createTeam({ name: 'Alpha Team', agentIds: [] })

    // The rule is specifically CASE-INSENSITIVE. A byte-comparison guard would let this
    // through, so a differently-cased duplicate is the input that discriminates.
    await expect(reg.createTeam({ name: 'alpha team', agentIds: [] })).rejects.toMatchObject({
      name: 'TeamValidationException',
      code: 409,
    })
  })

  it('POSITIVE CONTROL — a genuinely different name still succeeds', async () => {
    // Without this, "it rejected" would also be satisfied by a guard that rejects
    // EVERYTHING (a broken validator, a mis-wired mock), and the test above would pass
    // for entirely the wrong reason.
    const reg = await freshRegistry()
    await reg.createTeam({ name: 'Alpha Team', agentIds: [] })
    const beta = await reg.createTeam({ name: 'Beta Team', agentIds: [] })

    expect(beta.name).toBe('Beta Team')
    expect(reg.loadTeams().map(t => t.name).sort()).toEqual(['Alpha Team', 'Beta Team'])
  })
})

describe('R2.3 — a rename checks uniqueness against all OTHER teams, excluding itself', () => {
  it('lets a team keep its own name on update — the self-exclusion', async () => {
    const reg = await freshRegistry()
    const alpha = await reg.createTeam({ name: 'Alpha Team', agentIds: [] })

    // The `&& t.id !== teamId` half of the guard. Drop it and a team can never be
    // updated again, because it always collides with ITSELF — a self-inflicted deadlock
    // that a duplicate-only test would never notice.
    const updated = await reg.updateTeam(alpha.id, { name: 'Alpha Team', description: 'edited' })
    expect(updated?.description).toBe('edited')
    expect(updated?.name).toBe('Alpha Team')
  })

  it("refuses a rename onto ANOTHER team's name, case-insensitively, with 409", async () => {
    const reg = await freshRegistry()
    await reg.createTeam({ name: 'Alpha Team', agentIds: [] })
    const beta = await reg.createTeam({ name: 'Beta Team', agentIds: [] })

    await expect(reg.updateTeam(beta.id, { name: 'ALPHA TEAM' })).rejects.toMatchObject({
      name: 'TeamValidationException',
      code: 409,
    })
    // The refusal must also have changed NOTHING — a guard that throws after writing is
    // worse than one that does not throw at all.
    expect(reg.getTeam(beta.id)?.name).toBe('Beta Team')
  })
})

describe('R1.5 — with no MANAGER, every team is blocked and all operations freeze', () => {
  it('sets blocked on every team, and unblockAllTeams clears it again', async () => {
    const reg = await freshRegistry()
    const alpha = await reg.createTeam({ name: 'Alpha Team', agentIds: [] })
    const beta = await reg.createTeam({ name: 'Beta Team', agentIds: [] })

    // PRE-CONDITION: they start unblocked. Without this the post-condition could be
    // satisfied by teams that were blocked all along.
    expect(reg.getTeam(alpha.id)?.blocked).toBeFalsy()
    expect(reg.getTeam(beta.id)?.blocked).toBeFalsy()

    await reg.blockAllTeams()
    expect(reg.getTeam(alpha.id)?.blocked).toBe(true)
    expect(reg.getTeam(beta.id)?.blocked).toBe(true)

    // The inverse, because a one-way flag would satisfy the assertion above while making
    // the block permanent — and R1.5's whole shape is "blocked UNTIL a MANAGER exists".
    await reg.unblockAllTeams()
    expect(reg.getTeam(alpha.id)?.blocked).toBe(false)
    expect(reg.getTeam(beta.id)?.blocked).toBe(false)
  })
})

describe('0-IMPACT containment holds', () => {
  it('every write landed in the temp state dir, and the real home was never resolved', async () => {
    // The containment is itself a claim, and an unverified containment claim is how a
    // suite quietly writes to the developer's home. `fakeEcosystemPaths` throws at setup
    // if handed a non-temp path; this asserts the other end — that the file the registry
    // actually wrote is the sandboxed one.
    const reg = await freshRegistry()
    await reg.createTeam({ name: 'Containment Check', agentIds: [] })

    expect(existsSync(TEAMS_FILE)).toBe(true)
    expect(TEAMS_FILE.startsWith('/private/') || TEAMS_FILE.startsWith('/tmp') || TEAMS_FILE.startsWith('/var')).toBe(true)
    const { getStateDir } = await import('@/lib/ecosystem-constants')
    expect(getStateDir()).toBe(FAKE_STATE)
  })
})

// Referenced so the fixture writer is not flagged unused when a case is trimmed.
void writeFileSync
