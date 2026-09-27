/**
 * GET /api/agents/role-plugins/status — the user-controlled `filter` (TRDD-GA53VW1Q).
 *
 * The route once compiled `new RegExp(filterParam, 'i')` from the query string
 * (ReDoS — a catastrophic-backtracking pattern hangs the event loop). Commit
 * 1b3fc7ee6 replaced it with a case-insensitive SUBSTRING match; this file pins
 * that fix at the route handler itself, under VALID auth (the headless-router
 * auth-mirror tests already pin the 401 path with a forged token, which never
 * reaches the filter code — see tests/unit/headless-router-auth-mirror.test.ts).
 *
 * Two claims:
 *  (a) a catastrophic-backtracking pattern like `(a+)+$` is INERT — compiled as
 *      a regex against a long non-matching subject it would run effectively
 *      forever; as a substring it is an ordinary includes() that simply matches
 *      nothing. Asserted on the RESULT (200 + empty match) and on wall-clock,
 *      never on a timeout.
 *  (b) a benign substring still filters, case-insensitively, over agent name
 *      and label.
 *
 * Auth and the registry are doubled; the route's own GET handler is the thing
 * under test. `os.homedir` is redirected so the USER-scope scan reads a
 * nonexistent fixture path instead of the developer's real settings.json.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockAuth, mockRegistry } = vi.hoisted(() => ({
  mockAuth: { authenticateFromRequest: vi.fn() },
  mockRegistry: { loadAgents: vi.fn() },
}))

vi.mock('@/lib/agent-auth', () => mockAuth)
vi.mock('@/lib/agent-registry', () => mockRegistry)
// Redirect HOME so the route's user-scope settings.json scan (and each agent's
// workdir scan) reads fixture paths that do not exist — readJsonSafe returns
// null, no role-plugin is ever found, and nothing on the real machine is read.
vi.mock('os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('os')>()),
  homedir: () => '/tmp/role-plugins-status-filter-fixture/no-home',
}))

import { GET } from '@/app/api/agents/role-plugins/status/route'
import { NextRequest } from 'next/server'

function req(query = ''): NextRequest {
  return new NextRequest(new URL(`http://localhost:23000/api/agents/role-plugins/status${query}`), {
    method: 'GET',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.authenticateFromRequest.mockReturnValue({
    agentId: 'caller-1',
    governanceTitle: 'manager',
  })
  mockRegistry.loadAgents.mockReturnValue([
    { id: 'a1', name: 'alpha-agent', label: 'Alpha Bot', governanceTitle: 'manager', workingDirectory: null },
    { id: 'a2', name: 'beta-agent', label: 'Beta Bot', governanceTitle: null, workingDirectory: null },
  ])
})

describe('GET /api/agents/role-plugins/status — filter is a substring match, not a RegExp (TRDD-GA53VW1Q)', () => {
  it('a catastrophic-backtracking pattern is inert: 200 with an empty match, fast', async () => {
    // `(a+)+$` — the canonical ReDoS pattern. As `new RegExp('(a+)+$', 'i')`
    // matched against a long non-matching string it runs effectively forever;
    // as a substring it can only ever match a literal "(a+)+$" in a name.
    const started = Date.now()
    const res = await GET(req(`?filter=${encodeURIComponent('(a+)+$')}`))
    const elapsedMs = Date.now() - started

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.agents).toEqual([])
    expect(body.summary.total).toBe(0)
    // Generous bound: guards the semantics (a hung regex would blow past it)
    // without making the test flaky on a slow CI runner.
    expect(elapsedMs).toBeLessThan(2000)
  })

  it('a benign substring still filters by agent name, case-insensitively', async () => {
    const res = await GET(req('?filter=alp'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.summary.total).toBe(1)
    expect(body.agents.map((a: { name: string }) => a.name)).toEqual(['alpha-agent'])
  })

  it('the filter also matches the agent label, case-insensitively', async () => {
    const res = await GET(req('?filter=BETA%20BOT'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.summary.total).toBe(1)
    expect(body.agents.map((a: { name: string }) => a.name)).toEqual(['beta-agent'])
  })
})
