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
import { Check, Download } from 'lucide-react'
import type { TranscriptLine, MessageUsage } from '@/types/sessions-browser'
import { approxCostUsd, formatUsd, isFallbackFamily, APPROX_COST_CAVEAT } from '@/lib/token-cost'
import MessageBubble from './MessageBubble'
import ToolUseRow from './ToolUseRow'

/**
 * Resolve the session's Claude model id for the cost roll-up, in priority:
 *   1. an explicit `model` prop (when a caller wires one),
 *   2. otherwise the most-recent assistant line that carries a model id at
 *      `raw.message.model` (Claude Code's canonical location — verified on
 *      live `.jsonl` files).
 * Returns `null` when neither yields one → the cost module prices at the
 * sonnet-tier fallback and the UI flags it. Scanning from the END finds the
 * model with the fewest iterations for the common single-model session.
 */
function resolveSessionModel(lines: TranscriptLine[], explicit: string | null): string | null {
  if (explicit && explicit.length > 0) return explicit
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i]?.raw
    if (!raw || typeof raw !== 'object') continue
    const msg = (raw as { message?: unknown }).message
    if (!msg || typeof msg !== 'object') continue
    const model = (msg as { model?: unknown }).model
    if (typeof model === 'string' && model.length > 0) return model
  }
  return null
}

// Minimum heights — every row gets at least this much vertical space even
// when its content is empty, so the role badge + timestamp stay readable.
const BUBBLE_MIN_HEIGHT = 52
const TOOL_ROW_HEIGHT = 40
// Expanded tool rows render a max-height: 280 px scrollable body plus the
// header button (~36 px) + 1 px border-t separator + small padding. We
// reserve a fixed slot so virtualization stays O(1); the body itself
// scrolls when the payload is taller. Keeps the next bubble from
// bleeding into the expanded JSON.
const TOOL_ROW_EXPANDED_HEIGHT = 320
const OVERSCAN = 10
// Tighter inter-bubble gap. The previous 8 px reserve combined with the
// bubble's own 8 px py + 14 px role-label header produced visibly
// "airy" empty space between consecutive turns. 3 px lets the role
// border still read as a discrete card while bringing the rhythm in
// line with conventional chat UIs.
const ROW_GAP = 3

// Visual constants matching MessageBubble.tsx CSS:
//   - text size 12 px, line-height ~1.5 → ~18 px per text line
//   - container padding (py-2) + header (~14 px + mb-1) + border ≈ 38 px
//   - text bubble width clamps wrap at roughly 80 chars on a 720-820 px center pane
const TEXT_LINE_HEIGHT_PX = 18
const VISIBLE_CHARS_PER_LINE = 80
const BUBBLE_CHROME_PX = 34
// Collapsed reasoning (extended-thinking) block — MessageBubble renders a
// closed <details> "Reasoning" toggle (~22 px summary row + 6 px mb-1.5
// margin) whenever a line carries `thinkingText` or `redactedThinkingCount`.
// Closed by default, so we only reserve the one summary row here; expanding
// it grows the wrapper, which the ResizeObserver then measures exactly. This
// keeps the FIRST-PAINT offset from underestimating thinking-bearing rows
// (the measured height overrides it the moment the wrapper mounts).
const REASONING_ROW_PX = 28

/**
 * Estimate row height from the line's content. Required for the absolutely-
 * positioned virtualizer: a fixed-height estimate (the original BUBBLE_HEIGHT
 * = 96) caused long messages to bleed into adjacent rows because the
 * bubble's natural HTML flow expanded beyond its allocated 96 px slot.
 *
 * The estimate counts wrapped lines (text length / chars-per-line) plus
 * explicit newline breaks, then multiplies by line-height and adds bubble
 * chrome. It's slightly conservative — we'd rather over-estimate (small
 * gap below short messages) than under-estimate (overlap).
 *
 * Tool rows render a single-line summary in `ToolUseRow.tsx` so 40 px
 * remains accurate for them.
 *
 * A collapsed reasoning block adds one `REASONING_ROW_PX` row when the
 * line carries `thinkingText` / `redactedThinkingCount` (Phase 1). This
 * mirrors MessageBubble: a thinking-bearing row with an empty body is
 * NOT compact (it renders the full bubble so the reasoning toggle has a
 * home), so we add the bubble chrome to it too rather than collapsing to
 * `BUBBLE_MIN_HEIGHT`.
 */
function rowHeight(line: TranscriptLine): number {
  if (line.isToolEvent) return TOOL_ROW_HEIGHT
  const hasThinking = (line.thinkingText?.length ?? 0) > 0 || (line.redactedThinkingCount ?? 0) > 0
  const reasoning = hasThinking ? REASONING_ROW_PX : 0
  const text = line.text || ''
  if (text.length === 0) {
    // Empty body: a thinking-bearing turn still renders the full bubble
    // (chrome + reasoning toggle); a plain empty wrapper stays compact.
    return hasThinking
      ? Math.max(BUBBLE_MIN_HEIGHT, BUBBLE_CHROME_PX + reasoning)
      : BUBBLE_MIN_HEIGHT
  }
  const explicitBreaks = (text.match(/\n/g) || []).length
  // wrapped lines for each natural paragraph (split on \n, ceiling on width)
  let wrappedLineCount = 0
  for (const para of text.split('\n')) {
    wrappedLineCount += Math.max(1, Math.ceil(para.length / VISIBLE_CHARS_PER_LINE))
  }
  // explicitBreaks already added the newlines; wrappedLineCount counts
  // paragraphs, so the total line count IS wrappedLineCount.
  void explicitBreaks
  return Math.max(BUBBLE_MIN_HEIGHT, wrappedLineCount * TEXT_LINE_HEIGHT_PX + BUBBLE_CHROME_PX + reasoning)
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
  /**
   * Currently pinned line index for the right-panel breakdown. The
   * matching bubble gets a subtle ring so the user can see which
   * point-in-time the panel is showing. `null` = pinned to "latest"
   * (no specific bubble highlighted).
   */
  pinnedLineIndex?: number | null
  /**
   * Click handler for bubbles. The transcript invokes this with the
   * bubble's `lineIndex` to pin, or with `null` to unpin (which
   * happens when the user clicks the already-pinned bubble).
   */
  onPinLineIndex?: (lineIndex: number | null) => void
  /**
   * Resolved avatar image URL for the agent that owns this transcript.
   * Threaded into every assistant `MessageBubble` so the role icon
   * renders as a real portrait matching the sidebar badge instead of
   * the generic sparkles glyph.
   */
  assistantAvatarUrl?: string | null
  /**
   * Optional Claude model id for the sticky-header cost roll-up. When
   * omitted, the model is derived from the most-recent assistant line that
   * carries one (`raw.message.model`). Additive — callers that already know
   * the session model (e.g. from the context breakdown's `modelId`) may pass
   * it to skip the scan. `null` / unknown → the roll-up is priced at the
   * sonnet-tier fallback and flagged. The dollar figure is ALWAYS an
   * INDICATIVE API-equivalent, never the user's flat-rate spend.
   */
  model?: string | null
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
    pinnedLineIndex = null,
    onPinLineIndex,
    assistantAvatarUrl = null,
    model = null,
  },
  ref,
) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState({ scrollTop: 0, clientHeight: 0 })

  // Tool-row expansion state lives at the transcript level so the
  // virtualizer's row offsets can react when the user opens / closes
  // a `ToolUseRow`. Keyed by `line.lineIndex` (stable JSONL line
  // number — doesn't shift when more rows are paged in). Local state
  // inside ToolUseRow would have grown the DOM without telling the
  // virtualizer, causing expanded JSON to bleed onto the next bubble.
  const [expandedToolKeys, setExpandedToolKeys] = useState<Set<number>>(() => new Set())

  const toggleTool = useCallback((lineIndex: number) => {
    setExpandedToolKeys(prev => {
      const next = new Set(prev)
      if (next.has(lineIndex)) next.delete(lineIndex)
      else next.add(lineIndex)
      return next
    })
  }, [])

  // ----- Multi-select for export-to-Markdown -----
  //
  // Each bubble carries a finger-sized checkbox at its left edge. A
  // user can tick any number of bubbles, then press the floating
  // "Export selected to Markdown" button at the bottom-right corner of
  // the transcript to download a `.md` file containing the selected
  // turns in JSONL line-order.
  //
  // We keep the selection set at this level so it survives scrolling
  // (virtualised rows are mounted/unmounted constantly — local state
  // would reset on every viewport change). The Set is keyed by
  // `line.lineIndex`, the stable JSONL line number.
  const [selectedLineIndexes, setSelectedLineIndexes] = useState<Set<number>>(() => new Set())

  const toggleSelected = useCallback((lineIndex: number) => {
    setSelectedLineIndexes(prev => {
      const next = new Set(prev)
      if (next.has(lineIndex)) next.delete(lineIndex)
      else next.add(lineIndex)
      return next
    })
  }, [])

  const clearSelected = useCallback(() => {
    setSelectedLineIndexes(new Set())
  }, [])

  // Build the markdown payload. Each selected bubble becomes a section
  // with a `## <ROLE> — <timestamp>` header followed by the body. Tool
  // rows render as a single fenced code block so the JSON payload is
  // trivially copy-pasteable. The order is the JSONL line order, which
  // matches what the user sees on screen.
  const exportSelectedAsMarkdown = useCallback(() => {
    if (selectedLineIndexes.size === 0) return
    const selected = lines.filter(l => selectedLineIndexes.has(l.lineIndex))
    const blocks: string[] = []
    blocks.push(`# Session transcript export`)
    blocks.push(`*${selected.length} message${selected.length === 1 ? '' : 's'} · exported ${new Date().toISOString()}*`)
    blocks.push('')
    for (const line of selected) {
      const ts = line.timestamp ?? ''
      const header = `## ${line.role.toUpperCase()}${ts ? ` — ${ts}` : ''}  *(line #${line.lineIndex})*`
      blocks.push(header)
      if (line.isToolEvent) {
        const toolName = line.toolName ?? 'tool'
        blocks.push(`\`\`\`json`)
        blocks.push(`{`)
        blocks.push(`  "tool": ${JSON.stringify(toolName)},`)
        if (line.toolInput !== undefined) {
          blocks.push(`  "input": ${JSON.stringify(line.toolInput, null, 2).split('\n').join('\n  ')},`)
        }
        if (line.toolResult !== undefined) {
          blocks.push(`  "result": ${JSON.stringify(line.toolResult, null, 2).split('\n').join('\n  ')}`)
        }
        blocks.push(`}`)
        blocks.push(`\`\`\``)
      } else {
        blocks.push(line.text || '*(empty)*')
      }
      blocks.push('')
    }
    const md = blocks.join('\n')
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `session-export-${new Date().toISOString().replace(/[:.]/g, '-')}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [lines, selectedLineIndexes])

  // ----- Measured row heights via ResizeObserver -----
  //
  // The character-based `rowHeight()` heuristic is ~7 % off for
  // captured `/context` output (~900 lines, 17K px actual) — enough
  // that the next bubble's `top` is computed inside the giant
  // bubble's natural-flow extent, causing visible content overlap.
  //
  // We measure each rendered wrapper's actual height with a single
  // shared ResizeObserver and prefer the measured value when
  // available. The heuristic stays as a first-paint estimate so
  // long lists don't all start at offset=0 before measurements
  // arrive. Hysteresis (>1 px tolerance) prevents render loops from
  // sub-pixel mutations.
  const measuredRowHeightsRef = useRef<Map<number, number>>(new Map())
  const [measuredVersion, setMeasuredVersion] = useState(0)
  const wrapperRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const resizeObserverRef = useRef<ResizeObserver | null>(null)

  useEffect(() => {
    const ro = new ResizeObserver(entries => {
      let dirty = false
      for (const entry of entries) {
        const el = entry.target as HTMLDivElement
        const idx = Number(el.dataset.lineIndex)
        if (!Number.isInteger(idx)) continue
        // Use offsetHeight so we include any borders/padding the
        // wrapper carries. contentRect tracks padding-box only.
        const h = el.offsetHeight
        const old = measuredRowHeightsRef.current.get(idx)
        if (old === undefined || Math.abs(old - h) > 1) {
          measuredRowHeightsRef.current.set(idx, h)
          dirty = true
        }
      }
      if (dirty) setMeasuredVersion(v => v + 1)
    })
    resizeObserverRef.current = ro
    // Re-observe any wrappers that mounted before this effect.
    for (const el of wrapperRefs.current.values()) ro.observe(el)
    return () => {
      ro.disconnect()
      resizeObserverRef.current = null
    }
  }, [])

  const measureRef = useCallback((lineIndex: number) => (el: HTMLDivElement | null) => {
    const ro = resizeObserverRef.current
    const prev = wrapperRefs.current.get(lineIndex)
    if (prev && prev !== el) {
      ro?.unobserve(prev)
      wrapperRefs.current.delete(lineIndex)
    }
    if (el) {
      el.dataset.lineIndex = String(lineIndex)
      wrapperRefs.current.set(lineIndex, el)
      ro?.observe(el)
      // Capture the initial height eagerly so the next offsets pass
      // doesn't have to wait for the first ResizeObserver fire.
      const h = el.offsetHeight
      const old = measuredRowHeightsRef.current.get(lineIndex)
      if (h > 0 && (old === undefined || Math.abs(old - h) > 1)) {
        measuredRowHeightsRef.current.set(lineIndex, h)
        setMeasuredVersion(v => v + 1)
      }
    }
  }, [])

  // Effective row height — measured wins, falling back to:
  //   - TOOL_ROW_EXPANDED_HEIGHT / TOOL_ROW_HEIGHT for tool rows
  //   - the char/4-derived `rowHeight()` heuristic otherwise
  const computeRowHeight = useCallback(
    (line: TranscriptLine): number => {
      const measured = measuredRowHeightsRef.current.get(line.lineIndex)
      if (measured !== undefined && measured > 0) return measured
      if (line.isToolEvent) {
        return expandedToolKeys.has(line.lineIndex) ? TOOL_ROW_EXPANDED_HEIGHT : TOOL_ROW_HEIGHT
      }
      return rowHeight(line)
    },
    [expandedToolKeys],
  )

  // Pre-compute row offsets for O(log n) binary search on scroll.
  // `measuredVersion` participates in deps so the array recomputes
  // when ResizeObserver discovers a row's true height differs from
  // the heuristic (the case that produced visible bubble overlap on
  // the captured `/context` block).
  const offsets = useMemo(() => {
    const o = new Array<number>(lines.length + 1)
    o[0] = 0
    for (let i = 0; i < lines.length; i++) {
      o[i + 1] = o[i] + computeRowHeight(lines[i]) + ROW_GAP
    }
    return o
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, computeRowHeight, measuredVersion])

  // Subtract one trailing ROW_GAP — the offsets-array recurrence
  // adds ROW_GAP after every row including the last, leaving
  // `ROW_GAP` px of phantom space below the final bubble. Cosmetic
  // but visible when the transcript fits the viewport.
  const totalHeight = Math.max(0, (offsets[offsets.length - 1] ?? 0) - ROW_GAP)

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

  // Session-level approximate cost roll-up for the sticky header. We sum the
  // already-summed `totalUsage` at the session model's family rate. This is
  // INDICATIVE only — the user pays a flat-rate Pro/Max subscription, so the
  // figure is a "what would this have cost at published per-token API rates"
  // yardstick, NEVER the user's actual spend. Memoized so we don't re-scan
  // for the model id (resolveSessionModel walks the lines from the end) on
  // every scroll-driven render. `null` totalUsage → no figure.
  const sessionCost = useMemo(() => {
    if (!totalUsage) return null
    const resolved = resolveSessionModel(lines, model)
    return {
      usd: approxCostUsd(totalUsage, resolved),
      fallback: isFallbackFamily(resolved),
    }
  }, [totalUsage, lines, model])

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
          <span className="inline-flex items-baseline gap-[5px] text-[12px] leading-[1.25] tracking-[0.01em] whitespace-nowrap tabular-nums text-emerald-300/90">
            in: {totalUsage.inputTokens.toLocaleString()} · out:{' '}
            {totalUsage.outputTokens.toLocaleString()} · cache:{' '}
            {totalUsage.cacheReadTokens.toLocaleString()} · total:{' '}
            {(
              totalUsage.inputTokens +
              totalUsage.outputTokens +
              totalUsage.cacheReadTokens
            ).toLocaleString()}
          </span>
          {/* Approximate session cost roll-up. ALWAYS an INDICATIVE
              API-equivalent figure (carries `~` + the caveat as its title),
              NEVER the user's flat-rate Pro/Max spend. Flagged when the
              session model is unknown (priced at the sonnet-tier fallback). */}
          {sessionCost && (
            <span
              className="inline-flex items-baseline gap-1 text-[12px] leading-[1.25] tracking-[0.01em] whitespace-nowrap tabular-nums"
              title={`${APPROX_COST_CAVEAT}${sessionCost.fallback ? ' (model unknown — priced at sonnet-tier rates)' : ''}`}
            >
              <span className="text-gray-500 uppercase tracking-wider font-medium">~cost</span>
              <span className="font-semibold text-gray-200">~{formatUsd(sessionCost.usd)}</span>
              {sessionCost.fallback && (
                <span className="text-amber-300/70 normal-case tracking-normal text-[10px]">est.</span>
              )}
            </span>
          )}
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
        className="relative flex-1 min-h-0 overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 touch-pan-y overscroll-contain"
      >
        <div style={{ height: totalHeight, position: 'relative' }}>
          {visibleLines.map((line, i) => {
            const index = startIndex + i
            const top = offsets[index]
            const isCurrent = currentMatchLine !== null && currentMatchLine === line.lineIndex
            const isPinned = pinnedLineIndex !== null && pinnedLineIndex === line.lineIndex
            const isSelected = selectedLineIndexes.has(line.lineIndex)
            // ROLE → SIDE: the human (a genuine `user` message) anchors
            // RIGHT; every agent role (assistant / system / tool) anchors
            // LEFT. `&& !isToolEvent` is the defensive half: a tool_result
            // block arrives inside a `user`-role record, but it is agent
            // activity rendered by `ToolUseRow`, so it must stay LEFT — the
            // raw role alone would wrongly flip it right. Tool events route
            // to `<ToolUseRow>` below regardless; this guard keeps the
            // wrapper justification correct for that branch too.
            const isHuman = line.role === 'user' && !line.isToolEvent
            // Pin/unpin click handler — clicking a bubble that's already
            // pinned unpins (sets pin to null), otherwise pins to that
            // line. Click events that originate from the export
            // checkbox or copy-to-clipboard button stop their own
            // propagation, so they never reach this handler.
            const handlePinClick = onPinLineIndex
              ? (e: React.MouseEvent) => {
                  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
                  const selection = window.getSelection()
                  if (selection && selection.toString().length > 0) return
                  onPinLineIndex(isPinned ? null : line.lineIndex)
                }
              : undefined
            // Two visual states only: pinned (emerald ring on the
            // inner card) or default (no chrome change). The earlier
            // "faded" dim of every non-pinned row was rejected by user
            // feedback — non-pinned bubbles now keep their default
            // appearance regardless of whether another row is pinned.
            //
            // This wrapper is the `group` + `data-pinned` hook the inner
            // cards (MessageBubble / ToolUseRow) read for their
            // hover/pinned glow. The glow box-shadows live on the inner
            // card as `group-hover:`/`group-data-[pinned=true]:` variants
            // (parity with the former `.aim-bubble-*:hover .aim-msg-card`
            // descendant rules) — so the `group` class and the
            // `data-pinned` attribute MUST stay on this exact element or
            // the cards lose their pin/hover chrome entirely.
            return (
              <div
                key={`${line.lineIndex}-${line.role}`}
                ref={measureRef(line.lineIndex)}
                style={{
                  position: 'absolute',
                  top,
                  left: 0,
                  right: 0,
                  // Natural content height — NO `minHeight: h`. Setting
                  // minHeight to the heuristic estimate trapped the
                  // ResizeObserver inside the floor: even after the
                  // wrapper rendered shorter content, offsetHeight
                  // still reported `h`, so offsets never shrank and
                  // empty space accumulated below short rows
                  // (especially compact wrapper bubbles). With the
                  // floor removed, ResizeObserver captures the true
                  // height and the offsets recompute on
                  // measuredVersion bumps. `h` survives only as the
                  // first-paint estimate inside the offsets array.
                  padding: '0 12px',
                  cursor: handlePinClick ? 'pointer' : undefined,
                }}
                onClick={handlePinClick}
                aria-label={
                  isPinned
                    ? 'Pinned to context breakdown panel — click to unpin'
                    : 'Click to pin context breakdown to this message'
                }
                data-pinned={isPinned || undefined}
                className="group rounded-md transition-shadow duration-200 ease-out"
              >
                {/* Comic two-sided layout. The OUTER flex justifies the
                    bubble group to its side (human → end/right, agent →
                    start/left). The INNER group clamps to ~80% of the
                    pane width so a true two-sided conversation reads, and
                    flips direction for the human so the selection checkbox
                    mirrors to the bubble's outer edge. The bubble itself is
                    content-sized (`min-w-0`, no flex-grow), so a short turn
                    hugs its side while a long turn wraps at the 80% clamp.
                    Tool rows always anchor LEFT (agent activity) and skip
                    the bubble's own copy button via ToolUseRow, but still
                    carry the checkbox so they can be exported. */}
                <div className={`flex ${isHuman ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`flex items-start gap-2 max-w-[80%] min-w-0 ${isHuman ? 'flex-row-reverse' : 'flex-row'}`}
                  >
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={isSelected}
                      aria-label={
                        isSelected
                          ? `Unselect message at line ${line.lineIndex} from export`
                          : `Select message at line ${line.lineIndex} for Markdown export`
                      }
                      title={isSelected ? 'Selected for export — click to unselect' : 'Select for Markdown export'}
                      className="flex-shrink-0 w-8 h-8 mt-1 inline-flex items-center justify-center rounded-md border-[1.5px] border-gray-400/60 bg-gray-900/55 text-transparent transition-colors cursor-pointer hover:border-emerald-500/80 hover:bg-gray-800/80 data-[checked=true]:bg-emerald-500 data-[checked=true]:border-emerald-500 data-[checked=true]:text-gray-900"
                      data-checked={isSelected || undefined}
                      onClick={e => {
                        e.stopPropagation()
                        toggleSelected(line.lineIndex)
                      }}
                    >
                      {isSelected && <Check className="w-4 h-4" strokeWidth={3} />}
                    </button>
                    <div className="min-w-0">
                      {line.isToolEvent ? (
                        <ToolUseRow
                          line={line}
                          expanded={expandedToolKeys.has(line.lineIndex)}
                          onToggle={() => toggleTool(line.lineIndex)}
                        />
                      ) : (
                        <MessageBubble
                          line={line}
                          highlightQuery={normalisedQuery}
                          currentMatch={isCurrent}
                          assistantAvatarUrl={assistantAvatarUrl}
                        />
                      )}
                    </div>
                  </div>
                </div>
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
        {/* Floating Export-to-Markdown FAB. Sits in the bottom-right
            corner of the scrollable viewport, offset from the right
            edge so the (touch-friendly, fat) browser scrollbar
            doesn't overlap it. Disabled state when no rows are
            selected; alt+click clears selection without exporting. */}
        {selectedLineIndexes.size > 0 && (
          <button
            type="button"
            className="absolute bottom-4 right-7 z-[5] inline-flex items-center gap-1.5 px-3.5 py-[9px] rounded-full text-[12px] font-semibold tracking-[0.02em] bg-emerald-500 text-gray-900 border border-emerald-600 shadow-[0_8px_24px_-4px_rgba(16,185,129,0.55),0_2px_6px_rgba(0,0,0,0.35)] transition-[transform,box-shadow] duration-[120ms] hover:-translate-y-px hover:shadow-[0_10px_28px_-4px_rgba(16,185,129,0.7),0_3px_8px_rgba(0,0,0,0.4)] disabled:opacity-50 disabled:pointer-events-none"
            onClick={e => {
              if (e.altKey) {
                clearSelected()
                return
              }
              exportSelectedAsMarkdown()
            }}
            aria-label={`Export ${selectedLineIndexes.size} selected message${selectedLineIndexes.size === 1 ? '' : 's'} as Markdown`}
            title={`Export ${selectedLineIndexes.size} selected to Markdown · alt-click to clear selection`}
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export to .md</span>
            <span className="inline-flex items-center justify-center min-w-[20px] h-[18px] px-1.5 ml-0.5 rounded-full bg-gray-900/85 text-emerald-300 text-[10px] font-bold">{selectedLineIndexes.size}</span>
          </button>
        )}
      </div>
    </div>
  )
})

export default ChatTranscript
