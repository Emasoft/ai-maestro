'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Brain, AlertCircle, CheckCircle2 } from 'lucide-react'
import {
  subconsciousBadgeState,
  SUBCONSCIOUS_BADGE_TITLE,
  SUBCONSCIOUS_BADGE_LABEL,
  SUBCONSCIOUS_BADGE_ICON_CLASS,
  SUBCONSCIOUS_BADGE_LABEL_CLASS,
} from '@/lib/subconscious-badge'

interface ExtendedAgentSubconsciousStatus {
  success: boolean
  exists: boolean
  initialized: boolean
  isRunning: boolean
  status: {
    startedAt: number | null
    messageCheckInterval: number
    lastMessageRun: number | null
    lastMessageResult: {
      success: boolean
      unreadCount?: number
      error?: string
    } | null
    totalMessageRuns: number
  } | null
}

interface Props {
  agentId: string | undefined
  hostUrl?: string  // Base URL for remote hosts
}

export function AgentSubconsciousIndicator({ agentId, hostUrl }: Props) {
  // Base URL for API calls - empty for local, full URL for remote hosts
  const baseUrl = hostUrl || ''
  const [status, setStatus] = useState<ExtendedAgentSubconsciousStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showPopover, setShowPopover] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const fetchStatus = useCallback(async () => {
    if (!agentId) {
      setLoading(false)
      return
    }

    try {
      const response = await fetch(`${baseUrl}/api/agents/${agentId}/subconscious`)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const data = await response.json()
      setStatus(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch')
    } finally {
      setLoading(false)
    }
  }, [agentId, baseUrl])

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 30000)
    return () => clearInterval(interval)
  }, [fetchStatus])

  // Close popover on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setShowPopover(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  if (!agentId) return null

  const isRunning = status?.isRunning || false
  const hasError = error || status?.status?.lastMessageResult?.error

  // The mapping lives in lib/subconscious-badge.ts so it can be tested without a
  // DOM. Keeping it here as inline ternaries is how it went untested, and how it
  // came to branch on an `isWarmingUp` that was always false.
  const badge = subconsciousBadgeState({ loading, hasError: Boolean(hasError), isRunning })

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={(e) => {
          e.stopPropagation()
          setShowPopover(!showPopover)
        }}
        className="flex items-center justify-center p-2 rounded transition-all duration-200 hover:bg-gray-800/50"
        title={SUBCONSCIOUS_BADGE_TITLE[badge]}
      >
        <Brain className={`w-4 h-4 ${SUBCONSCIOUS_BADGE_ICON_CLASS[badge]}`} />
        {badge === 'running' && (
          <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-purple-500 rounded-full" />
        )}
      </button>

      {/* Popover */}
      {showPopover && (
        <div
          ref={popoverRef}
          className="absolute top-full right-0 mt-2 w-64 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-50"
        >
          <div className="p-3 border-b border-gray-700">
            <div className="flex items-center gap-2">
              <Brain className={`w-4 h-4 ${isRunning ? 'text-purple-400' : 'text-gray-400'}`} />
              <h3 className="text-sm font-semibold text-gray-100">Agent Subconscious</h3>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Background message tracking
            </p>
          </div>

          <div className="p-3 space-y-2">
            {error ? (
              <div className="flex items-center gap-2 text-red-400 text-xs">
                <AlertCircle className="w-3 h-3" />
                <span>Error: {error}</span>
              </div>
            ) : loading ? (
              <div className="flex items-center gap-2 text-gray-400 text-xs">
                <Brain className="w-3 h-3 animate-pulse" />
                <span>Loading...</span>
              </div>
            ) : status ? (
              <>
                {/* Status */}
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-400 flex items-center gap-1.5">
                    <CheckCircle2 className={`w-3 h-3 ${isRunning ? 'text-purple-400' : ''}`} />
                    Status
                  </span>
                  <span className={SUBCONSCIOUS_BADGE_LABEL_CLASS[badge]}>
                    {SUBCONSCIOUS_BADGE_LABEL[badge]}
                  </span>
                </div>

                {status.status && (
                  <div className="border-t border-gray-700 pt-2 mt-2">
                    <p className="text-[10px] text-gray-500 mb-1.5">Notifications</p>
                    <p className="text-[10px] text-gray-500">
                      Messages delivered instantly via tmux push
                    </p>
                  </div>
                )}
              </>
            ) : null}
          </div>

          <div className="p-2 border-t border-gray-700">
            <button
              onClick={(e) => {
                e.stopPropagation()
                fetchStatus()
              }}
              className="w-full text-[10px] text-gray-400 hover:text-gray-200 transition-colors"
            >
              Click to refresh
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
