import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * TRDD-R268J32X — GET /api/export/jobs/[jobId] authenticates.
 *
 * The GET had NO auth call at all while its own DELETE sibling, in the same file, carried
 * `enforceAuth` with the comment "#114: Authenticate before any side effect". That pass was
 * reasoning about SIDE EFFECTS, so a read that DISCLOSES was never in its scope — the identical
 * shape as the `sessions/restore` GET (fixed in `d6f78e2b`, "unauthenticated in BOTH modes"),
 * which is why this is fixed directly rather than filed as a ruling.
 *
 * What the read discloses: `getExportJobStatus` returns the whole `ExportJob` (`types/export.ts`)
 * — `agentId`, `agentName`, `sessionId`, and `filePath`, the on-disk path of the completed export.
 * Unauthenticated, a caller who guesses or enumerates a job id learns which agents exist, what
 * they exported, and where the artifact sits.
 *
 * NO HEADLESS TWIN, verified rather than assumed: `grep -c 'export/jobs' services/headless-router.ts`
 * = 0, and a sweep of `services/ lib/ app/` found no reference outside the route's own directory.
 * So unlike `sessions/restore` — whose companion half lives in `headless-router-auth-mirror.test.ts`
 * because a Next-side fix there is half a fix — this route needs only this file. If a twin is ever
 * added, that guard needs its own mirror test; a Next-only guard would then be half-applied by
 * construction.
 *
 * NEUTER RUN — recorded at the bottom of this file.
 */

const mockAuthenticate = vi.fn()

// Mock the SEAM `enforceAuth` traverses, so the REAL enforceAuth runs. Mocking enforceAuth itself
// would only prove the route calls a stub.
vi.mock('@/lib/agent-auth', async (orig) => {
  const actual = await orig<typeof import('@/lib/agent-auth')>()
  return { ...actual, authenticateFromRequest: (...a: unknown[]) => mockAuthenticate(...a) }
})

// The service must never be reached on a rejected call — a 401 wrapped around a completed read is
// still a disclosure.
const mockStatus = vi.fn()
vi.mock('@/services/config-service', () => ({
  getExportJobStatus: (...a: unknown[]) => mockStatus(...a),
  deleteExportJob: vi.fn(),
}))

const SECRET_PATH = '/Users/somebody/exports/agent-transcript.md'
const SECRET_AGENT = 'scen-probe-agent'

function req() {
  return new Request('http://localhost/api/export/jobs/job-1', { method: 'GET' }) as never
}
const params = { params: Promise.resolve({ jobId: 'job-1' }) }

describe('TRDD-R268J32X — export job status reads are authenticated', () => {
  beforeEach(() => {
    mockAuthenticate.mockReset()
    mockStatus.mockReset()
    mockStatus.mockReturnValue({
      data: {
        success: true,
        job: { id: 'job-1', agentId: 'a1', agentName: SECRET_AGENT, filePath: SECRET_PATH, progress: 100 },
        message: 'ok',
      },
      status: 200,
    })
  })

  it('refuses an unauthenticated caller, and discloses nothing', async () => {
    /** Validates the agent roster and the export's on-disk path are no longer world-readable */
    mockAuthenticate.mockReturnValue({ error: 'Authentication required', status: 401 })
    const { GET } = await import('@/app/api/export/jobs/[jobId]/route')
    const res = await GET(req(), params)

    expect(res.status).toBe(401)
    expect(mockStatus).not.toHaveBeenCalled()
    // Assert the PAYLOAD is absent, not merely the status. A 401 returned after the service ran
    // would still have leaked, and only this assertion can tell those apart.
    const body = await res.text()
    expect(body).not.toContain(SECRET_PATH)
    expect(body).not.toContain(SECRET_AGENT)
  })

  it('POSITIVE CONTROL — an authenticated caller still gets the job status', async () => {
    /** Validates the guard can say yes, so the refusal above is a decision and not a blanket 401 */
    mockAuthenticate.mockReturnValue({ agentId: undefined, governanceTitle: undefined, teamId: null })
    const { GET } = await import('@/app/api/export/jobs/[jobId]/route')
    const res = await GET(req(), params)

    expect(res.status).toBe(200)
    expect(mockStatus).toHaveBeenCalled()
    expect(await res.text()).toContain(SECRET_PATH)
  })
})

/**
 * NEUTER RUN (2026-08-26 — OBSERVED via scripts/dev/neuter, restore verified by blob hash):
 *   s/if \(authErr\) return authErr/if (false) return authErr/ if $. == 22
 *   → 1 red / 1 green:
 *       refuses an unauthenticated caller, and discloses nothing
 *
 * THE LINE ANCHOR IS LOAD-BEARING — the same trap the sessions/restore neuter hit. `if (authErr)
 * return authErr` appears TWICE in this route file (line 22 = GET, line 53 = DELETE), spelled
 * identically, so an unanchored mutation would have disabled the DELETE guard too: a plausible
 * red set produced by breaking a guard this file does not test, which is worse than breaking none.
 * The positive control staying GREEN under the mutation is what proves the red is the guard and
 * not a blanket failure.
 */
