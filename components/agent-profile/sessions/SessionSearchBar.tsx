'use client'

/**
 * SessionSearchBar — spans the top of the center pane.
 *
 * Spec (TRDD-d46b42e9 Phase 3 §6.3.5):
 *   250 ms debounce → POST /search. Matches highlight, Prev/Next scroll to
 *   each match, counter `N / M`. Debounce is owned by useJsonlSession;
 *   this component is presentational only.
 */

import { useId } from 'react'
import { Search, ChevronUp, ChevronDown, Loader2, X } from 'lucide-react'

interface SessionSearchBarProps {
  query: string
  onQueryChange: (q: string) => void
  matchCount: number
  matchIndex: number | null
  onPrev: () => void
  onNext: () => void
  onClear: () => void
  searching: boolean
  error: string | null
  disabled?: boolean
}

export default function SessionSearchBar({
  query,
  onQueryChange,
  matchCount,
  matchIndex,
  onPrev,
  onNext,
  onClear,
  searching,
  error,
  disabled = false,
}: SessionSearchBarProps) {
  const inputId = useId()
  const counter =
    query.trim() === ''
      ? null
      : searching
        ? '…'
        : matchCount === 0
          ? '0 / 0'
          : `${(matchIndex ?? 0) + 1} / ${matchCount}`

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800 bg-gray-900/40">
      <label htmlFor={inputId} className="sr-only">
        Search session transcript
      </label>
      <div className="flex-1 relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
        <input
          id={inputId}
          type="search"
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          placeholder={disabled ? 'Select a session to search' : 'Search this session…'}
          disabled={disabled}
          aria-label="Search session transcript"
          aria-busy={searching}
          className="w-full pl-7 pr-7 py-1 text-[11px] rounded-md bg-gray-800/60 border border-gray-700/70 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-emerald-500/70 focus:ring-1 focus:ring-emerald-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              onNext()
            } else if (e.key === 'Enter' && e.shiftKey) {
              e.preventDefault()
              onPrev()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onClear()
            }
          }}
        />
        {query.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear search"
            className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-gray-700/60 text-gray-500 hover:text-gray-300"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      {counter !== null && (
        <div
          className="text-[10px] tabular-nums text-gray-400 min-w-[44px] text-right"
          aria-live="polite"
        >
          {counter}
        </div>
      )}
      <button
        type="button"
        onClick={onPrev}
        aria-label="Previous match"
        disabled={disabled || matchCount === 0}
        className="p-1 rounded border border-gray-700/70 text-gray-400 hover:text-gray-200 hover:bg-gray-800/70 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <ChevronUp className="w-3 h-3" />
      </button>
      <button
        type="button"
        onClick={onNext}
        aria-label="Next match"
        disabled={disabled || matchCount === 0}
        className="p-1 rounded border border-gray-700/70 text-gray-400 hover:text-gray-200 hover:bg-gray-800/70 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <ChevronDown className="w-3 h-3" />
      </button>
      {searching && <Loader2 className="w-3 h-3 text-gray-500 animate-spin" />}
      {error && (
        <span className="text-[10px] text-red-300 ml-1 truncate max-w-[180px]" role="alert" title={error}>
          {error}
        </span>
      )}
    </div>
  )
}
