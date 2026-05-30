'use client'

/**
 * ContextBreakdownPanel — right pane (≤280 px wide desktop, drawer on tablet).
 *
 * Spec (TRDD-d46b42e9 Phase 3 §6.3.4 + Phase B of the 14-bug review):
 *   - Two view modes: BARS (horizontal bars per bucket, the original)
 *     and PILLAR (single 100%-height column with proportional segments).
 *   - Pillar segments are clickable; clicking one drills down into a
 *     scrollable sub-page showing every loaded element in that bucket.
 *   - Drill-down sub-page: back arrow at top-left, the bucket's slice
 *     rectangle copied at the top, the bucket name in big text, then a
 *     pointed list of elements with plugin-prefixed names, sizes, and
 *     percentages. Constant buckets (systemPrompt, systemTools,
 *     mcpTools, autocompactBuffer) show their explanation note instead.
 *     Item-12: when a bucket has 0 enumerated elements but the captured
 *     /context shows tokens for it, the drill-down explicitly flags
 *     the bucket as "missing from token count".
 *
 * The displayed numbers ALWAYS come from our heuristic (JSONL parse +
 * on-disk tokenization). Captured `/context` numbers (when present) are
 * surfaced as a per-row Δ comparison badge so drift is visible.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  X,
  PanelRightOpen,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  AlignVerticalJustifyEnd,
  Loader2,
  Boxes,
} from 'lucide-react'
import type {
  ContextBreakdownResponse,
  RecordedContextSnapshotWire,
  BucketElementWire,
} from '@/types/sessions-browser'

interface Bucket {
  key: keyof Pick<
    ContextBreakdownResponse,
    | 'systemPrompt'
    | 'systemTools'
    | 'mcpTools'
    | 'customAgents'
    | 'memory'
    | 'skills'
    | 'messages'
    | 'autocompactBuffer'
    | 'freeSpace'
    | 'cacheRead'
  >
  /** Field on the recorded snapshot, when one exists; null when this bucket
   *  has no captured-/context counterpart (systemTools, mcpTools, cacheRead). */
  recordedKey: keyof RecordedContextSnapshotWire | null
  label: string
  /** CSS color used by both the bars and pillar segments. */
  color: string
  /** Tailwind text color for labels. */
  labelColor: string
  /** Drill-down bg gradient — distinct dark-violet shades per bucket. */
  drillDownGradient: string
}

// Single source of truth for the Δ-comparison badge tone → Tailwind class map.
// Previously this ternary was hand-written in three places (BarRow,
// SegmentDetailView, BarsView total) and had already drifted; one map keeps
// every comparison badge in lock-step. (audit MINOR: duplicated tone ternaries.)
const DELTA_TONE_CLASS: Record<'match' | 'low' | 'high', string> = {
  match: 'text-emerald-400/90',
  high: 'text-amber-300',
  low: 'text-rose-300',
}

// Order mirrors what `claude-code /context` prints.
//
// Palette tuning (2026-05-08): the original Tailwind 500-tone hues read
// as too bright when stacked side-by-side in the pillar — neighboring
// segments visually bled into each other. The values below are darker,
// less-saturated equivalents (roughly Tailwind 600/700 range with a
// slate-tint mixed in) so adjacent segments stay distinct without
// visually shouting at the user. Hue identity is preserved — what was
// blue is still blue, what was emerald is still emerald.
const BUCKETS: Bucket[] = [
  { key: 'systemPrompt',      recordedKey: 'systemPrompt',      label: 'System prompt',      color: 'rgb(74, 112, 174)',   labelColor: 'text-blue-300',    drillDownGradient: 'from-indigo-950 via-violet-950 to-purple-950' },
  { key: 'systemTools',       recordedKey: null,                label: 'System tools',       color: 'rgb(60, 124, 138)',   labelColor: 'text-cyan-300',    drillDownGradient: 'from-indigo-950 via-violet-950 to-purple-950' },
  { key: 'mcpTools',          recordedKey: null,                label: 'MCP tools',          color: 'rgb(118, 96, 170)',   labelColor: 'text-violet-300',  drillDownGradient: 'from-indigo-950 via-violet-950 to-purple-950' },
  { key: 'customAgents',      recordedKey: 'customAgents',      label: 'Custom agents',      color: 'rgb(174, 130, 65)',   labelColor: 'text-amber-300',   drillDownGradient: 'from-indigo-950 via-violet-950 to-purple-950' },
  { key: 'memory',            recordedKey: 'memory',            label: 'Memory files',       color: 'rgb(170, 78, 124)',   labelColor: 'text-pink-300',    drillDownGradient: 'from-indigo-950 via-violet-950 to-purple-950' },
  { key: 'skills',            recordedKey: 'skills',            label: 'Skills',             color: 'rgb(150, 84, 168)',   labelColor: 'text-fuchsia-300', drillDownGradient: 'from-indigo-950 via-violet-950 to-purple-950' },
  { key: 'messages',          recordedKey: 'messages',          label: 'Messages',           color: 'rgb(63, 145, 119)',   labelColor: 'text-emerald-300', drillDownGradient: 'from-indigo-950 via-violet-950 to-purple-950' },
  // cacheRead is a REAL slice of an actual Claude context window — prompt-cache
  // reads that re-enter the window without re-billing input tokens. The audit
  // flagged it silently dropped from every total/view; surfacing it as its own
  // bucket makes the parts reconcile to the whole. It has no captured-/context
  // counterpart (not on RecordedContextSnapshotWire) and no per-element
  // listing, so it renders a note in the drill-down like the other constants.
  { key: 'cacheRead',         recordedKey: null,                label: 'Cache reads',        color: 'rgb(80, 138, 158)',   labelColor: 'text-sky-300',     drillDownGradient: 'from-indigo-950 via-violet-950 to-purple-950' },
  { key: 'autocompactBuffer', recordedKey: 'autocompactBuffer', label: 'Autocompact buffer', color: 'rgb(170, 105, 65)',   labelColor: 'text-orange-300',  drillDownGradient: 'from-indigo-950 via-violet-950 to-purple-950' },
  { key: 'freeSpace',         recordedKey: 'freeSpace',         label: 'Free space',         color: 'rgb(108, 115, 128)',  labelColor: 'text-gray-400',    drillDownGradient: 'from-indigo-950 via-violet-950 to-purple-950' },
]

type BucketKey = Bucket['key']

function useIsCompactLayout(breakpoint = 1024): { compact: boolean; mounted: boolean } {
  // `mounted` lets the caller avoid the SSR-default-desktop wrong first paint
  // (the matchMedia result is unknown until the effect runs on the client).
  // We gate the responsive branch on a SINGLE source of truth — this boolean —
  // and drop the parallel Tailwind `lg:hidden`/`hidden lg:flex` gating, so the
  // JS branch and CSS can no longer disagree at the 1024px boundary or during
  // hydration. (audit MAJOR: matchMedia vs Tailwind double-gating.)
  const [compact, setCompact] = useState(false)
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    setMounted(true)
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`)
    const update = () => setCompact(mql.matches)
    update()
    mql.addEventListener('change', update)
    return () => mql.removeEventListener('change', update)
  }, [breakpoint])
  return { compact, mounted }
}

/**
 * Make `containerRef` a real ARIA-APG modal dialog while `open` is true:
 *   - Escape closes it (calls `onClose`).
 *   - Initial focus moves into the dialog (first focusable, else the container).
 *   - Tab is trapped — cycling past the last focusable wraps to the first and
 *     vice-versa, so focus never escapes the "modal" into the inert page.
 *   - On close, focus returns to whatever was focused when it opened (the
 *     trigger button).
 *   - The document body scroll is locked while open and restored on close.
 *
 * Extracted as a hook so every drawer in the Sessions tab can behave
 * identically. (audit CRITICAL: drawer was role=dialog aria-modal but had no
 * Escape / focus-trap / return-focus / scroll-lock.)
 */
function useModalDialog(
  open: boolean,
  onClose: () => void,
  containerRef: React.RefObject<HTMLElement>,
) {
  // Remember the element focused at open-time so we can restore it on close.
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    const container = containerRef.current
    if (!container) return

    previouslyFocused.current = (document.activeElement as HTMLElement | null) ?? null

    const FOCUSABLE =
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    const focusables = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        el => el.offsetParent !== null || el === document.activeElement,
      )

    // Move focus inside on open (rAF so the dialog has painted/measured first).
    const raf = requestAnimationFrame(() => {
      const list = focusables()
      ;(list[0] ?? container).focus()
    })

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const list = focusables()
      if (list.length === 0) {
        // Nothing focusable but the container itself — keep focus pinned there.
        e.preventDefault()
        container.focus()
        return
      }
      const first = list[0]
      const last = list[list.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey && (active === first || active === container)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)

    // Lock body scroll behind the modal (restored on cleanup).
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = prevOverflow
      // Restore focus to the trigger if it's still in the document.
      const prev = previouslyFocused.current
      if (prev && document.contains(prev)) prev.focus()
    }
  }, [open, onClose, containerRef])
}

/**
 * Coerce a numeric value into the valid `[0, 100]` ARIA progressbar range,
 * mapping NaN/±Infinity to 0. Used so `aria-valuenow` never reports an
 * out-of-contract value (e.g. 137 against a max of 100) even when a single
 * bucket exceeds the model limit. (audit MAJOR: aria-valuenow could exceed
 * aria-valuemax.)
 */
function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) return 0
  return Math.min(100, Math.max(0, pct))
}

function formatTokenNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

/**
 * Format a percentage for display, showing `<0.1%` for a nonzero share that
 * would otherwise round to `0.0%` (so the user never reads a real-but-tiny
 * bucket as "nothing"). (audit NIT: sub-rounding nonzero buckets read as 0.)
 */
function formatPct(pct: number, dp = 1): string {
  if (!Number.isFinite(pct)) return '0'
  if (pct > 0 && pct < Math.pow(10, -dp)) return `<${Math.pow(10, -dp)}`
  return pct.toFixed(dp)
}

function formatDelta(heuristic: number, recorded: number): { text: string; tone: 'match' | 'low' | 'high' } {
  const diff = heuristic - recorded
  const denom = Math.max(recorded, 1)
  const ratio = Math.abs(diff) / denom
  if (ratio < 0.05) return { text: '✓', tone: 'match' }
  const signed = diff > 0 ? '+' : '−'
  return {
    text: `${signed}${formatTokenNumber(Math.abs(diff))}`,
    tone: diff > 0 ? 'high' : 'low',
  }
}

interface ContextBreakdownPanelProps {
  breakdown: ContextBreakdownResponse | null
  loading: boolean
  error: string | null
  /**
   * Agent working directory — passed to the PSS component-lifeline query.
   * `null` when no session/agent is resolved yet (the lifeline section then
   * renders nothing). Comes from `useJsonlSession().projectDir`.
   */
  projectDir?: string | null
  /**
   * Conversation time (epoch ms) the lifeline resolves "what was loaded then"
   * against — the pinned line's `tsMs`, or the latest line's `tsMs` when not
   * pinned (live). `null` when unknown. Comes from SessionsTab.
   */
  atMs?: number | null
}

// ---------------------------------------------------------------------------
// Bars view (the original layout)
// ---------------------------------------------------------------------------

function BarRow({
  bucket,
  value,
  modelLimit,
  recorded,
  onSelectBucket,
}: {
  bucket: Bucket
  value: number
  modelLimit: number
  recorded: RecordedContextSnapshotWire | null
  onSelectBucket: (k: BucketKey) => void
}) {
  const safeLimit = Math.max(modelLimit, 1)
  const pct = (value / safeLimit) * 100

  const recordedValue =
    recorded && bucket.recordedKey !== null ? recorded[bucket.recordedKey] : null
  const delta = typeof recordedValue === 'number'
    ? formatDelta(value, recordedValue)
    : null
  const badgeTone = delta ? DELTA_TONE_CLASS[delta.tone] : DELTA_TONE_CLASS.low

  // Tooltip shown on hover for both the text label and the colored bar.
  // Mirrors the pillar segment's tooltip so both representations carry
  // the same context. The exact integer is included so a rounded "1.5K"
  // is recoverable. (audit MINOR: rounded numbers presented as exact.)
  const tooltip = `${bucket.label} — ${value.toLocaleString()} tokens (${formatPct(pct)}% of model limit)${
    typeof recordedValue === 'number'
      ? ` · captured /context: ${recordedValue.toLocaleString()}`
      : ''
  } · click for details`

  return (
    <button
      type="button"
      onClick={() => onSelectBucket(bucket.key)}
      className="block w-full text-left py-1 px-1.5 -my-0.5 -mx-1.5 rounded-md bg-transparent cursor-pointer transition-colors duration-[120ms] ease-out hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500/70 focus-visible:[outline-offset:-1px]"
      aria-label={`${bucket.label}: ${formatTokenNumber(value)} tokens (${formatPct(pct)}% of model limit) — click to drill down`}
      title={tooltip}
    >
      <div className="flex items-center justify-between text-[10px] mb-1 gap-2">
        <span className={`${bucket.labelColor} font-medium`}>{bucket.label}</span>
        <span className="tabular-nums text-gray-300 flex items-baseline gap-1.5">
          <span className="font-medium" title={value.toLocaleString()}>{formatTokenNumber(value)}</span>
          <span className="text-gray-500">({formatPct(pct)}%)</span>
          {delta && typeof recordedValue === 'number' && (
            <span
              className={`${badgeTone} text-[9px] font-mono ml-0.5`}
              title={`Heuristic: ${value.toLocaleString()} · Captured /context: ${recordedValue.toLocaleString()}`}
            >
              {delta.text}
            </span>
          )}
        </span>
      </div>
      <div
        className="h-1.5 rounded-full bg-gray-700/40 overflow-hidden"
        role="progressbar"
        aria-label={`${bucket.label}: ${formatTokenNumber(value)} tokens (${formatPct(pct)}% of model limit)`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clampPct(pct))}
        title={tooltip}
      >
        <div
          className="h-full rounded-[inherit] transition-[width] duration-[180ms] ease-out"
          style={{ width: `${clampPct(pct)}%`, backgroundColor: bucket.color }}
        />
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Pillar view (single 100%-height vertical column with clickable segments)
// ---------------------------------------------------------------------------

function PillarView({
  breakdown,
  onSelectBucket,
}: {
  breakdown: ContextBreakdownResponse
  onSelectBucket: (key: BucketKey) => void
}) {
  // The pillar's 100% is the sum of every bucket value, BUT we reconcile
  // honestly against the API `total`: if the API total exceeds the bucket
  // sum, the leftover is rendered as an explicit non-clickable "Unaccounted"
  // segment rather than silently mis-scaling the visible buckets. Using
  // `modelContextLimit` as the denominator would let free-space dominate;
  // using a bare bucket-sum would hide any total/sum disagreement.
  // (audit MAJOR: bucket-sum vs total disagreement shown with no reconciliation.)
  const bucketSum = useMemo(
    () => BUCKETS.reduce((s, b) => s + (breakdown[b.key] ?? 0), 0),
    [breakdown],
  )
  const unaccounted = Math.max(0, breakdown.total - bucketSum)
  const segmentTotal = bucketSum + unaccounted

  const segments = useMemo(() => {
    return BUCKETS.map(b => {
      const value = breakdown[b.key] ?? 0
      const pct = segmentTotal > 0 ? (value / segmentTotal) * 100 : 0
      return { bucket: b, value, pct }
    }).filter(s => s.value > 0)
  }, [breakdown, segmentTotal])

  const unaccountedPct = segmentTotal > 0 ? (unaccounted / segmentTotal) * 100 : 0

  return (
    <div className="p-4 flex flex-col h-full min-h-0">
      <p className="text-[10px] text-gray-400 italic mb-1 leading-tight">
        Click on the colored areas to get more info
      </p>
      {/* Denominator caption so the basis is explicit when toggling bars↔pillar
          (bars show "% of model limit", the pillar shows "% of buckets").
          (audit MAJOR: per-view percentages change meaning with no label.) */}
      <p className="text-[9px] text-gray-500 mb-2 leading-tight">
        Shares below are <span className="text-gray-400">% of the bucket total</span>
        {unaccounted > 0 && (
          <> · {formatPct(unaccountedPct)}% unaccounted vs the API total</>
        )}
      </p>
      {/*
        100%-of-the-container pillar. The parent aside is `flex flex-col
        overflow-y-auto`; we make THIS container `flex-1 min-h-0` so the
        pillar takes whatever vertical space remains under the header.
        The flex children below use percentage heights, so the pillar
        always fills regardless of viewport size.
      */}
      <div
        className="flex-1 min-h-0 flex flex-col rounded-md overflow-hidden border border-gray-700/60 shadow-inner"
        role="list"
        aria-label="Context buckets — click a segment for details"
      >
        {segments.map(seg => (
          <button
            key={seg.bucket.key}
            type="button"
            role="listitem"
            onClick={() => onSelectBucket(seg.bucket.key)}
            // Tiny segments still need to be clickable, so we floor at
            // ~6 px via min-height. The display percentage is unchanged
            // — the user sees the exact share in the drill-down.
            style={{ height: `${seg.pct}%`, backgroundColor: seg.bucket.color, minHeight: 6 }}
            className="w-full text-left transition-all hover:brightness-110 hover:saturate-150 focus:outline-none focus:ring-2 focus:ring-white/40 focus:z-10"
            title={`${seg.bucket.label} — ${seg.value.toLocaleString()} tokens (${formatPct(seg.pct)}% of buckets) · click for details`}
            // Proportion is now in the label, not visual-height-only, so a
            // screen reader gets the same quantitative encoding as a sighted
            // user. (audit MAJOR: pillar conveyed proportion purely visually.)
            aria-label={`${seg.bucket.label}: ${formatTokenNumber(seg.value)} tokens, ${formatPct(seg.pct)}% of buckets — click for details`}
          />
        ))}
        {unaccounted > 0 && (
          <div
            role="listitem"
            // Non-clickable: there is no bucket to drill into. A diagonal
            // hatch via a repeating gradient marks it as "not a real bucket".
            style={{
              height: `${unaccountedPct}%`,
              minHeight: 6,
              backgroundImage:
                'repeating-linear-gradient(45deg, rgb(75,85,99) 0, rgb(75,85,99) 4px, rgb(55,65,81) 4px, rgb(55,65,81) 8px)',
            }}
            className="w-full"
            title={`Unaccounted — ${unaccounted.toLocaleString()} tokens (${formatPct(unaccountedPct)}% of total) reported in the API total but not attributed to any bucket`}
            aria-label={`Unaccounted: ${formatTokenNumber(unaccounted)} tokens, ${formatPct(unaccountedPct)}% of total, not attributed to any bucket`}
          />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Drill-down sub-page (per-bucket element list)
// ---------------------------------------------------------------------------

function MissingNote({ tokens }: { tokens: number }) {
  // Item-12: the bucket has captured /context tokens but we couldn't
  // enumerate any elements for it. Show this explicitly so the user
  // knows the gap, instead of just a blank list.
  return (
    <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
      <div className="font-semibold mb-0.5">Missing from token count</div>
      <div className="text-rose-200/80">
        The captured <span className="font-mono">/context</span> snapshot reports {formatTokenNumber(tokens)} tokens for this bucket, but the local enumerator returned no elements. The Phase C token-size ledger will fill this gap.
      </div>
    </div>
  )
}

function ScopeBadge({ scope }: { scope: BucketElementWire['scope'] }) {
  const colors: Record<BucketElementWire['scope'], string> = {
    user:    'text-blue-300 bg-blue-500/10 border-blue-500/30',
    project: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
    plugin:  'text-violet-300 bg-violet-500/10 border-violet-500/30',
    builtin: 'text-gray-400 bg-gray-700/30 border-gray-600/40',
  }
  return (
    <span className={`px-1.5 py-0.5 rounded border text-[8px] uppercase tracking-wider font-semibold ${colors[scope]}`}>
      {scope}
    </span>
  )
}

function StatusTag({ status }: { status: BucketElementWire['status'] }) {
  // Phase C tag — shows whether the element's token count is the
  // historical truth from the ledger ('normal'), an approximation
  // from the current on-disk state ('approx'), or a placeholder for
  // a now-uninstalled element ('missing'). Live views (no
  // atOrBeforeLineIndex) emit no status, so we render nothing.
  if (!status || status === 'normal') return null
  if (status === 'approx') {
    return (
      <span
        className="px-1 py-0.5 rounded border text-[8px] uppercase tracking-wider font-semibold text-amber-300 bg-amber-500/10 border-amber-500/30"
        title="Historical view requested but no inventory ledger snapshot in scope; current on-disk size shown as an approximation."
      >
        approx
      </span>
    )
  }
  return (
    <span
      className="px-1 py-0.5 rounded border text-[8px] uppercase tracking-wider font-semibold text-rose-300 bg-rose-500/10 border-rose-500/30"
      title="Was loaded at session time but is no longer on disk. Token count is the historical value from the ledger."
    >
      missing
    </span>
  )
}

function ElementRow({
  element,
  bucketTotal,
  modelLimit,
}: {
  element: BucketElementWire
  bucketTotal: number
  modelLimit: number
}) {
  const denom = Math.max(modelLimit, 1)
  const pctOfLimit = (element.tokens / denom) * 100
  const pctOfBucket = bucketTotal > 0 ? (element.tokens / bucketTotal) * 100 : 0
  return (
    <li className="flex items-start gap-2 py-1 border-b border-white/5">
      <span className="text-gray-400 text-[10px] mt-0.5">•</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <ScopeBadge scope={element.scope} />
          <StatusTag status={element.status} />
          <span className="font-mono text-[11px] text-gray-100 break-all" title={element.detail}>
            {element.name}
          </span>
        </div>
      </div>
      <span className="tabular-nums text-[10px] text-gray-300 flex-shrink-0 text-right">
        <div className="font-medium" title={element.tokens.toLocaleString()}>{formatTokenNumber(element.tokens)}</div>
        {/* Both percentages are labelled (was a bare "%" and a cryptic "lim"),
            with matching precision. (audit MINOR: ambiguous % units.) */}
        <div className="text-gray-500 text-[9px]" title={`${formatPct(pctOfBucket, 2)}% of this bucket · ${formatPct(pctOfLimit, 2)}% of the model window`}>
          {formatPct(pctOfBucket)}% of bucket · {formatPct(pctOfLimit, 2)}% of window
        </div>
      </span>
    </li>
  )
}

function SegmentDetailView({
  bucket,
  breakdown,
  onBack,
}: {
  bucket: Bucket
  breakdown: ContextBreakdownResponse
  onBack: () => void
}) {
  const value = breakdown[bucket.key] ?? 0
  const elements = breakdown.elements ?? null
  const recorded = breakdown.recordedSnapshot ?? null
  const recordedValue =
    recorded && bucket.recordedKey !== null ? recorded[bucket.recordedKey] : null

  // Derive what to render for this bucket. Constant buckets carry a
  // `note` instead of an element list. The messages bucket carries
  // user/assistant counts. Everything else has a flat array.
  const renderBody = () => {
    if (!elements) {
      return <div className="text-[11px] text-gray-400">Element listing unavailable on this server version.</div>
    }
    switch (bucket.key) {
      case 'systemPrompt':
      case 'systemTools':
      case 'mcpTools':
      case 'autocompactBuffer': {
        const item = elements[bucket.key]
        const showMissing =
          typeof recordedValue === 'number' && recordedValue > value && item.tokens === 0
        return (
          <div className="space-y-3">
            <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-gray-200">
              {item.note}
            </div>
            {showMissing && <MissingNote tokens={recordedValue} />}
          </div>
        )
      }
      case 'freeSpace':
        return (
          <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-gray-200">
            Unused token budget remaining in the model&apos;s context window. This is the headroom
            before auto-compaction kicks in.
          </div>
        )
      case 'cacheRead':
        return (
          <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-gray-200">
            Tokens served from Claude&apos;s <span className="font-mono">prompt cache</span> — prior
            context (system prompt, tools, earlier turns) re-entered into the window from cache
            instead of being re-sent as fresh input. They still occupy the window, which is why
            they&apos;re counted here, but they bill at the much cheaper cache-read rate rather than
            the full input rate. The captured <span className="font-mono">/context</span> snapshot
            does not break this out, so there is no Δ comparison for this bucket.
          </div>
        )
      case 'messages': {
        const m = elements.messages
        return (
          <ul className="text-[11px] space-y-1">
            {/* Counts carry a "msgs" unit and tokens a "tok" unit so a small
                integer count and a K/M token size are not mistaken for the
                same quantity. (audit NIT: counts vs token sizes look alike.) */}
            <li className="flex items-baseline gap-2 py-1 border-b border-white/5">
              <span className="text-gray-400">•</span>
              <span className="text-gray-100">User messages</span>
              <span className="ml-auto tabular-nums font-mono text-emerald-300">{m.userCount.toLocaleString()} <span className="text-gray-500 text-[9px]">msgs</span></span>
            </li>
            <li className="flex items-baseline gap-2 py-1 border-b border-white/5">
              <span className="text-gray-400">•</span>
              <span className="text-gray-100">Assistant messages</span>
              <span className="ml-auto tabular-nums font-mono text-emerald-300">{m.assistantCount.toLocaleString()} <span className="text-gray-500 text-[9px]">msgs</span></span>
            </li>
            <li className="flex items-baseline gap-2 py-1 border-b border-white/5">
              <span className="text-gray-400">•</span>
              <span className="text-gray-100">Total tokens</span>
              <span className="ml-auto tabular-nums font-mono text-emerald-300" title={m.tokens.toLocaleString()}>{formatTokenNumber(m.tokens)} <span className="text-gray-500 text-[9px]">tok</span></span>
            </li>
          </ul>
        )
      }
      case 'customAgents':
      case 'memory':
      case 'skills': {
        const list = elements[bucket.key]
        const sortedDesc = [...list].sort((a, b) => b.tokens - a.tokens)
        const showMissing =
          typeof recordedValue === 'number' && recordedValue > 0 && list.length === 0
        if (sortedDesc.length === 0) {
          return showMissing ? (
            <MissingNote tokens={recordedValue} />
          ) : (
            <div className="text-[11px] text-gray-500 italic">No elements loaded for this bucket.</div>
          )
        }
        return (
          <ul className="space-y-0">
            {sortedDesc.map((el, i) => (
              <ElementRow
                // scope+name is unique within a bucket; the index suffix is a
                // last-resort tiebreaker for a (rare) duplicate of both.
                // (audit MINOR: index-only key remounts on re-sort.)
                key={`${el.scope}-${el.name}-${i}`}
                element={el}
                bucketTotal={value}
                modelLimit={breakdown.modelContextLimit}
              />
            ))}
          </ul>
        )
      }
      default: {
        // Exhaustiveness guard: adding a 10th bucket key without a matching
        // case here becomes a TypeScript error (the assignment to `never`
        // fails), and at runtime renders a loud marker instead of a silent
        // blank panel. (audit MAJOR: switch had no default / fallthrough.)
        const _exhaustive: never = bucket.key
        return (
          <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
            Unhandled bucket: {String(_exhaustive)}
          </div>
        )
      }
    }
  }

  const pctOfLimit = (value / Math.max(breakdown.modelContextLimit, 1)) * 100

  return (
    <div className={`flex flex-col h-full bg-gradient-to-br ${bucket.drillDownGradient}`}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to context overview"
          className="p-1 rounded hover:bg-white/10 text-gray-300"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-400">
          Context · drill-down
        </span>
      </div>
      <div className="px-4 py-3 overflow-y-auto flex-1 min-h-0 overscroll-contain">
        {/*
          Slice rectangle copied from the pillar at a fixed wide-and-short
          aspect so the visual link to the pillar is unmistakable.
        */}
        <div
          className="rounded-md mb-2 shadow-md"
          style={{ backgroundColor: bucket.color, height: 28, width: '100%' }}
          aria-hidden
        />
        <h2 className={`text-base font-semibold mb-1 ${bucket.labelColor}`}>{bucket.label}</h2>
        <div className="flex items-baseline gap-2 mb-3 text-[11px] text-gray-300">
          <span className="font-mono tabular-nums text-gray-100 font-semibold" title={value.toLocaleString()}>
            {formatTokenNumber(value)}
          </span>
          <span className="text-gray-400">tokens</span>
          <span className="text-gray-500">·</span>
          <span className="text-gray-400">{formatPct(pctOfLimit)}% of model limit</span>
          {typeof recordedValue === 'number' && (() => {
            const d = formatDelta(value, recordedValue)
            return (
              <span
                className={`ml-auto ${DELTA_TONE_CLASS[d.tone]} font-mono`}
                title={`Heuristic: ${value.toLocaleString()} · Captured /context: ${recordedValue.toLocaleString()}`}
              >
                Δ {d.text}
              </span>
            )
          })()}
        </div>
        {renderBody()}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bars body (header + bar list) — same layout as before, factored out
// ---------------------------------------------------------------------------

function BarsView({
  breakdown,
  onSelectBucket,
}: {
  breakdown: ContextBreakdownResponse
  onSelectBucket: (k: BucketKey) => void
}) {
  const { total, modelContextLimit, modelId, approximate } = breakdown
  const recorded = breakdown.recordedSnapshot ?? null

  // Reconcile the per-bucket bars against the reported total. Now that
  // cacheRead is a bucket, the bar sum should equal `total` for a healthy
  // server. If they still disagree, show the signed remainder honestly
  // rather than letting the bars imply they sum to the total.
  // (audit MAJOR: bucket-sum vs total disagreement shown with no reconciliation.)
  const bucketSum = BUCKETS.reduce((s, b) => s + breakdown[b.key], 0)
  const remainder = total - bucketSum

  const captureBadge = recorded ? (
    <div className="text-[9px] text-emerald-400/80 mt-0.5 leading-tight">
      Comparing vs <span className="font-mono">/context</span> snapshot · line #
      {recorded.capturedAtLineIndex}
      {recorded.capturedAtTimestamp && (
        <span title={recorded.capturedAtTimestamp}>
          {' '}· {new Date(recorded.capturedAtTimestamp).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
        </span>
      )}
    </div>
  ) : (
    <div className="text-[9px] text-gray-500 mt-0.5 leading-tight">
      No <span className="font-mono">/context</span> snapshot in this session — heuristic only
    </div>
  )

  const totalDelta = recorded ? formatDelta(total, recorded.total) : null

  return (
    <div className="p-4 space-y-3">
      <div className="space-y-0.5 text-[10px] text-gray-400">
        <div className="flex items-center justify-between">
          <span>Total tokens</span>
          <span className="tabular-nums text-gray-200 font-medium flex items-baseline gap-1.5">
            <span title={total.toLocaleString()}>{formatTokenNumber(total)}</span>
            {approximate && <span className="text-gray-500" title="Heuristic estimate (char/4), not Claude's exact BPE count">~</span>}
            {totalDelta && recorded && (
              <span
                className={`${DELTA_TONE_CLASS[totalDelta.tone]} text-[9px] font-mono ml-0.5`}
                title={`Heuristic: ${total.toLocaleString()} · Captured: ${recorded.total.toLocaleString()}`}
              >
                {totalDelta.text}
              </span>
            )}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Model limit</span>
          <span className="tabular-nums text-gray-200" title={modelContextLimit.toLocaleString()}>{formatTokenNumber(modelContextLimit)}</span>
        </div>
        {/* Only surfaced when the bars do NOT sum to the total — a healthy
            server reconciles to 0 and this row is hidden. The 1-token guard
            avoids flagging rounding dust. */}
        {Math.abs(remainder) > 1 && (
          <div className="flex items-center justify-between text-amber-300/80" title="The per-bucket bars below do not sum to the reported total. This residual is the difference, shown so the parts reconcile to the whole.">
            <span>Unaccounted</span>
            <span className="tabular-nums">{remainder > 0 ? '+' : '−'}{formatTokenNumber(Math.abs(remainder))}</span>
          </div>
        )}
        {modelId && (
          <div className="flex items-center justify-between">
            <span>Model</span>
            <span className="text-gray-500 font-mono text-[9px] truncate max-w-[140px]" title={modelId}>
              {modelId}
            </span>
          </div>
        )}
        {captureBadge}
        {/* Denominator caption so the basis is explicit when toggling
            bars↔pillar (bars are "% of model limit", pillar is "% of buckets").
            (audit MAJOR: per-view percentages change meaning with no label.) */}
        <div className="text-[9px] text-gray-500 pt-0.5">Bar shares are % of the model limit.</div>
      </div>
      <div className="space-y-2.5">
        {BUCKETS.map(bucket => (
          <BarRow
            key={bucket.key}
            bucket={bucket}
            value={breakdown[bucket.key]}
            modelLimit={modelContextLimit}
            recorded={recorded}
            onSelectBucket={onSelectBucket}
          />
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// PSS component-lifeline section ("what was loaded here, then")
// ---------------------------------------------------------------------------

/** Mirrors lib/pss-lifeline.ts LifelineComponent. */
interface LifelineComponent {
  name: string
  type: string
  scope?: string
  installedAtIso?: string | null
}
/** Mirrors lib/pss-lifeline.ts LifelineResult (the route's JSON body). */
interface LifelineResult {
  status: 'ok' | 'stale' | 'unavailable'
  reason?: string
  asOfIso?: string
  scanAgeSec?: number | null
  components: LifelineComponent[]
}

function ScopePill({ scope }: { scope?: string }) {
  if (!scope) return null
  // PSS scopes are open-ended (user|project|local|plugin|marketplace|…). A
  // small lookup colors the known ones; anything else gets a neutral chip
  // (no crash on an unexpected scope — fail-soft).
  const known: Record<string, string> = {
    user: 'text-blue-300 bg-blue-500/10 border-blue-500/30',
    project: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
    local: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
    plugin: 'text-violet-300 bg-violet-500/10 border-violet-500/30',
    marketplace: 'text-fuchsia-300 bg-fuchsia-500/10 border-fuchsia-500/30',
  }
  const cls = known[scope] ?? 'text-gray-400 bg-gray-700/30 border-gray-600/40'
  return (
    <span className={`px-1 py-0.5 rounded border text-[8px] uppercase tracking-wider font-semibold ${cls}`}>
      {scope}
    </span>
  )
}

/**
 * "Components active here" — best-effort PSS lifeline for the agent's working
 * directory at the pinned conversation time.
 *
 * GRACEFUL DEGRADATION IS THE WHOLE POINT (the route NEVER 500s, and this
 * section NEVER breaks the panel):
 *   - no projectDir / no atMs → render nothing (we can't even ask).
 *   - fetch throws / non-200   → quiet "history unavailable" note.
 *   - status 'unavailable'     → quiet "history unavailable" note (PSS absent/empty).
 *   - status 'stale'           → amber "may be stale — run /pss-reindex-skills"
 *                                banner ABOVE the (possibly outdated) list.
 *   - status 'ok'              → the component list with type/scope/first-seen.
 */
function ComponentsLifelineSection({
  projectDir,
  atMs,
}: {
  projectDir: string | null
  atMs: number | null
}) {
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'error' }
    | { kind: 'done'; result: LifelineResult }
  >({ kind: 'idle' })

  useEffect(() => {
    // Can't query without both inputs — render nothing, don't fetch.
    if (!projectDir || atMs === null || !Number.isFinite(atMs)) {
      setState({ kind: 'idle' })
      return
    }
    const ctrl = new AbortController()
    setState({ kind: 'loading' })
    const qs = new URLSearchParams({ projectDir, atMs: String(Math.round(atMs)) })
    fetch(`/api/sessions-browser/lifeline?${qs.toString()}`, { signal: ctrl.signal })
      .then(async res => {
        // The route contract says 200 for every non-input-error case. A 4xx
        // here (401/400) is treated as "can't show" — fail-soft, never throw
        // out of this component.
        if (!res.ok) {
          setState({ kind: 'error' })
          return
        }
        const json = (await res.json()) as LifelineResult
        setState({ kind: 'done', result: json })
      })
      .catch(() => {
        // AbortError (unmount / input change) or network error — both quiet.
        if (!ctrl.signal.aborted) setState({ kind: 'error' })
      })
    return () => ctrl.abort()
  }, [projectDir, atMs])

  // Nothing to ask, or an outright fetch failure → a single quiet line.
  if (state.kind === 'idle') return null
  if (state.kind === 'loading') {
    return (
      <div className="px-4 pb-3 pt-1 border-t border-gray-800/60">
        <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 mb-1.5 flex items-center gap-1.5">
          <Boxes className="w-3 h-3" /> Components active here
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-gray-500">
          <Loader2 className="w-3 h-3 animate-spin" /> Resolving component history…
        </div>
      </div>
    )
  }
  if (state.kind === 'error') {
    return (
      <div className="px-4 pb-3 pt-1 border-t border-gray-800/60">
        <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 mb-1.5 flex items-center gap-1.5">
          <Boxes className="w-3 h-3" /> Components active here
        </div>
        <div className="text-[10px] text-gray-500 italic">Component history unavailable.</div>
      </div>
    )
  }

  const { result } = state

  if (result.status === 'unavailable') {
    return (
      <div className="px-4 pb-3 pt-1 border-t border-gray-800/60">
        <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 mb-1.5 flex items-center gap-1.5">
          <Boxes className="w-3 h-3" /> Components active here
        </div>
        <div
          className="text-[10px] text-gray-500 italic"
          title={result.reason ?? 'PSS history is not available for this folder.'}
        >
          Component history unavailable.
        </div>
      </div>
    )
  }

  const components = result.components
  return (
    <div className="px-4 pb-3 pt-1 border-t border-gray-800/60">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 mb-1.5 flex items-center gap-1.5">
        <Boxes className="w-3 h-3" /> Components active here
      </div>

      {result.status === 'stale' && (
        // The data is still shown (best-effort), but flagged: PSS's newest
        // scan is older than its freshness threshold, so the list may not
        // reflect recent installs/removals.
        <div
          className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 mb-2 text-[10px] text-amber-200"
          role="status"
        >
          <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
          <span>
            History may be stale — run <span className="font-mono">/pss-reindex-skills</span> to refresh.
          </span>
        </div>
      )}

      {components.length === 0 ? (
        <div className="text-[10px] text-gray-500 italic">No components recorded at this point.</div>
      ) : (
        <ul className="space-y-0.5">
          {components.map((c, i) => (
            <li
              key={`${c.scope ?? 'noscope'}-${c.type}-${c.name}-${i}`}
              className="flex items-center gap-1.5 py-0.5 text-[11px]"
            >
              <ScopePill scope={c.scope} />
              <span className="text-gray-500 text-[9px] uppercase tracking-wide flex-shrink-0">{c.type}</span>
              <span className="font-mono text-gray-100 break-all min-w-0">{c.name}</span>
              {c.installedAtIso && (
                <span
                  className="ml-auto text-gray-500 text-[9px] flex-shrink-0 tabular-nums"
                  // On a freshly-seeded PSS DB this is the migration date, not
                  // the true install date — present as "first seen", per P-4.
                  title={`First seen: ${c.installedAtIso}`}
                >
                  {new Date(c.installedAtIso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Body dispatcher
// ---------------------------------------------------------------------------

interface PanelBodyExtra {
  viewMode: 'bars' | 'pillar'
  drillDownBucket: BucketKey | null
  setDrillDownBucket: (k: BucketKey | null) => void
  /** Agent working directory — drives the PSS lifeline query. May be null. */
  projectDir: string | null
  /** Pinned conversation time (epoch ms) the lifeline resolves against. */
  atMs: number | null
}

function PanelBody({
  breakdown,
  loading,
  error,
  viewMode,
  drillDownBucket,
  setDrillDownBucket,
  projectDir,
  atMs,
}: ContextBreakdownPanelProps & PanelBodyExtra) {
  if (loading && !breakdown) {
    return <div className="text-[11px] text-gray-500 px-3 py-4">Loading context breakdown…</div>
  }
  if (error) {
    return (
      <div className="text-[11px] text-red-300 px-3 py-4 flex items-start gap-2" role="alert">
        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
        <span>Failed to load context: {error}</span>
      </div>
    )
  }
  if (!breakdown) {
    return <div className="text-[11px] text-gray-500 px-3 py-4">No session selected.</div>
  }

  if (drillDownBucket) {
    const bucket = BUCKETS.find(b => b.key === drillDownBucket)
    if (!bucket) {
      // Drill-down key drifted — bail to overview rather than crashing.
      setDrillDownBucket(null)
      return null
    }
    return (
      <SegmentDetailView
        bucket={bucket}
        breakdown={breakdown}
        onBack={() => setDrillDownBucket(null)}
      />
    )
  }

  // Overview = the chosen view + the PSS lifeline section. When a refetch is
  // in flight while a previous breakdown is still on screen, dim the numbers
  // and show a "refreshing" badge so the user knows they're looking at
  // about-to-be-replaced data. (audit MAJOR: stale breakdown shown with no
  // loading indicator on refetch.)
  return (
    <div className="relative flex flex-col">
      {loading && (
        <div className="sticky top-0 z-10 flex items-center justify-end gap-1.5 px-3 py-1 text-[9px] text-amber-300/90 bg-gray-900/80 backdrop-blur-sm" role="status">
          <Loader2 className="w-3 h-3 animate-spin" /> Refreshing…
        </div>
      )}
      <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
        {viewMode === 'pillar' ? (
          <PillarView breakdown={breakdown} onSelectBucket={setDrillDownBucket} />
        ) : (
          <BarsView breakdown={breakdown} onSelectBucket={setDrillDownBucket} />
        )}
        <ComponentsLifelineSection projectDir={projectDir} atMs={atMs} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Top-level panel (desktop side panel + mobile drawer)
// ---------------------------------------------------------------------------

function ViewModeToggle({
  viewMode,
  onChange,
}: {
  viewMode: 'bars' | 'pillar'
  onChange: (mode: 'bars' | 'pillar') => void
}) {
  return (
    <div className="ml-auto flex items-center gap-0.5 bg-gray-800/60 border border-gray-700 rounded-md p-0.5">
      <button
        type="button"
        onClick={() => onChange('bars')}
        aria-label="Bars view"
        title="Bars view"
        className={`p-1 rounded ${viewMode === 'bars' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'}`}
      >
        <BarChart3 className="w-3 h-3" />
      </button>
      <button
        type="button"
        onClick={() => onChange('pillar')}
        aria-label="Pillar view"
        title="Pillar view"
        className={`p-1 rounded ${viewMode === 'pillar' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'}`}
      >
        <AlignVerticalJustifyEnd className="w-3 h-3" />
      </button>
    </div>
  )
}

const DRAWER_ID = 'context-breakdown-drawer'

export default function ContextBreakdownPanel(props: ContextBreakdownPanelProps) {
  // ONE responsive source of truth — see useIsCompactLayout. The redundant
  // Tailwind `hidden lg:flex` / `lg:hidden` gating is gone, so JS and CSS can
  // no longer disagree at the breakpoint.
  const { compact, mounted } = useIsCompactLayout(1024)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [viewMode, setViewMode] = useState<'bars' | 'pillar'>('bars')
  const [drillDownBucket, setDrillDownBucket] = useState<BucketKey | null>(null)

  const drawerRef = useRef<HTMLElement>(null)
  const closeDrawer = useCallback(() => setDrawerOpen(false), [])
  // Real modal behavior for the drawer: Escape, focus-trap, return-focus,
  // body-scroll lock. No-ops while closed. (audit CRITICAL.)
  useModalDialog(drawerOpen, closeDrawer, drawerRef)

  // Reset the drill-down to the overview whenever the underlying session
  // changes — otherwise a drill-down pinned during a session switch shows the
  // NEW session's data under the OLD bucket view, with no signal a switch
  // happened. (audit MAJOR: drill-down not reset on session change.)
  const sessionId = props.breakdown?.sessionId ?? null
  useEffect(() => {
    setDrillDownBucket(null)
  }, [sessionId])

  const bodyExtra: PanelBodyExtra = {
    viewMode,
    drillDownBucket,
    setDrillDownBucket,
    projectDir: props.projectDir ?? null,
    atMs: props.atMs ?? null,
  }

  // Desktop side panel. SSR + first client render both hit this branch
  // (compact defaults false), so there is no hydration mismatch; on a real
  // compact viewport the effect flips `compact` and we re-render the drawer
  // shell below.
  if (!compact) {
    return (
      <aside
        aria-label="Context breakdown"
        className="flex flex-col w-[280px] border-l border-gray-800 bg-gray-900/40 overflow-hidden touch-pan-y overscroll-contain"
      >
        <div className="sticky top-0 z-10 flex items-center gap-2 px-3 py-2 text-[10px] uppercase tracking-wider font-semibold text-gray-500 bg-gray-900/70 backdrop-blur border-b border-gray-800/60">
          <span>Context</span>
          {drillDownBucket === null && (
            <ViewModeToggle viewMode={viewMode} onChange={setViewMode} />
          )}
        </div>
        <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
          <PanelBody {...props} {...bodyExtra} />
        </div>
      </aside>
    )
  }

  // Compact (< 1024px): a toggle button + a real modal drawer. The toggle is
  // wrapped in a `relative` container THIS component owns, so its absolute
  // position no longer depends on an ancestor positioned by SessionsTab.
  // (audit MINOR: toggle depended on a relative ancestor it didn't own.)
  return (
    <div className="relative">
      {/* Hide the toggle while the drawer is open (its job is done and it
          would otherwise sit under the backdrop). */}
      {!drawerOpen && (
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open context breakdown"
          aria-expanded={drawerOpen}
          aria-controls={DRAWER_ID}
          className="absolute top-2 right-2 z-20 p-1.5 rounded-md bg-gray-800/80 hover:bg-gray-700/90 text-gray-300 border border-gray-700 shadow-lg"
        >
          <PanelRightOpen className="w-4 h-4" />
        </button>
      )}
      {/* Render the drawer only after mount so a compact first paint never
          flashes the wrong shell; harmless on desktop (this whole branch is
          compact-only). */}
      {mounted && drawerOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-30"
            onClick={closeDrawer}
            aria-hidden
          />
          <aside
            ref={drawerRef}
            id={DRAWER_ID}
            role="dialog"
            aria-label="Context breakdown"
            aria-modal="true"
            tabIndex={-1}
            className="fixed right-0 top-0 bottom-0 w-[280px] max-w-[85vw] z-40 bg-gray-900 border-l border-gray-800 overflow-hidden flex flex-col focus:outline-none"
          >
            <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
                Context
              </span>
              {drillDownBucket === null && (
                <ViewModeToggle viewMode={viewMode} onChange={setViewMode} />
              )}
              <button
                type="button"
                onClick={closeDrawer}
                aria-label="Close context breakdown"
                className="p-1 rounded hover:bg-gray-800/60 text-gray-400"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
              <PanelBody {...props} {...bodyExtra} />
            </div>
          </aside>
        </>
      )}
    </div>
  )
}
