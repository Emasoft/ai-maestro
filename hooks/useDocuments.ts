'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { TeamDocument } from '@/types/document'

interface UseDocumentsResult {
  documents: TeamDocument[]
  loading: boolean
  error: string | null
  createDocument: (data: { title: string; content: string; pinned?: boolean; tags?: string[] }) => Promise<void>
  updateDocument: (docId: string, updates: { title?: string; content?: string; pinned?: boolean; tags?: string[] }) => Promise<void>
  deleteDocument: (docId: string) => Promise<void>
  refreshDocuments: () => Promise<void>
}

export function useDocuments(teamId: string | null): UseDocumentsResult {
  const [documents, setDocuments] = useState<TeamDocument[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  // Guard against setState after unmount — prevents React warnings when async
  // fetches resolve after the component using this hook has been removed from the tree
  const isMountedRef = useRef(true)
  useEffect(() => { return () => { isMountedRef.current = false } }, [])

  // MF-005: Accept optional AbortSignal to cancel stale fetches on unmount/teamId change
  const fetchDocuments = useCallback(async (signal?: AbortSignal) => {
    if (!teamId) return
    try {
      const res = await fetch(`/api/teams/${teamId}/documents`, { signal })
      if (!res.ok) throw new Error('Failed to fetch documents')
      // Guard against setting state after abort or unmount
      if (signal?.aborted || !isMountedRef.current) return
      const data = await res.json()
      setDocuments(data.documents || [])
      setError(null)
    } catch (err) {
      // Silently ignore AbortError — expected when component unmounts or teamId changes
      if (err instanceof DOMException && err.name === 'AbortError') return
      if (!isMountedRef.current) return
      setError(err instanceof Error ? err.message : 'Failed to fetch documents')
    }
  }, [teamId])

  // Initial fetch with AbortController for cleanup on unmount/teamId change
  useEffect(() => {
    if (!teamId) {
      setDocuments([])
      setLoading(false)
      return
    }
    // AbortController cancels in-flight fetch when teamId changes or component unmounts,
    // preventing stale data from a previous teamId overwriting the current team's documents
    const controller = new AbortController()
    setLoading(true)
    fetchDocuments(controller.signal).finally(() => {
      if (!controller.signal.aborted && isMountedRef.current) setLoading(false)
    })
    return () => controller.abort()
  }, [teamId, fetchDocuments])

  // Poll every 5s for multi-tab sync
  useEffect(() => {
    if (!teamId) return
    // Each poll tick gets its own AbortController so cleanup aborts any in-flight poll fetch
    let pollController: AbortController | null = null
    intervalRef.current = setInterval(() => {
      pollController = new AbortController()
      fetchDocuments(pollController.signal)
    }, 5000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      pollController?.abort()
    }
  }, [teamId, fetchDocuments])

  const createDocument = useCallback(async (data: { title: string; content: string; pinned?: boolean; tags?: string[] }) => {
    if (!teamId) return
    const res = await fetch(`/api/teams/${teamId}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error('Failed to create document')
    await fetchDocuments()
  }, [teamId, fetchDocuments])

  const updateDocument = useCallback(async (docId: string, updates: { title?: string; content?: string; pinned?: boolean; tags?: string[] }) => {
    if (!teamId) return
    // Optimistic update
    setDocuments(prev => prev.map(d => d.id === docId ? { ...d, ...updates, updatedAt: new Date().toISOString() } : d))
    const res = await fetch(`/api/teams/${teamId}/documents/${docId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    if (!res.ok) {
      // Revert optimistic update — swallow revert errors to preserve the mutation error,
      // but log them so a refresh-failure-after-mutation-failure isn't completely silent.
      // UI2-MAJ-20.
      await fetchDocuments().catch((err) => {
        console.warn('[useDocuments] Revert after updateDocument failure also failed:', err)
      })
      throw new Error('Failed to update document')
    }
    await fetchDocuments()
  }, [teamId, fetchDocuments])

  const deleteDocument = useCallback(async (docId: string) => {
    if (!teamId) return
    // Optimistic update
    setDocuments(prev => prev.filter(d => d.id !== docId))
    const res = await fetch(`/api/teams/${teamId}/documents/${docId}`, { method: 'DELETE' })
    if (!res.ok) {
      // Revert optimistic update — swallow revert errors to preserve the mutation error,
      // but log them. UI2-MAJ-20.
      await fetchDocuments().catch((err) => {
        console.warn('[useDocuments] Revert after deleteDocument failure also failed:', err)
      })
      throw new Error('Failed to delete document')
    }
  }, [teamId, fetchDocuments])

  return {
    documents,
    loading,
    error,
    createDocument,
    updateDocument,
    deleteDocument,
    refreshDocuments: fetchDocuments,
  }
}
