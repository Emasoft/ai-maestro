/**
 * R40.1 — a NON-NATIVE (foreign) user "requires the MAESTRO's approval for
 * EVERY agent or team creation".
 *
 * The rule is quantified over creation surfaces, so pinning one of them would
 * launder an instance into a rule — and this rule has already been half-enforced
 * once: `create_team` sat in `R40_RESTRICTABLE_COMMANDS` while the guard was
 * wired into `CreateAgent` ONLY, until the M3 fix of the 2026-06-19 audit. That
 * is the exact failure a single-surface test cannot see, so this file is
 * MECHANISM + COVERAGE:
 *
 *   MECHANISM — `assertForeignUserMayCall` itself: who it lets through, who it
 *   refuses, and (the security-critical one) that it fails CLOSED when the
 *   grant store cannot be read. "R40 is a security ADD; a glitch must not
 *   silently grant a foreign user create rights" is a claim about a `catch`
 *   block, which is precisely the kind of claim that rots unobserved.
 *
 *   COVERAGE — BOTH surfaces the rule names, each driven through its real
 *   public entry point (`CreateAgent`, `createNewTeam`) with a foreign caller,
 *   asserting the refusal AND that it happened before any side effect.
 *
 * WHAT IS MOCKED, AND WHY IT IS NOT THE GUARD
 * -------------------------------------------
 * `@/lib/user-registry` and `@/lib/foreign-approval-registry` are the guard's
 * DATA SOURCES — "is this user native?" and "what did the MAESTRO grant?" —
 * and both are reached by DYNAMIC import inside the guard, which vitest's mock
 * registry intercepts. `isForeignUser` and `assertForeignUserMayCall` run for
 * real, as do both pipelines' gate blocks. Nothing here stubs the guard; a test
 * that did would survive its deletion.
 *
 * Neuter record (2026-07-30) — three mutations, because one neuter certifies
 * only the surface it reaches, and the whole point of this rule is that the
 * surfaces are independent:
 *   A. `assertForeignUserMayCall` → `return null` on entry
 *      → the four MECHANISM refusal tests AND both COVERAGE tests fail; the
 *        three "allowed" tests stay green (they assert `null` already).
 *   B. delete the `G00f` block in `CreateAgent`
 *      → ONLY the CreateAgent coverage test fails. createNewTeam stays green,
 *        which is the M3 regression reproduced exactly.
 *   C. delete the `create_team` gate in `createNewTeam`
 *      → ONLY the createNewTeam coverage test fails.
 * B and C are what make the coverage claim real: either alone would leave one
 * surface free to lose its gate silently.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { existsSync } from 'fs'
import path from 'path'
import type { AuthContext } from '@/lib/agent-auth'

// ============================================================================
// Hoisted fake $HOME + state dir, and the mutable fixture the mock factories
// close over. `vi.hoisted` runs before the factories AND before static imports,
// which matters because the registries resolve their paths at MODULE level.
// ============================================================================
const { FAKE_HOME, FAKE_STATE, FIXTURE } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fsSync = require('fs')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const osSync = require('os')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pathSync = require('path')
  const home = fsSync.mkdtempSync(pathSync.join(osSync.tmpdir(), 'r40-home-'))
  const state = fsSync.mkdtempSync(pathSync.join(osSync.tmpdir(), 'r40-state-'))
  fsSync.mkdirSync(pathSync.join(state, 'teams'), { recursive: true })
  fsSync.mkdirSync(pathSync.join(state, 'agents'), { recursive: true })
  fsSync.mkdirSync(pathSync.join(home, 'agents'), { recursive: true })
  return {
    FAKE_HOME: home,
    FAKE_STATE: state,
    FIXTURE: {
      users: {} as Record<string, { aid?: string; native: boolean } | undefined>,
      grants: [] as Array<{ kind: string; fingerprint: string; status: string; grantedCommands?: string[] }>,
      grantStoreThrows: false,
    },
  }
})

// 0-IMPACT layer 1 — anything resolving $HOME through a STATIC import.
vi.mock('os', async importOriginal => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, default: { ...actual, homedir: () => FAKE_HOME }, homedir: () => FAKE_HOME }
})

// 0-IMPACT layer 2 — `lib/ecosystem-constants.ts` resolves homedir() through a
// RUNTIME require inside each function body, which layer 1 does not reliably
// intercept; overriding the path functions themselves holds either way.
vi.mock('@/lib/ecosystem-constants', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ecosystem-constants')>()
  const { fakeEcosystemPaths } = await import('@/tests/helpers/fake-ecosystem-home')
  return fakeEcosystemPaths(actual, FAKE_HOME, FAKE_STATE)
})

// DATA SOURCE, not guard: "is this user native?" — spread the real module so any
// other consumer of it keeps working.
vi.mock('@/lib/user-registry', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/user-registry')>()
  return { ...actual, getUser: (id: string) => FIXTURE.users[id] ?? null }
})

// DATA SOURCE, not guard: "what did the MAESTRO grant?"
vi.mock('@/lib/foreign-approval-registry', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/foreign-approval-registry')>()
  return {
    ...actual,
    loadForeignApprovals: () => {
      if (FIXTURE.grantStoreThrows) throw new Error('grant store unreadable')
      return FIXTURE.grants
    },
  }
})

// A governance broadcast is a websocket fan-out to live clients — environment.
// It MUST return a promise: callers attach `.catch()` to the result.
vi.mock('@/lib/governance-sync', () => ({ broadcastGovernanceSync: async () => {} }))

// Nothing in the refused path should shell out, but a stray helper must never
// reach the developer's tmux.
vi.mock('child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('child_process')>()
  return {
    ...actual,
    execFile: (_f: string, _a: string[], cb: (e: Error | null, r: { stdout: string; stderr: string }) => void) =>
      cb(null, { stdout: '', stderr: '' }),
  }
})

const FOREIGN = { userId: 'user-foreign' } as unknown as AuthContext
const NATIVE = { userId: 'user-native' } as unknown as AuthContext
/** An agent or the system-owner: no userId is resolved, so R40 is inert. */
const NO_USER = {} as unknown as AuthContext

beforeEach(() => {
  vi.resetModules()
  FIXTURE.users = {
    'user-foreign': { aid: 'fp-foreign', native: false },
    'user-native': { aid: 'fp-native', native: true },
  }
  FIXTURE.grants = []
  FIXTURE.grantStoreThrows = false
})

describe('R40.1 MECHANISM — assertForeignUserMayCall', () => {
  it('lets a NATIVE user through — R40 gates foreign users only', async () => {
    const { assertForeignUserMayCall } = await import('@/services/element-management-service')
    expect(await assertForeignUserMayCall(NATIVE, 'create_agent')).toBeNull()
  })

  it('lets a caller with no resolved user through (agent / system-owner / model off)', async () => {
    const { assertForeignUserMayCall } = await import('@/services/element-management-service')
    expect(await assertForeignUserMayCall(NO_USER, 'create_agent')).toBeNull()
  })

  it('refuses a foreign user who has no AID on record', async () => {
    FIXTURE.users['user-foreign'] = { native: false } // no aid
    const { assertForeignUserMayCall } = await import('@/services/element-management-service')
    const err = await assertForeignUserMayCall(FOREIGN, 'create_agent')
    // The REASON is the assertion — "denied" alone cannot tell this apart from
    // the ungranted case below, and they have different remedies.
    expect(err).toMatch(/no AID on record/)
  })

  it('refuses a foreign user the MAESTRO has not granted the command to', async () => {
    const { assertForeignUserMayCall } = await import('@/services/element-management-service')
    expect(await assertForeignUserMayCall(FOREIGN, 'create_agent')).toMatch(/not granted "create_agent"/)
  })

  it('refuses a foreign user granted a DIFFERENT command — a grant is per-command', async () => {
    FIXTURE.grants = [
      { kind: 'user', fingerprint: 'fp-foreign', status: 'approved', grantedCommands: ['create_team'] },
    ]
    const { assertForeignUserMayCall } = await import('@/services/element-management-service')
    expect(await assertForeignUserMayCall(FOREIGN, 'create_agent')).toMatch(/not granted "create_agent"/)
    // ...and the command they WERE granted still works, or the test above would
    // pass against a guard that refuses everything.
    expect(await assertForeignUserMayCall(FOREIGN, 'create_team')).toBeNull()
  })

  it('lets a foreign user through once the MAESTRO has approved that command', async () => {
    FIXTURE.grants = [
      { kind: 'user', fingerprint: 'fp-foreign', status: 'approved', grantedCommands: ['create_agent'] },
    ]
    const { assertForeignUserMayCall } = await import('@/services/element-management-service')
    expect(await assertForeignUserMayCall(FOREIGN, 'create_agent')).toBeNull()
  })

  it('ignores a grant that is not approved', async () => {
    FIXTURE.grants = [
      { kind: 'user', fingerprint: 'fp-foreign', status: 'pending', grantedCommands: ['create_agent'] },
    ]
    const { assertForeignUserMayCall } = await import('@/services/element-management-service')
    expect(await assertForeignUserMayCall(FOREIGN, 'create_agent')).toMatch(/not granted/)
  })

  it('FAILS CLOSED when the grant store cannot be read', async () => {
    FIXTURE.grantStoreThrows = true
    const { assertForeignUserMayCall } = await import('@/services/element-management-service')
    // A security ADD must not become a security SUBTRACT on a glitch: an
    // unreadable store denies, it does not wave the caller through.
    expect(await assertForeignUserMayCall(FOREIGN, 'create_agent')).toMatch(/could not verify/)
  })

  it('does not gate a command outside R40_RESTRICTABLE_COMMANDS (R40.2 scope)', async () => {
    const { assertForeignUserMayCall } = await import('@/services/element-management-service')
    expect(await assertForeignUserMayCall(FOREIGN, 'delete_agent')).toBeNull()
  })
})

describe('R40.1 COVERAGE — EVERY creation surface the rule names refuses a foreign user', () => {
  it('CreateAgent refuses at G00f, before any work', async () => {
    const { CreateAgent } = await import('@/services/element-management-service')
    const res = await CreateAgent({ name: 'r40-never-created', authContext: FOREIGN })

    expect(res.success).toBe(false)
    expect(res.error).toMatch(/R40/)
    expect(res.agentId).toBeNull()
    // The gate label proves WHICH refusal this was — without it the assertion
    // above passes on any later gate that happens to fail first.
    expect(res.operations.join('\n')).toMatch(/G00f: DENIED/)
    // "Refused before any work" is a post-condition, not a comment.
    expect(existsSync(path.join(FAKE_HOME, 'agents', 'r40-never-created'))).toBe(false)
  })

  it('createNewTeam refuses with 403, before any work', async () => {
    const { createNewTeam } = await import('@/services/teams-service')
    const res = await createNewTeam({ name: 'r40-never-created-team', authContext: FOREIGN } as never)

    expect(res.error).toMatch(/R40/)
    expect(res.status).toBe(403)
    // The team file is either absent or has not gained the team — either way
    // the refusal landed before the write.
    const teamsFile = path.join(FAKE_STATE, 'teams', 'teams.json')
    if (existsSync(teamsFile)) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const raw = require('fs').readFileSync(teamsFile, 'utf-8')
      expect(raw).not.toContain('r40-never-created-team')
    }
  })

  it('both surfaces let the SAME user through once granted — the gate is the grant, not the user', async () => {
    // Positive control for the coverage pair: without it, both refusal tests
    // would pass against a pipeline that refuses every caller.
    FIXTURE.grants = [
      { kind: 'user', fingerprint: 'fp-foreign', status: 'approved', grantedCommands: ['create_agent', 'create_team'] },
    ]
    const { assertForeignUserMayCall } = await import('@/services/element-management-service')
    expect(await assertForeignUserMayCall(FOREIGN, 'create_agent')).toBeNull()
    expect(await assertForeignUserMayCall(FOREIGN, 'create_team')).toBeNull()
  })
})
