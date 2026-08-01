/**
 * TRDD-ZT3P02PO — the marketplaces route tells the user their settings file is unreadable.
 *
 * `saveJsonSafe` REFUSES to overwrite a `~/.claude/settings.json` it could not read, and
 * `save-json-safe-refuses-clobber.test.ts` pins that behaviour on real files. This test pins the
 * OTHER half — the WIRING — because a guard whose refusal is swallowed is invisible:
 *
 *   1. that this route's settings writes go through the guarded writer at all, and
 *   2. that its POST catch-all, which answers every throw with a generic `Action failed` 500,
 *      special-cases this one.
 *
 * ⚠ WHY THE STATUS MATTERS AND IS NOT COSMETIC. Without the mapping the user clicks "add
 * marketplace", gets `Action failed`, and has no way to learn that their global Claude Code config
 * is corrupt — the single most useful fact available at that moment. That silence is how the
 * destroy-the-file bug survived: the failure mode had no voice. **409, not 500**: nothing here is
 * broken, the state on disk is UNKNOWN.
 *
 * ⚠ THE DISCRIMINATING TEST IS THE THIRD ONE. A route that answered 409 to EVERY throw would pass
 * the first two; only "a generic error is still a 500" separates a specific mapping from a blanket
 * one. And the positive control is what proves the 409 comes from the guard rather than from a
 * failed auth or a failed pipeline somewhere upstream.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockEnforceSystemOwner, mockCreateMarketplace, mockSaveJsonSafe, mockLoadJsonSafe } = vi.hoisted(() => ({
  mockEnforceSystemOwner: vi.fn(),
  mockCreateMarketplace: vi.fn(),
  mockSaveJsonSafe: vi.fn(),
  mockLoadJsonSafe: vi.fn(),
}))

vi.mock('@/lib/route-auth', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  enforceSystemOwner: mockEnforceSystemOwner,
}))

vi.mock('@/services/element-management-service', () => ({
  CreateMarketplace: mockCreateMarketplace,
  DeleteMarketplace: vi.fn(),
  UpdateMarketplace: vi.fn(),
  ChangePlugin: vi.fn(),
}))

// The REAL `UnreadableTargetError` class is kept (spread from the actual module) — the route maps on
// `instanceof`, so a look-alike error object would silently take the generic branch and the test
// would pass while pinning nothing.
vi.mock('@/lib/json-io', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  loadJsonSafe: mockLoadJsonSafe,
  saveJsonSafe: mockSaveJsonSafe,
}))

/**
 * ⚠ 30s, not the 5s default. Importing this route pulls a 1700-line module and its whole transitive
 * graph — measured 0.8s warm and 3.3-5.0s cold, so the default timeout is a coin flip under load.
 *
 * And a timeout here does not merely fail ITS OWN test: the timed-out `post()` stays PENDING, and
 * when the next test queues a `mockRejectedValueOnce`, the leaked call consumes it — so the next
 * test's own call gets the default resolve and sees a **200 where it asserted 409**. That is a
 * failure reported against the wrong test, with a status that makes it look like the code under
 * test regressed. Observed exactly once while neutering this file; the fix is to stop the timeout,
 * not to chase the 200.
 */
vi.setConfig({ testTimeout: 30_000 })

const post = async (body: Record<string, unknown>) => {
  const { POST } = await import('@/app/api/settings/marketplaces/route')
  // Port 23000 is where the real server lives (server.mjs serves the Next.js routes AND the
  // WebSocket upgrade on the one port). Nothing here is served over a socket — the handler is
  // imported and called directly — so the URL is only a `Request` constructor argument and the
  // port is never consulted. It is written realistically so the next reader does not have to
  // wonder whether a portless URL means something.
  const req = new Request('http://localhost:23000/api/settings/marketplaces', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(req as never)
}

/** A plain GitHub add — not a destructive action, so it needs no sudo token, and it reaches the
 *  settings stamp immediately after the (mocked) CreateMarketplace pipeline. */
const ADD = { action: 'add-marketplace', url: 'https://github.com/someone/their-plugins' }

describe('marketplaces route — an unreadable settings.json is reported, not clobbered', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockEnforceSystemOwner.mockReturnValue(null) // authorized
    mockCreateMarketplace.mockResolvedValue({ success: true })
    mockLoadJsonSafe.mockResolvedValue({})
    mockSaveJsonSafe.mockResolvedValue(undefined)
  })

  it('POSITIVE CONTROL — the same request succeeds when the settings file is readable', async () => {
    // Without this, a 409 below could be coming from the auth gate, the pipeline, or anywhere else.
    const res = await post(ADD)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, action: 'add-marketplace' })
    expect(mockSaveJsonSafe).toHaveBeenCalledTimes(1)
  })

  it('answers 409 and NAMES THE CAUSE when the write refuses', async () => {
    const { UnreadableTargetError } = await import('@/lib/json-io')
    mockSaveJsonSafe.mockRejectedValueOnce(
      new UnreadableTargetError('/home/u/.claude/settings.json', 'Unexpected end of JSON input'),
    )
    const res = await post(ADD)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.errorType).toBe('unreadable-settings')
    // The REAL cause, not `Action failed` — the assertion the mapping exists for.
    expect(body.error).toMatch(/does not parse[\s\S]*refusing to overwrite/)
    expect(body.error).not.toMatch(/^Action failed$/)
  })

  it('a GENERIC error is still a 500 — the mapping is specific, not a blanket 409', async () => {
    mockSaveJsonSafe.mockRejectedValueOnce(new Error('disk full'))
    const res = await post(ADD)
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ error: 'Action failed' })
  })

  it('the route reaches the GUARDED writer — never a direct write', async () => {
    // Pairs with `user-settings-has-two-writers.test.ts`, which forbids the direct-write SHAPE in
    // source. This is the runtime half: the handler actually calls the owner.
    await post(ADD)
    expect(mockSaveJsonSafe).toHaveBeenCalledWith(
      expect.stringMatching(/\.claude[/\\]settings\.json$/),
      expect.objectContaining({ extraKnownMarketplaces: expect.anything() }),
    )
  })
})
