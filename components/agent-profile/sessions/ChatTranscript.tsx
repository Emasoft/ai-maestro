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
import { Check, Download, FileText, Printer, X } from 'lucide-react'
import type { TranscriptLine, MessageUsage } from '@/types/sessions-browser'
import { approxCostUsd, formatUsd, isFallbackFamily, APPROX_COST_CAVEAT } from '@/lib/token-cost'
import { toMarkdown } from '@/lib/session-export'
import { stripAnsi } from '@/lib/ansi'
import MessageBubble from './MessageBubble'
import ToolUseRow from './ToolUseRow'
import TimelineRuler, { type RulerRow } from './TimelineRuler'

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

// Width of the left chronological ruler gutter (TimelineRuler). The absolute
// rows are inset by exactly this much (`left: RULER_GUTTER_PX`) so the bubbles
// clear the ticks + the `HH:MM:SS` timestamp labels. 56 px holds a `00:00:00`
// 9 px-mono stamp (~48 px) plus the spine/tick margin without an inner
// horizontal scroller. Kept as the single source of truth shared by the ruler
// (`widthPx`) and the rows' `left` inset so they can never disagree.
const RULER_GUTTER_PX = 56

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

// ---------------------------------------------------------------------------
// Client-side print-to-PDF helpers (pure string builders — NO DOM access).
//
// `buildPrintHtml` returns a complete, self-contained HTML document for the
// selected interval. It is written ONLY into a freshly-opened popup window's
// own document (see `exportSelectedAsPdf`), never into the app DOM, and every
// dynamic value is HTML-escaped first, so there is no XSS / no-innerHTML-on-app
// surface. The PDF comes from the browser's "Save as PDF" on `window.print()`.
// ---------------------------------------------------------------------------

/** Escape the five HTML-significant characters so a string is safe to embed
 *  verbatim in markup. Used for every dynamic value in the print document. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Recursively strip ANSI from every string leaf of a JSON-able value, then
 *  return a structurally-identical clone. This MUST run BEFORE `JSON.stringify`:
 *  a captured-stdout string carries a real ESC byte (`\x1b`), but
 *  `JSON.stringify` escapes it into the literal `` text, which
 *  `stripAnsi`'s ESC-byte regex can no longer match — so stripping after
 *  serialisation leaves visible `[..m` artefacts in the printed PDF.
 *  Mirrors `session-export.ts::stripAnsiDeep` so the .md and PDF exports
 *  produce identical, ANSI-free tool payloads. Primitives pass through; no
 *  cycle guard is needed (Claude Code tool payloads are plain JSON). */
function stripAnsiDeep(value: unknown): unknown {
  if (typeof value === 'string') return stripAnsi(value)
  if (Array.isArray(value)) return value.map(stripAnsiDeep)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = stripAnsiDeep(v)
    }
    return out
  }
  return value
}

/** Local `YYYY-MM-DD HH:MM:SS` stamp for the print heading — same shape and
 *  source priority as the on-screen bubbles (tsMs first, ISO fallback). */
function printStamp(line: TranscriptLine): string {
  let d: Date | null = null
  if (Number.isFinite(line.tsMs) && line.tsMs > 0) d = new Date(line.tsMs)
  else if (line.timestamp) {
    const parsed = new Date(line.timestamp)
    if (!Number.isNaN(parsed.getTime())) d = parsed
  }
  if (!d || Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** Build the inner `<section>` markup for one selected turn (escaped). */
function printTurn(line: TranscriptLine): string {
  const role = line.isToolEvent ? 'TOOL' : line.role.toUpperCase()
  const stamp = printStamp(line)
  const head = `<h2>${escapeHtml(role)}${stamp ? ` <span class="ts">— ${escapeHtml(stamp)}</span>` : ''}</h2>`

  const parts: string[] = [head]

  // Reasoning blockquote (ANSI stripped).
  const thinking = (line.thinkingText ?? '').trim()
  const redacted = line.redactedThinkingCount ?? 0
  if (thinking.length > 0 || redacted > 0) {
    const inner: string[] = ['<strong>reasoning</strong>']
    if (thinking.length > 0) inner.push(escapeHtml(stripAnsi(thinking)))
    if (redacted > 0) inner.push(`<em>[redacted reasoning ×${redacted}]</em>`)
    parts.push(`<blockquote>${inner.join('<br/>')}</blockquote>`)
  }

  if (line.isToolEvent) {
    const payload: Record<string, unknown> = { tool: line.toolName ?? 'tool' }
    // Strip ANSI from the RAW string leaves BEFORE serialising. A captured
    // tool_result string holds a real ESC byte; JSON.stringify would escape it
    // to the literal `` (which stripAnsi can no longer match), so stripping
    // post-serialisation would leak `[32m`-style codes into the PDF. Deep-
    // strip first, then pretty-print — same contract as the .md exporter.
    if (line.toolInput !== undefined) payload.input = stripAnsiDeep(line.toolInput)
    if (line.toolResult !== undefined) payload.result = stripAnsiDeep(line.toolResult)
    const json = JSON.stringify(payload, null, 2)
    parts.push(`<pre class="tool">${escapeHtml(json)}</pre>`)
  } else {
    const body = stripAnsi(line.text ?? '')
    if (body.length === 0) parts.push(`<p class="empty">(empty)</p>`)
    else parts.push(`<pre class="body">${escapeHtml(body)}</pre>`)
  }

  return `<section class="turn">${parts.join('')}</section>`
}

/** Assemble the full print document. Self-contained: inline <style>, no
 *  external assets, no scripts that touch the opener. */
/**
 * Whether the viewer asked the OS to minimise motion. Read live (not
 * cached) so a mid-session setting flip is honoured. SSR-safe: returns
 * `false` when `window.matchMedia` is unavailable. Used to downgrade every
 * imperative `behavior: 'smooth'` scroll to an instant `'auto'` jump — the
 * Tailwind `motion-reduce:` variants only govern CSS `scroll-behavior`, which
 * does NOT apply to programmatic `scrollTo({ behavior })` calls, so the JS
 * path needs its own guard.
 */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function buildPrintHtml(lines: TranscriptLine[]): string {
  const turns = lines.map(printTurn).join('\n')
  // Minimal, print-optimised stylesheet. Light background for ink economy.
  // No inner scrollers — content flows and paginates naturally.
  const style = `
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body { font: 13px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
           color: #111; background: #fff; margin: 24px; }
    h1 { font-size: 18px; margin: 0 0 4px; }
    .meta { color: #666; font-size: 11px; margin: 0 0 16px; }
    .turn { margin: 0 0 18px; page-break-inside: avoid; }
    h2 { font-size: 13px; letter-spacing: 0.04em; text-transform: uppercase;
         color: #0a7d54; margin: 0 0 6px; border-bottom: 1px solid #e3e3e3; padding-bottom: 3px; }
    h2 .ts { color: #999; font-weight: 400; text-transform: none; letter-spacing: 0; }
    blockquote { margin: 0 0 8px; padding: 6px 10px; border-left: 3px solid #c8c8c8;
                 color: #555; background: #f6f6f6; font-size: 12px; }
    pre { white-space: pre-wrap; word-break: break-word; margin: 0;
          font: 12px/1.45 'SF Mono', ui-monospace, Menlo, Consolas, monospace; }
    pre.tool { background: #f3f4f6; border: 1px solid #e3e3e3; border-radius: 4px; padding: 8px 10px; }
    pre.body { color: #111; }
    .empty { color: #aaa; font-style: italic; margin: 0; }
    @media print { body { margin: 0; } }`
  const now = escapeHtml(new Date().toLocaleString())
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8"/>',
    '<title>Session transcript export</title>',
    `<style>${style}</style>`,
    '</head><body>',
    '<h1>Session transcript export</h1>',
    `<p class="meta">${lines.length} message${lines.length === 1 ? '' : 's'} · exported ${now}</p>`,
    turns,
    '</body></html>',
  ].join('\n')
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

  // The export FAB opens a small two-action menu (Markdown / PDF). The menu
  // open state lives here so a click outside (or Escape) can dismiss it. We
  // do NOT auto-open — the FAB toggles it — so a misclick never spams a
  // download.
  const [exportMenuOpen, setExportMenuOpen] = useState(false)

  // The selected lines in JSONL line-order. The transcript already presents
  // bubbles in `lines` order, so filtering preserves what the user sees.
  // Memoised on the selection set + the lines so the export handlers and the
  // print view share ONE source of truth (no second filter that could drift).
  const selectedLines = useMemo(
    () => lines.filter(l => selectedLineIndexes.has(l.lineIndex)),
    [lines, selectedLineIndexes],
  )

  // (a) Markdown — serialise the selected interval via the pure
  // `toMarkdown` helper and trigger a CLIENT-SIDE download (Blob → object
  // URL → temporary <a download> → revoke). No server round-trip.
  const exportSelectedAsMarkdown = useCallback(() => {
    if (selectedLines.length === 0) return
    const md = toMarkdown(selectedLines, { title: 'Session transcript export' })
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `session-export-${new Date().toISOString().replace(/[:.]/g, '-')}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    setExportMenuOpen(false)
  }, [selectedLines])

  // (b) PDF — CLIENT-SIDE print-to-PDF. We open a fresh window, write a
  // print-friendly HTML document built from React-escaped strings (NO
  // innerHTML on the app DOM — the only `document.write` happens on the
  // brand-new window we just opened, never on our own page), and call
  // `print()` so the browser's "Save as PDF" produces the file. No new
  // dependency, no server round-trip.
  //
  // Why a popup rather than `print:` utilities on the live DOM: the
  // transcript is a virtualised window — only ~20 rows are mounted at any
  // time, so a `window.print()` of the live page would only ever print the
  // visible slice. Rendering the FULL selected interval into a throwaway
  // document is the only way to print rows that aren't currently mounted.
  const exportSelectedAsPdf = useCallback(() => {
    if (selectedLines.length === 0) return
    setExportMenuOpen(false)
    // NOTE: we deliberately do NOT pass `noopener` in the features string —
    // `window.open(..., 'noopener')` returns `null` per spec (it severs the
    // handle), and we NEED the handle to write the print document into the
    // new window. We sever the opener reference manually below instead, so
    // the popup still cannot navigate us.
    const win = window.open('', '_blank', 'width=900,height=1000')
    if (!win) return // popup blocked — silently no-op (the .md path still works)
    // Defensively null out the back-reference so the popup can't reach back
    // into the opener (parity with what `noopener` would have given us).
    try {
      win.opener = null
    } catch {
      // Some engines mark `opener` read-only on a same-origin blank window;
      // the document we write is our own escaped markup with no scripts, so
      // a non-null opener here is harmless.
    }
    const html = buildPrintHtml(selectedLines)
    // `win.document` is the popup's OWN document, not the app DOM. Writing
    // an escaped, self-contained string here cannot inject into our page.
    win.document.open()
    win.document.write(html)
    win.document.close()
    // Give the new document a tick to lay out before invoking print, then
    // close the popup once the user finishes the print dialog.
    win.focus()
    const fire = () => {
      win.print()
    }
    if (win.document.readyState === 'complete') {
      // Defer one frame so fonts/layout settle.
      win.setTimeout(fire, 50)
    } else {
      win.addEventListener('load', () => win.setTimeout(fire, 50))
    }
  }, [selectedLines])

  // The export menu can never outlive a non-empty selection: when the user
  // unticks the last bubble the FAB itself unmounts, so close the menu too.
  // (Without this the `exportMenuOpen` state could stay `true` and the menu
  // would flash open the next time a selection appears.)
  useEffect(() => {
    if (selectedLineIndexes.size === 0 && exportMenuOpen) setExportMenuOpen(false)
  }, [selectedLineIndexes, exportMenuOpen])

  // Escape closes the open export menu (a11y: every transient popover must be
  // dismissible from the keyboard without reaching for the mouse). Bound at
  // the window level only while the menu is open so we don't add a global
  // listener for the common closed state.
  useEffect(() => {
    if (!exportMenuOpen) return
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setExportMenuOpen(false)
      }
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [exportMenuOpen])

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

  // Geometry for the left chronological ruler — ONE entry per visible row,
  // never the full transcript, so the ruler stays O(visible) exactly like the
  // rows. We read the SAME `offsets[]` the rows use (single source of truth):
  // the effective row height is `offsets[index+1] - offsets[index] - ROW_GAP`
  // because the offsets recurrence is `o[i+1] = o[i] + height + ROW_GAP`. This
  // means a measured-height change (ResizeObserver → `offsets` recompute) flows
  // into the ruler tick positions automatically, keeping ticks aligned with
  // bubbles even after a tall `/context` block is measured. Keyed on the window
  // bounds + offsets identity so it recomputes only when the visible set or the
  // geometry changes — not on unrelated re-renders.
  const visibleRulerRows = useMemo<RulerRow[]>(() => {
    const rows: RulerRow[] = []
    for (let i = 0; i < visibleLines.length; i++) {
      const index = startIndex + i
      const top = offsets[index]
      const height = Math.max(0, offsets[index + 1] - offsets[index] - ROW_GAP)
      rows.push({ line: visibleLines[i], top, height })
    }
    return rows
  }, [visibleLines, startIndex, offsets])

  // API exposed to parent for scroll-to-match + programmatic scrollToBottom.
  useImperativeHandle(
    ref,
    () => ({
      scrollToLine: (lineIndex: number) => {
        const el = scrollRef.current
        if (!el) return
        if (lineIndex < 0 || lineIndex >= offsets.length - 1) return
        const targetTop = offsets[lineIndex]
        // Center the match roughly in the viewport. Honour reduced-motion:
        // an instant jump instead of a smooth glide when requested.
        const desired = Math.max(0, targetTop - el.clientHeight / 3)
        el.scrollTo({ top: desired, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
      },
      scrollToBottom: () => {
        const el = scrollRef.current
        if (!el) return
        el.scrollTo({ top: el.scrollHeight, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
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
      // Reduced-motion downgrades every smooth glide to an instant jump.
      const behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth'
      if (e.key === 'j' || e.key === 'ArrowDown') {
        el.scrollBy({ top: STEP, behavior })
        handled = true
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        el.scrollBy({ top: -STEP, behavior })
        handled = true
      } else if (e.key === 'Home') {
        el.scrollTo({ top: 0, behavior })
        handled = true
      } else if (e.key === 'End') {
        el.scrollTo({ top: el.scrollHeight, behavior })
        handled = true
      } else if (e.key === 'PageDown') {
        el.scrollBy({ top: el.clientHeight * 0.9, behavior })
        handled = true
      } else if (e.key === 'PageUp') {
        el.scrollBy({ top: -el.clientHeight * 0.9, behavior })
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
          {/* Left chronological ruler — lives INSIDE this same `totalHeight`
              spacer (and the same scroll container) so it scrolls in lock-step
              with the absolute rows and its ticks share their exact `offsets[]`
              coordinate space. `left:0` pins it to the gutter; the rows below
              are inset by `RULER_GUTTER_PX` so bubbles clear the ticks. */}
          <TimelineRuler
            visible={visibleRulerRows}
            totalHeight={totalHeight}
            widthPx={RULER_GUTTER_PX}
          />
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
                  // Inset past the left chronological ruler gutter so the
                  // comic bubbles clear the ticks + timestamp labels. The
                  // bubbles keep their agent-left / human-right justification
                  // WITHIN this inset content area (the inner flex below). The
                  // gutter width is the shared `RULER_GUTTER_PX` constant the
                  // ruler also reads, so the two can never drift apart.
                  left: RULER_GUTTER_PX,
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
        {/* Floating Export FAB + popover menu. Sits in the bottom-right
            corner of the scrollable viewport, offset from the right edge so
            the (touch-friendly, fat) browser scrollbar doesn't overlap it.
            The FAB toggles a two-action menu (Markdown / PDF) plus a clear-
            selection escape. Both the FAB and every action are >=44px touch
            targets, keyboard-focusable, and focus-visible. Transitions carry
            `motion-reduce:` variants so reduced-motion users get no glide. */}
        {selectedLineIndexes.size > 0 && (
          <div className="absolute bottom-4 right-7 z-[5] flex flex-col items-end gap-2">
            {/* Action menu — only mounted while open. Rendered ABOVE the FAB
                (column-reverse via DOM order: menu first, FAB last visually
                because the wrapper is a normal column and the menu precedes
                the FAB). Each item is a full-width >=44px row. */}
            {exportMenuOpen && (
              <div
                role="menu"
                aria-label="Export selected messages"
                className="flex flex-col w-56 overflow-hidden rounded-xl border border-gray-700 bg-gray-900/97 backdrop-blur shadow-[0_12px_32px_-6px_rgba(0,0,0,0.6)]"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={exportSelectedAsMarkdown}
                  className="flex items-center gap-2.5 min-h-[44px] px-4 py-2.5 text-left text-[13px] font-medium text-gray-200 transition-colors duration-150 motion-reduce:transition-none hover:bg-emerald-500/15 hover:text-emerald-200 focus:outline-none focus-visible:bg-emerald-500/20 focus-visible:text-emerald-100"
                >
                  <FileText className="w-4 h-4 flex-shrink-0 text-emerald-400" />
                  <span className="flex-1">Markdown (.md)</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={exportSelectedAsPdf}
                  className="flex items-center gap-2.5 min-h-[44px] px-4 py-2.5 text-left text-[13px] font-medium text-gray-200 border-t border-gray-800 transition-colors duration-150 motion-reduce:transition-none hover:bg-emerald-500/15 hover:text-emerald-200 focus:outline-none focus-visible:bg-emerald-500/20 focus-visible:text-emerald-100"
                >
                  <Printer className="w-4 h-4 flex-shrink-0 text-emerald-400" />
                  <span className="flex-1">PDF (print / save)</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    clearSelected()
                    setExportMenuOpen(false)
                  }}
                  className="flex items-center gap-2.5 min-h-[44px] px-4 py-2.5 text-left text-[13px] font-medium text-gray-400 border-t border-gray-800 transition-colors duration-150 motion-reduce:transition-none hover:bg-red-500/15 hover:text-red-200 focus:outline-none focus-visible:bg-red-500/20 focus-visible:text-red-100"
                >
                  <X className="w-4 h-4 flex-shrink-0" />
                  <span className="flex-1">Clear selection</span>
                </button>
              </div>
            )}

            {/* The FAB itself. >=44px tall, full focus-visible ring, motion-
                reduce drops the hover lift + shadow transition. Click toggles
                the menu; aria-expanded reflects menu state. */}
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={exportMenuOpen}
              onClick={() => setExportMenuOpen(o => !o)}
              className="inline-flex items-center gap-1.5 min-h-[44px] px-4 py-[10px] rounded-full text-[12px] font-semibold tracking-[0.02em] bg-emerald-500 text-gray-900 border border-emerald-600 shadow-[0_8px_24px_-4px_rgba(16,185,129,0.55),0_2px_6px_rgba(0,0,0,0.35)] transition-[transform,box-shadow] duration-[120ms] motion-reduce:transition-none hover:-translate-y-px motion-reduce:hover:translate-y-0 hover:shadow-[0_10px_28px_-4px_rgba(16,185,129,0.7),0_3px_8px_rgba(0,0,0,0.4)] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
              aria-label={`Export ${selectedLineIndexes.size} selected message${selectedLineIndexes.size === 1 ? '' : 's'}`}
              title={`Export ${selectedLineIndexes.size} selected — Markdown or PDF`}
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export</span>
              <span className="inline-flex items-center justify-center min-w-[20px] h-[18px] px-1.5 ml-0.5 rounded-full bg-gray-900/85 text-emerald-300 text-[10px] font-bold">{selectedLineIndexes.size}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
})

export default ChatTranscript
