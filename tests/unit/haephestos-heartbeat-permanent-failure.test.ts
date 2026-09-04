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
  const realInnerWidth = window.innerWidth

  afterEach(() => {
    cleanup()
    // DO NOT "make this consistent" with the delete below — the two properties have
    // OPPOSITE shapes and each needs the opposite treatment (both measured in jsdom):
    //   window.innerWidth        own DATA property (1024, writable), NO prototype entry
    //   document.visibilityState NO own property, prototype ACCESSOR
    // So defineProperty is the correct restore here, and `delete` would be a BUG —
    // with no getter to fall back to, window.innerWidth would become `undefined`.
    Object.defineProperty(window, 'innerWidth', { value: realInnerWidth, writable: true, configurable: true })
    // `delete`, NOT a defineProperty "restore". `visibilityState` has no own property
    // on the document — it is an ACCESSOR on the prototype (measured: own descriptor
    // `undefined`, prototype descriptor has a getter). Writing the captured VALUE back
    // as an own data property leaves the getter permanently shadowed for the rest of
    // the file, which looks like a restore and is the very leak it claims to undo.
    // `delete` removes the own property and re-exposes the live getter.
    // @ts-expect-error — deleting an own property that shadows a prototype accessor
    delete document.visibilityState
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
})
