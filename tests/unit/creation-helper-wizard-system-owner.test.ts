import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * TRDD-DQVPODKW — the six WIZARD-ONLY creation-helper routes are system-owner only.
 *
 * The Haephestos creation wizard is a human dashboard flow. These six routes shipped with
 * `enforceAuth` (or, for file-picker, a bare `authenticateFromRequest`), which proves the caller
 * is authenticated and nothing about whether it may do this. So any agent of any governance
 * title, on any team, could drive the owner's wizard: wipe its working directory (`cleanup`
 * deletes the whole `~/agents/haephestos/` tree), reset its banner, forge its heartbeat, respawn
 * its persona, browse the owner's filesystem through the picker, and read its uploads.
 *
 * WHY OWNER-ONLY, AND WHY THESE SIX AND NOT THE WHOLE SUBTREE. A per-route caller census
 * (2026-09-04) measured browser callers against persona callers for all thirteen routes.
 *
 * THE FIRST CENSUS WAS TOO NARROW TO CARRY THE RULING, and an adversarial review said so before
 * it was believed. It searched only `components/ hooks/ app/page.tsx` — excluding most of `app/`
 * — for a LITERAL route path, so it could not have seen a caller assembling the URL from a
 * variable, nor any `.mjs`/`scripts/` caller. Its `grep -c ... || echo 0` also emitted TWO lines
 * per row for eleven of thirteen routes (grep's own `0` plus the fallback's), i.e. the instrument
 * was malformed and read as data anyway. RE-RUN over all of `app/ components/ hooks/ lib/
 * scripts/ tests/` with `.mjs`/`.js` included and LINE CONTEXT instead of a count: every caller
 * is a literal `fetch('/api/agents/creation-helper/<name>', …)` in `components/` —
 * HaephestosEmbeddedView, AgentCreationHelper, TerminalView — plus tests and two scenario docs.
 * No `app/` caller, no dynamic construction, no `.mjs`, no script. The ruling holds; the first
 * evidence for it did not.
 *
 * These six are called from `components/` and NEVER by the persona, whose shipped instructions
 * (`agents/haephestos-creation-helper.md`) curl exactly two routes — `element-descriptions` and
 * `publish-plugin` — which are therefore deliberately EXCLUDED here and left agent-callable.
 * `clear-banner` has no caller at all outside the spec and the coverage ledger. The persona
 * mentions `cleanup` only in PROSE, describing what the wizard does to its directory; that is a
 * mention, not a call, and counting it would have wrongly excluded the most destructive route of
 * the six.
 *
 * THE CARD SAID TO DO THIS IN ONE CHANGE WITH "give Haephestos a credential", AND THAT COUPLING
 * IS VOID BY THE CARD'S OWN MEASUREMENT. Its stated reason was that tightening would break the
 * wizard — but the persona's curls carry NO auth header, `services/creation-helper-service.ts`
 * injects no credential into the session (0 hits for AID_AUTH|Bearer|Authorization|aim_tk,
 * re-measured first-hand), and `middleware.ts` refuses every credential-less `/api/*` request
 * before any handler. So that path is ALREADY broken, and tightening six routes the persona never
 * calls cannot break it further. The credential half is a live defect in its own right and is
 * carved out rather than used to hold this half hostage.
 *
 * SAFE FOR THE UI **UNDER THE DEFAULT**, and the qualifier is load-bearing. Read in
 * `lib/agent-auth.ts::buildAuthContext` rather than taken from a docstring:
 *
 *   - user-authority model OFF (the DEFAULT): `isSystemOwner = !agentId`, so ANY browser session
 *     is the system owner and all six wizard fetches pass. This is what ships.
 *   - model ON: `isSystemOwner` means the ACTIVE MAESTRO (`userTitle ∈ {maestro,
 *     maestro-delegate}`). A normal user has a session and `isSystemOwner === false`, so the
 *     wizard is refused for them.
 *
 * That second row is the INTENDED semantics of `enforceSystemOwner` — the same docstring says
 * the existing 24 such routes "correctly reject" a normal user — and creating agents is
 * plausibly a maestro capability. It is recorded here because it is a real consequence of this
 * change that the phrase "the UI is unaffected" would have hidden.
 *
 * ITS FAILURE MODE IS SILENT, WHICH IS THE PART THAT NEEDS FIXING ELSEWHERE.
 * `components/HaephestosEmbeddedView.tsx:129-140` polls `heartbeat` and, on a non-ok response,
 * throws into a `catch` that only schedules an exponential-backoff retry — it never surfaces the
 * status. So under model ON a normal user's Haephestos session is reaped by the watchdog with no
 * error shown: the wizard "mysteriously dies". A 2026-04-13 scenario report already flagged the
 * same swallow for a 503; this change gives it a second, deterministic trigger. Carded
 * separately — an auth decision must not be reverted to paper over a UI that hides its errors.
 *
 * ALSO CHANGED, AND NOT VISIBLE TO THESE TESTS: `file-picker` previously called
 * `authenticateFromRequest` directly and now goes through `enforceSystemOwner`, which begins with
 * `checkWriteBlock(request.method)`. So it gains a write-block check it did not have. The other
 * five already had it via `enforceAuth`. The mocks here cannot see this — `checkWriteBlock` runs
 * before the mocked call — so it is stated rather than tested.
 *
 * NEUTER RUN — see the recorded result at the bottom of this file.
 *
 * AMENDED (TRDD-1LFRP6GJ, 2026-09-05): the coupling this file describes above — that
 * `element-descriptions` and `publish-plugin` must stay agent-callable because the persona
 * curls them — is VOID. Measured first-hand (TRDD-1LFRP6GJ): the persona's curls carried no
 * credential and 401ed under `middleware.ts` before either route was ever reached, so they
 * were never actually reachable by the persona at all. RULED: move the lookups off the API
 * instead of minting a credential — `element-descriptions` is now a direct PSS binary
 * invocation in the persona's own instructions (agents/haephestos-creation-helper.md Step 3),
 * and `publish-plugin` is now reached via a file-based request/response poller
 * (`services/creation-helper-service.ts`'s `pollPublishRequest`, added alongside the existing
 * heartbeat watchdog) that calls the same `services/haephestos-publish-service.ts::
 * publishHaephestosPlugin` logic in-process. Both routes now carry `enforceSystemOwner` and
 * join the ROUTES array below — see the trailing "NOW carry the same owner gate" test, which
 * replaces the old "deliberately NOT owner-gated" one.
 */

const mockAuthenticate = vi.fn()

vi.mock('@/lib/agent-auth', async (orig) => {
  const actual = await orig<typeof import('@/lib/agent-auth')>()
  return { ...actual, authenticateFromRequest: (...a: unknown[]) => mockAuthenticate(...a) }
})

// Every service the six routes reach must be UNREACHED on a refused call. A 403 returned after
// cleanup has already wiped ~/agents/haephestos/ is not a refusal.
const svc = {
  cleanupCreationHelper: vi.fn(async () => ({ status: 200, data: { success: true } })),
  heartbeatCreationHelper: vi.fn(() => undefined),
  ensurePersonaFile: vi.fn(async () => ({ status: 200, data: { success: true } })),
  getRawMaterialsState: vi.fn(async () => ({ status: 200, data: {} })),
  saveRawMaterialsState: vi.fn(async () => ({ status: 200, data: {} })),
}
vi.mock('@/services/creation-helper-service', async (orig) => {
  const actual = await orig<typeof import('@/services/creation-helper-service')>()
  return { ...actual, ...svc }
})

// TRDD-1LFRP6GJ: `publish-plugin` now joins the six owner-gated routes below. Its real
// validation+copy logic (`services/haephestos-publish-service.ts::publishHaephestosPlugin`)
// is exercised for real by `tests/integration/haephestos-pipeline.test.ts`; THIS file is
// about the auth gate only, so the pipeline itself is mocked to a canned success — same
// reasoning as the `svc` mock above for the other five routes' services.
const publishMock = vi.fn(async () => ({
  status: 200,
  body: { success: true as const, pluginName: 'test-plugin', pluginDir: '/x/test-plugin' },
}))
vi.mock('@/services/haephestos-publish-service', () => ({ publishHaephestosPlugin: publishMock }))

// `clear-banner` is NOT in ROUTES below. It reaches no service — it shells out to tmux — so its
// owner path 500s in this environment, and the only way to give it a positive control here was a
// module-scope `child_process` mock. MEASURED 2026-09-04: that mock's blast radius is TWO routes,
// not one — `cleanup/route.ts:49` also calls `execFileAsync('tmux', ['kill-session', …])`. So the
// mock reached a second route in this very loop, directly underneath the assertion that had just
// been strengthened to catch exactly that kind of blindness. Removed. `clear-banner` now lives in
// tests/unit/clear-banner-system-owner.test.ts, where the mock is scoped to the one route needing it.
//
// TWO CORRECTIONS TO THE CLAIM THIS COMMENT ORIGINALLY MADE, both from a later review:
//
// 1. It said the mock "cost `cleanup` a failure mode". IT DID NOT, and my own run said so — with
//    the mock removed, `cleanup` still returned < 400 in an environment with no tmux session.
//    `cleanup/route.ts:48-53` wraps its `execFileAsync('tmux', ['kill-session', …])` in a bare
//    `catch { /* Session didn't exist — that's fine */ }` and returns `{cleaned:true}` regardless.
//    So `cleanup`'s positive control is INSENSITIVE to the executor in both directions; there was
//    no failure mode there to lose. The mock was still wrong to have — an unaudited blast radius
//    is a hazard whether or not it fires — but that is a different and weaker claim than the one
//    written here first, and the evidence for the stronger one was in the run that refuted it.
//
// 2. "The blast radius is exactly two routes" is a claim about the SEVEN FILES I grepped, not
//    about the mock. `vi.mock('child_process')` applies to the whole module graph of the test
//    file, so any TRANSITIVE import that shells out is also in radius — `lib/agent-runtime.ts`
//    is this repo's tmux layer and was never checked against these routes' import trees. The
//    honest claim is: no DIRECT `child_process` use in the six route files or the one service
//    checked. Scoping the stub to a one-route file is correct regardless of that gap, which is
//    luck rather than diligence.

const MEMBER = { agentId: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', governanceTitle: 'member', teamId: null }
const MANAGER = { agentId: 'cccccccc-3333-4333-8333-cccccccccccc', governanceTitle: 'manager', teamId: null }
const OWNER = { agentId: undefined, governanceTitle: undefined, teamId: null }

import { beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

let ORIGINAL_HOME: string | undefined
let TMP_HOME: string

/** route dir -> [http method to import, a request the route would otherwise act on] */
const ROUTES: { dir: string; method: 'POST' | 'GET'; url: string; body?: unknown }[] = [
  { dir: 'cleanup', method: 'POST', url: 'http://localhost/api/agents/creation-helper/cleanup', body: {} },
  { dir: 'heartbeat', method: 'POST', url: 'http://localhost/api/agents/creation-helper/heartbeat', body: {} },
  { dir: 'ensure-persona', method: 'POST', url: 'http://localhost/api/agents/creation-helper/ensure-persona', body: {} },
  // file-picker exports POST, not GET — measured, after a GET assumption produced
  // `handler is not a function` on all three of its cases.
  { dir: 'file-picker', method: 'POST', url: 'http://localhost/api/agents/creation-helper/file-picker', body: uploadBody() },
  { dir: 'raw-materials', method: 'GET', url: 'http://localhost/api/agents/creation-helper/raw-materials' },
  // TRDD-1LFRP6GJ: these two join the six above — the persona's credential-less HTTP calls
  // to them 401ed under middleware.ts anyway (RULED: move the lookups off the API), so they
  // are no longer "the two agent-callable siblings" the last case below used to exempt.
  // `names: []` reaches the route's own early `{descriptions: {}}` 200 return (route.ts's
  // `!Array.isArray(names) || names.length === 0` branch) WITHOUT needing the PSS binary to
  // be present in this environment — the auth gate is what this file tests, not PSS lookup.
  { dir: 'element-descriptions', method: 'POST', url: 'http://localhost/api/agents/creation-helper/element-descriptions', body: { names: [] } },
  { dir: 'publish-plugin', method: 'POST', url: 'http://localhost/api/agents/creation-helper/publish-plugin', body: { pluginDir: '/x/test-plugin' } },
]

function req(url: string, method: string, body?: unknown) {
  // file-picker is an UPLOAD route — it reads `req.formData()`, so a JSON body throws inside the
  // handler and 500s. Send the shape each route actually parses, or the POSITIVE CONTROL measures
  // the fixture rather than the gate.
  if (body instanceof FormData) {
    return new Request(url, { method, headers: { authorization: 'Bearer tok' }, body }) as never
  }
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', authorization: 'Bearer tok' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }) as never
}

function uploadBody(): FormData {
  const fd = new FormData()
  fd.append('file', new File(['x'], 'raw.txt', { type: 'text/plain' }))
  return fd
}

async function call(r: (typeof ROUTES)[number]) {
  const mod = await import(`@/app/api/agents/creation-helper/${r.dir}/route`)
  const handler = mod[r.method]
  return handler(req(r.url, r.method, r.body))
}

beforeAll(() => {
  ORIGINAL_HOME = process.env.HOME
  TMP_HOME = mkdtempSync(join(tmpdir(), 'aim-home-'))
  process.env.HOME = TMP_HOME
})

afterAll(() => {
  if (ORIGINAL_HOME === undefined) {
    delete process.env.HOME
  } else {
    process.env.HOME = ORIGINAL_HOME
  }
  rmSync(TMP_HOME, { recursive: true, force: true })
})

describe('TRDD-DQVPODKW — the wizard-only creation-helper routes are owner-only', () => {
  beforeEach(() => {
    mockAuthenticate.mockReset()
    Object.values(svc).forEach((f) => f.mockClear())
    publishMock.mockClear()
  })

  for (const r of ROUTES) {
    it(`${r.dir} refuses a MEMBER — an agent may not drive the owner's creation wizard`, async () => {
      /** Validates that authentication no longer stands in for owner authority on this wizard route */
      mockAuthenticate.mockReturnValue(MEMBER)
      const res = await call(r)

      expect(res.status).toBe(403)
      // The REASON, not merely a non-200: several of these routes have their own body/param
      // validation that already yields 400, so a status-only assertion could pass with the gate
      // removed and the request merely malformed.
      expect((await res.json()).error).toMatch(/system owner only/i)
    })

    it(`${r.dir} refuses even a MANAGER — this is owner authority, not a governance title`, async () => {
      /** Validates the guard is enforceSystemOwner and not a title check, which would still admit agents */
      mockAuthenticate.mockReturnValue(MANAGER)
      const res = await call(r)
      expect(res.status).toBe(403)
    })

    it(`${r.dir} POSITIVE CONTROL — the system owner is NOT refused by the gate`, async () => {
      /** Validates the gate can say yes, so the refusals above are a decision and not a blanket 403 */
      mockAuthenticate.mockReturnValue(OWNER)
      const res = await call(r)
      // Being stopped BY this gate is the subject; what happens past it is not. But `not.toBe(403)`
      // alone is satisfied by a route that throws and 500s, so the control would survive the route
      // being broken in any non-403 way — bound it below 400 instead.
      expect(res.status).toBeLessThan(400)
    })
  }

  it('the two former AGENT-CALLABLE siblings NOW carry the same owner gate as the six (TRDD-1LFRP6GJ)', async () => {
    /** Validates the persona-lookup routes joined the owner-gated set once their HTTP-facing
     *  callers moved off the API (element-descriptions -> direct PSS invocation,
     *  publish-plugin -> the file-based request/response poller in creation-helper-service.ts)
     *  — the inverse of the assertion this test used to make before that migration. */
    const { readFileSync } = await import('fs')
    const path = await import('path')
    const root = path.resolve(__dirname, '..', '..')
    for (const dir of ['element-descriptions', 'publish-plugin']) {
      const src = readFileSync(path.join(root, 'app', 'api', 'agents', 'creation-helper', dir, 'route.ts'), 'utf8')
      expect(src, `${dir} must now be owner-gated — the persona no longer calls it over HTTP`).toMatch(/enforceSystemOwner\(/)
    }
  })
})

/**
 * NEUTER RUNS (2026-09-04 — OBSERVED, restored from a pre-edit copy afterwards):
 *
 * 1. `s/const authErr = enforceSystemOwner(request)/const authErr = null as never/` in
 *    `cleanup/route.ts` ONLY → **2 red / 17 green**, exactly:
 *        cleanup refuses a MEMBER …
 *        cleanup refuses even a MANAGER …
 *    Predicted 2, observed 2. The other five routes stayed green, which is what makes this
 *    per-route rather than one gate standing in for six — and cleanup's POSITIVE CONTROL
 *    correctly stayed green, without which "2 red" would be equally consistent with having
 *    broken the route for its only legitimate caller.
 *
 * 1b. RE-RUN after an adversarial review forced the POSITIVE CONTROL from `not.toBe(403)` to
 *    `< 400`: same result, **2 red / 17 green**, same two cases. The attribution survives the
 *    stronger control, which is the point of re-running it rather than assuming it does.
 *
 * 2. The scope guard (the last case) was neutered by seeding `enforceSystemOwner(` into an
 *    agent-callable sibling → **1 red / 18 green**, naming exactly that case.
 *
 *    THE FIRST ATTEMPT AT (2) MEASURED NOTHING AND REPORTED GREEN. The probe was anchored on
 *    `export const dynamic`, which `element-descriptions/route.ts` does not contain — so the
 *    seed never landed and the run's "19 passed" said only that an unmodified file is
 *    unmodified. A neuter that reddens NOTHING is a claim about the INSTRUMENT until the
 *    mutation is proven to have landed; re-run against `publish-plugin/route.ts` (which has the
 *    anchor) with an explicit `assert count == 1` and a printed `probe landed: True`, it
 *    reddened immediately. Recorded because a silently-unapplied neuter is indistinguishable
 *    from a vacuous guard, and both look like a pass.
 */

/**
 * WHAT THE STRONGER POSITIVE CONTROL FOUND, recorded because the weak one hid it for a full
 * verification cycle. `expect(res.status).not.toBe(403)` passed on `clear-banner` and
 * `file-picker` while BOTH were returning **500** on the owner path — so for two of the six
 * routes the control proved only "not this specific status", and the run reported 19/19 green
 * over a fixture that never reached either handler's body.
 *
 * Neither was a route defect; both were defects in THIS FILE, which is worse in the way that
 * matters — a fixture bug is invisible to the suite it is supposed to be measuring:
 *   - `clear-banner` reaches NO service. It shells out to tmux. The draft mocked a `clearBanner`
 *     service export the route never calls, so the mock matched nothing and the real execFile ran.
 *   - `file-picker` is an UPLOAD route reading `req.formData()`; the draft sent a JSON body, which
 *     throws inside the handler. This is the SECOND time this file's fixture assumed the wrong
 *     shape for that one route — the first was assuming it exported GET when it exports POST.
 *
 * A positive control bounded only by the status it is refuting cannot tell "the gate let me
 * through" from "the gate let me through and everything after it failed".
 */
