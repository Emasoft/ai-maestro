/**
 * R10.6 — "the restart endpoint follows the same governance rules as the wake
 * endpoint."
 *
 * The rule R10 builds on: when no MANAGER exists on the host, every team agent
 * is hibernated until one is assigned. Reviving a team agent by RESTARTING it
 * would walk straight through that freeze, so restart carries the same gate
 * wake does — and R10.6 is the claim that it carries it EVERYWHERE.
 *
 * THIS IS A PARITY CLAIM ACROSS THREE SITES, which is why one drive proves
 * nothing. `wakeAgent` is a single SERVICE function; restart has no such twin —
 * its gate is duplicated into a Next route handler and TWO headless handlers:
 *
 *   1. app/api/sessions/[id]/restart/route.ts   — authorize() then the gate
 *   2. headless POST /api/sessions/[id]/restart — the mirrored gate
 *   3. headless POST /api/sessions/me/restart   — self-restart, same gate
 *
 * That asymmetry IS the rule, and duplication is exactly the shape that drifts:
 * headless site 2 was authenticate-only until the 2026-07-14 governance audit,
 * so full mode 403'd a restart headless allowed. All three are driven here with
 * ONE fixture (a team agent, no MANAGER) and must answer with the SAME status
 * and the SAME message — agreement is the assertion, not merely refusal.
 *
 * THE WAKE HALF IS ALREADY PINNED, and deliberately not re-driven here:
 * `tests/governance/r3-r9-team-governance.test.ts` ("R9.5 — the MANAGER
 * wake-gate binds TEAM agents only") calls the real `wakeAgent` under its own
 * seeded-registry containment and asserts `/Cannot wake team agent: no MANAGER
 * exists/i`. This file is the restart half; together they are R10.6.
 *
 * WHY IT WAS UNPINNED UNTIL NOW. The headless parity file's own header used to
 * claim this gate "is covered there by the governance suite" — measured false on
 * 2026-07-30: `grep -rln "Cannot restart team agent" tests/` returned NOTHING.
 * Its two restart tests are honest about their reach (both stop at the AUTH
 * layer, and say so), and the forged-credential harness they use structurally
 * CANNOT reach a gate that runs after `authorize()`. Hence the authorized-caller
 * harness below.
 *
 * WHAT IS MOCKED, AND WHY IT IS NOT THE GUARD. Everything stubbed is a layer in
 * FRONT of the gate (auth, authorization, sudo) or a DATA SOURCE the gate reads
 * (`getManagerId`, `isAgentInAnyTeam`, the registry, `sessionExistsSync`). The
 * gate expression itself runs for real in all three handlers. `runRestartSequence`
 * is stubbed so nothing touches the developer's tmux — and doubles as the
 * post-condition: a refusal that still restarted the agent is not a refusal.
 *
 * Neuter record (2026-07-30) — three, one per site, because a parity claim whose
 * sites are not independently pinned is exactly the drift it exists to prevent:
 *   A. delete the gate in app/api/sessions/[id]/restart/route.ts
 *      → ONLY the app-route test fails.
 *   B. delete the gate in headless [id]/restart
 *      → ONLY the headless [id] test fails.
 *   C. delete the gate in headless me/restart
 *      → ONLY the headless me test fails.
 * Any single neuter reddening more than one site would mean the sites share an
 * implementation — which would make R10.6 unnecessary, and is not the case.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EventEmitter } from 'events'
import { Readable } from 'stream'

// MEASURED flake, not a guess (the teams-stats-verb precedent, 71104775): under full-suite load
// this import-heavy route file blows vitest's 5s default — captured 2026-08-06 (full-suite round
// 2, 106 `Test timed out in 5000ms` across spawn/import-heavy suites; this file 6/6 red with
// exactly that signature at r10-restart-manager-gate-parity.test.ts:191). 30s changes nothing
// when green and absorbs scheduler starvation when loaded.
vi.setConfig({ testTimeout: 30_000 })

const FIXTURE = vi.hoisted(() => ({
  managerId: null as string | null,
  inTeam: true,
  restartCalls: [] as string[],
}))

const TEAM_AGENT = {
  id: 'agent-in-a-team',
  name: 'teamling',
  workingDirectory: '/tmp/teamling',
  sessions: [{ index: 0, status: 'online', workingDirectory: '/tmp/teamling' }],
}

// ── layers IN FRONT of the gate: auth, authorization, sudo ───────────────────
// The gate runs after all of them, so the forged-credential harness the existing
// headless parity file uses cannot reach it. These let an authorized caller in.
vi.mock('@/lib/agent-auth', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/agent-auth')>()
  return {
    ...actual,
    // BOTH are SYNCHRONOUS in the real modules, and the route uses them without
    // `await`. An `async` stub returns a truthy Promise, which `if (sudoErr)`
    // and `if (auth.error)` read as "here is your error response" — the route
    // then returns a Promise and the test sees `null`. Match the real shape.
    authenticateAgent: () => ({ agentId: TEAM_AGENT.id, isSystemOwner: false }),
    authenticateFromRequest: () => ({ agentId: TEAM_AGENT.id, isSystemOwner: false }),
    buildAuthContext: (a: unknown) => a,
  }
})
vi.mock('@/lib/authorization', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/authorization')>()
  return { ...actual, authorize: () => ({ allowed: true }) }
})
vi.mock('@/lib/sudo-guard', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/sudo-guard')>()
  return { ...actual, requireSudoToken: () => null }
})

// ── DATA SOURCES the gate reads ──────────────────────────────────────────────
vi.mock('@/lib/governance', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/governance')>()
  return { ...actual, getManagerId: () => FIXTURE.managerId }
})
vi.mock('@/lib/team-registry', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/team-registry')>()
  return { ...actual, isAgentInAnyTeam: () => FIXTURE.inTeam }
})
vi.mock('@/lib/agent-registry', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/agent-registry')>()
  return { ...actual, getAgent: () => TEAM_AGENT, getAgentBySession: () => TEAM_AGENT }
})
vi.mock('@/lib/agent-runtime', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/agent-runtime')>()
  return { ...actual, sessionExistsSync: () => true }
})

// ── the ACT the gate is supposed to prevent ──────────────────────────────────
// Stubbed so nothing reaches the developer's tmux, and recorded so "it refused"
// can be distinguished from "it refused and restarted anyway".
vi.mock('@/lib/session-restart', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/session-restart')>()
  return {
    ...actual,
    runRestartSequence: async (name: string) => {
      FIXTURE.restartCalls.push(name)
      return { ok: true }
    },
  }
})
vi.mock('@/lib/session-relaunch', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/session-relaunch')>()
  return { ...actual, prepareRelaunchCommand: async () => ({ command: 'true', program: 'claude' }) }
})

const GATE_MESSAGE = /Cannot restart team agent: no MANAGER exists on this host/

// ── headless harness (same shape as tests/unit/headless-router-auth-mirror) ──
function makeReq(method: string, url: string, headers: Record<string, string> = {}, body = '') {
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v
  const req = Readable.from(body ? [Buffer.from(body)] : []) as never as {
    method: string; url: string; headers: Record<string, string>
  }
  req.method = method
  req.url = url
  req.headers = lower
  return req as never
}

function makeRes() {
  const res: Record<string, unknown> & { _chunks: Buffer[] } = Object.assign(new EventEmitter(), {
    headersSent: false, statusCode: 0, _chunks: [] as Buffer[],
  }) as never
  res.setHeader = () => {}
  res.writeHead = (status: number) => { res.statusCode = status; res.headersSent = true; return res }
  res.write = (c: string | Buffer) => { res._chunks.push(Buffer.from(c)); return true }
  res.end = (c?: string | Buffer) => { if (c) res._chunks.push(Buffer.from(c)) }
  return res as never as {
    statusCode: number
    _chunks: Buffer[]
  }
}

function bodyOf(res: { _chunks: Buffer[] }): string {
  return Buffer.concat(res._chunks).toString('utf-8')
}

/** An authorized caller — the credential is irrelevant, auth is stubbed to allow. */
const AUTH_HEADERS = { Authorization: 'Bearer aim_tk_AAAAAAAAAAAAAAAAAAAAAAAA', 'X-Agent-Id': TEAM_AGENT.id }

async function callHeadless(url: string) {
  const { createHeadlessRouter } = await import('@/services/headless-router')
  const res = makeRes()
  await createHeadlessRouter().handle(makeReq('POST', url, AUTH_HEADERS), res as never)
  return res
}

async function callAppRoute() {
  const mod = await import('@/app/api/sessions/[id]/restart/route')
  const request = { json: async () => ({}), headers: new Headers(AUTH_HEADERS), url: 'http://localhost/x' }
  return mod.POST(request as never, { params: Promise.resolve({ id: 'teamling' }) })
}

beforeEach(() => {
  vi.resetModules()
  FIXTURE.managerId = null
  FIXTURE.inTeam = true
  FIXTURE.restartCalls = []
})

describe('R10.6 — the MANAGER gate is on EVERY restart surface, not just one', () => {
  it('app route: refuses 403 and does not restart', async () => {
    const res = await callAppRoute()
    expect(res.status).toBe(403)
    expect(JSON.stringify(await res.json())).toMatch(GATE_MESSAGE)
    // A refusal that restarted the agent anyway is not a refusal.
    expect(FIXTURE.restartCalls).toEqual([])
  })

  it('headless [id]/restart: refuses 403 and does not restart', async () => {
    const res = await callHeadless('/api/sessions/teamling/restart')
    expect(res.statusCode).toBe(403)
    expect(bodyOf(res)).toMatch(GATE_MESSAGE)
    expect(FIXTURE.restartCalls).toEqual([])
  })

  it('headless me/restart: refuses 403 and does not restart', async () => {
    const res = await callHeadless('/api/sessions/me/restart')
    expect(res.statusCode).toBe(403)
    expect(bodyOf(res)).toMatch(GATE_MESSAGE)
    expect(FIXTURE.restartCalls).toEqual([])
  })

  it('all three surfaces answer with the SAME message — agreement IS the rule', async () => {
    const appBody = JSON.stringify(await (await callAppRoute()).json())
    const headlessId = bodyOf(await callHeadless('/api/sessions/teamling/restart'))
    const headlessMe = bodyOf(await callHeadless('/api/sessions/me/restart'))

    const extract = (s: string) => JSON.parse(s).error as string
    expect(extract(headlessId)).toBe(extract(appBody))
    expect(extract(headlessMe)).toBe(extract(appBody))
  })

  it('with a MANAGER on the host the gate opens — it gates on the MANAGER, not on restarting', async () => {
    // Positive control. Without it every test above would pass against a
    // handler that refuses every restart unconditionally.
    //
    // HONEST LIMIT: this asserts the GATE OPENED, not that the restart then
    // succeeded. Past the gate the handler null-derefs on `.program` in this
    // fixture (visible as a `[Headless] Error handling POST …` line) because the
    // relaunch path needs more of the agent record than the gate does. So the
    // control proves "not refused BY THIS GATE" — which is what it is for — and
    // NOT "restart works". Do not strengthen it to `statusCode === 200` without
    // building the relaunch fixture; an error response is also "not 403", and a
    // control that cannot tell those apart would be the weaker claim, not the
    // stronger one.
    FIXTURE.managerId = 'the-manager'

    const res = await callHeadless('/api/sessions/teamling/restart')
    expect(res.statusCode).not.toBe(403)
    expect(bodyOf(res)).not.toMatch(GATE_MESSAGE)
  })

  it('a NON-team agent is never gated, even with no MANAGER (R9.5 parity)', async () => {
    // The wake twin binds TEAM agents only; restart must draw the same line or
    // the two endpoints do NOT follow the same governance rules.
    FIXTURE.inTeam = false

    const res = await callHeadless('/api/sessions/teamling/restart')
    expect(bodyOf(res)).not.toMatch(GATE_MESSAGE)
  })
})
