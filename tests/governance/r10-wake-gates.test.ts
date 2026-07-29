/**
 * Governance drift tests — R10.1 / R10.5, the two gates at the top of
 * `wakeAgent` (`docs/GOVERNANCE-ENFORCEMENT-MAP.md`).
 *
 * TEXT-AGAINST-GUARD, checked before writing — both match:
 *   R10.1 "Only the user (web UI, no auth headers) or the MANAGER agent can wake ANY agent"
 *         → Gate 0, which skips authorize() entirely for the system owner and runs
 *           authorize(auth, 'wake-agent', target) for every agent caller.
 *   R10.5 "Team agents cannot be woken if no MANAGER exists on the host (even by the user)"
 *         → Gate 1, which runs UNCONDITIONALLY — it is a system invariant, not RBAC, and
 *           the "even by the user" clause is exactly what makes it a separate gate.
 *
 * CITATIONS CORRECTED IN THIS COMMIT. The map cited R10.1 at
 * `services/agents-core-service.ts:2003-2017` and R10.5 at `:2019-2028`. Both ranges land
 * inside `wakeAgent`'s RETURN-TYPE DECLARATION — real code, no guard in sight. The actual
 * gates are ~26 lines further down, at :2029-2043 and :2045-2054. This is the same defect
 * class as R10.3 last batch (fixed in 28c0ff3f): a citation that names real working code
 * is invisible to the ratchet's existence-and-bounds check, so only reading it catches it.
 *
 * THE POSITIVE CONTROLS ARE "THE ERROR MOVED". A wake that actually succeeds needs tmux,
 * a runtime and a session — none of which these two gates touch, and mocking all of it
 * would test the mock. Instead each control drives a caller the gate must ADMIT and
 * asserts the call lands on the NEXT refusal down (`404 Agent not found`, from the
 * `getAgent` lookup immediately after Gate 1). Reaching a downstream error proves the gate
 * let the caller through, which is the only thing the gate is responsible for.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { FAKE_HOME, FAKE_STATE } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fsSync = require('fs')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const osSync = require('os')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pathSync = require('path')
  return {
    FAKE_HOME: fsSync.mkdtempSync(pathSync.join(osSync.tmpdir(), 'r10-home-')),
    FAKE_STATE: fsSync.mkdtempSync(pathSync.join(osSync.tmpdir(), 'r10-state-')),
  }
})

vi.mock('os', async importOriginal => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, default: { ...actual, homedir: () => FAKE_HOME }, homedir: () => FAKE_HOME }
})

vi.mock('@/lib/ecosystem-constants', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ecosystem-constants')>()
  const { fakeEcosystemPaths } = await import('@/tests/helpers/fake-ecosystem-home')
  return fakeEcosystemPaths(actual, FAKE_HOME, FAKE_STATE)
})

const spies = vi.hoisted(() => ({
  getManagerId: vi.fn(),
  isAgentInAnyTeam: vi.fn(),
  getAgent: vi.fn(),
}))

// The two facts Gate 1 turns on. Both are ENVIRONMENT — "is there a MANAGER on this host"
// and "is this agent on a team" are inputs to the gate, not the gate.
vi.mock('@/lib/governance', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/governance')>()
  return { ...actual, getManagerId: () => spies.getManagerId() }
})
vi.mock('@/lib/team-registry', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/team-registry')>()
  return { ...actual, isAgentInAnyTeam: (id: string) => spies.isAgentInAnyTeam(id) }
})
// Returns null throughout: the `404 Agent not found` immediately downstream of Gate 1 is
// the marker every positive control below lands on.
vi.mock('@/lib/agent-registry', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/agent-registry')>()
  return { ...actual, getAgent: (id: string) => spies.getAgent(id) }
})

// NOT mocked, deliberately: `@/lib/authorization`. authorize() IS R10.1's mechanism — the
// gate is a thin call into it — so stubbing it would leave the test asserting its own stub.

const TARGET = 'agent-target'

/** A caller the web UI produces: no agent identity, isSystemOwner true. */
const USER_CTX = { isSystemOwner: true as const }
const MANAGER_CTX = { isSystemOwner: false as const, agentId: 'agent-mgr', governanceTitle: 'manager', teamId: null }
const MEMBER_CTX = { isSystemOwner: false as const, agentId: 'agent-mem', governanceTitle: 'member', teamId: null }

async function freshWake() {
  vi.resetModules()
  const { wakeAgent } = await import('@/services/agents-core-service')
  return wakeAgent
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default world: a MANAGER exists, the target is not on a team, no such agent record.
  spies.getManagerId.mockReturnValue('agent-mgr')
  spies.isAgentInAnyTeam.mockReturnValue(false)
  spies.getAgent.mockReturnValue(null)
})

describe('R10.1 — only the USER or a MANAGER may wake an agent', () => {
  it('refuses a MEMBER agent waking another agent', async () => {
    const wakeAgent = await freshWake()

    const res = await wakeAgent(TARGET, { authContext: MEMBER_CTX } as never)

    expect(res.status).toBe(403)
    // The REASON matters: a bare 403 is also produced by Gate 1, so asserting only the
    // status would pass with Gate 0 deleted and the manager-gate refusing instead.
    expect(res.error).toMatch(/cannot wake-agent|not authorized/i)
  })

  it('POSITIVE CONTROL — a MANAGER caller is admitted and reaches the next refusal down', async () => {
    // 404 is `getAgent` returning null, which sits AFTER both gates. Landing there is the
    // proof Gate 0 admitted the caller; without this the refusal above is equally satisfied
    // by a gate that refuses everyone.
    const wakeAgent = await freshWake()

    const res = await wakeAgent(TARGET, { authContext: MANAGER_CTX } as never)

    expect(res.status).toBe(404)
    expect(res.error).toBe('Agent not found')
  })

  it('POSITIVE CONTROL — the USER (web UI) skips the RBAC gate entirely', async () => {
    // The rule names TWO admitted callers, and they take different paths: the system owner
    // never reaches authorize() at all (`authContext && !isSystemOwner`). A test covering
    // only the MANAGER would leave the user's path unpinned.
    const wakeAgent = await freshWake()

    const res = await wakeAgent(TARGET, { authContext: USER_CTX } as never)

    expect(res.status).toBe(404)
  })
})

describe('R10.5 — no MANAGER on the host ⇒ no team agent may be woken, by ANYONE', () => {
  beforeEach(() => {
    spies.getManagerId.mockReturnValue(null)
    spies.isAgentInAnyTeam.mockReturnValue(true)
  })

  it('refuses the USER — the "even by the user" clause is the whole point of this gate', async () => {
    // This is what makes Gate 1 a separate gate rather than part of Gate 0: the system
    // owner is exempt from RBAC and is NOT exempt from this. Fold it into the RBAC gate
    // and the user regains the ability to wake a team agent into a manager-less host.
    const wakeAgent = await freshWake()

    const res = await wakeAgent(TARGET, { authContext: USER_CTX } as never)

    expect(res.status).toBe(403)
    expect(res.error).toMatch(/no MANAGER exists/i)
  })

  it('refuses an internal call that passes no authContext at all', async () => {
    // Gate 0 is skipped when authContext is absent (internal callers). Gate 1 is not —
    // its comment says "runs ALWAYS, even for internal calls". Pinned so a future
    // refactor cannot quietly move it under the `if (authContext)`.
    const wakeAgent = await freshWake()

    const res = await wakeAgent(TARGET, {} as never)

    expect(res.status).toBe(403)
    expect(res.error).toMatch(/no MANAGER exists/i)
  })

  it('POSITIVE CONTROL — the same team agent IS wakeable once a MANAGER exists', async () => {
    spies.getManagerId.mockReturnValue('agent-mgr')
    const wakeAgent = await freshWake()

    const res = await wakeAgent(TARGET, { authContext: USER_CTX } as never)

    expect(res.status).toBe(404)
  })

  it('POSITIVE CONTROL — the gate is TEAM-scoped, not a blanket manager-less freeze', async () => {
    // With no MANAGER but the target on no team, the wake proceeds. Drop the
    // `isAgentInAnyTeam` half and this flips to 403 — every solo agent on a manager-less
    // host would become unwakeable, which is a different (and much larger) rule.
    spies.isAgentInAnyTeam.mockReturnValue(false)
    const wakeAgent = await freshWake()

    const res = await wakeAgent(TARGET, { authContext: USER_CTX } as never)

    expect(res.status).toBe(404)
  })
})

describe('0-IMPACT containment holds', () => {
  it('the state dir the service resolves is the sandboxed one', async () => {
    const { getStateDir } = await import('@/lib/ecosystem-constants')
    expect(getStateDir()).toBe(FAKE_STATE)
    expect(FAKE_STATE.startsWith('/private/') || FAKE_STATE.startsWith('/tmp') || FAKE_STATE.startsWith('/var')).toBe(true)
  })
})
