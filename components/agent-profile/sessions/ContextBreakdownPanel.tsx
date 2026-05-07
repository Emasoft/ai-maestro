'use client'

/**
 * ContextBreakdownPanel — right pane (≤280 px wide desktop, drawer on tablet).
 *
 * Spec (TRDD-d46b42e9 Phase 3 §6.3.4):
 *   7 horizontal bars (systemPrompt, systemTools, mcpTools, customAgents,
 *   memory, messages, freeSpace) with absolute token counts, % of total,
 *   and % of model context limit. Free space gray.
 */

import { useEffect, useState } from 'react'
import { X, PanelRightOpen, AlertTriangle } from 'lucide-react'
import type { ContextBreakdownResponse } from '@/types/sessions-browser'

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
  label: string
  /** Tailwind bg color for the filled portion of the bar. */
  fillBg: string
  /** Tailwind text color for the label. */
  labelColor: string
}

// Order mirrors what `claude-code /context` prints, so users comparing
// the two side-by-side can scan top-to-bottom without re-mapping rows.
const BUCKETS: Bucket[] = [
  { key: 'systemPrompt',      label: 'System prompt',      fillBg: 'bg-blue-500',    labelColor: 'text-blue-300' },
  { key: 'systemTools',       label: 'System tools',       fillBg: 'bg-cyan-500',    labelColor: 'text-cyan-300' },
  { key: 'mcpTools',          label: 'MCP tools',          fillBg: 'bg-violet-500',  labelColor: 'text-violet-300' },
  { key: 'customAgents',      label: 'Custom agents',      fillBg: 'bg-amber-500',   labelColor: 'text-amber-300' },
  { key: 'memory',            label: 'Memory files',       fillBg: 'bg-pink-500',    labelColor: 'text-pink-300' },
  { key: 'skills',            label: 'Skills',             fillBg: 'bg-fuchsia-500', labelColor: 'text-fuchsia-300' },
  { key: 'messages',          label: 'Messages',           fillBg: 'bg-emerald-500', labelColor: 'text-emerald-300' },
  { key: 'autocompactBuffer', label: 'Autocompact buffer', fillBg: 'bg-orange-500',  labelColor: 'text-orange-300' },
  { key: 'freeSpace',         label: 'Free space',         fillBg: 'bg-gray-500',    labelColor: 'text-gray-400' },
]

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

interface ContextBreakdownPanelProps {
  breakdown: ContextBreakdownResponse | null
  loading: boolean
  error: string | null
}

function BarRow({
  bucket,
  value,
  total,
  modelLimit,
}: {
  bucket: Bucket
  value: number
  total: number
  modelLimit: number
}) {
  const safeLimit = Math.max(modelLimit, 1)
  // Match Claude Code's `/context`: every per-bucket percentage uses
  // the MODEL LIMIT as denominator, not the session total. That's why
  // `/context` shows "Memory files: 35k tokens (3.5%)" even though
  // memory is far more than 3.5% of the consumed portion — the 3.5% is
  // its share of the 1M-token window. `total` is kept in the closure
  // for backwards compatibility with the old aria-label format but is
  // not used for the displayed percentages.
  void total // referenced to avoid an unused-arg lint
  const pctOfBucketDenom = (value / safeLimit) * 100
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] mb-1">
        <span className={`${bucket.labelColor} font-medium`}>{bucket.label}</span>
        <span className="tabular-nums text-gray-400">
          {formatTokenNumber(value)}
          <span className="text-gray-600 ml-1.5">({pctOfBucketDenom.toFixed(1)}%)</span>
        </span>
      </div>
      <div
        className="aim-ctx-bar-track"
        role="progressbar"
        aria-label={`${bucket.label}: ${formatTokenNumber(value)} tokens (${pctOfBucketDenom.toFixed(1)}% of model limit)`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pctOfBucketDenom)}
      >
        <div
          className={`aim-ctx-bar-fill ${bucket.fillBg}`}
          style={{ width: `${Math.min(100, pctOfBucketDenom)}%` }}
        />
      </div>
      {/*
        The earlier two-line layout showed both the per-bucket % and a
        small "% of model context limit" footer because the two
        denominators differed. They now match Claude Code's `/context`
        (always vs model limit), so the footer is redundant — kept the
        inline percentage on the value line above. */}
    </div>
  )
}

/**
 * Body content — reused by both the side panel and the drawer layouts.
 */
function PanelBody({ breakdown, loading, error }: ContextBreakdownPanelProps) {
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
  const { total, modelContextLimit, modelId, approximate } = breakdown
  // Snapshot provenance — when source==='recorded' we read the
  // numbers verbatim from a captured `/context` slash-command output
  // in the JSONL. Tell the user which message and when so they can
  // correlate the panel with the transcript and confirm "yes this is
  // exactly what Claude reported at that moment". When source is
  // missing or 'heuristic', we walked today's filesystem instead;
  // mark that visually so the user knows the numbers are an estimate.
  const source = breakdown.source ?? 'heuristic'
  const capturedAt = breakdown.capturedAtTimestamp
  const capturedAtLineIndex = breakdown.capturedAtLineIndex
  const sourceBadge =
    source === 'recorded' ? (
      <div className="text-[9px] text-emerald-400/80 mt-0.5 leading-tight">
        Snapshot from <span className="font-mono">/context</span>
        {capturedAtLineIndex !== null && capturedAtLineIndex !== undefined && (
          <> · line #{capturedAtLineIndex}</>
        )}
        {capturedAt && (
          <> · {new Date(capturedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}</>
        )}
      </div>
    ) : (
      <div className="text-[9px] text-amber-400/70 mt-0.5 leading-tight">
        Estimated from on-disk state — no <span className="font-mono">/context</span> capture in this session
      </div>
    )
  return (
    <div className="px-3 py-3 space-y-3">
      <div className="space-y-0.5 text-[10px] text-gray-400">
        <div className="flex items-center justify-between">
          <span>Total tokens</span>
          <span className="tabular-nums text-gray-200 font-medium">
            {formatTokenNumber(total)}
            {approximate && <span className="text-gray-500 ml-1">~</span>}
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
        {sourceBadge}
      </div>
      <div className="space-y-2.5">
        {BUCKETS.map(bucket => (
          <BarRow
            key={bucket.key}
            bucket={bucket}
            value={breakdown[bucket.key]}
            total={total}
            modelLimit={modelContextLimit}
          />
        ))}
      </div>
    </div>
  )
}

export default function ContextBreakdownPanel(props: ContextBreakdownPanelProps) {
  const compact = useIsCompactLayout(1024)
  const [drawerOpen, setDrawerOpen] = useState(false)

  if (!compact) {
    return (
      <aside
        aria-label="Context breakdown"
        className="hidden lg:flex flex-col w-[280px] border-l border-gray-800 bg-gray-900/40 overflow-y-auto"
        style={{ touchAction: 'pan-y', overscrollBehavior: 'contain' }}
      >
        <div className="sticky top-0 z-10 flex items-center gap-2 px-3 py-2 text-[10px] uppercase tracking-wider font-semibold text-gray-500 bg-gray-900/70 backdrop-blur border-b border-gray-800/60">
          <span>Context</span>
        </div>
        <PanelBody {...props} />
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
              className="fixed right-0 top-0 bottom-0 w-[280px] max-w-[85vw] z-40 bg-gray-900 border-l border-gray-800 overflow-y-auto flex flex-col"
            >
              <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800">
                <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
                  Context
                </span>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Close context breakdown"
                  className="ml-auto p-1 rounded hover:bg-gray-800/60 text-gray-400"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <PanelBody {...props} />
            </aside>
          </>
        )}
      </div>
    </>
  )
}
