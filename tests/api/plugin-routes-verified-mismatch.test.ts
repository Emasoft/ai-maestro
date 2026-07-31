/**
 * TRDD-RO90UCKQ — a user-initiated route ACTS on G11's read-back verdict.
 *
 * `ChangePlugin` reports the verdict (`verified`) separately from `success`, because it is also
 * called as an R51 COMPENSATION where a failed read-back would escalate to "the system is in an
 * INVALID STATE, manual repair required" about a system that was restored. The decision therefore
 * belongs to the caller — and THIS caller is a human clicking a toggle, for whom the truthful answer
 * to "the settings file says your change did not land" is an error, not a 200.
 *
 * ⚠ WHY THIS TEST EXISTS SEPARATELY FROM THE SERVICE TEST. `changeplugin-verified-verdict.test.ts`
 * pins that the field is COMPUTED; nothing pinned that anyone READS it. A field no caller acts on is
 * dead weight that a future cleanup deletes with no test going red — and the whole point of the
 * design is that the caller decides. This is the caller.
 *
 * ⚠ `unknown` MUST NOT gate. An invariant may act on a positive VIOLATION and never on an UNKNOWN
 * (TRDD-K71FV649). Its test is the third one, and it is not decoration: collapsing `unknown` into
 * `mismatch` is precisely the regression that card was written to prevent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockChangePlugin, mockRequireAuth, mockEnforceSystemOwner, mockRequireSudoToken } = vi.hoisted(() => ({
  mockChangePlugin: vi.fn(),
  mockRequireAuth: vi.fn(),
  mockEnforceSystemOwner: vi.fn(),
  mockRequireSudoToken: vi.fn(),
}))

vi.mock('@/services/element-management-service', () => ({ ChangePlugin: mockChangePlugin }))
// The four routes do NOT share one guard, and the tests found that rather than assuming it:
// `local-plugins` uses requireAuth; `role-plugins/install` gates on a SUDO TOKEN first (both verbs);
// `global-plugins` is system-owner-only. Mocking just requireAuth got a 401 from the real sudo guard
// and a "No enforceSystemOwner export" from the mock — each a route saying which door it uses.
vi.mock('@/lib/route-auth', () => ({
  requireAuth: mockRequireAuth,
  enforceSystemOwner: mockEnforceSystemOwner,
}))
vi.mock('@/lib/sudo-guard', () => ({ requireSudoToken: mockRequireSudoToken }))

const AGENT_ID = '11111111-2222-4333-8444-555555555555'

const post = async (body: Record<string, unknown>) => {
  const { POST } = await import('@/app/api/agents/[id]/local-plugins/route')
  const req = new Request(`http://localhost/api/agents/${AGENT_ID}/local-plugins`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(req as never, { params: Promise.resolve({ id: AGENT_ID }) })
}

/** A ChangePlugin result that SUCCEEDED — only `verified` varies between the cases. */
const result = (verified?: 'ok' | 'mismatch' | 'unknown') => ({
  success: true,
  pluginKey: 'my-plugin@mk',
  action: 'enable',
  operations: ['G11: …'],
  restartNeeded: true,
  verified,
})

describe('POST /api/agents/[id]/local-plugins — acts on the read-back verdict', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // SYNCHRONOUS — the route does `const auth = requireAuth(req)` with no await, so a
    // `mockResolvedValue` here makes `auth.ok` undefined and the route returns `auth.error`
    // (undefined) before reaching anything under test.
    mockRequireAuth.mockReturnValue({ ok: true, context: { isSystemOwner: true } })
    // Both return an error Response or null; null = "authorized, carry on".
    mockEnforceSystemOwner.mockReturnValue(null)
    mockRequireSudoToken.mockReturnValue(null)
  })

  it('409s when the settings file says the change did not land', async () => {
    mockChangePlugin.mockResolvedValue(result('mismatch'))
    const res = await post({ key: 'my-plugin@mk', enabled: true })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/did not take effect/i)
  })

  it('200s when the verdict is `ok`', async () => {
    mockChangePlugin.mockResolvedValue(result('ok'))
    expect((await post({ key: 'my-plugin@mk', enabled: true })).status).toBe(200)
  })

  it('200s on `unknown` — an UNREADABLE file is not a violation (TRDD-K71FV649)', async () => {
    mockChangePlugin.mockResolvedValue(result('unknown'))
    expect((await post({ key: 'my-plugin@mk', enabled: true })).status).toBe(200)
  })

  it('200s when `verified` is unset — the idempotent no-op path never runs G11', async () => {
    // The fail-safe property: an absent verdict can never be mistaken for a violation, because the
    // check is `=== 'mismatch'` and not `!== 'ok'`. Stated as a test rather than as a hope.
    mockChangePlugin.mockResolvedValue(result(undefined))
    expect((await post({ key: 'my-plugin@mk', enabled: true })).status).toBe(200)
  })

  it('POSITIVE CONTROL — a genuine failure still 400s, so 409 is not swallowing it', async () => {
    mockChangePlugin.mockResolvedValue({ ...result('mismatch'), success: false, error: 'G02: denied' })
    const res = await post({ key: 'my-plugin@mk', enabled: true })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('G02: denied')
  })
})

/**
 * THE OTHER THREE SITES. The 409 is wired at FOUR routes and, until this block, pinned at ONE —
 * found by re-reading the diff rather than by any test failing. Reversing the two early-returns at
 * any of the three below (so `mismatch` is checked BEFORE `!success`) turns a genuine gate denial
 * into "the change did not take effect", and `tsc` cannot see it: both branches type-check, both
 * return a Response. ORDER is the claim these tests exist to hold.
 */
const ROUTES: Array<{
  name: string
  load: () => Promise<(req: Request) => Promise<Response>>
  body: Record<string, unknown>
}> = [
  {
    name: 'role-plugins/install POST',
    load: async () => (await import('@/app/api/agents/role-plugins/install/route')).POST as never,
    body: { pluginName: 'my-plugin', agentDir: '/tmp/agent-dir', marketplaceName: 'mk' },
  },
  {
    name: 'role-plugins/install DELETE',
    load: async () => (await import('@/app/api/agents/role-plugins/install/route')).DELETE as never,
    body: { pluginName: 'my-plugin', agentDir: '/tmp/agent-dir', marketplaceName: 'mk' },
  },
  {
    name: 'settings/global-plugins POST',
    load: async () => (await import('@/app/api/settings/global-plugins/route')).POST as never,
    body: { key: 'my-plugin@mk', enabled: true },
  },
]

describe.each(ROUTES)('$name — acts on the read-back verdict', ({ load, body }) => {
  const call = async () => {
    const handler = await load()
    return handler(new Request('http://localhost/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }))
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireAuth.mockReturnValue({ ok: true, context: { isSystemOwner: true } })
    // Both return an error Response or null; null = "authorized, carry on".
    mockEnforceSystemOwner.mockReturnValue(null)
    mockRequireSudoToken.mockReturnValue(null)
  })

  it('409s on `mismatch`', async () => {
    mockChangePlugin.mockResolvedValue(result('mismatch'))
    const res = await call()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/did not take effect/i)
  })

  it('does NOT 409 on `unknown` — unreadable is not a violation (TRDD-K71FV649)', async () => {
    mockChangePlugin.mockResolvedValue(result('unknown'))
    expect((await call()).status).not.toBe(409)
  })

  it('ORDER — a genuine failure still 400s, so the mismatch check has not jumped the queue', async () => {
    mockChangePlugin.mockResolvedValue({ ...result('mismatch'), success: false, error: 'G02: denied' })
    const res = await call()
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('G02: denied')
  })
})
