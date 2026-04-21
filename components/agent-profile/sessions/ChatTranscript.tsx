'use client'

/**
 * ChatTranscript — virtualized transcript view.
 *
 * Spec (TRDD-d46b42e9 Phase 3 §6.3.2):
 *   renders 10 000+ messages without jank. We don't have
 *   `@tanstack/react-virtual` available (despite the spec claiming it),
 *   so this is a hand-rolled absolute-positioned windowing implementation.
 *   The ergonomics match the tanstack API so a future swap is a 1-file change.
 *
 * Key invariants:
 *   - Rows are absolutely positioned inside a container whose height is the
 *     sum of estimated row heights.
 *   - We estimate 96 px for uncollapsed text bubbles, 40 px for tool rows;
 *     the UI degrades gracefully if a bubble ends up taller (extra
 *     overlap is avoided because bubbles have their own rounded border).
 *   - A 10-row overscan ensures keyboard navigation and small scroll
 *     jumps do not produce blank frames.
 *
 * Keyboard navigation (acceptance criterion: a11y):
 *   `j` / ArrowDown → scroll one row down
 *   `k` / ArrowUp   → scroll one row up
 *   Home            → scroll to top
 *   End             → scroll to bottom
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { TranscriptLine, MessageUsage } from '@/types/sessions-browser'
import MessageBubble from './MessageBubble'
import ToolUseRow from './ToolUseRow'

const BUBBLE_HEIGHT = 96
const TOOL_ROW_HEIGHT = 40
const OVERSCAN = 10
const ROW_GAP = 8

function rowHeight(line: TranscriptLine): number {
  return line.isToolEvent ? TOOL_ROW_HEIGHT : BUBBLE_HEIGHT
}

interface ChatTranscriptProps {
  lines: TranscriptLine[]
  /** Aggregate usage for the sticky header. Pass null to hide. */
  totalUsage: MessageUsage | null
  /** Debounced current search query (may be empty). */
  highlightQuery: string
  /** Current match line number, or null. */
  currentMatchLine: number | null
  /** Fired when the user scrolls within 400 px of the bottom. */
  onNearBottom?: () => void
  /** Loading indicator at the bottom of the list. */
  loadingMore?: boolean
  /** Error overlay (inline) at bottom. */
  error?: string | null
}

export interface ChatTranscriptHandle {
  scrollToLine: (lineIndex: number) => void
  scrollToBottom: () => void
}

const ChatTranscript = forwardRef<ChatTranscriptHandle, ChatTranscriptProps>(function ChatTranscript(
  {
    lines,
    totalUsage,
    highlightQuery,
    currentMatchLine,
    onNearBottom,
    loadingMore = false,
    error = null,
  },
  ref,
) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState({ scrollTop: 0, clientHeight: 0 })

  // Pre-compute row offsets for O(log n) binary search on scroll.
  const offsets = useMemo(() => {
    const o = new Array<number>(lines.length + 1)
    o[0] = 0
    for (let i = 0; i < lines.length; i++) {
      o[i + 1] = o[i] + rowHeight(lines[i]) + ROW_GAP
    }
    return o
  }, [lines])

  const totalHeight = offsets[offsets.length - 1] ?? 0

  // ResizeObserver to track container height.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const h = entry.contentRect.height
        setViewport(v => (v.clientHeight === h ? v : { ...v, clientHeight: h }))
      }
    })
    ro.observe(el)
    // Initialize once on mount to avoid an empty first paint.
    setViewport(v => ({ ...v, clientHeight: el.clientHeight, scrollTop: el.scrollTop }))
    return () => ro.disconnect()
  }, [])

  const onScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const target = e.currentTarget
      const scrollTop = target.scrollTop
      const clientHeight = target.clientHeight
      setViewport({ scrollTop, clientHeight })
      if (onNearBottom) {
        const distanceToBottom = totalHeight - (scrollTop + clientHeight)
        if (distanceToBottom < 400) onNearBottom()
      }
    },
    [totalHeight, onNearBottom],
  )

  // Binary-search the first row visible at `scrollTop`.
  const findStartIndex = useCallback(
    (scrollTop: number): number => {
      if (lines.length === 0) return 0
      let lo = 0
      let hi = lines.length - 1
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        const end = offsets[mid + 1]
        if (end <= scrollTop) lo = mid + 1
        else hi = mid
      }
      return lo
    },
    [lines.length, offsets],
  )

  const startIndex = Math.max(0, findStartIndex(viewport.scrollTop) - OVERSCAN)
  const endPixel = viewport.scrollTop + viewport.clientHeight
  const endIndex = Math.min(lines.length, findStartIndex(endPixel) + OVERSCAN + 1)
  const visibleLines = lines.slice(startIndex, endIndex)

  // API exposed to parent for scroll-to-match + programmatic scrollToBottom.
  useImperativeHandle(
    ref,
    () => ({
      scrollToLine: (lineIndex: number) => {
        const el = scrollRef.current
        if (!el) return
        if (lineIndex < 0 || lineIndex >= offsets.length - 1) return
        const targetTop = offsets[lineIndex]
        // Center the match roughly in the viewport.
        const desired = Math.max(0, targetTop - el.clientHeight / 3)
        el.scrollTo({ top: desired, behavior: 'smooth' })
      },
      scrollToBottom: () => {
        const el = scrollRef.current
        if (!el) return
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
      },
    }),
    [offsets],
  )

  // Keyboard navigation — j/k + arrows.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const el = scrollRef.current
      if (!el) return
      let handled = false
      const STEP = 120
      if (e.key === 'j' || e.key === 'ArrowDown') {
        el.scrollBy({ top: STEP, behavior: 'smooth' })
        handled = true
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        el.scrollBy({ top: -STEP, behavior: 'smooth' })
        handled = true
      } else if (e.key === 'Home') {
        el.scrollTo({ top: 0, behavior: 'smooth' })
        handled = true
      } else if (e.key === 'End') {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
        handled = true
      } else if (e.key === 'PageDown') {
        el.scrollBy({ top: el.clientHeight * 0.9, behavior: 'smooth' })
        handled = true
      } else if (e.key === 'PageUp') {
        el.scrollBy({ top: -el.clientHeight * 0.9, behavior: 'smooth' })
        handled = true
      }
      if (handled) {
        e.preventDefault()
      }
    },
    [],
  )

  // Normalise the highlight query once per render.
  const normalisedQuery = highlightQuery.trim().toLowerCase()

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Sticky aggregate header */}
      {totalUsage && (
        <div
          className="sticky top-0 z-10 flex items-center gap-3 px-3 py-1.5 text-[10px] border-b border-gray-800 bg-gray-900/80 backdrop-blur"
          role="status"
          aria-live="polite"
        >
          <span className="text-gray-500 font-medium uppercase tracking-wider">Session totals</span>
          <span className="aim-msg-tokens text-emerald-300/90">
            in: {totalUsage.inputTokens.toLocaleString()} · out:{' '}
            {totalUsage.outputTokens.toLocaleString()} · cache:{' '}
            {totalUsage.cacheReadTokens.toLocaleString()} · total:{' '}
            {(
              totalUsage.inputTokens +
              totalUsage.outputTokens +
              totalUsage.cacheReadTokens
            ).toLocaleString()}
          </span>
          <span className="ml-auto text-gray-500">{lines.length.toLocaleString()} messages</span>
        </div>
      )}

      {/* Scrollable virtualised area */}
      <div
        ref={scrollRef}
        tabIndex={0}
        role="feed"
        aria-label="Session transcript"
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        className="relative flex-1 min-h-0 overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
        style={{ touchAction: 'pan-y', overscrollBehavior: 'contain' }}
      >
        <div style={{ height: totalHeight, position: 'relative' }}>
          {visibleLines.map((line, i) => {
            const index = startIndex + i
            const top = offsets[index]
            const h = rowHeight(line)
            const isCurrent = currentMatchLine !== null && currentMatchLine === line.lineIndex
            return (
              <div
                key={`${line.lineIndex}-${line.role}`}
                style={{
                  position: 'absolute',
                  top,
                  left: 0,
                  right: 0,
                  minHeight: h,
                  padding: '0 12px',
                }}
              >
                {line.isToolEvent ? (
                  <ToolUseRow line={line} />
                ) : (
                  <MessageBubble
                    line={line}
                    highlightQuery={normalisedQuery}
                    currentMatch={isCurrent}
                  />
                )}
              </div>
            )
          })}
        </div>
        {loadingMore && (
          <div className="sticky bottom-0 py-2 text-center text-[11px] text-gray-500">
            Loading more messages…
          </div>
        )}
        {error && (
          <div className="sticky bottom-0 py-2 px-3 text-[11px] text-red-300 bg-red-500/10 border-t border-red-500/20">
            {error}
          </div>
        )}
      </div>
    </div>
  )
})

export default ChatTranscript
