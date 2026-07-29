/**
 * Governance drift tests — R32: agents NEVER face a sudo gate; a sudo password is
 * requested only of the USER, only via the UI
 * (`docs/GOVERNANCE-ENFORCEMENT-MAP.md` rows R32.1, R32.2).
 *
 * TEXT-AGAINST-GUARD, checked BEFORE writing a line of this file. Both rules genuinely
 * match the code they cite, which is why both are honestly pinnable here:
 *   R32.1 — "Agents never require sudo gates / sudo tokens. They authenticate with their
 *           AID" → `lib/sudo-guard.ts:86-88`, the `if (!ctx.isSystemOwner) return
 *           requireAidTitle(...)` diversion, which fires BEFORE the token is even read.
 *   R32.2 — "A sudo password may be requested only of the USER, and only via the UI" →
 *           `app/api/auth/sudo-password/route.ts:98-108`, which 403s an agent-authenticated
 *           mint, plus the same diversion (the map cites both sites; the earlier citation
 *           named only the consume half and was corrected in commit 2b0954fe).
 * The sibling R39 rules came out the OPPOSITE way in the batch before this one — guards
 * encoding a superseded rule text — and were FILED (TRDD-SPS63XHA) rather than pinned,
 * because a test written against a superseded guard passes and thereby certifies the drift.
 *
 * Every test drives a REAL exported entry point (`requireSudoToken`, the route's own `POST`)
 * against a REAL strict route from `security-registry.json`. `authenticateFromRequest` is
 * the ONLY thing mocked: it is the auth BRIDGE (environment — it parses headers/cookies),
 * not the guard under test. `buildAuthContext` stays REAL, so the `isSystemOwner`
 * classification both guards branch on is the production one.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { FAKE_HOME, FAKE_STATE } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fsSync = require('fs')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const osSync = require('os')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pathSync = require('path')
  const home = fsSync.mkdtempSync(pathSync.join(osSync.tmpdir(), 'r32-home-'))
  const state = fsSync.mkdtempSync(pathSync.join(osSync.tmpdir(), 'r32-state-'))
  fsSync.mkdirSync(pathSync.join(state, 'agents'), { recursive: true })
  return { FAKE_HOME: home, FAKE_STATE: state }
})

// Layer 1 — static `homedir` imports.
vi.mock('os', async importOriginal => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, default: { ...actual, homedir: () => FAKE_HOME }, homedir: () => FAKE_HOME }
})

// Layer 2 — the path functions themselves. `lib/ecosystem-constants.ts` resolves homedir
// through a RUNTIME require inside each function body, which layer 1 does not reliably
// intercept. This layer is what actually contains `lib/kill-switch.ts`, which computes its
// LOCKDOWN_FILE from `getStateDir()` at MODULE LOAD and writes there on a failed auth.
vi.mock('@/lib/ecosystem-constants', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ecosystem-constants')>()
  const { fakeEcosystemPaths } = await import('@/tests/helpers/fake-ecosystem-home')
  return fakeEcosystemPaths(actual, FAKE_HOME, FAKE_STATE)
})

const spies = vi.hoisted(() => ({
  authenticate: vi.fn(),
  verifyAndConsume: vi.fn(),
  issue: vi.fn(),
  countBySubject: vi.fn(),
}))

// The auth BRIDGE only. `buildAuthContext` — the function that decides isSystemOwner, i.e.
// the very branch under test — is deliberately left real.
vi.mock('@/lib/agent-auth', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/agent-auth')>()
  return { ...actual, authenticateFromRequest: (...a: unknown[]) => spies.authenticate(...a) }
})

// Routed through a thunk so `beforeEach` can restore each implementation. An inline
// `vi.fn(impl)` in the factory cannot be restored, and `vi.clearAllMocks()` clears CALLS
// but not IMPLEMENTATIONS — so a mock set in one test would leak into every test after it.
vi.mock('@/lib/sudo-auth', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/sudo-auth')>()
  return {
    ...actual,
    verifyAndConsumeSudoToken: (...a: unknown[]) => spies.verifyAndConsume(...a),
    issueSudoToken: (...a: unknown[]) => spies.issue(...a),
    countBySubject: (...a: unknown[]) => spies.countBySubject(...a),
  }
})

/** A MANAGER agent. `agentId` set ⇒ `buildAuthContext` computes isSystemOwner = false. */
const MANAGER_AGENT = { agentId: 'agent-manager-1', governanceTitle: 'manager', teamId: null }
/** A MEMBER agent — refused by the TITLE path, which is the point of the second test. */
const MEMBER_AGENT = { agentId: 'agent-member-1', governanceTitle: 'member', teamId: null }
/** The USER / system owner: no agentId at all. */
const SYSTEM_OWNER = {}

/** A real strict route (security-registry.json: "DELETE_/api/agents/[id]": "strict"). */
const STRICT_METHOD = 'DELETE'
const STRICT_TEMPLATE = '/api/agents/[id]'

function strictRequest(headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost:23000/api/agents/some-target-id', {
    method: STRICT_METHOD,
    headers,
  })
}

async function freshGuard() {
  vi.resetModules()
  const { requireSudoToken } = await import('@/lib/sudo-guard')
  return requireSudoToken
}

beforeEach(async () => {
  vi.clearAllMocks()
  const actual = await vi.importActual<typeof import('@/lib/sudo-auth')>('@/lib/sudo-auth')
  // Delegate to the REAL consume so the system-owner positive control genuinely fails on a
  // missing token rather than on a stub that refuses everything.
  spies.verifyAndConsume.mockImplementation(actual.verifyAndConsumeSudoToken)
  spies.issue.mockResolvedValue({ token: 'sudo-token-under-test', expiresAt: Date.now() + 60_000 })
  spies.countBySubject.mockReturnValue(0)
})

describe('R32.1 — an agent caller is diverted to the AID/title path and never sudo-gated', () => {
  it('lets a MANAGER agent through a STRICT route carrying NO sudo token at all', async () => {
    // The strongest form of the rule: not "the agent gets a different error message", but
    // "the agent is authorized with no sudo token in the request".
    spies.authenticate.mockReturnValue(MANAGER_AGENT)
    const requireSudoToken = await freshGuard()

    const result = requireSudoToken(strictRequest(), STRICT_METHOD, STRICT_TEMPLATE)

    expect(result).toBeNull()
    // The load-bearing assertion. Deleting the `!ctx.isSystemOwner` diversion makes the
    // agent fall into the USER branch, which reads and consumes the token — so this call
    // count is what distinguishes "not sudo-gated" from "sudo-gated but happened to pass".
    expect(spies.verifyAndConsume).not.toHaveBeenCalled()
  })

  it('refuses a MEMBER agent by TITLE, not by sudo — still without touching the token store', async () => {
    // A refusal is expected here; WHICH refusal is the finding. `aid_title_forbidden` proves
    // the request took the R28 title path; `sudo_required` would prove it took the sudo path.
    spies.authenticate.mockReturnValue(MEMBER_AGENT)
    const requireSudoToken = await freshGuard()

    const result = requireSudoToken(strictRequest(), STRICT_METHOD, STRICT_TEMPLATE)

    expect(result).not.toBeNull()
    expect(result!.status).toBe(403)
    const body = await result!.json()
    expect(body.error).toBe('aid_title_forbidden')
    expect(body.error).not.toBe('sudo_required')
    expect(spies.verifyAndConsume).not.toHaveBeenCalled()
  })

  it('is NOT weakened by an agent that supplies a sudo token anyway', async () => {
    // R32.3's shape: a token in an agent's request must buy nothing. If the diversion were
    // removed, this MEMBER would be evaluated on the token instead of on its title.
    spies.authenticate.mockReturnValue(MEMBER_AGENT)
    const requireSudoToken = await freshGuard()

    const result = requireSudoToken(
      strictRequest({ 'x-sudo-token': 'whatever-an-agent-might-send' }),
      STRICT_METHOD,
      STRICT_TEMPLATE,
    )

    expect((await result!.json()).error).toBe('aid_title_forbidden')
    expect(spies.verifyAndConsume).not.toHaveBeenCalled()
  })

  it('POSITIVE CONTROL — the SAME strict route DOES sudo-gate the system owner', async () => {
    // Without this, every assertion above is also satisfied by a sudo gate that gates
    // nobody: "the agent was not sudo-gated" is trivially true if the route is not gated
    // at all. This is the case that proves the gate exists and that only the AGENT skips it.
    spies.authenticate.mockReturnValue(SYSTEM_OWNER)
    const requireSudoToken = await freshGuard()

    const result = requireSudoToken(strictRequest(), STRICT_METHOD, STRICT_TEMPLATE)

    expect(result).not.toBeNull()
    expect(result!.status).toBe(403)
    const body = await result!.json()
    expect(body.error).toBe('sudo_required')
    expect(body.reason).toBe('missing')
    expect(spies.verifyAndConsume).toHaveBeenCalledTimes(1)
  })
})

describe('R32.2 — the sudo-password MINT route refuses an agent outright', () => {
  function mintRequest() {
    return new NextRequest('http://localhost:23000/api/auth/sudo-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'irrelevant-the-gate-is-before-the-body' }),
    })
  }

  it('403s an agent-authenticated mint with sudo_user_only', async () => {
    spies.authenticate.mockReturnValue(MANAGER_AGENT)
    vi.resetModules()
    const { POST } = await import('@/app/api/auth/sudo-password/route')

    const res = await POST(mintRequest())

    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('sudo_user_only')
    // The refusal precedes the mint entirely — an agent never reaches the password check.
    expect(spies.issue).not.toHaveBeenCalled()
  })

  it('POSITIVE CONTROL — the system owner DOES get a token from the same route', async () => {
    // Same reasoning as above: a route that refused everyone would satisfy the agent
    // assertion for the wrong reason. MANAGER is the highest agent title there is, so the
    // pair together say "no agent, however privileged" rather than "this route is closed".
    spies.authenticate.mockReturnValue(SYSTEM_OWNER)
    vi.resetModules()
    const { POST } = await import('@/app/api/auth/sudo-password/route')

    const res = await POST(mintRequest())

    expect(res.status).toBe(200)
    expect((await res.json()).token).toBe('sudo-token-under-test')
    expect(spies.issue).toHaveBeenCalledTimes(1)
    // R32.2's subject is always the USER — never an agent id.
    expect(spies.issue.mock.calls[0][1]).toBe('system-owner')
  })
})

describe('0-IMPACT containment holds', () => {
  it('the state dir the guards would write to is the sandboxed one', async () => {
    const { getStateDir } = await import('@/lib/ecosystem-constants')
    expect(getStateDir()).toBe(FAKE_STATE)
    expect(
      FAKE_STATE.startsWith('/private/') || FAKE_STATE.startsWith('/tmp') || FAKE_STATE.startsWith('/var'),
    ).toBe(true)
  })
})
