'use client'

/**
 * TimelineRuler — the left chronological gutter for {@link ChatTranscript}
 * (TRDD-1657a5f4 Phase 5).
 *
 * The user asked for "a tick per event + prominent always-visible timestamps +
 * a complete timeline of the conversation". This component is the visual
 * realisation of that: a narrow fixed-width column down the left edge of the
 * transcript scroll area, carrying
 *
 *   • ONE coloured tick per event row, vertically centred on its row, and
 *   • readable `HH:MM:SS` (local) timestamp labels at the start of the visible
 *     window, on every wall-clock-minute change, and on any large time-gap.
 *
 * VIRTUALISATION CONTRACT (the load-bearing invariant):
 *   This component is *presentational only*. It does NOT compute geometry — it
 *   reads the SAME `offsets[]` array, `startIndex`, and per-row heights the
 *   transcript's hand-rolled windowing already produced, and renders ticks
 *   ONLY for the rows in `visible` (the exact slice ChatTranscript mounts).
 *   So a 10 000-line transcript paints at most `OVERSCAN*2 + viewport` ticks —
 *   O(visible), never O(n). The ruler column is `totalHeight` tall (matching
 *   the rows' spacer) and lives inside the SAME scroll container, so it scrolls
 *   in lock-step with the bubbles and its ticks line up with the rows pixel for
 *   pixel. `offsets[]` stays the single source of truth — the ruler reads it,
 *   it never re-derives row positions.
 *
 * a11y: the ruler is navigational chrome layered beside the real `role="feed"`
 * content. Decorative ticks are `aria-hidden`; the column carries a quiet
 * `aria-hidden` because every tick/timestamp it shows is already conveyed by
 * the bubbles themselves (each `MessageBubble` / `ToolUseRow` renders its own
 * timestamp + role). It never traps focus — there are no focusable children.
 */

import { useMemo } from 'react'
import type { TranscriptLine } from '@/types/sessions-browser'
import { classifyEvent, EVENT_META } from '@/lib/session-events'

/**
 * One visible row, paired with the geometry the ruler needs. The caller
 * (ChatTranscript) already has all of this — it hands us the slice rather than
 * making us recompute it, so the ruler can never desync from the rows.
 */
export interface RulerRow {
  /** The transcript line (for `classifyEvent` + `tsMs`). */
  line: TranscriptLine
  /** Absolute top of this row inside the `totalHeight` spacer — `offsets[index]`. */
  top: number
  /** Effective height of this row (measured-or-estimated) — `offsets[index+1] - offsets[index] - ROW_GAP`. */
  height: number
}

interface TimelineRulerProps {
  /**
   * The visible window of rows + their geometry. Exactly the slice
   * ChatTranscript renders (start..end after overscan). The ruler paints one
   * tick per entry — never iterates the full transcript.
   */
  visible: RulerRow[]
  /**
   * Total height of the virtualised spacer (`offsets[last] - ROW_GAP`). The
   * ruler column is exactly this tall so it scrolls in lock-step with the rows
   * and the scrollbar thumb sizes the same for both.
   */
  totalHeight: number
  /** Fixed gutter width in px. Kept in sync with ChatTranscript's left padding. */
  widthPx: number
  /**
   * Show a timestamp label whenever the gap to the previous row is at least
   * this many ms (in addition to the first row and every minute change).
   * Defaults to 60 000 (1 min) per the spec ("a large time-gap (>~1 min)").
   */
  gapLabelMs?: number
}

/**
 * `HH:MM:SS` in LOCAL time, mirroring `MessageBubble.formatTimestamp` /
 * `ToolUseRow` (manual `getHours/getMinutes/getSeconds` + zero-pad — no
 * `toLocaleTimeString`, which varies by locale and would drift from the
 * bubbles' own stamps). Derived straight from epoch-ms; `tsMs` is guaranteed
 * finite by `normalizeLine`, but we still guard a `0`/invalid value so a
 * missing-timestamp carry-forward of `0` renders as a clear `--:--:--` rather
 * than `01:00:00` (epoch in the local zone).
 */
function formatClock(tsMs: number): string {
  if (!Number.isFinite(tsMs) || tsMs <= 0) return '--:--:--'
  const d = new Date(tsMs)
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mi}:${ss}`
}

/** Wall-clock minute bucket for "label on minute change" — local, epoch-ms in. */
function minuteBucket(tsMs: number): number {
  if (!Number.isFinite(tsMs) || tsMs <= 0) return NaN
  return Math.floor(tsMs / 60_000)
}

export default function TimelineRuler({
  visible,
  totalHeight,
  widthPx,
  gapLabelMs = 60_000,
}: TimelineRulerProps) {
  // Decide which visible rows get a prominent timestamp label. We want a label
  // at the FIRST visible row (so the reader always has a time reference at the
  // top of the viewport), then again whenever the wall-clock minute changes or
  // a large time-gap opens. Computing this over `visible` keeps it O(visible).
  //
  // NOTE on "minute change across the window edge": because we always label the
  // first visible row, a label re-appears at the top every time you scroll into
  // a new window — which is exactly the desired "always-visible reference".
  // Within the window, subsequent labels track real minute/gap boundaries.
  const labelled = useMemo(() => {
    const out = new Set<number>() // indices INTO `visible`
    let prevBucket = NaN
    let prevTs = NaN
    for (let i = 0; i < visible.length; i++) {
      const ts = visible[i].line.tsMs
      const bucket = minuteBucket(ts)
      const firstRow = i === 0
      const minuteChanged = Number.isFinite(bucket) && bucket !== prevBucket
      const bigGap =
        Number.isFinite(ts) &&
        Number.isFinite(prevTs) &&
        ts - prevTs >= gapLabelMs
      if (firstRow || minuteChanged || bigGap) out.add(i)
      prevBucket = bucket
      prevTs = ts
    }
    return out
  }, [visible, gapLabelMs])

  return (
    // The column is `totalHeight` tall and pinned to the left edge of the
    // scroll container by `left:0` — it scrolls vertically with the rows
    // natively (no sticky needed; both live in the same scroller). `aria-hidden`
    // because the bubbles already announce role + timestamp; the ruler is a
    // redundant visual aid. `select-none` so a drag-select over the transcript
    // doesn't grab tick/label text. `pointer-events-none` keeps the gutter from
    // intercepting clicks meant for bubbles that sit just to its right.
    <div
      aria-hidden="true"
      className="absolute top-0 left-0 z-[1] border-r border-gray-800/70 bg-gray-950/40 select-none pointer-events-none"
      style={{ width: widthPx, height: totalHeight }}
    >
      {visible.map(({ line, top, height }, i) => {
        const kind = classifyEvent(line)
        const meta = EVENT_META[kind]
        // Centre the tick on the row. `height` is the effective row height, so
        // `top + height/2` lands the dot at the row's vertical midpoint — the
        // same midpoint the bubble occupies just to the right.
        const tickCenter = top + height / 2
        const showLabel = labelled.has(i)
        const clock = showLabel ? formatClock(line.tsMs) : null
        return (
          <div key={line.lineIndex}>
            {/* The tick: a small coloured dot at the row midpoint, on the
                right edge of the gutter (closest to the bubble it marks). The
                vertical hairline behind it (drawn by the column's own
                `border-r`) gives the "complete timeline" spine the user asked
                for. */}
            <span
              className={`absolute right-[3px] h-[6px] w-[6px] -translate-y-1/2 rounded-full ${meta.dotClass}`}
              style={{ top: tickCenter }}
              title={meta.label}
            />
            {/* The prominent timestamp label, anchored to the tick's row. A
                small tabular-nums monospace stamp so columns of times line up;
                rendered to the LEFT of the spine so it never overlaps the dot.
                `whitespace-nowrap` keeps `HH:MM:SS` on one line inside the
                narrow gutter (no inner horizontal scroller — the gutter is sized
                to hold it). */}
            {clock && (
              <span
                className="absolute left-[4px] -translate-y-1/2 font-mono tabular-nums text-[9px] leading-none tracking-tight text-gray-400 whitespace-nowrap"
                style={{ top: tickCenter }}
              >
                {clock}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
