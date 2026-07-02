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
import { Search, ChevronUp, ChevronDown, Loader2, X, Radio } from 'lucide-react'

/**
 * Expands a visually-small control to a ≥44px touch target without changing
 * its painted box or the row height: a centered, transparent `::before`
 * overlay sized 44×44 that receives the tap. The host element must be
 * `relative` (and NOT `overflow-hidden`, or the overlay would be clipped).
 * Tailwind-utility-only — no bespoke CSS. (WCAG 2.5.5 / Apple HIG.)
 */
const TOUCH_HIT_AREA =
  "relative before:content-[''] before:absolute before:left-1/2 before:top-1/2 " +
  'before:-translate-x-1/2 before:-translate-y-1/2 before:min-h-[44px] before:min-w-[44px]'

/** Search-nav (prev/next) icon button: compact visual box + 44px hit area. */
const NAV_BTN_CLASS =
  `${TOUCH_HIT_AREA} flex items-center justify-center p-1 rounded border border-gray-700/70 ` +
  'text-gray-400 hover:text-gray-200 hover:bg-gray-800/70 transition-colors motion-reduce:transition-none ' +
  'disabled:opacity-40 disabled:cursor-not-allowed'

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
  /**
   * Whether the selected session is still being written. The "Follow tail"
   * toggle is only meaningful — and only rendered — when this is true: a
   * closed historical transcript can never grow, so tailing it is a no-op.
   * (TRDD-1657a5f4 Phase 3 — live-tail gating, audit C1.)
   */
  isOngoing?: boolean
  /** Current state of the user "follow tail" opt-in (defaults OFF in the hook). */
  followTail?: boolean
  /** Called when the user flips the toggle. Wired to `useJsonlSession.setFollowTail`. */
  onFollowTailChange?: (on: boolean) => void
  /**
   * Terminal live-tail failure surfaced by the hook (binary missing, etc.).
   * Rendered as a small inline note next to the toggle so a stalled tail is
   * visible instead of silently looking "live" forever.
   */
  tailError?: string | null
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
  isOngoing = false,
  followTail = false,
  onFollowTailChange,
  tailError = null,
}: SessionSearchBarProps) {
  const inputId = useId()
  const tailId = useId()
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
          // `min-h-[44px] md:min-h-0`: a real ≥44px tap height on the mobile
          // component set (<768px, the same width breakpoint the mobile pill
          // row uses) where a `before:` overlay can't apply to a text input;
          // compact again on desktop. (Audit theme C touch targets.)
          className="w-full pl-7 pr-7 py-1 min-h-[44px] md:min-h-0 text-[11px] rounded-md bg-gray-800/60 border border-gray-700/70 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-emerald-500/70 focus:ring-1 focus:ring-emerald-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
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
            // Already `absolute` (so it's its own positioning context — the
            // `before:` 44px hit overlay anchors to the button). Visually a tiny
            // X, but a full touch target. (Audit theme C touch targets.)
            className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center justify-center p-0.5 rounded hover:bg-gray-700/60 text-gray-500 hover:text-gray-300 transition-colors motion-reduce:transition-none before:content-[''] before:absolute before:left-1/2 before:top-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:min-h-[44px] before:min-w-[44px]"
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
        // Visually compact icon button, but a centered ≥44px invisible hit area
        // (the `before:` overlay) so it's reliably tappable on touch without
        // growing the search-bar row height. (WCAG 2.5.5 / Apple HIG; audit
        // theme C touch targets.)
        className={NAV_BTN_CLASS}
      >
        <ChevronUp className="w-3 h-3" />
      </button>
      <button
        type="button"
        onClick={onNext}
        aria-label="Next match"
        disabled={disabled || matchCount === 0}
        className={NAV_BTN_CLASS}
      >
        <ChevronDown className="w-3 h-3" />
      </button>
      {searching && <Loader2 className="w-3 h-3 text-gray-500 animate-spin motion-reduce:animate-none" />}
      {error && (
        <span className="text-[10px] text-red-300 ml-1 truncate max-w-[180px]" role="alert" title={error}>
          {error}
        </span>
      )}

      {/*
        Follow-tail toggle — only for an ongoing (still-being-written) session.
        A closed transcript can't grow, so the control is omitted entirely
        rather than rendered disabled (less noise on the common historical
        case). `ml-auto` floats it to the far right of the row regardless of
        how wide the search area grows. The native checkbox keeps it
        keyboard-operable for free; `focus-visible:ring-*` gives a visible
        focus ring without the always-on outline.
      */}
      {isOngoing && (
        <div className="flex items-center gap-1.5 ml-auto pl-2">
          <label
            htmlFor={tailId}
            // The whole label is the tap target (clicking it toggles the
            // checkbox). `min-h-[44px] md:min-h-0` gives a ≥44px tap height on
            // the mobile component set while staying compact on desktop.
            // `transition-colors` gets a `motion-reduce:` guard. (Audit theme C.)
            className="flex items-center gap-1 min-h-[44px] md:min-h-0 cursor-pointer select-none text-[10px] text-gray-400 hover:text-gray-200 transition-colors motion-reduce:transition-none"
            title="Live-tail this session as new lines are written"
          >
            <input
              id={tailId}
              type="checkbox"
              checked={followTail}
              onChange={e => onFollowTailChange?.(e.target.checked)}
              className="h-3 w-3 cursor-pointer rounded-sm border border-gray-600 bg-gray-800/70 accent-emerald-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 focus-visible:ring-offset-1 focus-visible:ring-offset-gray-900"
            />
            <Radio
              className={`w-3 h-3 ${followTail ? 'text-emerald-400' : 'text-gray-500'}`}
              aria-hidden="true"
            />
            <span>Follow tail</span>
          </label>
          {tailError && (
            <span
              className="text-[10px] text-red-300 truncate max-w-[120px]"
              role="alert"
              title={tailError}
            >
              tail stopped
            </span>
          )}
        </div>
      )}
    </div>
  )
}
