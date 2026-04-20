/**
 * useClientAvailability — probe whether an AI-client binary is on the
 * server's PATH.
 *
 * Primary consumer: the sidebar HELPERS section (`components/AgentList.tsx`)
 * that hides the Haephestos card when `claude` is unavailable, per user
 * directive (2026-04-20) "haephestos will never show on systems where
 * no claude code is installed".
 *
 * Caching: result is cached in-memory per (client, mount). The endpoint
 * is fast (~10 ms on a hot system) and returns `Cache-Control: no-store`
 * so we re-probe on explicit `refresh()`. We do NOT poll — the system
 * tracker (#242) handles durable change detection via ledger entries.
 * For near-real-time availability swaps the future websocket push work
 * (#245 when that feature branch reopens) will call `refresh()`.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export interface ClientAvailability {
  client: string
  available: boolean
  path?: string
  version?: string
  checkedAt: string
}

interface UseClientAvailabilityResult {
  data: ClientAvailability | null
  loading: boolean
  error: string | null
  /** Force a fresh probe. */
  refresh: () => void
}

export function useClientAvailability(client: string): UseClientAvailabilityResult {
  const [data, setData] = useState<ClientAvailability | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // useRef instead of state so triggering `refresh()` doesn't cause
  // a stale-closure re-fetch when the parent component re-mounts.
  const nonceRef = useRef(0)

  const fetchIt = useCallback(async (nonce: number) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/system/client-availability?client=${encodeURIComponent(client)}`)
      if (nonce !== nonceRef.current) return  // stale probe — ignore
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        setError(body.error || `Probe failed (HTTP ${res.status})`)
        setData(null)
        return
      }
      const payload = (await res.json()) as ClientAvailability
      setData(payload)
    } catch (err) {
      if (nonce !== nonceRef.current) return
      setError(err instanceof Error ? err.message : 'Probe failed')
      setData(null)
    } finally {
      if (nonce === nonceRef.current) setLoading(false)
    }
  }, [client])

  const refresh = useCallback(() => {
    const next = ++nonceRef.current
    fetchIt(next)
  }, [fetchIt])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { data, loading, error, refresh }
}
