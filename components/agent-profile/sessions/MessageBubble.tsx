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

interface MessageBubbleProps {
  line: TranscriptLine
  /** Current search query (already .toLowerCase()) — empty string disables highlight. */
  highlightQuery?: string
  /** Current match position in this line's text, if this line IS the current match. */
  currentMatch?: boolean
}

const ROLE_STYLES: Record<string, { wrapper: string; label: string; text: string; icon: typeof User }> = {
  user: {
    wrapper: 'border-blue-500/20 bg-blue-500/5',
    label: 'text-blue-300',
    text: 'text-gray-100',
    icon: User,
  },
  assistant: {
    wrapper: 'border-emerald-500/20 bg-emerald-500/5',
    label: 'text-emerald-300',
    text: 'text-gray-100',
    icon: Sparkles,
  },
  system: {
    wrapper: 'border-gray-700/40 bg-gray-800/30',
    label: 'text-gray-400',
    text: 'text-gray-300',
    icon: TerminalIcon,
  },
  tool: {
    wrapper: 'border-violet-500/20 bg-violet-500/5',
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

export default function MessageBubble({ line, highlightQuery = '', currentMatch = false }: MessageBubbleProps) {
  const styles = ROLE_STYLES[line.role] ?? ROLE_STYLES.system
  const Icon = styles.icon

  const segments = useMemo(
    () => splitOnMatches(line.text, highlightQuery),
    [line.text, highlightQuery],
  )

  // Unique id pairing role + line index for aria-labelledby.
  const labelId = `aim-msg-label-${line.lineIndex}`

  return (
    <div
      role="article"
      aria-labelledby={labelId}
      className={`relative rounded-md border px-3 py-2 text-[12px] ${styles.wrapper}`}
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
          <div className={`whitespace-pre-wrap break-words ${styles.text}`}>
            {segments.map((seg, i) =>
              seg.isMatch ? (
                <mark
                  key={i}
                  className={
                    currentMatch
                      ? 'aim-match aim-match-current'
                      : 'aim-match'
                  }
                >
                  {seg.part}
                </mark>
              ) : (
                <span key={i}>{seg.part}</span>
              ),
            )}
            {line.text === '' && (
              <span className="text-gray-500 italic">(empty)</span>
            )}
          </div>
        </div>
        {line.usage && line.role === 'assistant' && (
          <div
            className="aim-msg-tokens ml-2 flex-shrink-0 text-emerald-300/80"
            aria-label={`Tokens — input ${line.usage.inputTokens}, output ${line.usage.outputTokens}, cache ${line.usage.cacheReadTokens}`}
            title={`in=${line.usage.inputTokens} out=${line.usage.outputTokens} cache=${line.usage.cacheReadTokens}`}
          >
            in: {formatTokenNumber(line.usage.inputTokens)} · out:{' '}
            {formatTokenNumber(line.usage.outputTokens)} · cache:{' '}
            {formatTokenNumber(line.usage.cacheReadTokens)}
          </div>
        )}
      </div>
    </div>
  )
}
