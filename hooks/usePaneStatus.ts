'use client'

/**
 * usePaneStatus — fast-poll the tmux pane state for a single session.
 *
 * Used by `TerminalView` to drive the security-lock overlay that
 * disables input while no AI program is running in the pane (during
 * wake-pending, post-`/exit` shell, or the restart gap). Polls every
 * 1.5s (much faster than the 10s `useAgents` cadence) so the lock
 * lifts within ~1.5s of `claude` appearing in the pane.
 *
 * Stops polling automatically when the document is hidden, and
 * resumes immediately on `visibilitychange` — so a backgrounded tab
 * doesn't burn cycles.
 */

import { useEffect, useRef, useState } from 'react'

export interface PaneStatus {
  paneCommand: string
  programRunning: boolean
  paneCurrentPath: string
}

export interface UsePaneStatusResult {
  /**
   * Latest pane status. `null` until the first response or if the
   * sessionId is empty/falsy.
   */
  status: PaneStatus | null
  /** True before the first response has arrived for the current sessionId. */
  loading: boolean
  /** Last fetch error (cleared on the next successful poll). */
  error: string | null
}

const POLL_INTERVAL_MS = 1500

export function usePaneStatus(sessionId: string | undefined | null): UsePaneStatusResult {
  const [status, setStatus] = useState<PaneStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const isMountedRef = useRef(true)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    isMountedRef.current = true
    return () => { isMountedRef.current = false }
  }, [])

  useEffect(() => {
    if (!sessionId) {
      setStatus(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setStatus(null)
    let timer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false

    const tick = async () => {
      if (cancelled) return
      if (typeof document !== 'undefined' && document.hidden) {
        // Skip while backgrounded — visibilitychange below resumes immediately.
        timer = setTimeout(tick, POLL_INTERVAL_MS)
        return
      }
      abortRef.current?.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/pane-status`, {
          method: 'GET',
          credentials: 'include',
          signal: ctrl.signal,
        })
        if (cancelled || !isMountedRef.current) return
        if (!res.ok) {
          // 404 on hibernated session is expected — treat as "not running".
          setStatus({ paneCommand: '', programRunning: false, paneCurrentPath: '' })
          setError(res.status === 404 ? null : `HTTP ${res.status}`)
        } else {
          const body = await res.json() as PaneStatus
          if (cancelled || !isMountedRef.current) return
          setStatus(body)
          setError(null)
        }
      } catch (err) {
        if (cancelled || !isMountedRef.current) return
        if ((err as { name?: string }).name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'pane-status poll failed')
      } finally {
        if (!cancelled && isMountedRef.current) {
          setLoading(false)
          timer = setTimeout(tick, POLL_INTERVAL_MS)
        }
      }
    }

    tick()
    const onVisibility = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        if (timer) { clearTimeout(timer); timer = null }
        tick()
      }
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility)
    }

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      abortRef.current?.abort()
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility)
      }
    }
  }, [sessionId])

  return { status, loading, error }
}
