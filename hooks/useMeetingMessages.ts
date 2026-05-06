'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { MessageSummary } from '@/lib/messageQueue'

interface MeetingMessage extends MessageSummary {
  isMine: boolean       // Sent by Maestro
  displayFrom: string   // Resolved display name
}

interface UseMeetingMessagesOptions {
  meetingId: string | null
  participantIds: string[]
  teamName: string
  isActive: boolean
}

interface UseMeetingMessagesResult {
  messages: MeetingMessage[]
  unreadCount: number
  sendToAgent: (agentId: string, message: string) => Promise<void>
  broadcastToAll: (message: string) => Promise<void>
  markAsRead: () => void
  loading: boolean
}

export function useMeetingMessages({
  meetingId,
  participantIds,
  teamName,
  isActive,
}: UseMeetingMessagesOptions): UseMeetingMessagesResult {
  const [messages, setMessages] = useState<MeetingMessage[]>([])
  const [loading, setLoading] = useState(false)
  const lastFetchRef = useRef<string | null>(null)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const seenCountRef = useRef(0)
  // Track pending setTimeout handles so they can be cancelled on unmount
  const pendingTimeoutsRef = useRef<Set<NodeJS.Timeout>>(new Set())
  // Track messages length for markAsRead without causing re-creation
  const messagesLengthRef = useRef(0)
  // UI2-MAJ-11: gate setMessages calls (in fetchMessages, sendToAgent,
  // broadcastToAll) by mount state. The pending-timeout map already prevents
  // queued post-send fetches from firing after unmount, but a fetch that
  // resolves AFTER cleanup still calls setMessages from the in-flight body.
  const isMountedRef = useRef(true)
  useEffect(() => {
    isMountedRef.current = true
    return () => { isMountedRef.current = false }
  }, [])

  // Keep messagesLengthRef in sync so markAsRead can read it without deps
  useEffect(() => { messagesLengthRef.current = messages.length }, [messages.length])

  // Stabilize participantIds — only change when the sorted list actually changes
  const participantKey = useMemo(() => [...participantIds].sort().join(','), [participantIds])
  const stableParticipantIds = useRef(participantIds)
  useEffect(() => {
    stableParticipantIds.current = participantIds
  }, [participantKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchMessages = useCallback(async () => {
    const pIds = stableParticipantIds.current
    if (!meetingId || !isActive || pIds.length === 0) return

    try {
      const params = new URLSearchParams({
        meetingId,
        participants: pIds.join(','),
      })
      if (lastFetchRef.current) {
        params.set('since', lastFetchRef.current)
      }

      const res = await fetch(`/api/messages/meeting?${params}`)
      if (!res.ok) return

      const data = await res.json()
      // UI2-MAJ-11: bail before any setState if the hook unmounted while
      // the fetch was in-flight.
      if (!isMountedRef.current) return
      const newMessages: MeetingMessage[] = (data.messages || []).map((msg: MessageSummary) => ({
        ...msg,
        isMine: msg.from === 'maestro' || msg.fromAlias === 'Maestro',
        displayFrom: msg.fromLabel || msg.fromAlias || msg.from,
      }))

      if (lastFetchRef.current && newMessages.length > 0) {
        // Incremental: append new messages, remove only matched optimistic ones
        setMessages(prev => {
          const existingIds = new Set(prev.filter(m => !m.id.startsWith('optimistic-')).map(m => m.id))
          const toAdd = newMessages.filter(m => !existingIds.has(m.id))
          if (toAdd.length === 0) return prev
          // Build a set of fingerprints from incoming real messages to match
          // against optimistic messages (subject + preview + recipient).
          // Only optimistic messages with a matching real counterpart are removed.
          const realFingerprints = new Set(
            newMessages.map(m => `${m.subject}|${m.preview}|${m.to}`)
          )
          const withoutMatched = prev.filter(m => {
            if (!m.id.startsWith('optimistic-')) return true
            const fp = `${m.subject}|${m.preview}|${m.to}`
            return !realFingerprints.has(fp)
          })
          return [...withoutMatched, ...toAdd]
        })
      } else if (!lastFetchRef.current) {
        // Initial fetch: replace all (including any optimistic)
        setMessages(newMessages)
        seenCountRef.current = newMessages.length
      }

      if (newMessages.length > 0) {
        const latest = newMessages[newMessages.length - 1]
        lastFetchRef.current = latest.timestamp
      }
    } catch (err) {
      console.error('[useMeetingMessages] Fetch failed:', err)
    }
  }, [meetingId, isActive, participantKey])

  // Initial fetch
  useEffect(() => {
    if (!meetingId || !isActive) {
      setMessages([])
      lastFetchRef.current = null
      seenCountRef.current = 0
      return
    }
    setLoading(true)
    fetchMessages().finally(() => {
      // UI2-MAJ-11: gate setLoading by mount
      if (!isMountedRef.current) return
      setLoading(false)
    })
  }, [meetingId, isActive, fetchMessages])

  // Poll every 7s
  useEffect(() => {
    if (!meetingId || !isActive) return
    intervalRef.current = setInterval(fetchMessages, 7000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      // Cancel all pending post-send fetch timeouts to prevent setState-after-unmount
      for (const t of pendingTimeoutsRef.current) clearTimeout(t)
      pendingTimeoutsRef.current.clear()
    }
  }, [meetingId, isActive, fetchMessages])

  // Remove optimistic message by ID (used for rollback on failure)
  const removeOptimistic = useCallback((optimisticId: string) => {
    // UI2-MAJ-11: gate setMessages by mount
    if (!isMountedRef.current) return
    setMessages(prev => prev.filter(m => m.id !== optimisticId))
  }, [])

  // Show a message optimistically before server confirms.
  // Returns the optimistic ID so callers can roll back on failure.
  const addOptimistic = useCallback((text: string, toAgent?: string): string => {
    const optimisticId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const optimistic: MeetingMessage = {
      id: optimisticId,
      from: 'maestro',
      fromAlias: 'Maestro',
      to: toAgent || 'all',
      toAlias: toAgent ? undefined : 'All',
      timestamp: new Date().toISOString(),
      subject: `[MEETING:${meetingId}]`,
      preview: text,
      status: 'unread',
      priority: 'normal',
      type: 'notification',
      isMine: true,
      displayFrom: 'Maestro',
    }
    // UI2-MAJ-11: gate setMessages by mount
    if (isMountedRef.current) {
      setMessages(prev => [...prev, optimistic])
    }
    return optimisticId
  }, [meetingId])

  const sendToAgent = useCallback(async (agentId: string, message: string) => {
    if (!meetingId) return
    const pIds = stableParticipantIds.current
    const optimisticId = addOptimistic(message, agentId)
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'maestro',
          fromAlias: 'Maestro',
          to: agentId,
          subject: `[MEETING:${meetingId}] ${teamName}`,
          content: {
            type: 'notification',
            message,
            context: {
              meeting: {
                meetingId,
                teamName,
                participantIds: pIds,
                isBroadcast: false,
              },
            },
          },
        }),
      })
      if (!res.ok) {
        // Server rejected — roll back the optimistic message
        console.error('Failed to send message: server returned', res.status)
        removeOptimistic(optimisticId)
        return
      }
    } catch (err) {
      // Network error — roll back the optimistic message
      console.error('Failed to send message:', err)
      removeOptimistic(optimisticId)
      return
    }
    // Refresh after a short delay to let file I/O settle
    const t = setTimeout(() => { pendingTimeoutsRef.current.delete(t); fetchMessages() }, 300)
    pendingTimeoutsRef.current.add(t)
  }, [meetingId, teamName, participantKey, fetchMessages, addOptimistic, removeOptimistic])

  const broadcastToAll = useCallback(async (message: string) => {
    if (!meetingId) return
    const pIds = stableParticipantIds.current
    // Show one optimistic message for the broadcast (not N copies)
    const optimisticId = addOptimistic(message)
    // Send individual messages to each participant
    const results = await Promise.all(
      pIds.map(agentId =>
        fetch('/api/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'maestro',
            fromAlias: 'Maestro',
            to: agentId,
            subject: `[MEETING:${meetingId}] ${teamName}`,
            content: {
              type: 'notification',
              message,
              context: {
                meeting: {
                  meetingId,
                  teamName,
                  participantIds: pIds,
                  isBroadcast: true,
                },
              },
            },
          }),
        })
          .then(res => res.ok)
          .catch(err => { console.error(`Failed to send to ${agentId}:`, err); return false })
      )
    )
    // If ALL sends failed, roll back the optimistic message
    if (results.every(ok => !ok)) {
      removeOptimistic(optimisticId)
      return
    }
    // Refresh after a short delay to let file I/O settle
    const t = setTimeout(() => { pendingTimeoutsRef.current.delete(t); fetchMessages() }, 300)
    pendingTimeoutsRef.current.add(t)
  }, [meetingId, teamName, participantKey, fetchMessages, addOptimistic, removeOptimistic])

  const markAsRead = useCallback(() => {
    seenCountRef.current = messagesLengthRef.current
  }, [])

  const unreadCount = Math.max(0, messages.length - seenCountRef.current)

  return {
    messages,
    unreadCount,
    sendToAgent,
    broadcastToAll,
    markAsRead,
    loading,
  }
}
