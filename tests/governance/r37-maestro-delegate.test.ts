/**
 * Governance drift tests — R37: the single MAESTRO-DELEGATE handoff
 * (`docs/GOVERNANCE-ENFORCEMENT-MAP.md` rows R37.2, R37.3, R37.4).
 *
 * TEXT-AGAINST-GUARD, checked before writing: all three rules match the code the map
 * cites, so all three are honestly pinnable.
 *   R37.2 "only one at a time" + "while in use the MAESTRO is SUSPENDED"
 *   R37.3 "the MAESTRO may recall the delegate at any time, restoring itself"
 *   R37.4 "the delegate has NO power over the MAESTRO/MAESTRO-DELEGATE titles"
 *
 * CITATION CORRECTED IN THIS COMMIT: the map cited R37.4 at `route.ts:75-80` — the POST
 * "a delegate cannot appoint another delegate" refusal — and nothing else. R37.4 has a
 * SECOND enforcement site, the DELETE twin at `:139-144` ("a delegate cannot recall
 * itself"). The neuter run proves the omission is material: deleting `:139-144` alone
 * reddens a test that the cited range does not cover. Same shape as the R32.2 citation
 * fixed in 2b0954fe — a rule enforced at two sites whose row named only one.
 *
 * The route is driven END-TO-END against a REAL, sandboxed users.json + governance.json:
 * `saveUser`, `loadGovernance`, the file locks and the signed ledger all really run, so
 * the assertions read the persisted state rather than a mock's memory of it. Exactly two
 * things are mocked, and both are ENVIRONMENT rather than the guards under test:
 *   - `authenticateFromRequest` — the auth BRIDGE (parses headers/cookies). It is what
 *     lets a test BE the maestro or BE the acting delegate.
 *   - `requireSudoToken` — a DIFFERENT rule's guard (R32, pinned in
 *     tests/governance/r32-agents-never-sudo.test.ts). Minting a real one-shot sudo token
 *     per call would test R32 here, not R37.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { writeFileSync, readFileSync } from 'fs'
import path from 'path'
import type { UserRecord } from '@/types/user'

const { FAKE_HOME, FAKE_STATE } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fsSync = require('fs')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const osSync = require('os')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pathSync = require('path')
  const home = fsSync.mkdtempSync(pathSync.join(osSync.tmpdir(), 'r37-home-'))
  const state = fsSync.mkdtempSync(pathSync.join(osSync.tmpdir(), 'r37-state-'))
  return { FAKE_HOME: home, FAKE_STATE: state }
})

vi.mock('os', async importOriginal => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, default: { ...actual, homedir: () => FAKE_HOME }, homedir: () => FAKE_HOME }
})

// Load-bearing: `lib/user-registry.ts` computes USERS_FILE from `getStateDir()` at MODULE
// LOAD, and `lib/governance.ts` does the same for governance.json. Without this layer the
// route would read and REWRITE the developer's real ~/.aimaestro/users.json.
vi.mock('@/lib/ecosystem-constants', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ecosystem-constants')>()
  const { fakeEcosystemPaths } = await import('@/tests/helpers/fake-ecosystem-home')
  return fakeEcosystemPaths(actual, FAKE_HOME, FAKE_STATE)
})

const spies = vi.hoisted(() => ({ authenticate: vi.fn() }))

vi.mock('@/lib/agent-auth', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/agent-auth')>()
  return { ...actual, authenticateFromRequest: (...a: unknown[]) => spies.authenticate(...a) }
})

// R32's guard, not R37's. Returning null is "the USER already confirmed with a fresh sudo
// token" — the precondition every one of these tests is downstream of.
vi.mock('@/lib/sudo-guard', () => ({ requireSudoToken: () => null }))

const MAESTRO_ID = 'user-maestro'
const USER_B = 'user-bravo'
const USER_C = 'user-charlie'

const USERS_FILE = path.join(FAKE_STATE, 'users.json')
const GOVERNANCE_FILE = path.join(FAKE_STATE, 'governance.json')

function user(id: string, title: UserRecord['title'], name: string): UserRecord {
  return {
    id,
    aid: `aid-${id}`,
    name,
    title,
    native: true,
    passwordHash: null,
    passwordSetAt: null,
    assistantAgentId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

function seed(users: UserRecord[]) {
  writeFileSync(USERS_FILE, JSON.stringify({ version: 1, users }, null, 2), 'utf-8')
  // `version: 1` is REQUIRED, not decoration: `loadGovernance` refuses any other value
  // and returns DEFAULTS — which have the model OFF, so every one of these tests would
  // get the route's `user_authority_model_disabled` 409 instead of the guard under test.
  // `maestroUserId` present ⇒ `maybeMigrateMaestroUser` short-circuits as "already
  // migrated", so loading governance never invents a user behind the fixture's back.
  writeFileSync(
    GOVERNANCE_FILE,
    JSON.stringify(
      { version: 1, userAuthorityModelEnabled: true, maestroUserId: MAESTRO_ID, maestroDelegateUserId: null },
      null,
      2,
    ),
    'utf-8',
  )
}

/** Read the persisted truth, not a mock's memory of it. */
function readUsers(): UserRecord[] {
  return JSON.parse(readFileSync(USERS_FILE, 'utf-8')).users
}
function titleOf(id: string): string | undefined {
  return readUsers().find(u => u.id === id)?.title
}

/** The caller identity the auth bridge will report for the next request. */
function actingAs(userId: string, userTitle: 'maestro' | 'maestro-delegate') {
  spies.authenticate.mockReturnValue({ userId, userTitle })
}

function req(method: 'POST' | 'DELETE', body?: unknown) {
  return new NextRequest('http://localhost:23000/api/governance/maestro-delegate', {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

async function route() {
  vi.resetModules()
  return await import('@/app/api/governance/maestro-delegate/route')
}

beforeEach(() => {
  vi.clearAllMocks()
  seed([user(MAESTRO_ID, 'maestro', 'Maestro'), user(USER_B, 'user', 'Bravo'), user(USER_C, 'user', 'Charlie')])
})

describe('R37.2 — exactly ONE delegate at a time, and it SUSPENDS the maestro', () => {
  it('assigns a delegate and thereby suspends the maestro', async () => {
    // The suspension is R37.2's second clause and the one its citation does NOT name:
    // it lives in `getActiveMaestroUserId()`, not in the route. Asserting it here is what
    // makes this a test of the RULE rather than of the 409 branch alone.
    actingAs(MAESTRO_ID, 'maestro')
    const { POST } = await route()

    const res = await POST(req('POST', { targetUserId: USER_B }))

    expect(res.status).toBe(200)
    expect(titleOf(USER_B)).toBe('maestro-delegate')
    const { getActiveMaestroUserId } = await import('@/lib/user-registry')
    expect(getActiveMaestroUserId()).toBe(USER_B)
    // The ORIGINAL maestro keeps its title — it is suspended, not demoted.
    expect(titleOf(MAESTRO_ID)).toBe('maestro')
  })

  it('refuses a SECOND delegate while one is already active', async () => {
    seed([user(MAESTRO_ID, 'maestro', 'Maestro'), user(USER_B, 'maestro-delegate', 'Bravo'), user(USER_C, 'user', 'Charlie')])
    actingAs(MAESTRO_ID, 'maestro')
    const { POST } = await route()

    const res = await POST(req('POST', { targetUserId: USER_C }))

    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/already exists/i)
    // The refusal must not have half-applied: Charlie is untouched.
    expect(titleOf(USER_C)).toBe('user')
  })

  it('POSITIVE CONTROL — the SAME assignment succeeds once the seat is free', async () => {
    // Without this, the 409 above is equally satisfied by an assign path that is simply
    // broken for everyone. The only difference between the two cases is the occupied seat.
    actingAs(MAESTRO_ID, 'maestro')
    const { POST } = await route()

    const res = await POST(req('POST', { targetUserId: USER_C }))

    expect(res.status).toBe(200)
    expect(titleOf(USER_C)).toBe('maestro-delegate')
  })

  it('refuses making the MAESTRO its own delegate', async () => {
    // "No two MAESTROs may co-exist" from the other direction — one person holding both
    // titles would satisfy the one-at-a-time count while defeating what it protects.
    actingAs(MAESTRO_ID, 'maestro')
    const { POST } = await route()

    const res = await POST(req('POST', { targetUserId: MAESTRO_ID }))

    expect(res.status).toBe(400)
    expect(titleOf(MAESTRO_ID)).toBe('maestro')
  })
})

describe('R37.3 — the MAESTRO may recall the delegate, restoring itself', () => {
  it('demotes the delegate and returns the active-maestro identity to the maestro', async () => {
    seed([user(MAESTRO_ID, 'maestro', 'Maestro'), user(USER_B, 'maestro-delegate', 'Bravo')])
    actingAs(MAESTRO_ID, 'maestro')
    const { DELETE } = await route()

    const res = await DELETE(req('DELETE'))

    expect(res.status).toBe(200)
    expect((await res.json()).recalled).toBe(USER_B)
    expect(titleOf(USER_B)).toBe('user')
    const { getActiveMaestroUserId, getMaestroDelegateUserId } = await import('@/lib/user-registry')
    expect(getMaestroDelegateUserId()).toBeNull()
    expect(getActiveMaestroUserId()).toBe(MAESTRO_ID)
  })
})

describe('R37.4 — the acting delegate has NO power over the two titles', () => {
  beforeEach(() => {
    seed([user(MAESTRO_ID, 'maestro', 'Maestro'), user(USER_B, 'maestro-delegate', 'Bravo'), user(USER_C, 'user', 'Charlie')])
  })

  it('refuses a delegate appointing ANOTHER delegate', async () => {
    // The delegate is the ACTIVE maestro, so `enforceMaestro` admits it — this refusal is
    // the only thing standing between "acting with maestro authority" and "rewriting who
    // holds that authority". Note it would also be refused by the one-at-a-time 409, so
    // the ERROR CODE is what distinguishes which guard fired.
    actingAs(USER_B, 'maestro-delegate')
    const { POST } = await route()

    const res = await POST(req('POST', { targetUserId: USER_C }))

    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('forbidden_delegate_cannot_assign')
    expect(titleOf(USER_C)).toBe('user')
  })

  it('refuses a delegate recalling ITSELF', async () => {
    // The SECOND enforcement site (route.ts:139-144), which the map's R37.4 citation did
    // not name. A delegate that could recall itself could hand the seat on at will.
    actingAs(USER_B, 'maestro-delegate')
    const { DELETE } = await route()

    const res = await DELETE(req('DELETE'))

    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('forbidden_delegate_cannot_recall')
    expect(titleOf(USER_B)).toBe('maestro-delegate')
  })

  it('POSITIVE CONTROL — the ORIGINAL maestro is refused NEITHER operation', async () => {
    // Both refusals above must be about WHO is asking. Without this pair they are equally
    // satisfied by a route that refuses everybody, which would make R37.3 unenforceable too.
    actingAs(MAESTRO_ID, 'maestro')
    const { DELETE } = await route()
    const recall = await DELETE(req('DELETE'))
    expect(recall.status).toBe(200)

    const { POST } = await route()
    const assign = await POST(req('POST', { targetUserId: USER_C }))
    expect(assign.status).toBe(200)
    expect(titleOf(USER_C)).toBe('maestro-delegate')
  })
})

describe('0-IMPACT containment holds', () => {
  it('the users file the route rewrote is the sandboxed one', async () => {
    const { getStateDir } = await import('@/lib/ecosystem-constants')
    expect(getStateDir()).toBe(FAKE_STATE)
    expect(USERS_FILE.startsWith('/private/') || USERS_FILE.startsWith('/tmp') || USERS_FILE.startsWith('/var')).toBe(true)
  })
})
