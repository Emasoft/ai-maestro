'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { TaskWithDeps, TaskStatus } from '@/types/task'

interface UseTasksResult {
  tasks: TaskWithDeps[]
  loading: boolean
  error: string | null
  pendingTasks: TaskWithDeps[]
  inProgressTasks: TaskWithDeps[]
  completedTasks: TaskWithDeps[]
  tasksByStatus: Record<string, TaskWithDeps[]>
  tasksByAgent: Record<string, TaskWithDeps[]>
  createTask: (data: { subject: string; description?: string; assigneeAgentId?: string; blockedBy?: string[]; priority?: number; status?: string; labels?: string[]; taskType?: string; externalRef?: string }) => Promise<void>
  updateTask: (taskId: string, updates: { subject?: string; description?: string; status?: TaskStatus; assigneeAgentId?: string | null; blockedBy?: string[]; priority?: number; labels?: string[]; taskType?: string; externalRef?: string; externalProjectRef?: string; previousStatus?: string; acceptanceCriteria?: string[]; handoffDoc?: string; prUrl?: string; reviewResult?: string }) => Promise<{ unblocked: TaskWithDeps[] }>
  deleteTask: (taskId: string) => Promise<void>
  assignTask: (taskId: string, agentId: string | null) => Promise<void>
  refreshTasks: () => Promise<void>
}

export function useTasks(teamId: string | null): UseTasksResult {
  const [tasks, setTasks] = useState<TaskWithDeps[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  // UI2-MAJ-09 + UI2-MAJ-10: track mount state so async callbacks (fetchTasks
  // refresh on rapid teamId change, optimistic-update revert paths in
  // create/update/deleteTask) don't fire setState on the unmounted component.
  // Mirrors the pattern in useDocuments.ts and useTeam.ts.
  const isMountedRef = useRef(true)
  useEffect(() => {
    isMountedRef.current = true
    return () => { isMountedRef.current = false }
  }, [])

  const fetchTasks = useCallback(async (signal?: AbortSignal) => {
    if (!teamId) return
    try {
      const res = await fetch(`/api/teams/${teamId}/tasks`, signal ? { signal } : undefined)
      if (!res.ok) throw new Error('Failed to fetch tasks')
      const data = await res.json()
      if (!isMountedRef.current) return
      setTasks(data.tasks || [])
      setError(null)
    } catch (err) {
      // MF-019: ignore abort errors — they are expected on teamId change
      if (err instanceof Error && err.name === 'AbortError') return
      if (!isMountedRef.current) return
      setError(err instanceof Error ? err.message : 'Failed to fetch tasks')
    }
  }, [teamId])

  // Initial fetch — MF-019: use AbortController so stale inflight fetches are cancelled on teamId change
  useEffect(() => {
    if (!teamId) {
      setTasks([])
      return
    }
    const controller = new AbortController()
    setLoading(true)
    fetchTasks(controller.signal).finally(() => {
      if (!isMountedRef.current) return
      setLoading(false)
    })
    return () => { controller.abort() }
  }, [teamId, fetchTasks])

  // Poll every 5s for multi-tab sync
  // MF-025: Use AbortController so in-flight poll fetches are cancelled on unmount/teamId change.
  // Without this, setTasks fires after unmount if a fetch resolves after cleanup.
  useEffect(() => {
    if (!teamId) return
    const controller = new AbortController()
    intervalRef.current = setInterval(() => fetchTasks(controller.signal), 5000)
    return () => {
      controller.abort()
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [teamId, fetchTasks])

  const createTask = useCallback(async (data: { subject: string; description?: string; assigneeAgentId?: string; blockedBy?: string[]; priority?: number; status?: string; labels?: string[]; taskType?: string; externalRef?: string }) => {
    if (!teamId) return
    try {
      const res = await fetch(`/api/teams/${teamId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        // Proposal 6 (2026-04-20): surface the server's specific error
        // (e.g. "Cannot create task: team has no GitHub Project linked")
        // instead of a generic "Failed to create task" token. The server
        // already returns { error: "..." } for actionable cases; the
        // previous throw-a-constant swallowed that context.
        let msg = 'Failed to create task'
        try {
          const body = await res.json()
          if (typeof body?.error === 'string' && body.error) msg = body.error
        } catch { /* body not JSON; keep fallback */ }
        throw new Error(msg)
      }
      await fetchTasks()
    } catch (err) {
      await fetchTasks() // Revert optimistic state on network error
      throw err
    }
  }, [teamId, fetchTasks])

  const updateTask = useCallback(async (taskId: string, updates: { subject?: string; description?: string; status?: TaskStatus; assigneeAgentId?: string | null; blockedBy?: string[]; priority?: number; labels?: string[]; taskType?: string; externalRef?: string; externalProjectRef?: string; previousStatus?: string; acceptanceCriteria?: string[]; handoffDoc?: string; prUrl?: string; reviewResult?: string }) => {
    if (!teamId) return { unblocked: [] as TaskWithDeps[] }
    // Filter out undefined values to avoid overwriting existing task fields during optimistic merge
    const cleanUpdates = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined))
    // Optimistic update (UI2-MAJ-10: gate by mount)
    if (isMountedRef.current) {
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...cleanUpdates, updatedAt: new Date().toISOString() } : t))
    }
    try {
      const res = await fetch(`/api/teams/${teamId}/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!res.ok) throw new Error('Failed to update task')
      const data = await res.json()
      await fetchTasks() // Refresh to get resolved deps
      return { unblocked: data.unblocked || [] }
    } catch (err) {
      await fetchTasks() // Revert optimistic state on any error (network or HTTP)
      throw err
    }
  }, [teamId, fetchTasks])

  const deleteTask = useCallback(async (taskId: string) => {
    if (!teamId) return
    // Optimistic update (UI2-MAJ-10: gate by mount)
    if (isMountedRef.current) {
      setTasks(prev => prev.filter(t => t.id !== taskId))
    }
    try {
      const res = await fetch(`/api/teams/${teamId}/tasks/${taskId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete task')
    } catch (err) {
      await fetchTasks() // Revert optimistic state on any error (network or HTTP)
      throw err
    }
  }, [teamId, fetchTasks])

  const assignTask = useCallback(async (taskId: string, agentId: string | null) => {
    await updateTask(taskId, { assigneeAgentId: agentId })
  }, [updateTask])

  const pendingTasks = useMemo(() => tasks.filter(t => t.status === 'pending'), [tasks])
  const inProgressTasks = useMemo(() => tasks.filter(t => t.status === 'in_progress'), [tasks])
  const completedTasks = useMemo(() => tasks.filter(t => t.status === 'completed'), [tasks])

  const tasksByStatus = useMemo(() => {
    const map: Record<string, TaskWithDeps[]> = {}
    tasks.forEach(t => {
      if (!map[t.status]) map[t.status] = []
      map[t.status].push(t)
    })
    return map
  }, [tasks])

  const tasksByAgent = useMemo(() => {
    const map: Record<string, TaskWithDeps[]> = {}
    tasks.forEach(t => {
      if (t.assigneeAgentId) {
        if (!map[t.assigneeAgentId]) map[t.assigneeAgentId] = []
        map[t.assigneeAgentId].push(t)
      }
    })
    return map
  }, [tasks])

  return {
    tasks,
    loading,
    error,
    pendingTasks,
    inProgressTasks,
    completedTasks,
    tasksByStatus,
    tasksByAgent,
    createTask,
    updateTask,
    deleteTask,
    assignTask,
    refreshTasks: fetchTasks,
  }
}
