'use client'

/**
 * ToolUseRow — compact, collapsible representation of a tool_use or
 * tool_result record in a JSONL transcript. Rendered as a single row in the
 * virtualized list; when expanded, shows the raw input/result JSON.
 */

import { useState } from 'react'
import { ChevronRight, ChevronDown, Wrench } from 'lucide-react'
import type { TranscriptLine } from '@/types/sessions-browser'

interface ToolUseRowProps {
  line: TranscriptLine
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

export default function ToolUseRow({ line }: ToolUseRowProps) {
  const [expanded, setExpanded] = useState(false)
  const title =
    line.toolName ??
    (line.toolResult !== undefined ? 'tool_result' : 'tool_use')
  const inputStr = stringify(line.toolInput)
  const resultStr = stringify(line.toolResult)

  return (
    <div className="rounded-md border border-violet-500/20 bg-violet-500/5 text-gray-300 text-[11px]">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-1.5 px-2 py-1 text-left hover:bg-violet-500/10 transition-colors rounded-md"
      >
        {expanded ? (
          <ChevronDown className="w-3 h-3 text-violet-400 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-violet-400 flex-shrink-0" />
        )}
        <Wrench className="w-3 h-3 text-violet-300 flex-shrink-0" />
        <span className="font-mono text-violet-200 truncate">{title}</span>
        {line.toolUseId && (
          <span className="ml-auto text-[9px] text-gray-500 truncate max-w-[120px]">
            {line.toolUseId.slice(0, 12)}
          </span>
        )}
      </button>
      {expanded && (
        <div className="px-3 py-2 border-t border-violet-500/20 font-mono text-[10px] text-gray-300 space-y-2">
          {inputStr && (
            <div>
              <div className="text-violet-300 mb-1">input:</div>
              <pre className="whitespace-pre-wrap break-all text-gray-200">{inputStr}</pre>
            </div>
          )}
          {resultStr && (
            <div>
              <div className="text-violet-300 mb-1">result:</div>
              <pre className="whitespace-pre-wrap break-all text-gray-200">{resultStr}</pre>
            </div>
          )}
          {!inputStr && !resultStr && (
            <div className="text-gray-500">(no payload)</div>
          )}
        </div>
      )}
    </div>
  )
}
