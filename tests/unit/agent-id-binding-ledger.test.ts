/**
 * TRDD-91TLL7DW — a handler that takes an AGENT from the request must BIND the caller to it.
 *
 * THE CLASS. `lib/agent-auth.ts` derives the caller's identity from the verified credential and
 * `X-Agent-Id` is only ever a cross-check against it. That foundation is right and is pinned
 * elsewhere. It is void on any handler that then takes the agent to ACT ON from a path segment,
 * query parameter or body field and never ties it to the authenticated caller: no forgery is
 * needed, the caller just names someone else. Authentication alone is not a binding — it proves
 * who is calling and nothing about whether they may touch THAT agent. The 2026-10 audit found
 * three such handlers, all fixed here:
 *   - POST/DELETE /api/agents/:id/repos (headless-only) rewrote any agent's repo list,
 *   - GET /api/agents/[id]/chat returned any agent's whole conversation transcript,
 *   - GET /api/agents/[id]/panel/feedback DRAINED (deleted) any agent's panel-feedback queue.
 *
 * WHAT THIS PINS. Every handler — per HTTP METHOD, not per file, because the holes were GETs next
 * to bound POSTs — whose route is addressed by an agent id (`agents/[id]/…`, `sessions/[id]/…`)
 * or that reads `agentId` / `agent` from the request must contain a BINDING: an `authorize(…)`,
 * a team ACL, an owner-only gate, a self-id comparison, a `denyForeign*` helper, or a hand-off of
 * the VERIFIED caller context into a service/pipeline that decides. A handler with only
 * `authenticateFromRequest` / `requireAuth` / `enforceAuth` is NOT bound. Such a handler must be
 * named in REVIEWED_UNBOUND below, with its verdict and reason. Add a line only by deliberate,
 * reviewed edit; delete it when the handler is bound.
 *
 * WHAT THIS DOES NOT PROVE, stated rather than hidden. It is a source-text check: it sees that a
 * binding token is present in the handler, not that it names the right target or that its result
 * is obeyed. Forwarding `auth.context` / `buildAuthContext(…)` counts as a binding only because
 * the callee (a Change* pipeline's gate 0, or a service) decides — those callees have their own
 * behavioural tests. The per-fix behavioural tests are in the files named at each entry's fix.
 * It also cannot tell a destructive GET from a read, which is why a reviewer must read any NEW
 * ledger entry (panel/feedback was a GET that deleted).
 *
 * LEDGER RULES enforced below: only GET may be ledgered (a mutating handler must bind), and no
 * stale entries (binding a handler obliges deleting its line).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'
import { stripComments } from '../helpers/strip-comments'

const repoRoot = path.resolve(__dirname, '..', '..')
const apiRoot = path.join(repoRoot, 'app', 'api')
const ROUTER = path.join(repoRoot, 'services', 'headless-router.ts')

/**
 * Evidence that the caller is tied to the target. Deliberately EXCLUDES the pure authentication
 * helpers (authenticateFromRequest / requireAuth / enforceAuth): those are the gap this file exists for.
 */
const BINDING =
  /\bauthorize\(|\bcheckTeamAccess\(|\benforceSystemOwner\(|\benforceMaestro\(|\brequireSudoToken\(|\bwithAuthorizedTrdd\(|\bresolveDesignDir\(|\bcanIssue\(|\bgate0Auth\(|\bdenyForeign\w*\(|\bresolveAuthorizedAgentParam\(|\.agentId\s*!==?\s*\w|\w\s*!==?\s*\w+\.agentId|\bauth\.context\b|\bauthContext\b|\bbuildAuthContext\(|\brequestingAgentId\b|\bisSystemOwner\b/

/** A request-sourced agent id that is NOT carried in the path. */
const READS_AGENT_PARAM =
  /searchParams\.get\(\s*['"](agentId|agent)['"]\s*\)|\bparams\.agentId\b|\bbody\.agentId\b|\bagentIdQuery\b|\bparsed\.data\.agentId\b/

function findRouteFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...findRouteFiles(full))
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

interface Handler { key: string; method: string; bound: boolean }

/** Every Next handler addressed by an agent id or reading an agent param, with whether it binds. */
function nextHandlers(): Handler[] {
  const out: Handler[] = []
  for (const f of findRouteFiles(apiRoot).sort()) {
    const rel = path.relative(apiRoot, f).replace(/\/route\.ts$/, '')
    const src = stripComments(readFileSync(f, 'utf8'))
    const decls = [...src.matchAll(/^export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/gm)]
    const pathAddressed = /^(agents|sessions)\/\[id\]/.test(rel)
    decls.forEach((m, i) => {
      const body = src.slice(m.index, i + 1 < decls.length ? decls[i + 1].index : src.length)
      if (!pathAddressed && !READS_AGENT_PARAM.test(body)) return
      out.push({ key: `${m[1]} /api/${rel}`, method: m[1], bound: BINDING.test(body) })
    })
  }
  return out
}

/**
 * Headless handlers addressed by an agent/session id. `forwardAuthHeaders(` counts: the handler
 * forwards the caller's real credentials to the Next handler it imports, which binds.
 */
const HEADLESS_BINDING = new RegExp(BINDING.source + '|\\bdelegateNextRoute\\(|\\bforwardAuthHeaders\\(')

function headlessHandlers(): Handler[] {
  const lines = readFileSync(ROUTER, 'utf8').split('\n')
  const start = lines.findIndex(l => l.startsWith('const routes: Route[] = [')) + 1
  const end = lines.findIndex((l, i) => i > start && l.startsWith(']'))
  if (start === 0 || end < 0) throw new Error('headless-router route table not found — enumerator is broken, not the router')
  const entries: Array<{ method: string; pattern: string; at: number }> = []
  for (let i = start; i < end; i++) {
    const m = lines[i].match(/^ {2}\{ method: '([A-Z]+)', pattern: (\/.*?\/),/)
    if (m) entries.push({ method: m[1], pattern: m[2], at: i })
  }
  // Strip over the WHOLE table once so a /* inside a // comment cannot swallow live code.
  const table = stripComments(lines.slice(start, end).join('\n')).split('\n')
  const out: Handler[] = []
  entries.forEach((e, k) => {
    if (!/api\\\/(agents|sessions)\\\/\(\[\^\/\]\+\)/.test(e.pattern)) return
    const from = e.at - start
    const to = k + 1 < entries.length ? entries[k + 1].at - start : table.length
    out.push({
      key: `${e.method} ${e.pattern}`,
      method: e.method,
      bound: HEADLESS_BINDING.test(table.slice(from, to).join('\n')),
    })
  })
  return out
}

/**
 * Handlers that authenticate (or not) but do not bind the caller to the addressed agent.
 * AUTH-READ-OPEN  = the route's own documentation, or the sibling `GET /api/agents/[id]`, makes any
 *                   authenticated caller entitled to read this; nothing mutates.
 * NEEDS-OWNER     = no authentication at all in full mode (middleware.ts checks only the credential
 *                   SHAPE, so a forged `Bearer aim_tk_…` reaches it), or a policy nobody has decided.
 */
const REVIEWED_UNBOUND: Readonly<Record<string, string>> = {
  'GET /api/agents/[id]': 'AUTH-READ-OPEN: CC-GOV-008 — authenticated read of the agent record',
  'GET /api/agents/[id]/full': 'AUTH-READ-OPEN: documented fleet-monitor surface, public key only (route comment)',
  'GET /api/agents/[id]/prompt': 'AUTH-READ-OPEN: documented fleet-monitor surface (route comment); R42.8 gates ANSWERING, not reading',
  'GET /api/agents/[id]/queue': 'AUTH-READ-OPEN: documented fleet-monitor surface (route comment)',
  'GET /api/agents/[id]/metrics': 'AUTH-READ-OPEN: route comment — GET /api/agents/[id] already returns the same metrics',
  'GET /api/agents/[id]/panel': 'AUTH-READ-OPEN: connected-client and pending-event COUNTS only',
  'GET /api/agents/[id]/ensure-core': 'AUTH-READ-OPEN: one boolean, is the core plugin present',
  'GET /api/agents/[id]/portfolio/verify': 'AUTH-READ-OPEN: route comment — verification grants nothing, deliberately wider than the portfolio GET',
  'GET /api/sessions/[id]/activity-signals': 'AUTH-READ-OPEN: route comment — no-content derived signals',
  'GET /api/sessions/[id]/pane-status': 'AUTH-READ-OPEN: route comment — current pane command only',
  'GET /api/sessions/[id]/command': 'AUTH-READ-OPEN: CC-GOV-012 — idle/ready flag only',
  'GET /api/agents/email-index': 'AUTH-READ-OPEN: address-book lookup; ?agentId= is a filter, not an actor',
  'GET /api/agents/role-plugins/status': 'AUTH-READ-OPEN: role-plugin install status; ?agentId= is a filter',
  'GET /api/governance/reachable': 'AUTH-READ-OPEN: comm-graph reachability query; ?agentId= is the subject asked about',
  'GET /api/governance/transfers': 'AUTH-READ-OPEN: CC-GOV-009 — authenticated list; ?agentId= is a filter',
  'GET /api/agents/[id]/amp/addresses': 'NEEDS-OWNER: no authentication at all — are agent address lists public?',
  'GET /api/agents/[id]/amp/addresses/[address]': 'NEEDS-OWNER: no authentication at all — same question as the list',
  'GET /api/agents/[id]/email/addresses': 'NEEDS-OWNER: no authentication at all — same question',
  'GET /api/agents/[id]/email/addresses/[address]': 'NEEDS-OWNER: no authentication at all — same question',
  'GET /api/agents/[id]/metadata': 'NEEDS-OWNER: no authentication at all, yet GET /api/agents/[id] returns this metadata only to an authenticated caller',
  'GET /api/agents/[id]/session': 'NEEDS-OWNER: no authentication at all — session status of any agent',
  'GET /api/agents/[id]/skills/settings': 'NEEDS-OWNER: no authentication at all — skill settings of any agent',
  'GET /api/v1/governance/requests': 'NEEDS-OWNER: no authentication in the GET — lists cross-host governance requests, ?agentId= filter',
}

/** Headless twins of the entries above: the same reads, authenticated by the router-wide credential gate. */
const REVIEWED_UNBOUND_HEADLESS: Readonly<Record<string, string>> = {
  'GET /^\\/api\\/agents\\/([^/]+)$/': 'twin of GET /api/agents/[id]',
  'GET /^\\/api\\/agents\\/([^/]+)\\/metrics$/': 'twin of GET /api/agents/[id]/metrics',
  'GET /^\\/api\\/agents\\/([^/]+)\\/metadata$/': 'twin of GET /api/agents/[id]/metadata (NEEDS-OWNER)',
  'GET /^\\/api\\/agents\\/([^/]+)\\/session$/': 'twin of GET /api/agents/[id]/session (NEEDS-OWNER)',
  'GET /^\\/api\\/agents\\/([^/]+)\\/skills\\/settings$/': 'twin of GET /api/agents/[id]/skills/settings (NEEDS-OWNER)',
  'GET /^\\/api\\/agents\\/([^/]+)\\/amp\\/addresses$/': 'twin of the Next address GET (NEEDS-OWNER)',
  'GET /^\\/api\\/agents\\/([^/]+)\\/amp\\/addresses\\/([^/]+)$/': 'twin of the Next address GET (NEEDS-OWNER)',
  'GET /^\\/api\\/agents\\/([^/]+)\\/email\\/addresses$/': 'twin of the Next address GET (NEEDS-OWNER)',
  'GET /^\\/api\\/agents\\/([^/]+)\\/email\\/addresses\\/([^/]+)$/': 'twin of the Next address GET (NEEDS-OWNER)',
  'GET /^\\/api\\/sessions\\/([^/]+)\\/command$/': 'twin of GET /api/sessions/[id]/command',
}

describe('TRDD-91TLL7DW — Next routes: a handler addressed by an agent binds the caller to it', () => {
  const handlers = nextHandlers()
  const unbound = handlers.filter(h => !h.bound).map(h => h.key).sort()

  it('the scan sees both outcomes — a green run is not an empty run', () => {
    /** Positive controls: a handler known to bind AND one known not to, plus a real population size */
    const byKey = new Map(handlers.map(h => [h.key, h.bound]))
    expect(handlers.length).toBeGreaterThan(80)
    expect(byKey.get('POST /api/agents/[id]/chat')).toBe(true) // authorize('send-command')
    expect(byKey.get('GET /api/agents/[id]/chat')).toBe(true) // fixed here: auth.context → service
    expect(byKey.get('GET /api/agents/[id]/panel/feedback')).toBe(true) // fixed here: authorize
    expect(byKey.get('GET /api/agents/[id]/full')).toBe(false) // authenticated-only by design
  })

  it('no handler addressed by an agent is unbound unless it is in the reviewed ledger', () => {
    /** The class gate: a new route that authenticates but never binds fails here, naming the handler */
    expect(
      unbound,
      'A handler addressed by an agent id (or reading ?agentId=/?agent=) has no binding between the ' +
        'authenticated caller and that agent. Bind it (authorize / self-id check / forward the verified ' +
        'context to a service that decides) or add it to REVIEWED_UNBOUND with a verdict and reason.',
    ).toEqual(Object.keys(REVIEWED_UNBOUND).sort())
  })

  it('only GET handlers are ledgered — a mutating handler must bind', () => {
    /** A ledgered POST/PUT/PATCH/DELETE would be an open door with a reason attached */
    expect(Object.keys(REVIEWED_UNBOUND).filter(k => !k.startsWith('GET '))).toEqual([])
  })
})

describe('TRDD-91TLL7DW — headless router: a handler addressed by an agent binds the caller to it', () => {
  const handlers = headlessHandlers()
  const unbound = handlers.filter(h => !h.bound).map(h => h.key).sort()

  it('the scan sees both outcomes — a green run is not an empty run', () => {
    /** Positive controls: handlers fixed here and one authenticated-only read, plus a real population size */
    const byKey = new Map(handlers.map(h => [h.key, h.bound]))
    expect(handlers.length).toBeGreaterThan(40)
    expect(byKey.get('POST /^\\/api\\/agents\\/([^/]+)\\/repos$/')).toBe(true)
    expect(byKey.get('DELETE /^\\/api\\/agents\\/([^/]+)\\/repos$/')).toBe(true)
    expect(byKey.get('GET /^\\/api\\/agents\\/([^/]+)\\/chat$/')).toBe(true)
    expect(byKey.get('GET /^\\/api\\/agents\\/([^/]+)\\/metrics$/')).toBe(false)
  })

  it('no headless handler addressed by an agent is unbound unless it is in the reviewed ledger', () => {
    /** The class gate for the second server mode, which reimplements the surface by hand */
    expect(unbound, 'A headless handler addressed by an agent id binds nothing — see the header.').toEqual(
      Object.keys(REVIEWED_UNBOUND_HEADLESS).sort(),
    )
  })

  it('only GET handlers are ledgered — a mutating handler must bind', () => {
    /** Same rule as full mode */
    expect(Object.keys(REVIEWED_UNBOUND_HEADLESS).filter(k => !k.startsWith('GET '))).toEqual([])
  })
})
