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

import { useEffect, useMemo, useState } from 'react'
import { X, PanelRightOpen, AlertTriangle, ArrowLeft, BarChart3, AlignVerticalJustifyEnd } from 'lucide-react'
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
  >
  /** Field on the recorded snapshot, when one exists; null when this bucket
   *  has no captured-/context counterpart (systemTools, mcpTools). */
  recordedKey: keyof RecordedContextSnapshotWire | null
  label: string
  /** CSS color used by both the bars and pillar segments. */
  color: string
  /** Tailwind text color for labels. */
  labelColor: string
  /** Drill-down bg gradient — distinct dark-violet shades per bucket. */
  drillDownGradient: string
}

// Order mirrors what `claude-code /context` prints.
const BUCKETS: Bucket[] = [
  { key: 'systemPrompt',      recordedKey: 'systemPrompt',      label: 'System prompt',      color: 'rgb(59, 130, 246)',   labelColor: 'text-blue-300',    drillDownGradient: 'from-indigo-950 via-violet-950 to-purple-950' },
  { key: 'systemTools',       recordedKey: null,                label: 'System tools',       color: 'rgb(6, 182, 212)',    labelColor: 'text-cyan-300',    drillDownGradient: 'from-indigo-950 via-violet-950 to-purple-950' },
  { key: 'mcpTools',          recordedKey: null,                label: 'MCP tools',          color: 'rgb(139, 92, 246)',   labelColor: 'text-violet-300',  drillDownGradient: 'from-indigo-950 via-violet-950 to-purple-950' },
  { key: 'customAgents',      recordedKey: 'customAgents',      label: 'Custom agents',      color: 'rgb(245, 158, 11)',   labelColor: 'text-amber-300',   drillDownGradient: 'from-indigo-950 via-violet-950 to-purple-950' },
  { key: 'memory',            recordedKey: 'memory',            label: 'Memory files',       color: 'rgb(236, 72, 153)',   labelColor: 'text-pink-300',    drillDownGradient: 'from-indigo-950 via-violet-950 to-purple-950' },
  { key: 'skills',            recordedKey: 'skills',            label: 'Skills',             color: 'rgb(217, 70, 239)',   labelColor: 'text-fuchsia-300', drillDownGradient: 'from-indigo-950 via-violet-950 to-purple-950' },
  { key: 'messages',          recordedKey: 'messages',          label: 'Messages',           color: 'rgb(16, 185, 129)',   labelColor: 'text-emerald-300', drillDownGradient: 'from-indigo-950 via-violet-950 to-purple-950' },
  { key: 'autocompactBuffer', recordedKey: 'autocompactBuffer', label: 'Autocompact buffer', color: 'rgb(249, 115, 22)',   labelColor: 'text-orange-300',  drillDownGradient: 'from-indigo-950 via-violet-950 to-purple-950' },
  { key: 'freeSpace',         recordedKey: 'freeSpace',         label: 'Free space',         color: 'rgb(107, 114, 128)',  labelColor: 'text-gray-400',    drillDownGradient: 'from-indigo-950 via-violet-950 to-purple-950' },
]

type BucketKey = Bucket['key']

function useIsCompactLayout(breakpoint = 1024) {
  const [compact, setCompact] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`)
    const update = () => setCompact(mql.matches)
    update()
    mql.addEventListener('change', update)
    return () => mql.removeEventListener('change', update)
  }, [breakpoint])
  return compact
}

function formatTokenNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
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
}

// ---------------------------------------------------------------------------
// Bars view (the original layout)
// ---------------------------------------------------------------------------

function BarRow({
  bucket,
  value,
  modelLimit,
  recorded,
}: {
  bucket: Bucket
  value: number
  modelLimit: number
  recorded: RecordedContextSnapshotWire | null
}) {
  const safeLimit = Math.max(modelLimit, 1)
  const pct = (value / safeLimit) * 100

  const recordedValue =
    recorded && bucket.recordedKey !== null ? recorded[bucket.recordedKey] : null
  const delta = typeof recordedValue === 'number'
    ? formatDelta(value, recordedValue)
    : null
  const badgeTone =
    delta?.tone === 'match' ? 'text-emerald-400/90'
      : delta?.tone === 'high' ? 'text-amber-300'
        : 'text-rose-300'

  return (
    <div>
      <div className="flex items-center justify-between text-[10px] mb-1 gap-2">
        <span className={`${bucket.labelColor} font-medium`}>{bucket.label}</span>
        <span className="tabular-nums text-gray-300 flex items-baseline gap-1.5">
          <span className="font-medium">{formatTokenNumber(value)}</span>
          <span className="text-gray-500">({pct.toFixed(1)}%)</span>
          {delta && typeof recordedValue === 'number' && (
            <span
              className={`${badgeTone} text-[9px] font-mono ml-0.5`}
              title={`Heuristic: ${formatTokenNumber(value)} · Captured /context: ${formatTokenNumber(recordedValue)}`}
            >
              {delta.text}
            </span>
          )}
        </span>
      </div>
      <div
        className="aim-ctx-bar-track"
        role="progressbar"
        aria-label={`${bucket.label}: ${formatTokenNumber(value)} tokens (${pct.toFixed(1)}% of model limit)`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
      >
        <div
          className="aim-ctx-bar-fill"
          style={{ width: `${Math.min(100, pct)}%`, backgroundColor: bucket.color }}
        />
      </div>
    </div>
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
  // Total is the sum of every bucket value — this is what the pillar's
  // 100% represents. Using `modelContextLimit` would leave free-space
  // dominating the view; using `total` would skew when the bucket sum
  // disagrees with the API total. The bucket-sum is what the user sees.
  const segmentTotal = useMemo(() => {
    return BUCKETS.reduce((s, b) => s + (breakdown[b.key] ?? 0), 0)
  }, [breakdown])

  const segments = useMemo(() => {
    return BUCKETS.map(b => {
      const value = breakdown[b.key] ?? 0
      const pct = segmentTotal > 0 ? (value / segmentTotal) * 100 : 0
      return { bucket: b, value, pct }
    }).filter(s => s.value > 0)
  }, [breakdown, segmentTotal])

  return (
    <div className="px-3 py-3 flex flex-col h-full min-h-0">
      <p className="text-[10px] text-gray-400 italic mb-2 leading-tight">
        Click on the colored areas to get more info
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
            className="w-full text-left transition-all hover:brightness-125 hover:saturate-150 focus:outline-none focus:ring-2 focus:ring-white/40 focus:z-10"
            title={`${seg.bucket.label}: ${formatTokenNumber(seg.value)} (${seg.pct.toFixed(1)}%)`}
            aria-label={`${seg.bucket.label}: ${formatTokenNumber(seg.value)} tokens — click for details`}
          />
        ))}
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
        <div className="font-medium">{formatTokenNumber(element.tokens)}</div>
        <div className="text-gray-500 text-[9px]">
          {pctOfBucket.toFixed(1)}% · {pctOfLimit.toFixed(2)}% lim
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
            Unused token budget remaining in the model's context window. This is the headroom before
            auto-compaction kicks in.
          </div>
        )
      case 'messages': {
        const m = elements.messages
        return (
          <ul className="text-[11px] space-y-1">
            <li className="flex items-baseline gap-2 py-1 border-b border-white/5">
              <span className="text-gray-400">•</span>
              <span className="text-gray-100">User messages</span>
              <span className="ml-auto tabular-nums font-mono text-emerald-300">{m.userCount}</span>
            </li>
            <li className="flex items-baseline gap-2 py-1 border-b border-white/5">
              <span className="text-gray-400">•</span>
              <span className="text-gray-100">Assistant messages</span>
              <span className="ml-auto tabular-nums font-mono text-emerald-300">{m.assistantCount}</span>
            </li>
            <li className="flex items-baseline gap-2 py-1 border-b border-white/5">
              <span className="text-gray-400">•</span>
              <span className="text-gray-100">Total tokens</span>
              <span className="ml-auto tabular-nums font-mono text-emerald-300">{formatTokenNumber(m.tokens)}</span>
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
                key={`${el.name}-${i}`}
                element={el}
                bucketTotal={value}
                modelLimit={breakdown.modelContextLimit}
              />
            ))}
          </ul>
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
      <div className="px-4 py-3 overflow-y-auto flex-1 min-h-0" style={{ overscrollBehavior: 'contain' }}>
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
          <span className="font-mono tabular-nums text-gray-100 font-semibold">
            {formatTokenNumber(value)}
          </span>
          <span className="text-gray-400">tokens</span>
          <span className="text-gray-500">·</span>
          <span className="text-gray-400">{pctOfLimit.toFixed(1)}% of model limit</span>
          {typeof recordedValue === 'number' && (() => {
            const d = formatDelta(value, recordedValue)
            const tone =
              d.tone === 'match' ? 'text-emerald-400/90'
                : d.tone === 'high' ? 'text-amber-300'
                  : 'text-rose-300'
            return (
              <span
                className={`ml-auto ${tone} font-mono`}
                title={`Heuristic: ${formatTokenNumber(value)} · Captured /context: ${formatTokenNumber(recordedValue)}`}
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

function BarsView({ breakdown }: { breakdown: ContextBreakdownResponse }) {
  const { total, modelContextLimit, modelId, approximate } = breakdown
  const recorded = breakdown.recordedSnapshot ?? null

  const captureBadge = recorded ? (
    <div className="text-[9px] text-emerald-400/80 mt-0.5 leading-tight">
      Comparing vs <span className="font-mono">/context</span> snapshot · line #
      {recorded.capturedAtLineIndex}
      {recorded.capturedAtTimestamp && (
        <> · {new Date(recorded.capturedAtTimestamp).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</>
      )}
    </div>
  ) : (
    <div className="text-[9px] text-gray-500 mt-0.5 leading-tight">
      No <span className="font-mono">/context</span> snapshot in this session — heuristic only
    </div>
  )

  const totalDelta = recorded ? formatDelta(total, recorded.total) : null

  return (
    <div className="px-3 py-3 space-y-3">
      <div className="space-y-0.5 text-[10px] text-gray-400">
        <div className="flex items-center justify-between">
          <span>Total tokens</span>
          <span className="tabular-nums text-gray-200 font-medium flex items-baseline gap-1.5">
            <span>{formatTokenNumber(total)}</span>
            {approximate && <span className="text-gray-500">~</span>}
            {totalDelta && recorded && (
              <span
                className={
                  totalDelta.tone === 'match' ? 'text-emerald-400/90 text-[9px] font-mono ml-0.5'
                    : totalDelta.tone === 'high' ? 'text-amber-300 text-[9px] font-mono ml-0.5'
                      : 'text-rose-300 text-[9px] font-mono ml-0.5'
                }
                title={`Heuristic: ${formatTokenNumber(total)} · Captured: ${formatTokenNumber(recorded.total)}`}
              >
                {totalDelta.text}
              </span>
            )}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Model limit</span>
          <span className="tabular-nums text-gray-200">{formatTokenNumber(modelContextLimit)}</span>
        </div>
        {modelId && (
          <div className="flex items-center justify-between">
            <span>Model</span>
            <span className="text-gray-500 font-mono text-[9px] truncate max-w-[140px]" title={modelId}>
              {modelId}
            </span>
          </div>
        )}
        {captureBadge}
      </div>
      <div className="space-y-2.5">
        {BUCKETS.map(bucket => (
          <BarRow
            key={bucket.key}
            bucket={bucket}
            value={breakdown[bucket.key]}
            modelLimit={modelContextLimit}
            recorded={recorded}
          />
        ))}
      </div>
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
}

function PanelBody({
  breakdown,
  loading,
  error,
  viewMode,
  drillDownBucket,
  setDrillDownBucket,
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

  if (viewMode === 'pillar') {
    return <PillarView breakdown={breakdown} onSelectBucket={setDrillDownBucket} />
  }
  return <BarsView breakdown={breakdown} />
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

export default function ContextBreakdownPanel(props: ContextBreakdownPanelProps) {
  const compact = useIsCompactLayout(1024)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [viewMode, setViewMode] = useState<'bars' | 'pillar'>('bars')
  const [drillDownBucket, setDrillDownBucket] = useState<BucketKey | null>(null)

  const bodyExtra: PanelBodyExtra = { viewMode, drillDownBucket, setDrillDownBucket }

  if (!compact) {
    return (
      <aside
        aria-label="Context breakdown"
        className="hidden lg:flex flex-col w-[280px] border-l border-gray-800 bg-gray-900/40 overflow-hidden"
        style={{ touchAction: 'pan-y', overscrollBehavior: 'contain' }}
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

  return (
    <>
      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open context breakdown"
          className="absolute top-2 right-2 z-20 p-1.5 rounded-md bg-gray-800/80 hover:bg-gray-700/90 text-gray-300 border border-gray-700 shadow-lg"
        >
          <PanelRightOpen className="w-4 h-4" />
        </button>
        {drawerOpen && (
          <>
            <div
              className="fixed inset-0 bg-black/40 z-30"
              onClick={() => setDrawerOpen(false)}
              aria-hidden
            />
            <aside
              role="dialog"
              aria-label="Context breakdown"
              aria-modal="true"
              className="fixed right-0 top-0 bottom-0 w-[280px] max-w-[85vw] z-40 bg-gray-900 border-l border-gray-800 overflow-hidden flex flex-col"
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
                  onClick={() => setDrawerOpen(false)}
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
    </>
  )
}
