'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { Agent, AgentsApiResponse } from '@/types/agent'
import type { UnregisteredSession } from '@/services/agents-core-service'
import type { Host } from '@/types/host'
import { useHosts } from './useHosts'
import { cacheRemoteAgents, getCachedAgents } from '@/lib/agent-cache'

const REFRESH_INTERVAL = 10000 // 10 seconds
const SELF_FETCH_TIMEOUT = 8000 // 8 seconds for self host (tmux queries can be slow)
const PEER_FETCH_TIMEOUT = 3000 // 3 seconds for peer hosts (fail fast, use cache)

/**
 * Check if a host URL points to localhost (the machine running this dashboard)
 * Used client-side since os.hostname() isn't available in browser
 */
function isLocalhostUrl(url: string | undefined): boolean {
  if (!url) return true
  const lowered = url.toLowerCase()
  return lowered.includes('localhost') || lowered.includes('127.0.0.1')
}

/**
 * Aggregated stats across all hosts
 */
interface AggregatedStats {
  total: number
  online: number
  offline: number
  unregistered: number
  cached: number // Number of agents loaded from cache
}

/**
 * Host fetch result
 */
interface HostFetchResult {
  hostId: string
  success: boolean
  response?: AgentsApiResponse
  error?: Error
  fromCache?: boolean
}

/**
 * Fetch agents from a specific host
 */
async function fetchHostAgents(host: Host): Promise<HostFetchResult> {
  const isSelf = host.isSelf || isLocalhostUrl(host.url)
  const baseUrl = isSelf ? '' : host.url
  const timeout = isSelf ? SELF_FETCH_TIMEOUT : PEER_FETCH_TIMEOUT

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    let response: Response
    try {
      response = await fetch(`${baseUrl}/api/agents`, {
        signal: controller.signal
      })
    } finally {
      clearTimeout(timeoutId)
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const data: AgentsApiResponse = await response.json()

    // Inject host info directly onto agents
    // For self host: use '' (relative URL) so browser fetches stay same-origin
    const agents = data.agents.map(agent => ({
      ...agent,
      hostId: host.id,
      hostName: host.name,
      hostUrl: isSelf ? '' : host.url
    }))

    // Cache peer host agents for offline access (not self host)
    if (!isSelf) {
      cacheRemoteAgents(host.id, agents)
    }

    return {
      hostId: host.id,
      success: true,
      response: {
        ...data,
        agents,
        hostInfo: {
          ...data.hostInfo,
          id: host.id,
          name: host.name,
          isSelf,
        }
      }
    }
  } catch (error) {
    // Proposal 29 (2026-04-20): log the actual URL used (same-origin
    // when isSelf, peer host otherwise) so operators aren't misled by
    // a Tailscale-looking URL string that wasn't the real target.
    console.error(`[useAgents] Failed to fetch from ${host.name} (${baseUrl || 'same-origin'}):`, error)

    // Try to use cached data for peer hosts (not self)
    if (!isSelf) {
      const cachedAgents = getCachedAgents(host.id)
      if (cachedAgents && cachedAgents.length > 0) {
        console.log(`[useAgents] Using cached data for ${host.name}`)
        return {
          hostId: host.id,
          success: true,
          fromCache: true,
          response: {
            agents: cachedAgents,
            stats: {
              total: cachedAgents.length,
              online: cachedAgents.filter(a => a.session?.status === 'online').length,
              offline: cachedAgents.filter(a => a.session?.status === 'offline').length,
              unregistered: 0
            },
            hostInfo: {
              id: host.id,
              name: host.name,
              url: host.url,
              isSelf: false,
            }
          }
        }
      }
    }

    return {
      hostId: host.id,
      success: false,
      error: error instanceof Error ? error : new Error('Unknown error')
    }
  }
}

/**
 * Aggregate results from multiple hosts
 */
function aggregateResults(results: HostFetchResult[]): {
  agents: Agent[]
  unregisteredSessions: UnregisteredSession[]
  stats: AggregatedStats
  hostErrors: Record<string, Error>
} {
  const allAgents: Agent[] = []
  const allUnregistered: UnregisteredSession[] = []
  const hostErrors: Record<string, Error> = {}
  let cachedCount = 0

  for (const result of results) {
    if (result.success && result.response) {
      allAgents.push(...result.response.agents)
      // Collect unregistered sessions from each host
      if (result.response.unregisteredSessions) {
        allUnregistered.push(...result.response.unregisteredSessions)
      }
      if (result.fromCache) {
        cachedCount += result.response.agents.length
      }
    } else if (result.error) {
      hostErrors[result.hostId] = result.error
    }
  }

  // Show ALL agents — never hide any. Previously _aim- prefixed agents were
  // hidden, which allowed zombie sessions to run undetected for days.

  // Sort: online first, then alphabetically by alias
  // Use [...].sort() instead of toSorted() for Safari iOS 15 compatibility
  const sortedAgents = [...allAgents].sort((a, b) => {
    // Online first
    if (a.session?.status === 'online' && b.session?.status !== 'online') return -1
    if (a.session?.status !== 'online' && b.session?.status === 'online') return 1

    // Then alphabetically by name (case-insensitive)
    const nameA = (a.name || '').toLowerCase()
    const nameB = (b.name || '').toLowerCase()
    return nameA.localeCompare(nameB)
  })

  // OPTIMIZED: Calculate stats in a single loop instead of multiple filter() calls
  // Reduces from 4 array iterations (3 filter + 1 length) to 1 iteration
  let online = 0
  let offline = 0
  for (const agent of sortedAgents) {
    if (agent.session?.status === 'online') online++
    if (agent.session?.status === 'offline') offline++
  }

  const stats: AggregatedStats = {
    total: sortedAgents.length,
    online,
    offline,
    unregistered: results.reduce((sum, r) =>
      sum + (r.response?.stats.unregistered || 0), 0),
    cached: cachedCount
  }

  return { agents: sortedAgents, unregisteredSessions: allUnregistered, stats, hostErrors }
}

/**
 * Hook to manage agents across multiple hosts
 *
 * Fetches agents from all configured hosts (local + remote) and aggregates them.
 * Supports hybrid caching: always tries live fetch first, falls back to cache for unreachable remotes.
 */
export function useAgents() {
  const { hosts, loading: hostsLoading } = useHosts()
  const [agents, setAgents] = useState<Agent[]>([])
  const [unregisteredSessions, setUnregisteredSessions] = useState<UnregisteredSession[]>([])
  const [stats, setStats] = useState<AggregatedStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [hostErrors, setHostErrors] = useState<Record<string, Error>>({})
  const hasLoadedOnce = useRef(false)
  const requestIdRef = useRef(0)
  // UI2-MAJ-14: track mount state. The requestIdRef guard prevents stale
  // RESPONSES from updating state, but it does NOT prevent the initial
  // setLoading(true) flicker or the finally{} setLoading(false) call from
  // firing on the unmounted component when navigating away during a poll.
  const isMountedRef = useRef(true)
  useEffect(() => {
    isMountedRef.current = true
    return () => { isMountedRef.current = false }
  }, [])

  const loadAgents = useCallback(async () => {
    if (hosts.length === 0) {
      return
    }

    const myRequestId = ++requestIdRef.current

    try {
      // UI2-MAJ-14: bail before any setState if the hook unmounted
      if (!isMountedRef.current) return
      setLoading(true)
      setError(null)
      setHostErrors({})

      const localHosts = hosts.filter(h => h.isSelf || isLocalhostUrl(h.url))
      const remoteHosts = hosts.filter(h => !h.isSelf && !isLocalhostUrl(h.url))

      // Fetch local host first (fast) so the UI can render immediately
      const localResults = await Promise.all(
        localHosts.map(host => fetchHostAgents(host))
      )

      // On first load only, show local agents right away so UI doesn't wait for remotes.
      // On subsequent refreshes, skip this to avoid replacing the full list with just local agents.
      if (remoteHosts.length > 0 && !hasLoadedOnce.current) {
        // Guard: a newer request superseded this one — abandon stale update
        if (requestIdRef.current !== myRequestId) return
        // UI2-MAJ-14: also guard by mount state
        if (!isMountedRef.current) return
        const { agents: localAgents, unregisteredSessions: localUnreg, stats: localStats, hostErrors: localErrors } = aggregateResults(localResults)
        setAgents(localAgents)
        setUnregisteredSessions(localUnreg)
        setStats(localStats)
        setHostErrors(localErrors)
        setLoading(false)
      }

      // Then fetch remote hosts in parallel (may be slow or timeout)
      const remoteResults = await Promise.all(
        remoteHosts.map(host => fetchHostAgents(host))
      )

      // Merge all results
      const allResults = [...localResults, ...remoteResults]
      const { agents: allAgents, unregisteredSessions: allUnreg, stats: aggregatedStats, hostErrors: errors } = aggregateResults(allResults)

      // Guard: a newer request superseded this one — abandon stale update
      if (requestIdRef.current !== myRequestId) return
      // UI2-MAJ-14: also guard by mount state
      if (!isMountedRef.current) return

      setAgents(allAgents)
      setUnregisteredSessions(allUnreg)
      setStats(aggregatedStats)
      setHostErrors(errors)
      hasLoadedOnce.current = true

      // Log summary
      // P3 polish (2026-04-30): downgraded from console.log to console.debug
      // because this fires every REFRESH_INTERVAL (10s) and dominates the
      // browser console during normal operation. Keep it discoverable for
      // operators who want it (Chrome DevTools "Verbose" level) without
      // drowning out genuine warnings/errors.
      const successCount = allResults.filter(r => r.success).length
      const fromCacheCount = allResults.filter(r => r.fromCache).length
      console.debug(`[useAgents] Loaded ${allAgents.length} agent(s) from ${successCount}/${hosts.length} host(s) (${fromCacheCount} from cache)`)

    } catch (err) {
      console.error('[useAgents] Failed to load agents:', err)
      // UI2-MAJ-14: gate setError by mount
      if (isMountedRef.current) {
        setError(err instanceof Error ? err : new Error('Unknown error'))
      }
    } finally {
      // UI2-MAJ-14: gate the always-fires setLoading(false) by mount
      if (isMountedRef.current) {
        setLoading(false)
      }
    }
  }, [hosts])

  const refreshAgents = useCallback(() => {
    loadAgents()
  }, [loadAgents])

  // Initial load when hosts are ready
  useEffect(() => {
    if (!hostsLoading && hosts.length > 0) {
      loadAgents()
    }
  }, [hostsLoading, hosts.length, loadAgents])

  // Auto-refresh via polling.
  //
  // UI2-MIN-10: pause polling when the document is hidden (user switched
  // tabs / minimized the window) and resume on visibility change. Browsers
  // already throttle setInterval in background tabs, but iOS Safari can
  // still fire reduced-frequency polls — and each poll fetches from N
  // hosts. Skipping the work entirely while hidden saves battery and
  // network. The visibilitychange listener triggers an immediate
  // loadAgents() on resume so the UI catches up to any changes that
  // happened while the tab was backgrounded.
  useEffect(() => {
    if (hostsLoading || hosts.length === 0) {
      return
    }

    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      loadAgents()
    }

    const interval = setInterval(tick, REFRESH_INTERVAL)

    const onVisibilityChange = () => {
      if (typeof document !== 'undefined' && !document.hidden) {
        // Tab became visible — refresh immediately rather than waiting
        // up to REFRESH_INTERVAL for the next polling tick.
        loadAgents()
      }
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange)
    }

    return () => {
      clearInterval(interval)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange)
      }
    }
  }, [hostsLoading, hosts.length, loadAgents])

  // Instant refresh via /status WebSocket — listens for agent_data_update
  // broadcasts from Change* AIO functions (avatar, name, title, etc.)
  useEffect(() => {
    if (hostsLoading || hosts.length === 0) return

    let ws: WebSocket | null = null
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      ws = new WebSocket(`${protocol}//${window.location.host}/status`)
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'agent_data_update') {
            loadAgents()
          }
        } catch { /* ignore parse errors */ }
      }
    } catch { /* WebSocket not available */ }

    return () => { ws?.close() }
  }, [hostsLoading, hosts.length, loadAgents])

  // Computed: agents that are currently online (have active session)
  const onlineAgents = useMemo(
    () => agents.filter(a => a.session?.status === 'online'),
    [agents]
  )

  // Computed: agents that are offline
  const offlineAgents = useMemo(
    () => agents.filter(a => a.session?.status === 'offline'),
    [agents]
  )

  // Orphan agents no longer exist — unregistered sessions are returned separately by the API
  const orphanAgents: Agent[] = []

  // Computed: cached agents (loaded from cache because remote was unreachable)
  const cachedAgents = useMemo(
    () => agents.filter(a => a._cached),
    [agents]
  )

  // Computed: group agents by first tag (level 1 grouping)
  const agentsByGroup = useMemo(() => {
    const groups: Record<string, Agent[]> = {}

    for (const agent of agents) {
      const group = agent.tags?.[0] || 'ungrouped'
      if (!groups[group]) {
        groups[group] = []
      }
      groups[group].push(agent)
    }

    // Sort agents within each group by status (online first), then by name
    // Use [...].sort() instead of toSorted() for Safari iOS 15 compatibility
    for (const group in groups) {
      groups[group] = [...groups[group]].sort((a, b) => {
        if (a.session?.status === 'online' && b.session?.status !== 'online') return -1
        if (a.session?.status !== 'online' && b.session?.status === 'online') return 1
        const nameA = a.name || ''
        const nameB = b.name || ''
        return nameA.localeCompare(nameB)
      })
    }

    return groups
  }, [agents])

  // Computed: group agents by host
  const agentsByHost = useMemo(() => {
    const byHost: Record<string, Agent[]> = {}

    for (const agent of agents) {
      const hostId = agent.hostId || 'unknown-host'
      if (!byHost[hostId]) {
        byHost[hostId] = []
      }
      byHost[hostId].push(agent)
    }

    return byHost
  }, [agents])

  // Find agent by ID
  const getAgent = useCallback(
    (id: string) => agents.find(a => a.id === id) || null,
    [agents]
  )

  // Find agent by session name
  const getAgentBySession = useCallback(
    (sessionName: string) => agents.find(a => a.session?.tmuxSessionName === sessionName) || null,
    [agents]
  )

  // Check if any hosts had errors
  const hasHostErrors = useMemo(
    () => Object.keys(hostErrors).length > 0,
    [hostErrors]
  )

  return {
    // Data
    agents,
    unregisteredSessions,
    stats,
    loading: loading || hostsLoading,
    error,
    hostErrors,
    hasHostErrors,

    // Computed lists
    onlineAgents,
    offlineAgents,
    orphanAgents,
    cachedAgents,
    agentsByGroup,
    agentsByHost,

    // Methods
    refreshAgents,
    getAgent,
    getAgentBySession,
  }
}
