'use client'

/**
 * SessionList — left pane of the Sessions tab (≤200 px wide).
 *
 * Spec (TRDD-d46b42e9 Phase 3 §6):
 *   One row per `.jsonl` file: displayName, size, messageCount (`?` if not
 *   populated yet), last-modified, sorted newest first.
 */

import { File as FileIcon, RefreshCw } from 'lucide-react'
import type { SessionSummary } from '@/types/sessions-browser'

interface SessionListProps {
  sessions: SessionSummary[]
  selectedSessionId: string | null
  onSelect: (sid: string) => void
  loading: boolean
  error: string | null
  onRefresh: () => void
  projectDir: string | null
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso
  const diff = Date.now() - then
  const min = Math.round(diff / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const h = Math.round(min / 60)
  if (h < 48) return `${h}h ago`
  const d = Math.round(h / 24)
  return `${d}d ago`
}

export default function SessionList({
  sessions,
  selectedSessionId,
  onSelect,
  loading,
  error,
  onRefresh,
  projectDir,
}: SessionListProps) {
  const isEmpty = !loading && !error && sessions.length === 0

  return (
    <div className="flex flex-col h-full min-h-0 border-r border-gray-800 bg-gray-900/40">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800/60">
        <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Sessions</span>
        <span className="ml-auto text-[10px] text-gray-500 tabular-nums">{sessions.length}</span>
        <button
          type="button"
          onClick={onRefresh}
          aria-label="Refresh sessions list"
          title="Refresh sessions list"
          className="p-1 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800/60 transition-colors"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      {projectDir && (
        <div className="px-3 py-1 text-[9px] text-gray-500 truncate border-b border-gray-800/30" title={projectDir}>
          {projectDir}
        </div>
      )}
      <div className="flex-1 overflow-y-auto" style={{ touchAction: 'pan-y', overscrollBehavior: 'contain' }}>
        {loading && sessions.length === 0 && (
          <div className="px-3 py-4 text-[11px] text-gray-500">Loading…</div>
        )}
        {error && (
          <div className="px-3 py-4 text-[11px] text-red-300" role="alert">
            Failed to load sessions: {error}
          </div>
        )}
        {isEmpty && (
          <div className="px-3 py-6 text-[11px] text-gray-500">
            No sessions yet. This agent hasn&apos;t started a Claude conversation.
          </div>
        )}
        <ul className="divide-y divide-gray-800/30">
          {sessions.map(s => {
            const isSelected = s.id === selectedSessionId
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onSelect(s.id)}
                  aria-pressed={isSelected}
                  aria-label={`Session ${s.displayName}, ${formatBytes(s.size)}, last modified ${formatRelativeTime(s.lastModified)}`}
                  className={`aim-session-row w-full flex items-start gap-2 px-3 py-2 text-left transition-colors ${
                    isSelected
                      ? 'bg-emerald-500/10 text-gray-100 border-l-2 border-emerald-500'
                      : 'text-gray-300 hover:bg-gray-800/40 border-l-2 border-transparent'
                  }`}
                >
                  <FileIcon className={`w-3 h-3 flex-shrink-0 mt-0.5 ${isSelected ? 'text-emerald-400' : 'text-gray-500'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-mono truncate" title={s.displayName}>
                      {s.displayName}
                    </div>
                    <div className="flex items-center gap-2 text-[9px] text-gray-500 mt-0.5 tabular-nums">
                      <span>{formatBytes(s.size)}</span>
                      <span aria-hidden>·</span>
                      <span>{s.messageCount !== null ? `${s.messageCount} msgs` : '? msgs'}</span>
                      <span aria-hidden>·</span>
                      <span>{formatRelativeTime(s.lastModified)}</span>
                    </div>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
