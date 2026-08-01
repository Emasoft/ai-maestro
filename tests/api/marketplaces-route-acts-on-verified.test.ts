/**
 * TRDD-G2K02VDY — the marketplaces route ACTS on G11's read-back verdict, and its answer SPLITS.
 *
 * This is the FOURTH `ChangePlugin` caller. `plugin-routes-verified-mismatch.test.ts` (TRDD-RO90UCKQ)
 * covers the other three, and all three answer a `mismatch` the same way: 409, because no recovery
 * path exists. This route is the reason G2K02VDY is a separate card — `handleInstall` DOES have a
 * recovery path, so answering 409 there would report a fault the route already knows how to FIX.
 *
 *   enable / disable / update  →  409          (nothing further to try)
 *   install                    →  stale-cleanup + ONE retry, and 409 only if that also mismatches
 *
 * ⚠ THE INSTALL TEST IS THE LOAD-BEARING ONE. A test that asserted only "install answers 409 on a
 * mismatch" would pin the 409 SHAPE and be satisfied by the very bug this card removed — the
 * mismatch never reaching the repair. So the install assertions are about the RECOVERY: that
 * ChangePlugin is called a SECOND time, and that a retry which verifies reports `staleCleanup: true`.
 * The neuter is "make the mismatch not route into cleanup"; that test must red.
 *
 * ⚠ ONE CLAIM THIS FILE DELIBERATELY DOES NOT MAKE. `mismatchResponse`'s docstring says callers must
 * put it AFTER their `!r.ok` branch or a genuine failure would report as "did not take effect". That
 * hazard is UNREACHABLE through this route: `dispatchUserPluginAction` returns
 * `{ ok: false, pluginKey, lastError }` on failure and never sets `verified`, so `!r.ok` implies
 * `verified === undefined` and the check is false on either side of the branch. Reversing the order
 * reds nothing here (measured). The ordering is still correct defence in depth for a future
 * dispatcher that returns a verdict on the failure path — but no test at this altitude can
 * discriminate it, so none of these is named an ORDER guard.
 *
 * ⚠ `unknown` MUST NOT GATE, at any of the four. An invariant may act on a positive VIOLATION and
 * never on an UNKNOWN (TRDD-K71FV649) — and for install the stakes are concrete: the cleanup DELETES
 * settings entries and re-installs, so running it off a file we could not read would be acting on an
 * unknown. Collapsing `unknown` into `mismatch` is precisely the regression these tests prevent.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import { guardRealUserSettings } from '../helpers/real-home-untouched'

const { mockChangePlugin, mockEnforceSystemOwner, mockLoadJsonSafe, mockUpdateJson } = vi.hoisted(() => ({
  mockChangePlugin: vi.fn(),
  mockEnforceSystemOwner: vi.fn(),
  mockLoadJsonSafe: vi.fn(),
  mockUpdateJson: vi.fn(),
}))

vi.mock('@/lib/route-auth', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  enforceSystemOwner: mockEnforceSystemOwner,
}))
vi.mock('@/services/element-management-service', () => ({
  ChangePlugin: mockChangePlugin,
  CreateMarketplace: vi.fn(),
  DeleteMarketplace: vi.fn(),
  UpdateMarketplace: vi.fn(),
}))
// ⚠ THE MOCKED VERB MUST TRACK THE ROUTE'S ACTUAL WRITER. This spread keeps every unlisted export
// REAL, so mocking a verb the route no longer calls does not fail — it lets the REAL writer run
// against the developer's own ~/.claude/settings.json. That happened on 2026-08-01 when the route
// migrated `saveJsonSafe` → `updateJson` (TRDD-RYFP030K). `guardRealUserSettings` below is the
// verb-agnostic tripwire that makes a repeat loud instead of silent.
vi.mock('@/lib/json-io', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  loadJsonSafe: mockLoadJsonSafe,
  updateJson: mockUpdateJson,
}))

// Importing this route pulls a 1700-line module and its whole transitive graph — 0.8s warm and up to
// 5s cold, so the 5s default is a coin flip under load. Worse, a timed-out call stays PENDING and
// consumes the NEXT test's `…Once`, reporting a failure against the wrong test (TRDD-ZT3P02PO).
vi.setConfig({ testTimeout: 30_000 })

const post = async (body: Record<string, unknown>) => {
  const { POST } = await import('@/app/api/settings/marketplaces/route')
  // Port 23000 is where the real server lives; nothing here is served over a socket (the handler is
  // imported and called directly), so the port is never consulted.
  const req = new Request('http://localhost:23000/api/settings/marketplaces', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(req as never)
}

const PLUGIN = 'some-plugin'
const MKT = 'some-marketplace'
const KEY = `${PLUGIN}@${MKT}`

/** A ChangePlugin result that SUCCEEDED — only `verified` varies between the cases. */
const ok = (verified?: 'ok' | 'mismatch' | 'unknown') => ({
  success: true, pluginKey: KEY, action: 'enable', operations: ['G11: …'], restartNeeded: true, verified,
})

describe('marketplaces route — the verdict answer splits by handler', () => {
  let assertHomeUntouched: () => void
  beforeAll(() => { assertHomeUntouched = guardRealUserSettings() })
  afterAll(() => { assertHomeUntouched() })

  beforeEach(() => {
    vi.clearAllMocks()
    mockEnforceSystemOwner.mockReturnValue(null) // authorized
    mockLoadJsonSafe.mockResolvedValue({})
    // DEFAULT: the settings write finds nothing to change. The stale-cleanup retry is now gated on
    // `updateJson`'s OWN `changed` verdict rather than on a flag the route computed from a separate
    // read, so this is the knob that decides whether the repair path runs — tests that need the
    // retry override it to `changed: true` explicitly, which makes the dependency visible instead of
    // hiding it inside a fixture's `enabledPlugins` shape.
    mockUpdateJson.mockResolvedValue({ changed: false, backupPath: null, attempts: 1, auditOk: true })
  })

  // ── The three handlers with NO recovery path ────────────────────────────────
  for (const action of ['enable', 'disable', 'update'] as const) {
    describe(`${action}`, () => {
      it('answers 409 on a mismatch — no recovery path exists, so the truthful answer is "it did not land"', async () => {
        mockChangePlugin.mockResolvedValue(ok('mismatch'))
        const res = await post({ action, pluginKey: KEY, pluginName: PLUGIN, marketplaceName: MKT })
        expect(res.status).toBe(409)
        expect((await res.json()).error).toMatch(/did not take effect/)
      })

      it('does NOT gate on `unknown` — an invariant acts on a VIOLATION, never on an UNKNOWN', async () => {
        mockChangePlugin.mockResolvedValue(ok('unknown'))
        const res = await post({ action, pluginKey: KEY, pluginName: PLUGIN, marketplaceName: MKT })
        expect(res.status).toBe(200)
        expect(await res.json()).toMatchObject({ success: true, action })
      })

      it('a genuine FAILURE reports its own cause, not "did not take effect"', async () => {
        // ⚠ THIS DOES **NOT** PIN THE PRECEDENCE, and it is named accordingly. Reversing the two
        // branches in the handler reds NOTHING here — measured, not assumed — because
        // `dispatchUserPluginAction` returns `{ ok: false, pluginKey, lastError }` on failure and
        // NEVER sets `verified` at all. So `!r.ok` implies `verified === undefined`, the mismatch
        // check is false whichever side it sits on, and the ordering hazard `mismatchResponse`'s
        // docstring warns about is unreachable through this route today. It is real defence in depth
        // against a future `dispatchUserPluginAction` that returns a verdict on the failure path —
        // and until that exists, no test at this altitude can discriminate it, so calling this one
        // an ORDER guard would have shipped a false claim.
        //
        // What it DOES pin, and is worth pinning: a real failure surfaces its own cause and a 500.
        mockChangePlugin.mockResolvedValue({ success: false, error: 'the CLI exploded', operations: [] })
        const res = await post({ action, pluginKey: KEY, pluginName: PLUGIN, marketplaceName: MKT })
        expect(res.status).toBe(500)
        const body = await res.json()
        expect(body.error).toMatch(/the CLI exploded/)
        expect(body.error).not.toMatch(/did not take effect/)
      })

      it('POSITIVE CONTROL — a clean `ok` verdict is a 200, so the gate is not refusing everything', async () => {
        mockChangePlugin.mockResolvedValue(ok('ok'))
        const res = await post({ action, pluginKey: KEY, pluginName: PLUGIN, marketplaceName: MKT })
        expect(res.status).toBe(200)
      })
    })
  }

  // ── install: the handler whose answer is DIFFERENT ─────────────────────────
  describe('install — a mismatch is routed into the EXISTING stale-cleanup retry, not answered 409', () => {
    it('RETRIES after cleanup, and a retry that verifies is a SUCCESS with staleCleanup', async () => {
      // THE LOAD-BEARING ASSERTION. A 409 here would report a fault the route knows how to fix, and
      // the repair would never run. `changed: true` is what makes the cleanup count as having done
      // something, so the retry is reached at all.
      mockUpdateJson.mockResolvedValue({ changed: true, backupPath: null, attempts: 1, auditOk: true })
      mockChangePlugin
        .mockResolvedValueOnce(ok('mismatch')) // first attempt: ran, did not land
        .mockResolvedValueOnce(ok('ok'))       // retry after cleanup: landed

      const res = await post({ action: 'install', pluginKey: KEY, pluginName: PLUGIN, marketplaceName: MKT })

      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ success: true, action: 'install', staleCleanup: true })
      // The repair actually ran: a second ChangePlugin call, and the dangling entry was written back.
      expect(mockChangePlugin.mock.calls.length).toBeGreaterThanOrEqual(2)
      expect(mockUpdateJson).toHaveBeenCalled()
    })

    it('409 only when the RETRY also mismatches — the repair ran and the state still disagrees', async () => {
      // A different answer from the first mismatch, and it must not be a 500 with an invented cause:
      // on a mismatch `r2.ok` is true, so `r2.lastError` is undefined and the 500 branch would read
      // "Install failed after stale cleanup: unknown".
      mockUpdateJson.mockResolvedValue({ changed: true, backupPath: null, attempts: 1, auditOk: true })
      mockChangePlugin.mockResolvedValue(ok('mismatch'))

      const res = await post({ action: 'install', pluginKey: KEY, pluginName: PLUGIN, marketplaceName: MKT })

      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body.error).toMatch(/after stale cleanup/)
      expect(body.error).not.toMatch(/unknown/)
    })

    it('does NOT gate on `unknown` — the cleanup DELETES entries, so it must never run off a file we could not read', async () => {
      mockChangePlugin.mockResolvedValue(ok('unknown'))
      const res = await post({ action: 'install', pluginKey: KEY, pluginName: PLUGIN, marketplaceName: MKT })
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ success: true, action: 'install' })
      // The decisive half: no repair was attempted at all.
      expect(mockChangePlugin).toHaveBeenCalledTimes(1)
      expect(mockUpdateJson).not.toHaveBeenCalled()
    })

    it('POSITIVE CONTROL — a clean `ok` returns immediately, with no cleanup and no retry', async () => {
      mockChangePlugin.mockResolvedValue(ok('ok'))
      const res = await post({ action: 'install', pluginKey: KEY, pluginName: PLUGIN, marketplaceName: MKT })
      expect(res.status).toBe(200)
      expect(mockChangePlugin).toHaveBeenCalledTimes(1)
      expect(mockUpdateJson).not.toHaveBeenCalled()
    })
  })
})
