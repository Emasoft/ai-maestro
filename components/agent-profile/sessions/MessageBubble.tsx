'use client'

/**
 * MessageBubble — renders a single transcript line (user/assistant/system)
 * with role-coloring, optional token badge, slash-command pill, and
 * search highlight.
 *
 * Spec (TRDD-d46b42e9 Phase 3 §6.3.3):
 *   - Each assistant bubble has `IN/OUT/CACHE` token credits at top-right.
 *   - Role colors: user=blue, assistant=emerald, system=gray, tool=violet.
 *   - Tool events are rendered by `<ToolUseRow>`, NOT this component.
 *   - Slash commands written by Claude Code as `<command-name>/foo</command-name>`
 *     XML-tagged text are detected and rendered as a compact command pill
 *     instead of dumping the raw markup.
 *   - Every bubble carries a human-readable timestamp.
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

// Role-based palette. Tints are bumped so each role is visibly distinct
// even at a glance (item-5 of the 14-bug review). User=blue is the most
// saturated since users tend to send fewer messages — they need to stand
// out. Assistant=emerald is the dominant chrome of the dashboard so we
// keep it slightly muted. System=gray reads as ambient. Tool=violet is
// further differentiated by an explicit left-margin indent applied at
// the wrapper level (`.aim-tool-row` in styles/sessions-browser.css).
const ROLE_STYLES: Record<string, { wrapper: string; label: string; text: string; icon: typeof User }> = {
  user: {
    wrapper: 'border-blue-400/60 bg-blue-500/[0.18]',
    label: 'text-blue-200',
    text: 'text-gray-100',
    icon: User,
  },
  assistant: {
    wrapper: 'border-emerald-500/40 bg-emerald-500/[0.10]',
    label: 'text-emerald-300',
    text: 'text-gray-100',
    icon: Sparkles,
  },
  system: {
    wrapper: 'border-gray-500/50 bg-gray-700/40',
    label: 'text-gray-400',
    text: 'text-gray-300',
    icon: TerminalIcon,
  },
  tool: {
    wrapper: 'border-violet-400/50 bg-violet-500/[0.12]',
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
 * Format an ISO-8601 timestamp as `YYYY-MM-DD HH:MM:SS` in the
 * viewer's local time. Falls back to the raw input when parsing
 * fails — never throws, never returns empty (the bubble's header
 * renders the result verbatim, so an empty string would punch a
 * visible hole in the UI).
 */
function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`
}

/**
 * Detect Claude Code's slash-command JSONL markup. When the agent
 * runs `/context`, `/help`, `/skills`, etc., Claude writes a system
 * record whose `content` is XML-style:
 *
 *   <command-name>/context</command-name>
 *   <command-message>context</command-message>
 *   <command-args></command-args>
 *
 * Without special handling, this dumps as raw text in the bubble.
 * We extract the command name (and optional args) and signal the
 * caller to render a compact pill instead. Returns `null` when the
 * line is plain text.
 */
function detectCommandTag(text: string): { name: string; args: string } | null {
  // Cheap pre-check: any chance this is a command record?
  if (!text.includes('<command-name>')) return null
  const nameMatch = /<command-name>([\s\S]*?)<\/command-name>/.exec(text)
  if (!nameMatch) return null
  const argsMatch = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)
  return {
    name: (nameMatch[1] ?? '').trim(),
    args: (argsMatch?.[1] ?? '').trim(),
  }
}

/**
 * Detect the matching `<local-command-stdout>...</local-command-stdout>`
 * marker that Claude Code wraps slash-command output in. We strip the
 * tag wrapper so the body renders as plain (ANSI-colored) text — the
 * user shouldn't see the XML scaffolding.
 */
function unwrapLocalCommandStdout(text: string): string {
  const m = /<local-command-stdout>([\s\S]*?)(?:<\/local-command-stdout>|$)/.exec(text)
  if (!m) return text
  // Preserve everything before and after, in case multiple records were
  // concatenated. Practically Claude only emits one per record.
  return text.replace(/<\/?local-command-stdout>/g, '')
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
  // Slash-command markup (`<command-name>...</command-name>` etc.) is
  // detected here so the bubble renders a clean pill instead of the
  // raw XML. When the user issued the command (line.role === 'user'),
  // the bubble inherits the USER color so it's visually distinct from
  // commands triggered by Claude itself (system color). The original
  // ROLE_STYLES dispatch below picks the right palette automatically
  // — we don't override it here.
  const command = useMemo(() => detectCommandTag(line.text), [line.text])

  const styles = ROLE_STYLES[line.role] ?? ROLE_STYLES.system
  const Icon = styles.icon

  // Pre-process the body text:
  //   - command-tag records render as a pill (handled below).
  //   - local-command-stdout records have the wrapping tag stripped
  //     so the captured ANSI output renders cleanly.
  //   - everything else is passed through ANSI rendering verbatim.
  const bodyText = useMemo(() => {
    if (command) return ''
    return unwrapLocalCommandStdout(line.text)
  }, [command, line.text])

  // Render with ANSI color awareness so `/context`, `/skills`, etc.
  // outputs appear as styled text instead of literal `\x1b[…]m`
  // garbage. The plain-text version (used by aria-label and search
  // matching) still strips ANSI so screen readers and the search
  // engine see only the readable letters.
  const ansiPlainText = useMemo(() => stripAnsi(bodyText), [bodyText])
  const renderedBody = useMemo(
    () => renderBubbleText(bodyText, highlightQuery, currentMatch),
    [bodyText, highlightQuery, currentMatch],
  )

  // Unique id pairing role + line index for aria-labelledby.
  const labelId = `aim-msg-label-${line.lineIndex}`

  // Format the timestamp once; falls back to raw on parse errors.
  const formattedTs = line.timestamp ? formatTimestamp(line.timestamp) : null

  return (
    <div
      role="article"
      aria-labelledby={labelId}
      // `border-[1.5px]` is a small bump from the default 1px — at the
      // 12 px text size the extra half-pixel tightens the visual frame
      // without crossing into "boxed-in" territory. The `aim-msg-card`
      // hook lets the wrapper classes in styles/sessions-browser.css
      // adjust card-level brightness (pinned/faded/hover) without
      // rewriting the role-color rules.
      className={`aim-msg-card relative rounded-md border-[1.5px] px-3 py-2 text-[12px] ${styles.wrapper}`}
    >
      <div className="flex items-start gap-2">
        <Icon className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${styles.label}`} />
        <div className="flex-1 min-w-0">
          <div
            id={labelId}
            className={`text-[10px] font-semibold uppercase tracking-wider mb-1 flex items-baseline gap-2 ${styles.label}`}
          >
            <span>{line.role}</span>
            {formattedTs && (
              <span
                className="text-gray-400 font-mono font-normal tracking-normal normal-case"
                title={line.timestamp}
              >
                {formattedTs}
              </span>
            )}
          </div>
          {command ? (
            <div className="flex items-center flex-wrap gap-2 py-0.5">
              <span className="aim-cmd-pill" aria-label={`Slash command ${command.name}`}>
                <span className="aim-cmd-pill-prefix">cmd</span>
                <span>{command.name}</span>
                {command.args && (
                  <span className="aim-cmd-pill-prefix">· {command.args}</span>
                )}
              </span>
            </div>
          ) : (
            <div
              className={`whitespace-pre-wrap break-words font-mono text-[12px] ${styles.text}`}
              // The aria-label gives assistive tech the plain-text view
              // (no ANSI codes) of bubbles whose body otherwise carries
              // colored terminal output.
              aria-label={ansiPlainText || undefined}
            >
              {renderedBody}
              {bodyText === '' && (
                <span className="text-gray-500 italic">(empty)</span>
              )}
            </div>
          )}
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
