'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { Team } from '@/types/team'

interface UseTeamResult {
  team: Team | null
  loading: boolean
  error: string | null
  updateTeam: (updates: { name?: string; description?: string; agentIds?: string[]; instructions?: string }) => Promise<void>
  refreshTeam: () => Promise<void>
}

export function useTeam(teamId: string | null): UseTeamResult {
  const [team, setTeam] = useState<Team | null>(null)
  const [loading, setLoading] = useState(!!teamId)  // Start true only when teamId is provided, preventing "Team not found" flash
  const [error, setError] = useState<string | null>(null)
  // BUG-2 fix: Track mount status to avoid React state updates after unmount
  const isMountedRef = useRef(true)
  useEffect(() => {
    return () => { isMountedRef.current = false }
  }, [])

  // MF-005: Accept optional AbortSignal to cancel stale fetches on unmount/teamId change
  const fetchTeam = useCallback(async (signal?: AbortSignal) => {
    if (!teamId) return
    setError(null) // CC-008: Clear stale error at start so UI doesn't show old error during fetch
    try {
      const res = await fetch(`/api/teams/${teamId}`, { signal })
      if (!res.ok) throw new Error('Failed to fetch team')
      const data = await res.json()
      // MF-005: Guard against setting state after abort
      if (signal?.aborted) return
      setTeam(data.team || null)
    } catch (err) {
      // MF-005: Silently ignore AbortError — expected when component unmounts or teamId changes
      if (err instanceof DOMException && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'Failed to fetch team')
    }
  }, [teamId])

  // Initial fetch with AbortController for cleanup on unmount/teamId change
  useEffect(() => {
    if (!teamId) {
      setTeam(null)
      setLoading(false)
      return
    }
    // MF-005: AbortController cancels in-flight fetch when teamId changes or component unmounts
    const controller = new AbortController()
    setLoading(true)
    fetchTeam(controller.signal).finally(() => {
      // Always clear loading — skipping on abort traps UI in permanent loading state.
      // The abort guard in fetchTeam's .then() already prevents stale data updates;
      // loading=false is always safe and needed to unblock the UI.
      setLoading(false)
    })
    return () => controller.abort()
  }, [teamId, fetchTeam])

  // CC-010: updateTeam throws on error to allow callers to handle in try/catch.
  // This is a deliberate pattern — unlike useGovernance which returns { success, error } objects.
  const updateTeam = useCallback(async (updates: { name?: string; description?: string; agentIds?: string[]; instructions?: string }) => {
    if (!teamId) return
    // CC-007: Optimistic update — pick only valid team-update keys before spreading.
    // Structural typing could allow extra keys at runtime; explicit key filtering prevents
    // unexpected properties from polluting the team object. Server is the authority.
    // CC-P1-709: Include 'instructions' so optimistic update applies it immediately in the UI
    // SF-044: Only include keys that match the updateTeam function signature — 'type', 'chiefOfStaffId',
    // 'managerId' are not accepted by updateTeam and should not be optimistically applied
    const validKeys = ['name', 'description', 'agentIds', 'instructions'] as const
    const safeUpdates = Object.fromEntries(
      Object.entries(updates).filter(([k]) => (validKeys as readonly string[]).includes(k))
    )
    setTeam(prev => prev ? { ...prev, ...safeUpdates, updatedAt: new Date().toISOString() } : prev)
    try {
      // SCEN-002 BUG-002 fix: Do NOT send `lastActivityAt` in the PUT body.
      // The server's UpdateTeamSchema (app/api/teams/[id]/route.ts) uses .strict()
      // and does not include `lastActivityAt`, so including it here caused EVERY
      // team update from this hook to fail with HTTP 400 "Validation failed".
      // lastActivityAt is a server-side concern and should be updated by the API,
      // not dictated by the client.
      const res = await fetch(`/api/teams/${teamId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!res.ok) {
        // CC-004: Don't call fetchTeam() here — the throw propagates to the catch block
        // which already calls fetchTeam() to revert the optimistic update
        // SCEN-002 BUG-001 fix: Surface specific server-side error (e.g. R4.7 "Cannot remove
        // the Chief-of-Staff from team members") instead of the generic "Failed to update team".
        // This helps users understand WHY the operation was rejected.
        let serverMessage: string | null = null
        try {
          const body = await res.json()
          serverMessage = body?.error || body?.message || null
        } catch {
          // Body wasn't JSON — fall through with generic message
        }
        throw new Error(serverMessage || `Failed to update team (HTTP ${res.status})`)
      }
      const data = await res.json()
      setTeam(data.team)
    } catch (err) {
      // BUG-1 fix: If fetchTeam() throws its own error, the original err would be masked
      // and throw err would never execute. Swallow fetchTeam errors to guarantee propagation.
      await fetchTeam().catch(() => {})  // Revert optimistic update; ignore revert failures
      throw err
    }
  }, [teamId, fetchTeam])

  // CC-005: refreshTeam wraps fetchTeam with loading state for consistent UX
  // Stable reference via useCallback — inline closures in the return object create new
  // references every render, breaking React.memo on consumers of this hook
  const refreshTeam = useCallback(async () => {
    if (isMountedRef.current) setLoading(true)
    try {
      await fetchTeam()
    } finally {
      if (isMountedRef.current) setLoading(false)
    }
  }, [fetchTeam])

  return {
    team,
    loading,
    error,
    updateTeam,
    // CC-005: refreshTeam wraps fetchTeam with loading state for consistent UX
    // BUG-2 fix: Guard setLoading with isMountedRef to prevent React warnings on unmounted component
    // Wrapped in useCallback to provide a stable reference — inline closures break React.memo consumers
    refreshTeam,
  }
}
