/**
 * `PUT /api/teams/[id]` must DELEGATE to the hardened Next.js route — TRDD-DYIGNVTI.
 *
 * WHY THIS FILE EXISTS. `TRDD-8Q5EVGV1` made the headless credential gate SEMANTIC
 * (`c909aa3f`), and that cost exactly one piece of real coverage. The old guard lived in
 * `headless-router-auth-mirror.test.ts` and worked by sending a FORGED token at a MALFORMED
 * id: the delegated Next route runs `isValidUuid` BEFORE auth, so it answered 400, while the
 * pre-fix direct-`updateTeamById()` handler authenticated FIRST and answered 401. The
 * 400-vs-401 difference WAS the whole signal. The semantic gate now rejects a forged token
 * before either path runs, so both answer 401 and the discrimination is gone. The security
 * property is strictly stronger; the ARCHITECTURE guard is what died.
 *
 * ⚠ THE EHT CARD'S OWN PREFERRED FIX WAS REFUTED BEFORE IT WAS BUILT, and this is why the
 * file does not implement it. TRDD-DYIGNVTI proposed: mock auth to SUCCEED, then "assert the
 * malformed id still yields 400 from the delegated Next handler". Measured — that does not
 * discriminate: `services/teams-service.ts:558` opens `updateTeamById` with its OWN
 * `if (!isValidUuid(id)) return { error: 'Invalid team ID', status: 400 }`, added "for
 * consistency with getTeamById (CC-008)". So BOTH the delegated path and a direct call answer
 * 400 on a malformed id, and a test asserting 400 passes under the very neuter it exists to
 * catch. Building the recommended fix would have rebuilt the vacuity the card was written to
 * remove. The discriminator below is the zod `.strict()` schema instead, which only the Next
 * route has.
 *
 * TWO GUARDS, FAILING IN DIFFERENT DIRECTIONS (the card asked for this pairing):
 *   1. STATIC — the handler body SAYS `delegateNextRoute` and does not say `updateTeamById(`.
 *      Cannot be defeated by any gate change, because it reads source text. Proves the handler
 *      ASKS; never that it OBEYS. Same vehicle as `headless-handler-auth-ledger.test.ts`,
 *      which survived `c909aa3f` untouched.
 *   2. BEHAVIOURAL — with a VALID credential, an unknown body key is rejected by the Next
 *      route's `UpdateTeamSchema.strict()` (`app/api/teams/[id]/route.ts:41`). The direct path
 *      had a raw rest-spread and NO strict schema, which is the documented injection the
 *      handler's own security comment names (`{"blocked":false}` clears the manager-gated
 *      freeze). Observes the real path. Order verified: zod `safeParse` runs at PUT-relative
 *      line 21, `requireSudoToken` at 74 — so the strict rejection is reachable with auth
 *      mocked and nothing else.
 *
 * NEUTER RUN (2026-08-23 — OBSERVED via scripts/dev/neuter, restore verified by blob hash):
 *   $_ = ($. == 3102 ? q{    const svc = await import("@/services/teams-service"); sendServiceResult(res, await svc.updateTeamById(params.id, await readJsonBody(req)))} . "\n" : q{}) if $. >= 3102 && $. <= 3104;
 *   → 2 red / 1 green:
 *       BEHAVIOURAL: an unknown body key is rejected by the delegated route zod .strict()
 *       STATIC: the handler delegates and does not call updateTeamById directly
 *   The 1 green is the CONTROL, and it is green BY DESIGN: it asserts the response is NOT
 *   'Validation failed', which a direct path also satisfies. A control that reddened under
 *   this mutation would be discriminating nothing.
 *   Aimed by LINE NUMBER, not code shape: `delegateNextRoute(` appears at ~20 sites in this
 *   router, so a shape-matched expression would have rewritten every one of them and produced
 *   a plausible red set belonging to other pipelines.
 */
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'
import { Readable } from 'stream'
import { readFileSync } from 'fs'
import path from 'path'

const TEST_AGENT_ID = '33333333-3333-4333-8333-333333333333'

// A structurally-valid bearer so the STRUCTURAL gate lets the request through to the
// semantic one, which the mock below then accepts. Same shape as the mirror suite's.
const SHAPED_BEARER = 'Bearer aim_tk_AAAAAAAAAAAAAAAAAAAAAAAA'

/**
 * Auth succeeds, for BOTH the semantic gate (`authenticateFromRequestAsync`) and the delegated
 * Next route (`authenticateFromRequest`) — the same module backs both, so one mock covers the
 * whole path. Spread-the-original is used deliberately: the router also imports
 * `authenticateAgent` and `buildAuthContext` from here and they must stay real. That shape
 * goes silently inert if the code under test switches to a THIRD verb — acceptable only
 * because it fails LOUDLY here: an unmocked gate answers 401 and the 400 assertion reds.
 */
const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn(() => ({ agentId: TEST_AGENT_ID })) }))
vi.mock('@/lib/agent-auth', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/agent-auth')>()
  return {
    ...actual,
    authenticateFromRequest: (...a: unknown[]) => mockAuth(...(a as [])),
    authenticateFromRequestAsync: async (...a: unknown[]) => mockAuth(...(a as [])),
  }
})

import { createHeadlessRouter } from '@/services/headless-router'

const ROUTER_SRC = path.resolve(__dirname, '..', '..', 'services', 'headless-router.ts')
const TEAMS_PUT_KEY = "PUT /^\\/api\\/teams\\/([^/]+)$/"

/**
 * The `PUT /api/teams/:id` handler body, comments stripped. Stripping is LOAD-BEARING, not
 * tidiness: this handler carries a 25-line security comment that says `updateTeamById()` five
 * times explaining why it must NOT be called. An unstripped body matches the forbidden needle
 * on prose alone, so the guard would red against correct code. The `strippedBody` /
 * `rawBody` split below turns that hazard into this file's own positive control.
 */
function teamsPutHandler(): { strippedBody: string; rawBody: string } {
  const src = readFileSync(ROUTER_SRC, 'utf8').split('\n')
  const start = src.findIndex(l => l.startsWith('const routes: Route[] = [')) + 1
  const end = src.findIndex((l, i) => i > start && l.startsWith(']'))
  if (start === 0 || end < 0) {
    throw new Error('headless-router route table not found — this enumerator is broken, not the router')
  }

  const entries: Array<{ key: string; at: number }> = []
  for (let i = start; i < end; i++) {
    const m = src[i].match(/^ {2}\{ method: '([A-Z]+)', pattern: (\/.*?\/),/)
    if (m) entries.push({ key: `${m[1]} ${m[2]}`, at: i })
  }

  const k = entries.findIndex(e => e.key === TEAMS_PUT_KEY)
  if (k < 0) {
    throw new Error(
      `handler ${TEAMS_PUT_KEY} not found in the route table — if the route was renamed, ` +
      'retarget this guard rather than deleting it',
    )
  }
  const stop = k + 1 < entries.length ? entries[k + 1].at : end
  const lines = src.slice(entries[k].at, stop)
  const isComment = (l: string) => /^\s*(\/\/|\*|\/\*)/.test(l)
  return { strippedBody: lines.filter(l => !isComment(l)).join('\n'), rawBody: lines.join('\n') }
}

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
  const res: any = new EventEmitter()
  res.headersSent = false
  res.statusCode = 0
  res._chunks = []
  res.setHeader = () => {}
  res.writeHead = (status: number) => { res.statusCode = status; res.headersSent = true; return res }
  res.write = (c: any) => { res._chunks.push(Buffer.from(c)); return true }
  res.end = (c?: any) => { if (c) res._chunks.push(Buffer.from(c)); res.finished = true }
  res.bodyText = () => Buffer.concat(res._chunks).toString('utf-8')
  res.bodyJson = () => { try { return JSON.parse(res.bodyText()) } catch { return null } }
  return res
}

const router = createHeadlessRouter()

async function call(method: string, url: string, headers: Record<string, string>, body: string) {
  const res = makeRes()
  await router.handle(makeReq(method, url, headers, body), res)
  return res
}

const VALID_UUID = '22222222-2222-4222-8222-222222222222'

describe('PUT /api/teams/[id] delegation guard (TRDD-DYIGNVTI)', () => {
  it('STATIC: the handler delegates and does not call updateTeamById directly', () => {
    const { strippedBody, rawBody } = teamsPutHandler()

    // Positive control, and the reason the stripper exists: the needle IS present in the
    // handler's prose. If this ever fails, the security comment was rewritten and the
    // assertion below stopped being a discrimination — it would pass on any handler.
    expect(rawBody).toContain('updateTeamById(')

    expect(strippedBody).toContain('delegateNextRoute')
    expect(strippedBody).not.toContain('updateTeamById(')
  })

  it('BEHAVIOURAL: an unknown body key is rejected by the delegated route zod .strict()', async () => {
    // `blocked` is the exact injection the handler's security comment names: on the pre-fix
    // direct path the raw rest-spread accepted it, clearing the manager-gated team freeze.
    const res = await call(
      'PUT', `/api/teams/${VALID_UUID}`,
      { Authorization: SHAPED_BEARER, 'Content-Type': 'application/json' },
      JSON.stringify({ blocked: false }),
    )

    expect(res.statusCode).toBe(400)
    expect(res.bodyJson()?.error).toBe('Validation failed')
    // The issues array is the zod signature specifically — a 400 alone is NOT a
    // discriminator here, since updateTeamById answers 400 on its own for other reasons.
    expect(Array.isArray(res.bodyJson()?.issues)).toBe(true)
  })

  it('control: a well-formed body does NOT hit the schema rejection', async () => {
    // Proves the 400 above is caused by the UNKNOWN KEY and not by everything failing
    // validation (which would make the assertion pass for the wrong reason). This request
    // proceeds past zod into requireSudoToken/authorize, so it lands on some other refusal —
    // the only thing asserted is that it is not the strict-schema one.
    const res = await call(
      'PUT', `/api/teams/${VALID_UUID}`,
      { Authorization: SHAPED_BEARER, 'Content-Type': 'application/json' },
      JSON.stringify({ name: 'a-legal-rename' }),
    )

    expect(res.bodyJson()?.error).not.toBe('Validation failed')
  })
})
