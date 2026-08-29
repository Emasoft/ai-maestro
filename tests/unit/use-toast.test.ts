// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import { useToast } from '@/hooks/useToast'

/**
 * hooks/useToast.ts — TRDD-2K08IAPV.
 *
 * These test the REAL hook, not a re-implementation of its logic in the test file: the defect
 * this hook consolidates was a hand-rolled copy diverging from its siblings, so a test that
 * re-hand-rolls the behaviour would reproduce the same class of bug it exists to prevent.
 *
 * The three cases that matter are the three the old copies got wrong or inconsistent:
 * replacement (a second toast must not inherit the first one's timer), manual dismiss (must
 * cancel the pending timer, or the toast "comes back off" a stale one), and unmount cleanup.
 */
describe('useToast', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('starts empty and shows what it is told, defaulting the type to info', () => {
    const { result } = renderHook(() => useToast())
    expect(result.current.toast).toBeNull()

    act(() => { result.current.showToast('saved') })
    expect(result.current.toast).toEqual({ message: 'saved', type: 'info' })
  })

  it('auto-dismisses after the default duration and not before', () => {
    const { result } = renderHook(() => useToast(3000))
    act(() => { result.current.showToast('saved', 'success') })

    // Sampling just BEFORE the deadline is the half that matters: without it a hook that
    // dismissed immediately would pass an "it is gone after 3000ms" assertion.
    act(() => { vi.advanceTimersByTime(2999) })
    expect(result.current.toast).toEqual({ message: 'saved', type: 'success' })

    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current.toast).toBeNull()
  })

  it('honours a per-call duration over the default', () => {
    const { result } = renderHook(() => useToast(3000))
    act(() => { result.current.showToast('slow one', 'error', 8000) })

    act(() => { vi.advanceTimersByTime(3000) })
    expect(result.current.toast).not.toBeNull()

    act(() => { vi.advanceTimersByTime(5000) })
    expect(result.current.toast).toBeNull()
  })

  it('gives a REPLACEMENT toast its own full duration — the MobileMessageCenter bug', () => {
    // The old copy called a bare setTimeout it never stored, so the first toast's timer stayed
    // armed and cleared the SECOND message after the first one's remaining time. Here: show at
    // t=0, replace at t=2000, and the replacement must survive past t=3000 (where the stale
    // timer would have fired) and die at t=5000.
    const { result } = renderHook(() => useToast(3000))
    act(() => { result.current.showToast('first') })
    act(() => { vi.advanceTimersByTime(2000) })

    act(() => { result.current.showToast('second') })
    act(() => { vi.advanceTimersByTime(1001) })
    expect(result.current.toast).toEqual({ message: 'second', type: 'info' })

    act(() => { vi.advanceTimersByTime(2000) })
    expect(result.current.toast).toBeNull()
  })

  it('dismiss() clears immediately AND cancels the pending timer', () => {
    const { result } = renderHook(() => useToast(3000))
    act(() => { result.current.showToast('first') })
    act(() => { result.current.dismiss() })
    expect(result.current.toast).toBeNull()

    // Show again inside the ORIGINAL toast's window. If dismiss() had left that timer armed it
    // would fire here and wrongly clear the new toast.
    act(() => { result.current.showToast('second') })
    act(() => { vi.advanceTimersByTime(1500) })
    expect(result.current.toast).toEqual({ message: 'second', type: 'info' })
  })

  it('clears its timer on unmount, so nothing fires at a dead component', () => {
    const { result, unmount } = renderHook(() => useToast(3000))
    act(() => { result.current.showToast('pending') })
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
