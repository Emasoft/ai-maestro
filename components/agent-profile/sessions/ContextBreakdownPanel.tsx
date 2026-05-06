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
    'systemPrompt' | 'systemTools' | 'mcpTools' | 'customAgents' | 'memory' | 'messages' | 'freeSpace'
  >
  label: string
  /** Tailwind bg color for the filled portion of the bar. */
  fillBg: string
  /** Tailwind text color for the label. */
  labelColor: string
}

const BUCKETS: Bucket[] = [
  { key: 'systemPrompt', label: 'System prompt', fillBg: 'bg-blue-500', labelColor: 'text-blue-300' },
  { key: 'systemTools', label: 'System tools', fillBg: 'bg-cyan-500', labelColor: 'text-cyan-300' },
  { key: 'mcpTools', label: 'MCP tools', fillBg: 'bg-violet-500', labelColor: 'text-violet-300' },
  { key: 'customAgents', label: 'Custom agents', fillBg: 'bg-amber-500', labelColor: 'text-amber-300' },
  { key: 'memory', label: 'Memory', fillBg: 'bg-pink-500', labelColor: 'text-pink-300' },
  { key: 'messages', label: 'Messages', fillBg: 'bg-emerald-500', labelColor: 'text-emerald-300' },
  { key: 'freeSpace', label: 'Free space', fillBg: 'bg-gray-500', labelColor: 'text-gray-400' },
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
  const safeTotal = Math.max(total, 1)
  const safeLimit = Math.max(modelLimit, 1)
  // Free space is a complement to the consumed portion of the model
  // limit — its denominator is the model context limit, NOT the
  // session total. Using `total` (=consumed) as the denominator
  // produced the visible 922.5% value in the screenshot
  // (free=902.2K / total=97.8K). For every consumption bucket
  // (systemPrompt, messages, etc.) `total` is the right denominator
  // because we want "share of what's been consumed".
  const denomForBucket = bucket.key === 'freeSpace' ? safeLimit : safeTotal
  const pctOfBucketDenom = (value / denomForBucket) * 100
  const pctOfLimit = (value / safeLimit) * 100
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
        aria-label={`${bucket.label}: ${formatTokenNumber(value)} tokens (${pctOfBucketDenom.toFixed(1)}% of ${bucket.key === 'freeSpace' ? 'model limit' : 'session'}, ${pctOfLimit.toFixed(2)}% of model limit)`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pctOfBucketDenom)}
      >
        <div
          className={`aim-ctx-bar-fill ${bucket.fillBg}`}
          style={{ width: `${Math.min(100, pctOfBucketDenom)}%` }}
        />
      </div>
      <div className="text-[9px] text-gray-600 mt-0.5 tabular-nums">
        {pctOfLimit.toFixed(2)}% of model context limit
      </div>
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
