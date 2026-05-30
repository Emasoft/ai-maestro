'use client'

/**
 * SessionsTab — orchestrator for the Sessions tab in Agent Profile.
 *
 * Three-pane layout:
 *   Left   (≤200 px, desktop): SessionList
 *   Center (flex):              SessionSearchBar + ChatTranscript
 *   Right  (≤280 px, desktop): ContextBreakdownPanel (drawer < 1024 px)
 *
 * All data flows through `useJsonlSession`. This component owns only
 * layout + scroll-to-match glue.
 *
 * TRDD-d46b42e9 Phase 3 §6.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useJsonlSession, sumUsage, lineIndexToArrayPos } from './sessions/useJsonlSession'
import type { ChatTranscriptHandle } from './sessions/ChatTranscript'
import ChatTranscript from './sessions/ChatTranscript'
import SessionList from './sessions/SessionList'
import ContextBreakdownPanel from './sessions/ContextBreakdownPanel'
import SessionSearchBar from './sessions/SessionSearchBar'

interface SessionsTabProps {
  agentId: string | null
  /**
   * Resolved avatar URL of the agent whose transcript we're viewing.
   * Threaded down to the assistant bubbles so they show the agent's
   * actual photo (matching the sidebar badge) instead of a generic
   * sparkles vector icon. The user side keeps the vector User icon —
   * we don't have a "human user" avatar in registry yet.
   */
  assistantAvatarUrl?: string | null
}

export default function SessionsTab({ agentId, assistantAvatarUrl = null }: SessionsTabProps) {
  const api = useJsonlSession({ agentId })

  const transcriptRef = useRef<ChatTranscriptHandle | null>(null)

  // Latest rendered lines, read by the scroll-to-match effect WITHOUT being a
  // dependency of it — so that effect still fires only when the match changes,
  // not on every incremental line append (preserving the original behaviour).
  const linesRef = useRef(api.lines)
  useEffect(() => {
    linesRef.current = api.lines
  }, [api.lines])

  // Scroll to the current match whenever the match index (or match set) changes.
  useEffect(() => {
    if (api.matchIndex === null || api.matches.length === 0) return
    const match = api.matches[api.matchIndex]
    if (!match) return
    // `match.line` is the RAW jsonl line offset; ChatTranscript.scrollToLine
    // indexes its per-row `offsets[]` by ARRAY position. Filtered-out metadata
    // records make the two diverge (a match in a session with hidden records
    // would scroll to the wrong row, or — when lineIndex >= lines.length —
    // nowhere). Translate once, here, before scrolling. The helper is exported
    // + unit-tested in useJsonlSession. (TRDD-1657a5f4 Phase 1 — C4.)
    transcriptRef.current?.scrollToLine(lineIndexToArrayPos(linesRef.current, match.line))
  }, [api.matchIndex, api.matches])

  const totalUsage = useMemo(() => (api.lines.length > 0 ? sumUsage(api.lines) : null), [api.lines])
  const currentMatchLine = api.matchIndex !== null ? api.matches[api.matchIndex]?.line ?? null : null

  // Empty-state wiring: when the list has finished loading and is empty.
  const showAgentEmptyState =
    !!agentId && !api.listLoading && !api.listError && api.sessions.length === 0 && !api.selectedSessionId

  return (
    <div
      className="flex h-full min-h-0 w-full bg-gray-950"
      role="region"
      aria-label="Agent sessions"
    >
      {/* Left: session list */}
      <div className="w-[180px] sm:w-[200px] flex-shrink-0 hidden md:flex flex-col">
        <SessionList
          sessions={api.sessions}
          selectedSessionId={api.selectedSessionId}
          onSelect={api.selectSession}
          loading={api.listLoading}
          error={api.listError}
          onRefresh={api.refreshList}
          projectDir={api.projectDir}
        />
      </div>

      {/* Center: search + transcript */}
      <div className="flex-1 min-w-0 flex flex-col relative">
        {/* Mobile session picker — a horizontal scroller replacement for the sidebar. */}
        <div className="md:hidden flex items-center gap-2 px-2 py-1.5 border-b border-gray-800 overflow-x-auto bg-gray-900/40">
          {api.sessions.length === 0 ? (
            <span className="text-[10px] text-gray-500">
              {api.listLoading ? 'Loading sessions…' : 'No sessions'}
            </span>
          ) : (
            api.sessions.map(s => {
              const selected = s.id === api.selectedSessionId
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => api.selectSession(s.id)}
                  className={`flex-shrink-0 px-2 py-1 rounded text-[10px] font-mono border ${
                    selected
                      ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-200'
                      : 'border-gray-700 text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {s.displayName.slice(0, 8)}
                </button>
              )
            })
          )}
        </div>

        <SessionSearchBar
          query={api.query}
          onQueryChange={api.setQuery}
          matchCount={api.matches.length}
          matchIndex={api.matchIndex}
          onPrev={api.prevMatch}
          onNext={api.nextMatch}
          onClear={api.clearSearch}
          searching={api.searching}
          error={api.searchError}
          disabled={!api.selectedSessionId}
          isOngoing={api.isOngoing}
          followTail={api.followTail}
          onFollowTailChange={api.setFollowTail}
          tailError={api.tailError}
        />

        {showAgentEmptyState ? (
          <div className="flex-1 flex items-center justify-center p-6 text-center">
            <div className="max-w-xs">
              <p className="text-[12px] text-gray-400 font-medium">No sessions yet.</p>
              <p className="text-[11px] text-gray-500 mt-1">
                This agent hasn&apos;t started a Claude conversation.
              </p>
            </div>
          </div>
        ) : api.selectedSessionId ? (
          <ChatTranscript
            ref={transcriptRef}
            lines={api.lines}
            totalUsage={totalUsage}
            highlightQuery={api.query}
            currentMatchLine={currentMatchLine}
            onNearBottom={api.loadMore}
            loadingMore={api.transcriptLoading}
            error={api.transcriptError}
            pinnedLineIndex={api.pinnedLineIndex}
            onPinLineIndex={api.pinBreakdownTo}
            assistantAvatarUrl={assistantAvatarUrl}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center p-6 text-center">
            <p className="text-[11px] text-gray-500">Select a session to view its transcript.</p>
          </div>
        )}
      </div>

      {/* Right: context breakdown (desktop) or drawer toggle (mobile/tablet) */}
      <ContextBreakdownPanel
        breakdown={api.breakdown}
        loading={api.breakdownLoading}
        error={api.breakdownError}
      />
    </div>
  )
}
