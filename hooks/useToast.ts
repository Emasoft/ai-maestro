import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * One transient auto-dismissing toast per owner (TRDD-2K08IAPV).
 *
 * WHY THIS EXISTS. The pattern — a `useState<Toast | null>` plus a `setTimeout` that clears it —
 * was hand-rolled independently in four places, each with its own duration (8000 / 4000 / 3000 /
 * 3000 ms) and its own idea of cleanup. Three of the copies were merely divergent. The fourth,
 * `MobileMessageCenter`, was WRONG: its `showToast` called a bare `setTimeout` it never stored,
 * so a second toast inherited the first one's still-pending timer and was cleared early, and an
 * unmount mid-toast left a timer that fired `setToast` on a dead component. Consolidating is
 * therefore a bug fix, not only tidiness — which is the reason this hook OWNS the timer rather
 * than leaving each caller to remember it.
 *
 * Deliberately NOT a provider/queue. Every current call site shows one message at a time from one
 * component, so a context + stacking model would be machinery no caller asked for. A later caller
 * that genuinely needs stacking should add it then, with a real second consumer to shape it.
 */
export type ToastType = 'success' | 'error' | 'info'

export interface Toast {
  message: string
  type: ToastType
}

export interface UseToastResult {
  /** The visible toast, or null. */
  toast: Toast | null
  /** Show a toast, replacing any current one and restarting the timer. */
  showToast: (message: string, type?: ToastType, durationMs?: number) => void
  /** Dismiss now (a close button), cancelling the pending timer. */
  dismiss: () => void
}

/** @param defaultDurationMs auto-dismiss delay when a call does not override it. */
export function useToast(defaultDurationMs = 3000): UseToastResult {
  const [toast, setToast] = useState<Toast | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clearing through the ref is what makes a REPLACEMENT safe: without it the previous toast's
  // timer stays armed and dismisses the new message after the old one's remaining time.
  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const dismiss = useCallback(() => {
    clearTimer()
    setToast(null)
  }, [clearTimer])

  const showToast = useCallback(
    (message: string, type: ToastType = 'info', durationMs: number = defaultDurationMs) => {
      clearTimer()
      setToast({ message, type })
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        setToast(null)
      }, durationMs)
    },
    [clearTimer, defaultDurationMs],
  )

  // Unmount cleanup. Not optional: a pending timer that fires after unmount calls setState on a
  // dead component, which is the second half of the MobileMessageCenter defect above.
  useEffect(() => clearTimer, [clearTimer])

  return { toast, showToast, dismiss }
}
