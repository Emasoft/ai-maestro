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
import { RefreshCw } from 'lucide-react'
import { useJsonlSession, sumUsage, lineIndexToArrayPos } from './sessions/useJsonlSession'
import type { ChatTranscriptHandle } from './sessions/ChatTranscript'
import ChatTranscript from './sessions/ChatTranscript'
import SessionList, { formatRelativeTime, formatBytes } from './sessions/SessionList'
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

  // Conversation time the PSS component-lifeline resolves "what was loaded
  // then" against. When the breakdown is pinned to a line, use THAT line's
  // tsMs (resolved via the same raw-lineIndex→array-pos mapping the
  // scroll-to-match path uses, since pinnedLineIndex is a raw jsonl offset);
  // otherwise use the latest rendered line's tsMs ("now" of the conversation).
  // null until we have at least one line. tsMs is always a finite epoch-ms.
  const lifelineAtMs = useMemo<number | null>(() => {
    const lines = api.lines
    if (lines.length === 0) return null
    if (api.pinnedLineIndex !== null) {
      const pos = lineIndexToArrayPos(lines, api.pinnedLineIndex)
      const line = pos >= 0 ? lines[pos] : null
      if (line) return line.tsMs
    }
    return lines[lines.length - 1].tsMs
  }, [api.lines, api.pinnedLineIndex])

  // Empty-state wiring: when the list has finished loading and is empty.
  const showAgentEmptyState =
    !!agentId && !api.listLoading && !api.listError && api.sessions.length === 0 && !api.selectedSessionId

  return (
    <div
      // `relative` makes ContextBreakdownPanel's `<lg` drawer-toggle
      // (`absolute top-2 right-2`) resolve against THIS Sessions pane instead
      // of an uncontrolled higher ancestor — so on tablet/phone the "open
      // context breakdown" button (the only path to the panel there) lands in
      // the pane's top-right, not in dead space. Harmless on desktop, where the
      // panel is flow-positioned as an `<aside>`. (Audit theme C mobile parity.)
      className="relative flex h-full min-h-0 w-full bg-gray-950"
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
        {/*
          Mobile session picker — replaces the (hidden `<md`) sidebar SessionList.
          This is the ONE sanctioned horizontal scroller (a fixed-viewport control
          strip, not document content). The refresh button is pinned OUTSIDE the
          scrolling region so it stays reachable while the pills scroll, and a
          list-load error is surfaced here in red — never masked as "No sessions"
          (the desktop SessionList shows the error, but it's `hidden md:flex`, so
          without this branch a fetch failure would look like an empty agent on
          phone). Each pill carries the FULL session name + status + mtime in its
          `title`/`aria-label` and the scroller is a `role="listbox"` of
          `role="option"` pills with `aria-selected`, so two long-common-prefix
          UUID names aren't indistinguishable to AT. (Audit theme C.)
        */}
        <div className="md:hidden flex items-stretch border-b border-gray-800 bg-gray-900/40">
          <button
            type="button"
            onClick={api.refreshList}
            aria-label="Refresh sessions list"
            title="Refresh sessions list"
            className="flex-shrink-0 flex items-center justify-center min-h-[44px] min-w-[44px] border-r border-gray-800/60 text-gray-500 hover:text-gray-300 hover:bg-gray-800/60 transition-colors motion-reduce:transition-none"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${api.listLoading ? 'animate-spin motion-reduce:animate-none' : ''}`} />
          </button>
          {api.listError ? (
            <span
              className="flex items-center px-3 text-[11px] text-red-300"
              role="alert"
              title={api.listError}
            >
              Failed to load sessions: {api.listError}
            </span>
          ) : api.sessions.length === 0 ? (
            <span className="flex items-center px-3 text-[11px] text-gray-500">
              {api.listLoading ? 'Loading sessions…' : 'No sessions yet.'}
            </span>
          ) : (
            <div
              className="flex items-center gap-2 px-2 py-1.5 overflow-x-auto"
              role="listbox"
              aria-label="Sessions"
            >
              {api.sessions.map(s => {
                const selected = s.id === api.selectedSessionId
                const meta = `${formatBytes(s.size)}${
                  s.messageCount != null ? `, ${s.messageCount} msgs` : ''
                }, ${formatRelativeTime(s.lastModified)}`
                const label = `Session ${s.displayName}${
                  s.isOngoing ? ' (ongoing)' : ''
                }, ${meta}`
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => api.selectSession(s.id)}
                    role="option"
                    aria-selected={selected}
                    aria-label={label}
                    title={label}
                    className={`flex-shrink-0 flex items-center justify-center min-h-[44px] px-2.5 rounded text-[10px] font-mono border transition-colors motion-reduce:transition-none ${
                      selected
                        ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-200'
                        : 'border-gray-700 text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    {s.displayName.slice(0, 8)}
                  </button>
                )
              })}
            </div>
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
        projectDir={api.projectDir}
        atMs={lifelineAtMs}
      />
    </div>
  )
}
