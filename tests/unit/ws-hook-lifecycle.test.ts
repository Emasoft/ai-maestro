// @vitest-environment jsdom
/**
 * TRDD-4XQ1PNMV — regression tests for the WebSocket-hook lifecycle races that
 * TRDD-6A2I6ZO0 found in production behaviour but no unit test could see.
 *
 * Both defects share one root cause: a socket's event handlers outlive the
 * socket. `onclose` nulled `wsRef.current` without checking that IT was still
 * the current socket, and `onerror` closed whatever socket the (reassignable)
 * `ws` variable happened to hold. The result is a hook that reports itself
 * connected while its only write path is dead — silent, because `onopen`
 * restores `connected` but never restores the ref.
 *
 * These tests MUST FAIL against the pre-fix hooks. A regression test that passes
 * on the buggy code proves nothing; see the TRDD for the verification record.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { usePanelWebSocket } from '@/hooks/usePanelWebSocket'
import { useCompanionWebSocket } from '@/hooks/useCompanionWebSocket'

type Handler = ((ev?: unknown) => void) | null

/**
 * Minimal WebSocket double. `close()` deliberately does NOT fire `onclose` —
 * a real close event is asynchronous, and firing it synchronously would hide the
 * exact interleaving (old socket closes AFTER the new one is live) that both
 * bugs depend on. Tests drive the events explicitly.
 */
class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instances: FakeWebSocket[] = []

  readonly url: string
  readyState: number = FakeWebSocket.CONNECTING
  sent: string[] = []
  closeCalls = 0

  onopen: Handler = null
  onmessage: Handler = null
  onclose: Handler = null
  onerror: Handler = null

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.closeCalls += 1
    this.readyState = FakeWebSocket.CLOSED
  }

  // ── test drivers ──
  fireOpen() {
    this.readyState = FakeWebSocket.OPEN
    act(() => this.onopen?.())
  }

  fireClose(code = 1006) {
    this.readyState = FakeWebSocket.CLOSED
    act(() => this.onclose?.({ code }))
  }

  fireError() {
    act(() => this.onerror?.({}))
  }
}

const sockets = () => FakeWebSocket.instances

beforeEach(() => {
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// ─────────────────────────────────────────────────────────────────────────────
describe('usePanelWebSocket — stale socket must not disarm the live one', () => {
  it('a late close from the PREVIOUS agent does not kill feedback on the new one', () => {
    const { result, rerender } = renderHook(({ id }) => usePanelWebSocket(id), {
      initialProps: { id: 'agent-A' },
    })
    const first = sockets()[0]
    first.fireOpen()

    // Switching the active agent tears the effect down and re-runs it at once.
    rerender({ id: 'agent-B' })
    expect(sockets()).toHaveLength(2)
    const second = sockets()[1]
    second.fireOpen()

    // The OLD socket's close event lands only NOW — after the new one is live.
    // This is the whole bug: it used to wipe wsRef.current unconditionally.
    first.fireClose()

    act(() => result.current.sendFeedback({ kind: 'click' }))

    expect(second.sent).toHaveLength(1)
    expect(JSON.parse(second.sent[0])).toEqual({
      type: 'panel:feedback',
      payload: { kind: 'click' },
    })
    expect(first.sent).toHaveLength(0)
  })

  it('a late close from the previous agent does not flip `connected` to false', () => {
    // The silent part of the failure: the UI keeps claiming a healthy channel.
    const { result, rerender } = renderHook(({ id }) => usePanelWebSocket(id), {
      initialProps: { id: 'agent-A' },
    })
    sockets()[0].fireOpen()
    rerender({ id: 'agent-B' })
    sockets()[1].fireOpen()
    expect(result.current.panel.connected).toBe(true)

    sockets()[0].fireClose()
    expect(result.current.panel.connected).toBe(true)
  })

  it('a stale onerror closes ITS OWN socket, never the reconnected one', () => {
    const { result } = renderHook(() => usePanelWebSocket('agent-A'))
    const first = sockets()[0]
    first.fireOpen()

    // The live socket drops → the hook nulls the ref and schedules a reconnect.
    first.fireClose()
    expect(result.current.panel.connected).toBe(false)
    act(() => void vi.advanceTimersByTime(3000))
    expect(sockets()).toHaveLength(2)
    const second = sockets()[1]
    second.fireOpen()

    // The dead socket now errors. Handlers that closed over the reassignable
    // `ws` variable would close `second` here.
    first.fireError()

    expect(second.closeCalls).toBe(0)
    expect(second.readyState).toBe(FakeWebSocket.OPEN)
    act(() => result.current.sendFeedback({ kind: 'click' }))
    expect(second.sent).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('usePanelWebSocket — the behaviour the guard must NOT break', () => {
  it('the live socket closing marks disconnected and reconnects after the backoff', () => {
    const { result } = renderHook(() => usePanelWebSocket('agent-A'))
    sockets()[0].fireOpen()
    expect(result.current.panel.connected).toBe(true)

    sockets()[0].fireClose()
    expect(result.current.panel.connected).toBe(false)
    expect(sockets()).toHaveLength(1)

    act(() => void vi.advanceTimersByTime(2999))
    expect(sockets()).toHaveLength(1)
    act(() => void vi.advanceTimersByTime(1))
    expect(sockets()).toHaveLength(2)
  })

  it('unmount closes the socket and schedules no reconnect', () => {
    const { unmount } = renderHook(() => usePanelWebSocket('agent-A'))
    const first = sockets()[0]
    first.fireOpen()

    unmount()
    expect(first.closeCalls).toBe(1)

    // A close event arriving after unmount must not resurrect the connection.
    first.fireClose()
    act(() => void vi.advanceTimersByTime(10_000))
    expect(sockets()).toHaveLength(1)
  })

  it('a null agentId opens no socket', () => {
    renderHook(() => usePanelWebSocket(null))
    expect(sockets()).toHaveLength(0)
  })

  it('control messages still drive panel state', () => {
    const { result } = renderHook(() => usePanelWebSocket('agent-A'))
    const first = sockets()[0]
    first.fireOpen()

    act(() => first.onmessage?.({ data: JSON.stringify({ type: 'panel:set-html', html: '<p>hi</p>' }) }))
    expect(result.current.panel.html).toBe('<p>hi</p>')
    expect(result.current.panel.openSignal).toBe(1)

    const nonce = result.current.panel.nonce
    act(() => first.onmessage?.({ data: JSON.stringify({ type: 'panel:refresh' }) }))
    expect(result.current.panel.nonce).toBe(nonce + 1)

    act(() => first.onmessage?.({ data: JSON.stringify({ type: 'panel:close' }) }))
    expect(result.current.panel.closeSignal).toBe(1)
  })

  it('feedback is dropped, not thrown, when no socket is open', () => {
    const { result } = renderHook(() => usePanelWebSocket('agent-A'))
    // never opened → readyState CONNECTING
    expect(() => act(() => result.current.sendFeedback({ kind: 'click' }))).not.toThrow()
    expect(sockets()[0].sent).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('useCompanionWebSocket — same defect, same guard', () => {
  it('a late close from the previous agent does not kill send() on the new one', () => {
    const onSpeech = vi.fn()
    const { result, rerender } = renderHook(
      ({ id }) => useCompanionWebSocket({ agentId: id, onSpeech }),
      { initialProps: { id: 'agent-A' } },
    )
    const first = sockets()[0]
    first.fireOpen()

    rerender({ id: 'agent-B' })
    const second = sockets()[1]
    second.fireOpen()

    first.fireClose()

    act(() => result.current.send({ type: 'user-message', text: 'hello' }))
    expect(second.sent).toHaveLength(1)
    expect(JSON.parse(second.sent[0])).toEqual({ type: 'user-message', text: 'hello' })
  })

  it('an abnormal close on the live socket still reconnects', () => {
    const onSpeech = vi.fn()
    renderHook(() => useCompanionWebSocket({ agentId: 'agent-A', onSpeech }))
    sockets()[0].fireOpen()

    sockets()[0].fireClose(1006)
    act(() => void vi.advanceTimersByTime(1000))
    expect(sockets()).toHaveLength(2)
  })

  it('a graceful close (1000) does not reconnect', () => {
    const onSpeech = vi.fn()
    renderHook(() => useCompanionWebSocket({ agentId: 'agent-A', onSpeech }))
    sockets()[0].fireOpen()

    sockets()[0].fireClose(1000)
    act(() => void vi.advanceTimersByTime(30_000))
    expect(sockets()).toHaveLength(1)
  })

  it('speech messages reach onSpeech', () => {
    const onSpeech = vi.fn()
    renderHook(() => useCompanionWebSocket({ agentId: 'agent-A', onSpeech }))
    const first = sockets()[0]
    first.fireOpen()
    act(() => first.onmessage?.({ data: JSON.stringify({ type: 'speech', text: 'hi there' }) }))
    expect(onSpeech).toHaveBeenCalledWith('hi there')
  })
})
