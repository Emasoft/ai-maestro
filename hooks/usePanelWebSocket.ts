'use client'

/**
 * TRDD-229CJGYH — client hook for the HTML side-panel WebSocket (/panel-ws).
 *
 * Lives at the PAGE level (per active agent), NOT inside the panel component:
 * the panel tab only mounts when selected, but a plugin's `panel:open` must be
 * able to switch the dashboard TO the panel tab — so the listener has to be
 * alive on every tab. Single-active-agent rendering means this is exactly one
 * WS per dashboard window.
 *
 * State model: content (html XOR url) + a refresh nonce + open/close signals.
 * The signals are monotonically increasing counters rather than a boolean so
 * the consumer can react to EVERY open/close command in a useEffect even when
 * two arrive back-to-back (a boolean that is already true would not re-fire).
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export interface PanelContentState {
  html: string | null
  url: string | null
  /** bumped by panel:refresh (and every content change) — key the iframe on it */
  nonce: number
  /** bumped by panel:open and by panel:set-html carrying content */
  openSignal: number
  /** bumped by panel:close */
  closeSignal: number
  connected: boolean
}

const INITIAL: PanelContentState = {
  html: null,
  url: null,
  nonce: 0,
  openSignal: 0,
  closeSignal: 0,
  connected: false,
}

export function usePanelWebSocket(agentId: string | null): {
  panel: PanelContentState
  sendFeedback: (payload: unknown) => void
} {
  const [panel, setPanel] = useState<PanelContentState>(INITIAL)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (!agentId) return

    let disposed = false
    let ws: WebSocket | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    const connect = () => {
      if (disposed) return
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(`${proto}://${window.location.host}/panel-ws?agent=${encodeURIComponent(agentId)}`)
      wsRef.current = ws

      ws.onopen = () => setPanel((p) => ({ ...p, connected: true }))

      ws.onmessage = (event) => {
        let data: { type?: string; html?: string; url?: string }
        try {
          data = JSON.parse(event.data)
        } catch {
          return
        }
        switch (data.type) {
          case 'panel:set-html':
            setPanel((p) => ({
              ...p,
              html: typeof data.html === 'string' ? data.html : null,
              url: typeof data.url === 'string' ? data.url : null,
              nonce: p.nonce + 1,
              openSignal: p.openSignal + 1,
            }))
            break
          case 'panel:open':
            setPanel((p) => ({
              ...p,
              // open may carry fresh content; without it, show what's already set
              ...(typeof data.html === 'string' && { html: data.html, url: null, nonce: p.nonce + 1 }),
              ...(typeof data.url === 'string' && { url: data.url, html: null, nonce: p.nonce + 1 }),
              openSignal: p.openSignal + 1,
            }))
            break
          case 'panel:close':
            setPanel((p) => ({ ...p, closeSignal: p.closeSignal + 1 }))
            break
          case 'panel:refresh':
            setPanel((p) => ({ ...p, nonce: p.nonce + 1 }))
            break
        }
      }

      ws.onclose = () => {
        setPanel((p) => ({ ...p, connected: false }))
        wsRef.current = null
        // Modest fixed backoff: the panel is a secondary channel — no need for
        // the aggressive multi-step strategy the terminal WS uses.
        if (!disposed) retryTimer = setTimeout(connect, 3000)
      }

      ws.onerror = () => {
        try { ws?.close() } catch { /* already closing */ }
      }
    }

    connect()

    return () => {
      disposed = true
      if (retryTimer) clearTimeout(retryTimer)
      try { ws?.close() } catch { /* ignore */ }
      wsRef.current = null
      setPanel(INITIAL)
    }
  }, [agentId])

  const sendFeedback = useCallback((payload: unknown) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'panel:feedback', payload }))
      } catch { /* connection died between check and send — feedback is best-effort */ }
    }
  }, [])

  return { panel, sendFeedback }
}
