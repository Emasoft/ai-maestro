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
 * (2026-09-04) measured browser callers against persona callers for all thirteen routes. These
 * six are called from `components/` and NEVER by the persona, whose shipped instructions
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
 * SAFE FOR THE UI, on the same empirical precedent as `convert-skill`: a browser cookie session
 * resolves to the system owner (`lib/agent-auth`: "Valid session cookie (aim_session) → system
 * owner (web UI)"), which is why the settings UI already calls several enforceSystemOwner routes
 * successfully.
 *
 * NEUTER RUN — see the recorded result at the bottom of this file.
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
  clearBanner: vi.fn(async () => ({ status: 200, data: { success: true } })),
  heartbeatCreationHelper: vi.fn(() => undefined),
  ensurePersonaFile: vi.fn(async () => ({ status: 200, data: { success: true } })),
  getRawMaterialsState: vi.fn(async () => ({ status: 200, data: {} })),
  saveRawMaterialsState: vi.fn(async () => ({ status: 200, data: {} })),
}
vi.mock('@/services/creation-helper-service', async (orig) => {
  const actual = await orig<typeof import('@/services/creation-helper-service')>()
  return { ...actual, ...svc }
})

const MEMBER = { agentId: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', governanceTitle: 'member', teamId: null }
const MANAGER = { agentId: 'cccccccc-3333-4333-8333-cccccccccccc', governanceTitle: 'manager', teamId: null }
const OWNER = { agentId: undefined, governanceTitle: undefined, teamId: null }

/** route dir -> [http method to import, a request the route would otherwise act on] */
const ROUTES: { dir: string; method: 'POST' | 'GET'; url: string; body?: unknown }[] = [
  { dir: 'cleanup', method: 'POST', url: 'http://localhost/api/agents/creation-helper/cleanup', body: {} },
  { dir: 'clear-banner', method: 'POST', url: 'http://localhost/api/agents/creation-helper/clear-banner', body: {} },
  { dir: 'heartbeat', method: 'POST', url: 'http://localhost/api/agents/creation-helper/heartbeat', body: {} },
  { dir: 'ensure-persona', method: 'POST', url: 'http://localhost/api/agents/creation-helper/ensure-persona', body: {} },
  // file-picker exports POST, not GET — measured, after a GET assumption produced
  // `handler is not a function` on all three of its cases.
  { dir: 'file-picker', method: 'POST', url: 'http://localhost/api/agents/creation-helper/file-picker', body: { path: '/' } },
  { dir: 'raw-materials', method: 'GET', url: 'http://localhost/api/agents/creation-helper/raw-materials' },
]

function req(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', authorization: 'Bearer tok' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }) as never
}

async function call(r: (typeof ROUTES)[number]) {
  const mod = await import(`@/app/api/agents/creation-helper/${r.dir}/route`)
  const handler = mod[r.method]
  return handler(req(r.url, r.method, r.body))
}

describe('TRDD-DQVPODKW — the wizard-only creation-helper routes are owner-only', () => {
  beforeEach(() => {
    mockAuthenticate.mockReset()
    Object.values(svc).forEach((f) => f.mockClear())
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
      // What happens past the gate is not this file's subject; being stopped BY it is.
      expect(res.status).not.toBe(403)
    })
  }

  it('the two AGENT-CALLABLE siblings are deliberately NOT owner-gated', async () => {
    /** Validates the ruling was scoped by a caller census and did not sweep the whole subtree,
     *  which would break the persona's only two documented API calls */
    const { readFileSync } = await import('fs')
    const path = await import('path')
    const root = path.resolve(__dirname, '..', '..')
    for (const dir of ['element-descriptions', 'publish-plugin']) {
      const src = readFileSync(path.join(root, 'app', 'api', 'agents', 'creation-helper', dir, 'route.ts'), 'utf8')
      expect(src, `${dir} must stay agent-callable — the persona curls it`).not.toMatch(/enforceSystemOwner\(/)
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
