'use client'

/**
 * MessageBubble — renders a single transcript line (user/assistant/system)
 * with role-coloring, optional token badge, and optional search highlight.
 *
 * Spec (TRDD-d46b42e9 Phase 3 §6.3.3):
 *   - Each assistant bubble has `in: N · out: N · cache: N` in small-caps
 *     monospace at top-right.
 *   - Role colors: user=blue, assistant=emerald, system=gray.
 *   - Tool events are rendered by <ToolUseRow>, NOT this component.
 */

import { useMemo } from 'react'
import { User, Sparkles, Terminal as TerminalIcon } from 'lucide-react'
import type { TranscriptLine } from '@/types/sessions-browser'
import { parseAnsi, stripAnsi } from '@/lib/ansi'

interface MessageBubbleProps {
  line: TranscriptLine
  /** Current search query (already .toLowerCase()) — empty string disables highlight. */
  highlightQuery?: string
  /** Current match position in this line's text, if this line IS the current match. */
  currentMatch?: boolean
}

// Role-based palette. Border / fill opacities bumped so the bubble
// reads as a defined card instead of a faint outline — previous /5
// fill was barely visible, /20 border too thin to track in a long
// transcript. The pin / hover / faded states layered in
// styles/sessions-browser.css (.aim-bubble-* classes) further
// modulate brightness without rewriting the role classes.
const ROLE_STYLES: Record<string, { wrapper: string; label: string; text: string; icon: typeof User }> = {
  user: {
    wrapper: 'border-blue-500/40 bg-blue-500/[0.08]',
    label: 'text-blue-300',
    text: 'text-gray-100',
    icon: User,
  },
  assistant: {
    wrapper: 'border-emerald-500/40 bg-emerald-500/[0.08]',
    label: 'text-emerald-300',
    text: 'text-gray-100',
    icon: Sparkles,
  },
  system: {
    wrapper: 'border-gray-600/50 bg-gray-800/40',
    label: 'text-gray-400',
    text: 'text-gray-300',
    icon: TerminalIcon,
  },
  tool: {
    wrapper: 'border-violet-500/40 bg-violet-500/[0.08]',
    label: 'text-violet-300',
    text: 'text-gray-200',
    icon: TerminalIcon,
  },
}

function formatTokenNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

/**
 * Split `text` on case-insensitive occurrences of `query` and return an array
 * of segments with an `isMatch` flag. Returns a single-entry array when the
 * query is empty or not found. Uses an iterative indexOf to avoid regex
 * surprises with user input.
 */
function splitOnMatches(text: string, query: string): Array<{ part: string; isMatch: boolean }> {
  if (!query || query.length === 0) return [{ part: text, isMatch: false }]
  const lowerText = text.toLowerCase()
  const out: Array<{ part: string; isMatch: boolean }> = []
  let cursor = 0
  while (cursor < text.length) {
    const idx = lowerText.indexOf(query, cursor)
    if (idx < 0) {
      out.push({ part: text.slice(cursor), isMatch: false })
      break
    }
    if (idx > cursor) {
      out.push({ part: text.slice(cursor, idx), isMatch: false })
    }
    out.push({ part: text.slice(idx, idx + query.length), isMatch: true })
    cursor = idx + query.length
  }
  if (cursor === 0) return [{ part: text, isMatch: false }]
  return out
}

/**
 * Render a piece of bubble text — possibly carrying ANSI escape codes
 * from a `local-command-stdout` capture — as a list of styled spans
 * with the search-highlight overlay applied at the top level.
 *
 * The pipeline:
 *   1. `parseAnsi(text)` → segments of `{text, style}` (style = the
 *      cumulative SGR state at that point).
 *   2. For each segment, run `splitOnMatches(seg.text, lowerQuery)` so
 *      the highlight survives the styling layer. Match parts wear the
 *      `<mark>` chrome on top of the SGR style.
 *
 * Plain (no-ANSI) text round-trips through `parseAnsi` as a single
 * unstyled segment, so non-tty messages render exactly the same as
 * before this change.
 */
function renderBubbleText(text: string, lowerQuery: string, currentMatch: boolean) {
  const ansiSegments = parseAnsi(text)
  const out: React.ReactNode[] = []
  let key = 0
  for (const seg of ansiSegments) {
    const parts = splitOnMatches(seg.text, lowerQuery)
    for (const p of parts) {
      if (!p.part) continue
      if (p.isMatch) {
        out.push(
          <mark
            key={key++}
            style={seg.style}
            className={currentMatch ? 'aim-match aim-match-current' : 'aim-match'}
          >
            {p.part}
          </mark>,
        )
      } else if (Object.keys(seg.style).length > 0) {
        out.push(<span key={key++} style={seg.style}>{p.part}</span>)
      } else {
        out.push(<span key={key++}>{p.part}</span>)
      }
    }
  }
  return out
}

export default function MessageBubble({ line, highlightQuery = '', currentMatch = false }: MessageBubbleProps) {
  const styles = ROLE_STYLES[line.role] ?? ROLE_STYLES.system
  const Icon = styles.icon

  // Render with ANSI color awareness so `/context`, `/skills`, etc.
  // outputs appear as styled text instead of literal `\x1b[…]m`
  // garbage. The plain-text version (used by aria-label and search
  // matching) still strips ANSI so screen readers and the search
  // engine see only the readable letters.
  const ansiPlainText = useMemo(() => stripAnsi(line.text), [line.text])
  const renderedBody = useMemo(
    () => renderBubbleText(line.text, highlightQuery, currentMatch),
    [line.text, highlightQuery, currentMatch],
  )

  // Unique id pairing role + line index for aria-labelledby.
  const labelId = `aim-msg-label-${line.lineIndex}`

  return (
    <div
      role="article"
      aria-labelledby={labelId}
      // `border-[1.5px]` is a small bump from the default 1px — at the
      // 12px text size of the bubble the extra half-pixel tightens the
      // visual frame without crossing into "boxed-in" territory. The
      // `aim-msg-card` hook lets the wrapper classes in
      // styles/sessions-browser.css adjust card-level brightness
      // (pinned vs faded) without rewriting the role-color rules.
      className={`aim-msg-card relative rounded-md border-[1.5px] px-3 py-2 text-[12px] ${styles.wrapper}`}
    >
      <div className="flex items-start gap-2">
        <Icon className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${styles.label}`} />
        <div className="flex-1 min-w-0">
          <div id={labelId} className={`text-[10px] font-semibold uppercase tracking-wider mb-1 ${styles.label}`}>
            {line.role}
            {line.timestamp && (
              <span className="ml-2 text-gray-500 font-normal tracking-normal normal-case">
                {line.timestamp}
              </span>
            )}
          </div>
          <div
            className={`whitespace-pre-wrap break-words font-mono text-[12px] ${styles.text}`}
            // The aria-label gives assistive tech the plain-text view
            // (no ANSI codes) of bubbles whose body otherwise carries
            // colored terminal output.
            aria-label={ansiPlainText || undefined}
          >
            {renderedBody}
            {line.text === '' && (
              <span className="text-gray-500 italic">(empty)</span>
            )}
          </div>
        </div>
        {line.usage && line.role === 'assistant' && (
          <div
            className="aim-msg-tokens ml-2 flex-shrink-0"
            aria-label={`Tokens — input ${line.usage.inputTokens}, output ${line.usage.outputTokens}, cache ${line.usage.cacheReadTokens}`}
            title={`in=${line.usage.inputTokens} out=${line.usage.outputTokens} cache=${line.usage.cacheReadTokens}`}
          >
            <span className="aim-msg-tokens-label">IN</span>
            <span className="aim-msg-tokens-value">{formatTokenNumber(line.usage.inputTokens)}</span>
            <span className="aim-msg-tokens-sep">·</span>
            <span className="aim-msg-tokens-label">OUT</span>
            <span className="aim-msg-tokens-value">{formatTokenNumber(line.usage.outputTokens)}</span>
            <span className="aim-msg-tokens-sep">·</span>
            <span className="aim-msg-tokens-label">CACHE</span>
            <span className="aim-msg-tokens-value">{formatTokenNumber(line.usage.cacheReadTokens)}</span>
          </div>
        )}
      </div>
    </div>
  )
}
