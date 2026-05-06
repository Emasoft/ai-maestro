'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { ExportType, ExportJob, ExportJobStatus, ExportOptions } from '@/types/export'

/**
 * Polling interval for export job progress (in milliseconds)
 */
const EXPORT_POLL_INTERVAL_MS = 1000

/**
 * Maximum polling duration before giving up (in milliseconds)
 */
const EXPORT_MAX_POLL_DURATION_MS = 300000 // 5 minutes

/**
 * Hook for managing transcript exports
 *
 * Handles export job creation, progress tracking, and status polling
 * for long-running transcript export operations.
 *
 * @param agentId - Agent ID to export from
 */
export function useTranscriptExport(agentId: string) {
  const [jobs, setJobs] = useState<ExportJob[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [activeJobId, setActiveJobId] = useState<string | null>(null)

  // Mirror activeJobId in a ref so polling callbacks read the latest value
  // without stale closure issues
  const activeJobIdRef = useRef<string | null>(null)

  // Refs for polling timers and tracking
  const pollTimersRef = useRef<Record<string, NodeJS.Timeout>>({})
  const isMountedRef = useRef(true)

  // Keep the ref in sync with state so polling closures always see the latest value
  useEffect(() => {
    activeJobIdRef.current = activeJobId
  }, [activeJobId])

  /**
   * Reset jobs when the agent changes.
   *
   * UI2-MIN-07: this used to be called `loadJobs` and was documented as a
   * stub that would later "load from database or file system". In practice
   * AI Maestro tracks export jobs only in this hook's local state — there
   * is no persistent backend store for export history yet — so the function
   * is just a session-scoped reset, NOT a load. The mount-effect that calls
   * it on agentId change is still legitimate: switching agents must clear
   * the previous agent's optimistic job entries from the panel.
   *
   * If a future commit adds persistent export-job storage, RENAME this back
   * to `loadJobs` and replace the body with a real fetch. Until then, the
   * literal name `resetJobs` matches what the function actually does and
   * avoids misleading future maintainers into thinking they can rely on
   * job history being restored across page reloads.
   */
  const loadJobs = useCallback(async () => {
    try {
      console.log(`[useTranscriptExport] Resetting jobs for agent ${agentId} (no persistent store yet)`)
      setJobs([])
    } catch (err) {
      if (!isMountedRef.current) return

      console.error('[useTranscriptExport] Failed to reset jobs:', err)
      setError(err instanceof Error ? err : new Error('Failed to reset export jobs'))
    }
  }, [agentId])

  /**
   * Create a new export job
   */
  const exportTranscript = useCallback(async (
    format: ExportType,
    options: Partial<ExportOptions> = {}
  ) => {
    setLoading(true)
    setError(null)

    try {
      console.log(`[useTranscriptExport] Creating export job for agent ${agentId}, format: ${format}`)

      const exportRequest = {
        agentId,
        format,
        ...options
      }

      const response = await fetch(`/api/agents/${agentId}/export`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(exportRequest)
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()

      if (!data.success || !data.job) {
        throw new Error('Failed to create export job')
      }

      const newJob: ExportJob = data.job

      if (!isMountedRef.current) return

      setJobs(prev => [...prev, newJob])
      setActiveJobId(newJob.id)

      // Start polling for job progress
      startPolling(newJob.id)

      console.log(`[useTranscriptExport] Created export job ${newJob.id}`)
    } catch (err) {
      if (!isMountedRef.current) return

      console.error('[useTranscriptExport] Failed to create export job:', err)
      setError(err instanceof Error ? err : new Error('Failed to create export job'))
    } finally {
      if (isMountedRef.current) {
        setLoading(false)
      }
    }
  }, [agentId])

  /**
   * Start polling for a specific export job's progress.
   *
   * UI2-MAJ-21: Concurrent jobs are SUPPORTED BY DESIGN. If the user
   * triggers job A then job B, BOTH polls run in parallel — the
   * pollTimersRef map keys by jobId so each has its own interval. Polls
   * stop only when (a) the job reaches `completed` / `failed`, (b) the
   * fetch errors out, (c) the EXPORT_MAX_POLL_DURATION_MS cap is hit,
   * or (d) the component unmounts (cleanup at line ~287 clears the
   * whole map). `activeJobId` is single-valued and tracks only the
   * MOST RECENTLY started job, but other jobs continue polling and
   * updating their entry in the `jobs` state. Long-running jobs the
   * user has navigated past therefore stay polling until they finish
   * or hit the time cap. If concurrent-poll bookkeeping ever becomes
   * a memory issue, add an explicit cancelOtherPolls flag to this
   * function. Today, the user-driven export flow rarely starts more
   * than 1-2 jobs at a time and each finishes within seconds, so the
   * leak budget is bounded.
   */
  const startPolling = useCallback((jobId: string) => {
    if (pollTimersRef.current[jobId]) {
      clearInterval(pollTimersRef.current[jobId])
    }

    const startTime = Date.now()

    const pollInterval = setInterval(async () => {
      // Check max duration
      if (Date.now() - startTime > EXPORT_MAX_POLL_DURATION_MS) {
        clearInterval(pollInterval)
        delete pollTimersRef.current[jobId]
        console.warn(`[useTranscriptExport] Polling timeout for job ${jobId}`)
        return
      }

      try {
        const response = await fetch(`/api/export/jobs/${jobId}`)

        if (!response.ok) {
          clearInterval(pollInterval)
          delete pollTimersRef.current[jobId]
          return
        }

        const data = await response.json()

        if (!isMountedRef.current) return

        setJobs(prev => {
          return prev.map(job => {
            if (job.id === jobId) {
              return { ...job, ...data.job }
            }
            return job
          })
        })

        // Stop polling if job is completed or failed
        if (data.job.status === 'completed' || data.job.status === 'failed') {
          clearInterval(pollInterval)
          delete pollTimersRef.current[jobId]
          // Only clear activeJobId if this finishing job is actually the active one.
          // Reading from the ref avoids stale closure — activeJobIdRef always has
          // the latest value, unlike the captured state variable.
          if (activeJobIdRef.current === jobId) {
            setActiveJobId(null)
          }
          console.log(`[useTranscriptExport] Job ${jobId} finished with status ${data.job.status}`)
        }
      } catch (err) {
        console.error(`[useTranscriptExport] Failed to poll job ${jobId}:`, err)
        clearInterval(pollInterval)
        delete pollTimersRef.current[jobId]

        // Update job status to 'failed' so the UI reflects the polling failure
        // instead of leaving the job stuck in 'processing' forever
        if (isMountedRef.current) {
          const pollError = err instanceof Error ? err : new Error(`Polling failed for job ${jobId}`)
          setJobs(prev => prev.map(job =>
            job.id === jobId
              ? { ...job, status: 'failed' as const, error: pollError.message }
              : job
          ))
          setError(pollError)
          setActiveJobId(prev => prev === jobId ? null : prev)
        }
      }
    }, EXPORT_POLL_INTERVAL_MS)

    pollTimersRef.current[jobId] = pollInterval
  }, [])

  /**
   * Cancel an export job
   */
  const cancelJob = useCallback(async (jobId: string) => {
    try {
      console.log(`[useTranscriptExport] Cancelling job ${jobId}`)

      const response = await fetch(`/api/export/jobs/${jobId}`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`)
      }

      if (!isMountedRef.current) return

      // Stop polling if active
      if (pollTimersRef.current[jobId]) {
        clearInterval(pollTimersRef.current[jobId])
        delete pollTimersRef.current[jobId]
      }

      // Remove job from list
      setJobs(prev => prev.filter(job => job.id !== jobId))

      // Use functional update to avoid stale closure over activeJobId
      setActiveJobId(prev => prev === jobId ? null : prev)

      console.log(`[useTranscriptExport] Cancelled job ${jobId}`)
    } catch (err) {
      if (!isMountedRef.current) return

      console.error('[useTranscriptExport] Failed to cancel job:', err)
      setError(err instanceof Error ? err : new Error('Failed to cancel export job'))
    }
  }, [])

  /**
   * Clear completed or failed jobs
   */
  const clearCompletedJobs = useCallback(() => {
    setJobs(prev => prev.filter(job => 
      job.status === 'pending' || job.status === 'processing'
    ))
  }, [])

  /**
   * Active jobs (pending or processing) — derived from jobs state.
   * Using useMemo instead of useCallback because these are computed values,
   * not callbacks. useCallback on synchronous state getters creates new
   * function identities on every jobs change without providing memoization
   * benefit when the results are consumed immediately in render.
   */
  const activeJobs = useMemo((): ExportJob[] => {
    return jobs.filter(job =>
      job.status === 'pending' || job.status === 'processing'
    )
  }, [jobs])

  /**
   * Get job by ID — plain function, no memoization needed since callers
   * use it imperatively (not as a dependency or prop)
   */
  const getJob = (jobId: string): ExportJob | undefined => {
    return jobs.find(job => job.id === jobId)
  }

  /**
   * Get jobs by status — plain function for imperative use
   */
  const getJobsByStatus = (status: ExportJobStatus): ExportJob[] => {
    return jobs.filter(job => job.status === status)
  }

  /**
   * Cleanup polling timers on agentId change or unmount.
   * Without agentId in the deps, switching agents would leave orphaned
   * intervals polling for the previous agent's export jobs indefinitely.
   */
  useEffect(() => {
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false

      // Clear all polling timers
      for (const jobId in pollTimersRef.current) {
        clearInterval(pollTimersRef.current[jobId])
      }
      pollTimersRef.current = {}
    }
  }, [agentId])

  /**
   * Load jobs on mount
   */
  useEffect(() => {
    loadJobs()
  }, [loadJobs])

  return {
    // State
    jobs,
    loading,
    error,
    activeJobId,

    // Computed (memoized)
    activeJobs,

    // Actions
    exportTranscript,
    cancelJob,
    clearCompletedJobs,
    getJob,
    getJobsByStatus
  }
}
