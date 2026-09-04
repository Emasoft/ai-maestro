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

  afterEach(() => {
    cleanup()
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

  it('keeps retrying a 503 with backoff and clears the error once it recovers', async () => {
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

    expect(screen.queryByText(/rejected/i)).toBeNull()
  })
})
