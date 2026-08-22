import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * TRDD-R268J32X — GET /api/plugin-builder/builds/[id] authenticates.
 *
 * This route shipped with NO guard of any kind: the only unauthenticated route in an
 * otherwise-guarded subtree (`build` → enforceAuth, `push` → enforceSystemOwner,
 * `scan-repo` → enforceAuth). Its only protection was the entropy of the build id —
 * `randomUUID()`, handed back solely to the authenticated POST caller. That is a
 * capability URL, and `lib/agent-auth`'s own header records the ruling it contradicts:
 *
 *     "SF-058 CLOSED: No auth headers AND no session cookie → rejected.
 *      There is no 'free' system-owner access anymore."
 *
 * WHY enforceAuth AND NOT enforceSystemOwner: a build status is not a governance
 * object — there is no owner to compare against and no title that should widen or
 * narrow the answer. Authentication is the whole requirement, and it matches the
 * sibling that mints the id.
 *
 * WHY THIS WAS INVISIBLE TO THE R268J32X LEDGER: that guard's needle is
 * `MUTATING && CALLS_ENFORCE_AUTH && !STRONG_AUTHZ`, so it can only ever see routes
 * that already call a guard. A route calling NOTHING, on a non-mutating verb, fails
 * both conjuncts and is unreachable by construction. The ledger was built to catch
 * authentication-standing-in-for-authorization and is blind to no-authentication-at-all;
 * this file records that blind spot rather than leaving the count to imply coverage.
 *
 * NEUTER RUN — see the recorded result at the bottom of this file.
 */

const mockAuthenticate = vi.fn()

// Mock the SEAM enforceAuth actually traverses, so the real enforceAuth runs. Mocking
// enforceAuth itself would prove only that the route calls a stub, which is the failure
// mode where mocking the guard "proves" the guard.
vi.mock('@/lib/agent-auth', async (orig) => {
  const actual = await orig<typeof import('@/lib/agent-auth')>()
  return { ...actual, authenticateFromRequest: (...a: unknown[]) => mockAuthenticate(...a) }
})

// The service must never be reached on a rejected call — a 401 returned over a
// completed read is still a disclosure.
const mockGetBuildStatus = vi.fn()
vi.mock('@/services/plugin-builder-service', () => ({
  getBuildStatus: (...a: unknown[]) => mockGetBuildStatus(...a),
}))

const BUILD_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

function req() {
  return new Request(`http://localhost/api/plugin-builder/builds/${BUILD_ID}`, {
    method: 'GET',
  }) as never
}

describe('TRDD-R268J32X — build-status reads are authenticated', () => {
  beforeEach(() => {
    mockAuthenticate.mockReset()
    mockGetBuildStatus.mockReset()
    mockGetBuildStatus.mockResolvedValue({ data: { status: 'complete' } })
  })

  it('refuses an unauthenticated caller — a valid build id is not a credential', async () => {
    /** Validates that knowing the randomUUID build id no longer substitutes for authentication */
    mockAuthenticate.mockReturnValue({ error: 'Authentication required', status: 401 })
    const { GET } = await import('@/app/api/plugin-builder/builds/[id]/route')
    const res = await GET(req(), { params: Promise.resolve({ id: BUILD_ID }) })

    expect(res.status).toBe(401)
    // And prove nothing was read: a refusal that still called the service would be
    // a 401 wrapped around a completed disclosure.
    expect(mockGetBuildStatus).not.toHaveBeenCalled()
  })

  it('POSITIVE CONTROL — an authenticated caller still gets the status', async () => {
    /** Validates the guard can say yes, so the refusal above is a decision and not a blanket 401 */
    mockAuthenticate.mockReturnValue({ agentId: undefined, governanceTitle: undefined, teamId: null })
    const { GET } = await import('@/app/api/plugin-builder/builds/[id]/route')
    const res = await GET(req(), { params: Promise.resolve({ id: BUILD_ID }) })

    expect(res.status).toBe(200)
    expect(mockGetBuildStatus).toHaveBeenCalledWith(BUILD_ID)
  })

  it('still rejects a malformed build id, and does so without reaching the service', async () => {
    /** Validates the pre-existing uuid validation survived the guard being inserted above it */
    mockAuthenticate.mockReturnValue({ agentId: undefined, governanceTitle: undefined, teamId: null })
    const { GET } = await import('@/app/api/plugin-builder/builds/[id]/route')
    const res = await GET(req(), { params: Promise.resolve({ id: 'not-a-uuid' }) })

    expect(res.status).toBe(400)
    expect(mockGetBuildStatus).not.toHaveBeenCalled()
  })
})

/**
 * NEUTER RUN (2026-08-22 — OBSERVED via scripts/dev/neuter, restore verified by blob hash):
 *   s/if \(authErr\) return authErr/if (false) return authErr/
 *   → 1 red / 2 green:
 *       refuses an unauthenticated caller — a valid build id is not a credential
 *
 * Predicted 1, observed 1. The other two staying GREEN is the informative half, not a
 * shortfall: the positive control asserts the guard says YES (unchanged when it is
 * disabled) and the malformed-id case is the pre-existing uuid validation below it, which
 * the guard does not gate. A neuter that reddened all three would have meant the mutation
 * hit something shared and the numbers were about the wrong thing.
 */
