/**
 * ToolUseRow — compact, collapsible representation of a tool_use or
 * tool_result record in a JSONL transcript. Rendered as a single row in
 * the virtualized list; when expanded, shows the raw input/result JSON.
 *
 * Expansion state is HOISTED to the parent (`ChatTranscript`) so that
 * `rowHeight()` can recompute when the user opens a tool — without that,
 * the expanded JSON body grows the DOM but the next row's `top` was
 * computed against the collapsed (40 px) height, causing the expanded
 * content to bleed onto the bubble below. The parent owns the
 * `expanded ⇆ rowHeight` dependency in a single place.
 *
 * No `'use client'` directive: this component is purely presentational
 * and is only rendered by `ChatTranscript`, which IS a client component.
 * Marking ToolUseRow as a client entry on top of that triggered the
 * Next.js "props must be serializable" warning for the function props.
 */

import { ChevronRight, ChevronDown, Wrench } from 'lucide-react'
import type { TranscriptLine } from '@/types/sessions-browser'
import PseudoTerminal from './PseudoTerminal'

interface ToolUseRowProps {
  line: TranscriptLine
  /** Whether the parent has marked this row as expanded. */
  expanded: boolean
  /** Toggle expansion. Parent updates its expandedToolKeys set. */
  onToggle: () => void
}

function stringify(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/** Human-readable local-time stamp, mirroring MessageBubble.formatTimestamp. */
function formatTs(iso: string | undefined): string | null {
  if (!iso) return null
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

export default function ToolUseRow({ line, expanded, onToggle }: ToolUseRowProps) {
  const title =
    line.toolName ??
    (line.toolResult !== undefined ? 'tool_result' : 'tool_use')
  const inputStr = stringify(line.toolInput)
  const resultStr = stringify(line.toolResult)
  const ts = formatTs(line.timestamp)

  return (
    <div className="ml-[28px] rounded-md border-[1.5px] border-violet-400/50 bg-violet-500/[0.12] text-gray-300 text-[11px] overflow-hidden transition-shadow duration-200 ease-out group-hover:shadow-[0_0_12px_1px_rgba(16,185,129,0.45)] group-data-[pinned=true]:shadow-[0_0_0_2px_rgb(16,185,129),0_0_18px_2px_rgba(16,185,129,0.55)] group-data-[pinned=true]:group-hover:shadow-[0_0_0_3px_rgb(52,211,153),0_0_26px_4px_rgba(16,185,129,0.75)]">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={e => {
          // The transcript wrapper handles plain-click as "pin this
          // bubble to the context panel". Tool expand/collapse must
          // NOT also pin — stop propagation so only the toggle fires.
          e.stopPropagation()
          onToggle()
        }}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left hover:bg-violet-500/15 transition-colors rounded-md"
      >
        {expanded ? (
          <ChevronDown
            className="w-3.5 h-3.5 text-violet-300 flex-shrink-0 transition-transform"
            aria-hidden
          />
        ) : (
          <ChevronRight
            className="w-3.5 h-3.5 text-violet-300 flex-shrink-0 transition-transform"
            aria-hidden
          />
        )}
        <Wrench className="w-3 h-3 text-violet-300 flex-shrink-0" aria-hidden />
        <span className="font-mono font-semibold text-violet-200 truncate">{title}</span>
        {ts && (
          <span className="ml-2 font-mono text-[10px] text-gray-400 truncate" title={line.timestamp}>
            {ts}
          </span>
        )}
        {line.toolUseId && (
          <span className="ml-auto text-[9px] text-gray-500 truncate max-w-[120px]" title={line.toolUseId}>
            {line.toolUseId.slice(0, 12)}
          </span>
        )}
      </button>
      {expanded && (
        // Capped max-height + overflow-y:auto is the ONE sanctioned vertical
        // inner scroller: the expanded payload can be huge (multi-K JSON /
        // terminal output) without bleeding past the virtualizer's row slot.
        // The parent's rowHeight() returns TOOL_ROW_EXPANDED_HEIGHT (320 px,
        // = this 280 px cap + header + border) so the next bubble starts
        // BELOW this panel. The PseudoTerminal blocks inside WRAP long lines
        // (no horizontal scroller) — only THIS container scrolls vertically.
        <div className="px-3 py-2 border-t border-violet-500/30 space-y-2 max-h-[280px] overflow-y-auto overscroll-contain">
          {inputStr && <PseudoTerminal text={inputStr} title="input" />}
          {resultStr && <PseudoTerminal text={resultStr} title="result" />}
          {!inputStr && !resultStr && (
            <div className="font-mono text-[10.5px] text-gray-500">(no payload)</div>
          )}
        </div>
      )}
    </div>
  )
}
