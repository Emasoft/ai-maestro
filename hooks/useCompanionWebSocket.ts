'use client'

import { useEffect, useRef, useCallback } from 'react'

interface UseCompanionWebSocketOptions {
  agentId: string | null
  onSpeech: (text: string) => void
}

/**
 * Hook for bidirectional communication with the server's cerebellum voice subsystem.
 * Connects to /companion-ws?agent={agentId}, receives speech events,
 * and can send user messages back to the voice subsystem.
 */
export function useCompanionWebSocket({ agentId, onSpeech }: UseCompanionWebSocketOptions) {
  const onSpeechRef = useRef(onSpeech)
  onSpeechRef.current = onSpeech

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const send = useCallback((data: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify(data))
      } catch {
        // Ignore send errors
      }
    }
  }, [])

  useEffect(() => {
    if (!agentId) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/companion-ws?agent=${encodeURIComponent(agentId)}`

    let ws: WebSocket | null = null
    let mounted = true
    let retryCount = 0
    const maxRetries = 5
    const retryDelays = [1000, 2000, 3000, 5000, 10000]

    function connect() {
      if (!mounted) return

      // `sock` is captured per-connection so a handler can tell whether IT is
      // still the live socket (the outer `ws` is reassigned on reconnect).
      const sock = new WebSocket(wsUrl)
      ws = sock
      wsRef.current = sock

      sock.onopen = () => {
        retryCount = 0
        console.log('[CompanionWS] Connected for agent', agentId?.substring(0, 8))
      }

      sock.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'speech' && data.text) {
            onSpeechRef.current(data.text)
          }
        } catch {
          // Ignore non-JSON messages
        }
      }

      sock.onclose = (event) => {
        // TRDD-6A2I6ZO0: switching the active agent tears this effect down and
        // re-runs it at once, so the OLD socket's close lands AFTER the new one
        // is already in wsRef. Nulling the ref unconditionally there wiped the
        // live socket and send() silently no-op'd forever after. (Verified as a
        // real, silent failure in the panel channel, which had this same code;
        // fixed here by inspection — same defect, same shape.)
        if (wsRef.current !== sock) return
        wsRef.current = null
        // Only reconnect on abnormal closes — skip graceful disconnects (1000 normal, 1001 going away)
        if (mounted && retryCount < maxRetries && event.code !== 1000 && event.code !== 1001) {
          const delay = retryDelays[retryCount] || retryDelays[retryDelays.length - 1]
          retryCount++
          reconnectTimerRef.current = setTimeout(connect, delay)
        }
      }

      sock.onerror = () => {
        // onclose will handle reconnection
      }
    }

    connect()

    return () => {
      // UI2-MAJ-23: ORDER MATTERS. `mounted = false` MUST run BEFORE
      // `ws.close()` so that if the close event fires synchronously
      // (e.g. on macOS Safari where event.code 1005 is delivered before
      // close() returns), the onclose handler sees mounted=false and
      // skips the reconnect schedule. Reordering these lines re-opens
      // a race where ws.onclose fires with mounted=true and queues a
      // reconnect timer that the cleanup THEN clears — but only if the
      // reconnectTimerRef.current assignment happened before cleanup
      // runs the clearTimeout. Don't move these lines apart.
      mounted = false
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      if (ws) {
        ws.close()
        ws = null
      }
      wsRef.current = null
    }
  }, [agentId])

  return { send }
}
