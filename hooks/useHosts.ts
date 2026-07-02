'use client'

import { useEffect, useRef, useState } from 'react'
import type { Host } from '@/types/host'

const HOSTS_FETCH_TIMEOUT = 5000 // 5 seconds for local hosts list

/**
 * Hook to fetch and manage configured hosts
 */
export function useHosts() {
  const [hosts, setHosts] = useState<Host[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  // Guard against setState after unmount — AbortController is now in effect
  // scope so it is properly aborted on cleanup, and isMountedRef catches any
  // edge cases where the response arrives between abort and error handler
  const isMountedRef = useRef(true)
  useEffect(() => { return () => { isMountedRef.current = false } }, [])

  useEffect(() => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), HOSTS_FETCH_TIMEOUT)

    const fetchHosts = async () => {
      try {
        if (isMountedRef.current) setLoading(true)

        const response = await fetch('/api/hosts', {
          signal: controller.signal
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
          throw new Error('Failed to fetch hosts')
        }

        const data = await response.json()
        if (isMountedRef.current) {
          setHosts(data.hosts || [])
          setError(null)
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          console.error('Hosts fetch timed out after', HOSTS_FETCH_TIMEOUT, 'ms')
          if (isMountedRef.current) setError(new Error('Hosts fetch timed out'))
        } else if (isMountedRef.current) {
          console.error('Failed to fetch hosts:', err)
          setError(err instanceof Error ? err : new Error('Unknown error'))
        }
      } finally {
        if (isMountedRef.current) setLoading(false)
      }
    }

    fetchHosts()

    return () => {
      clearTimeout(timeoutId)
      controller.abort()
    }
  }, [])

  return { hosts, loading, error }
}
