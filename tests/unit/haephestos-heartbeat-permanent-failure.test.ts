// @vitest-environment jsdom
/**
 * TRDD-VAXLW6RI — the creation-helper heartbeat's `catch` discarded the HTTP
 * status, so a PERMANENT refusal (401/403 — the caller lost auth) retried
 * forever with exponential backoff, exactly like a transient 503, until the
 * server watchdog silently reaped the session ~120min later with no error
 * ever shown to the user.
 *
 * These tests drive the real heartbeat effect inside HaephestosEmbeddedView:
 * - a 403 must stop retrying and surface a visible error immediately
 * - a 503 must still retry with backoff and recover (positive control — the
 *   fix must not turn every non-2xx into a hard stop)
 */
import React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import HaephestosEmbeddedView from '@/components/HaephestosEmbeddedView'
import type { Agent } from '@/types/agent'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/components/TerminalView', () => ({ default: () => null }))
vi.mock('@/components/TomlPreviewPanel', () => ({ default: () => null }))
vi.mock('@/components/HaephestosLeftPanel', () => ({ default: () => null }))

const agent = {
  id: 'haephestos',
  name: 'haephestos',
  session: { status: 'online' },
} as unknown as Agent

// Captured at MODULE LOAD — before any test mutates either property. Measuring later
// would read back our own afterEach defineProperty instead of jsdom's real shape.
const PRISTINE_INNERWIDTH = Object.getOwnPropertyDescriptor(window, 'innerWidth')
const PRISTINE_VISIBILITY_OWN = Object.getOwnPropertyDescriptor(document, 'visibilityState')
function protoDescriptor(obj: object, key: string): PropertyDescriptor | undefined {
  for (let p = Object.getPrototypeOf(obj); p; p = Object.getPrototypeOf(p)) {
    const d = Object.getOwnPropertyDescriptor(p, key)
    if (d) return d
  }
  return undefined
}
const PRISTINE_VISIBILITY_PROTO = protoDescriptor(document, 'visibilityState')

/**
 * Put a property back EXACTLY as it was, whatever shape it had. This is
 * shape-agnostic on purpose: the two properties this file overrides have opposite
 * shapes in vitest's jsdom (innerWidth is an own ACCESSOR with no prototype entry;
 * visibilityState has no own property and a prototype accessor), so any teardown
 * that hard-codes one strategy is wrong for the other — and both hand-written
 * strategies I tried were wrong for at least one of them:
 *   defineProperty({value}) replaces an own accessor with a data property (shadow)
 *   delete                  strands a property whose prototype has no fallback
 * Re-defining the captured descriptor needs no knowledge of which case applies.
 */
function restoreProp(obj: object, key: string, pristine: PropertyDescriptor | undefined) {
  if (pristine) Object.defineProperty(obj, key, pristine)
  else delete (obj as Record<string, unknown>)[key]
}

describe('Haephestos heartbeat — permanent vs transient failure (TRDD-VAXLW6RI)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  // jsdom does NOT reset window between tests in a file, so the mobile test's
  // innerWidth=400 leaked forward and silently ran the NEXT test against the
  // mobile branch — found by neutering the mobile banner, which reddened two
  // tests instead of one. Restoring it keeps each test's branch its own choice.
  afterEach(() => {
    cleanup()
    // Both go through the SAME shape-agnostic restore — see restoreProp above. Do not
    // replace either with a hand-written strategy: the two have opposite shapes here,
    // and the "teardown contract" test at the bottom of this file asserts them IN THIS
    // ENVIRONMENT so the claim cannot drift the way a comment quoting descriptors does.
    restoreProp(window, 'innerWidth', PRISTINE_INNERWIDTH)
    restoreProp(document, 'visibilityState', PRISTINE_VISIBILITY_OWN)
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('surfaces a visible error and stops retrying on a 403', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/heartbeat')) {
        return Promise.resolve({ ok: false, status: 403 } as Response)
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ exists: false }) } as Response)
    })

    render(React.createElement(HaephestosEmbeddedView, { agent }))
    await act(async () => { await Promise.resolve() })

    expect(screen.getByText(/rejected \(403\)/i)).toBeTruthy()

    const heartbeatCallsAfterFirst = fetchMock.mock.calls.filter(c => String(c[0]).includes('/heartbeat')).length
    expect(heartbeatCallsAfterFirst).toBe(1)

    // Advance well past every backoff tier (1+2+4+8s) and the 15s interval —
    // a permanent failure must never retry again.
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    const heartbeatCallsLater = fetchMock.mock.calls.filter(c => String(c[0]).includes('/heartbeat')).length
    expect(heartbeatCallsLater).toBe(1)
  })

  it('keeps retrying a 503 with backoff until it recovers', async () => {
    let heartbeatCount = 0
    fetchMock.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/heartbeat')) {
        heartbeatCount += 1
        if (heartbeatCount <= 2) return Promise.resolve({ ok: false, status: 503 } as Response)
        return Promise.resolve({ ok: true, status: 200 } as Response)
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ exists: false }) } as Response)
    })

    render(React.createElement(HaephestosEmbeddedView, { agent }))
    await act(async () => { await Promise.resolve() })
    expect(heartbeatCount).toBe(1)

    // First retry after 1s backoff.
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(heartbeatCount).toBe(2)

    // Second retry after 2s backoff — this one succeeds (status 200).
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    expect(heartbeatCount).toBe(3)

    // DELIBERATELY NOT asserting "no banner" here. A 503 goes to the `catch`,
    // which never calls setHeartbeatError — so `queryByText(/rejected/i) === null`
    // would hold no matter what the component did, and would still pass with
    // setHeartbeatError(null) deleted. The clear-on-recovery claim is pinned by
    // the visibilitychange test below, which actually enters the error state first.
  })

  it('shows the banner on the MOBILE branch too — the heartbeat is not desktop-only', async () => {
    // The heartbeat effect is gated on `isOnline` alone, so it runs on a phone.
    // The first fix put the banner only in the desktop return, which left a 403
    // setting state that nothing rendered — the card's own bug, surviving in the
    // branch nobody read. useDeviceType classifies width < 768 as 'phone'.
    Object.defineProperty(window, 'innerWidth', { value: 400, writable: true, configurable: true })
    fetchMock.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/heartbeat')) {
        return Promise.resolve({ ok: false, status: 403 } as Response)
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ exists: false }) } as Response)
    })

    render(React.createElement(HaephestosEmbeddedView, { agent }))
    await act(async () => { await Promise.resolve() })

    expect(screen.getByText(/rejected \(403\)/i)).toBeTruthy()
  })

  it('clears the banner when a tab-resume heartbeat succeeds after a 403', async () => {
    // This is the ONLY path that reaches setHeartbeatError(null): a 403 stops the
    // poll, and `handleVisibility` re-issues one heartbeat on tab-show. If auth was
    // restored meanwhile it succeeds and the banner must go. Without this test that
    // line is dead code, and the resume path has no coverage at all.
    let permanent = true
    fetchMock.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/heartbeat')) {
        return permanent
          ? Promise.resolve({ ok: false, status: 403 } as Response)
          : Promise.resolve({ ok: true, status: 200 } as Response)
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ exists: false }) } as Response)
    })

    render(React.createElement(HaephestosEmbeddedView, { agent }))
    await act(async () => { await Promise.resolve() })
    expect(screen.getByText(/rejected \(403\)/i)).toBeTruthy()

    permanent = false
    Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true, configurable: true })
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
    })

    expect(screen.queryByText(/rejected/i)).toBeNull()
  })

  // NOTE the title was WRONG until now — it said innerWidth "is an own data property",
  // which is what a bare-node probe reports and what the assertions below DISPROVE in
  // this environment. A test name is prose: it cannot fail, so it outlived the fix that
  // falsified it by one commit. Same failure as the comment that fix deleted.
  it('teardown contract: innerWidth is an own ACCESSOR, visibilityState a prototype accessor — opposite shapes, one restore', () => {
    // This test exists because the afterEach restores the two properties by OPPOSITE
    // means, and nothing else pins that. Deleting either restore reds no other test
    // here — the mobile test SETS innerWidth rather than reading a restored value, and
    // it is the last test that touches width — so without this the teardown is
    // unguarded and the asymmetry looks like a bug to anyone tidying up.
    //
    // It also measures in the RIGHT PLACE. The shapes were first probed in a bare
    // `new JSDOM('')` under node, which is NOT this environment: that one reports
    // visibilityState 'prerender' where vitest's reports 'visible'. A descriptor fact
    // asserted here cannot drift from the environment the teardown actually runs in.

    // innerWidth: own DATA property, no getter, and no prototype entry to fall back
    // to — so `delete` would strand it undefined and defineProperty is the restore.
    // innerWidth: an own ACCESSOR with NO prototype entry. Both hand-written
    // strategies are wrong for it — defineProperty({value}) replaces the accessor
    // with a data property, and `delete` strands it undefined (nothing to fall back
    // to). MEASURED HERE, and it contradicts the same probe run in bare node, where
    // innerWidth is an own DATA property: that is why this assertion exists at all.
    expect(PRISTINE_INNERWIDTH?.get).toBeTypeOf('function')
    expect(protoDescriptor(window, 'innerWidth')).toBeUndefined()

    // visibilityState: the mirror image — NO own property, a prototype ACCESSOR.
    expect(PRISTINE_VISIBILITY_OWN).toBeUndefined()
    expect(PRISTINE_VISIBILITY_PROTO?.get).toBeTypeOf('function')

    // The invariant that actually matters, and the one restoreProp delivers for both
    // shapes: after teardown, each property's own descriptor is back to pristine.
    // This test runs last: vitest runs a file's tests in declaration order, these are
    // plain `it` (no `.concurrent`), and `vitest.config.ts` sets no `sequence.shuffle`
    // (default false) — checked, not assumed. Under shuffle the innerWidth half would
    // still hold (afterEach restores after whichever test ran); only the reading of
    // this comment depends on the order.
    // NON-VACUITY, measured: neutering restoreProp to a no-op reds exactly this test
    // with `expected { value: 400, … } to deeply equal { get: [Function get], … }` —
    // the mobile test's leaked override, NOT an echo of what the teardown wrote.
    expect(Object.getOwnPropertyDescriptor(window, 'innerWidth')).toEqual(PRISTINE_INNERWIDTH)
    expect(Object.getOwnPropertyDescriptor(document, 'visibilityState')).toBeUndefined()
  })
})
