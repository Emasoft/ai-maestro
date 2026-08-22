import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * TRDD-R268J32X — GET /api/sessions/restore authenticates, in the Next.js route.
 *
 * The handler was `export async function GET()` — no `request` parameter at all, so it could not
 * have authenticated even in principle. Its POST and DELETE siblings in the same file both do
 * (SVC2-MAJ-12, 2026-05-06), and both of those comments say "authenticate before re-spawning" /
 * "before deleting": that pass was reasoning about SIDE EFFECTS, and a read that DISCLOSES was
 * never in its scope.
 *
 * What the read discloses: `listRestorableSessions` returns whole `PersistedSession` records
 * (`lib/session-persistence.ts:6-13`) — `id`, `name`, `workingDirectory`, `createdAt`,
 * `lastSavedAt`, `agentId`. `workingDirectory` is an ABSOLUTE home path, so unauthenticated this
 * enumerates the fleet and leaks the owner's filesystem layout.
 *
 * WHY THIS IS READ AS AN OVERSIGHT AND NOT A DECISION. The same subtree contains the genuinely
 * decided case: `app/api/sessions/activity/update/route.ts` also accepts any authenticated caller,
 * and it carries a comment stating exactly why (worst case a misleading UI badge for a few
 * seconds; tightening rejected on hook-frequency perf grounds, with an O(1) upgrade path named).
 * A decision leaves a record. This left none, and `lib/agent-auth`'s header records the ruling it
 * contradicts: "SF-058 CLOSED: No auth headers AND no session cookie → rejected. There is no
 * 'free' system-owner access anymore."
 *
 * THE COMPANION HALF IS IN A DIFFERENT FILE, ON PURPOSE. `services/headless-router.ts`
 * REIMPLEMENTS this route (`GET /api/sessions/restore`, formerly `async (_req, res)`) and had the
 * identical gap. A guard added only here is half-applied by construction — in MAESTRO_MODE=headless
 * the Next route never runs. That half is pinned in
 * `tests/unit/headless-router-auth-mirror.test.ts`, which drives the real router end-to-end.
 * Neither test can see the other's regression; both are required.
 *
 * NEUTER RUN — see the recorded result at the bottom of this file.
 */

const mockAuthenticate = vi.fn()

// Mock the SEAM enforceAuth traverses, so the real enforceAuth runs. Mocking enforceAuth itself
// would only prove the route calls a stub.
vi.mock('@/lib/agent-auth', async (orig) => {
  const actual = await orig<typeof import('@/lib/agent-auth')>()
  return { ...actual, authenticateFromRequest: (...a: unknown[]) => mockAuthenticate(...a) }
})

// The service must never be reached on a rejected call — a 401 wrapped around a completed read
// is still a disclosure.
const mockList = vi.fn()
vi.mock('@/services/sessions-service', () => ({
  listRestorableSessions: (...a: unknown[]) => mockList(...a),
  restoreSessions: vi.fn(),
  deletePersistedSession: vi.fn(),
}))

const SECRET_PATH = '/Users/somebody/agents/scen-probe'

function req() {
  return new Request('http://localhost/api/sessions/restore', { method: 'GET' }) as never
}

describe('TRDD-R268J32X — persisted-session reads are authenticated (Next route)', () => {
  beforeEach(() => {
    mockAuthenticate.mockReset()
    mockList.mockReset()
    mockList.mockResolvedValue({
      sessions: [{ id: 'a', name: 'n', workingDirectory: SECRET_PATH, createdAt: 'x', lastSavedAt: 'y' }],
      count: 1,
    })
  })

  it('refuses an unauthenticated caller, and discloses nothing', async () => {
    /** Validates that the fleet roster and its absolute home paths are no longer world-readable */
    mockAuthenticate.mockReturnValue({ error: 'Authentication required', status: 401 })
    const { GET } = await import('@/app/api/sessions/restore/route')
    const res = await GET(req())

    expect(res.status).toBe(401)
    expect(mockList).not.toHaveBeenCalled()
    // Assert the PAYLOAD is absent, not merely the status. A 401 returned after the service ran
    // would still have leaked, and only this assertion can tell those apart.
    expect(await res.text()).not.toContain(SECRET_PATH)
  })

  it('POSITIVE CONTROL — an authenticated caller still gets the list', async () => {
    /** Validates the guard can say yes, so the refusal above is a decision and not a blanket 401 */
    mockAuthenticate.mockReturnValue({ agentId: undefined, governanceTitle: undefined, teamId: null })
    const { GET } = await import('@/app/api/sessions/restore/route')
    const res = await GET(req())

    expect(res.status).toBe(200)
    expect(mockList).toHaveBeenCalled()
    expect(await res.text()).toContain(SECRET_PATH)
  })
})

/**
 * NEUTER RUN (2026-08-22 — to be recorded below by scripts/dev/neuter).
 */
