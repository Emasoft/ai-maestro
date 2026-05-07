'use client'

/**
 * ContextBreakdownPanel — right pane (≤280 px wide desktop, drawer on tablet).
 *
 * Spec (TRDD-d46b42e9 Phase 3 §6.3.4):
 *   9 horizontal bars (systemPrompt, systemTools, mcpTools, customAgents,
 *   memory, skills, messages, autocompactBuffer, freeSpace) with absolute
 *   token counts, % of model limit, and an optional comparison badge
 *   showing the delta against the captured `/context` snapshot.
 *
 * The displayed numbers ALWAYS come from our heuristic — JSONL parse +
 * on-disk tokenization. When a `/context` slash command was captured at
 * or before the selected transcript message, its numbers are surfaced
 * as a small comparison badge per row so drift between Claude's BPE
 * tokenizer and our char/4 estimate is VISIBLE. That makes heuristic
 * bugs surface as "expected 13.5K, captured 15.2K" instead of silently
 * masking themselves behind a "use captured when present" fallback.
 */

import { useEffect, useState } from 'react'
import { X, PanelRightOpen, AlertTriangle } from 'lucide-react'
import type {
  ContextBreakdownResponse,
  RecordedContextSnapshotWire,
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
  /** Field name on the recorded snapshot, when one exists. Null when the
   *  snapshot doesn't carry this bucket (e.g. systemTools, mcpTools). */
  recordedKey: keyof RecordedContextSnapshotWire | null
  label: string
  /** Tailwind bg color for the filled portion of the bar. */
  fillBg: string
  /** Tailwind text color for the label. */
  labelColor: string
}

// Order mirrors what `claude-code /context` prints, so users comparing
// the two side-by-side can scan top-to-bottom without re-mapping rows.
const BUCKETS: Bucket[] = [
  { key: 'systemPrompt',      recordedKey: 'systemPrompt',      label: 'System prompt',      fillBg: 'bg-blue-500',    labelColor: 'text-blue-300' },
  { key: 'systemTools',       recordedKey: null,                label: 'System tools',       fillBg: 'bg-cyan-500',    labelColor: 'text-cyan-300' },
  { key: 'mcpTools',          recordedKey: null,                label: 'MCP tools',          fillBg: 'bg-violet-500',  labelColor: 'text-violet-300' },
  { key: 'customAgents',      recordedKey: 'customAgents',      label: 'Custom agents',      fillBg: 'bg-amber-500',   labelColor: 'text-amber-300' },
  { key: 'memory',            recordedKey: 'memory',            label: 'Memory files',       fillBg: 'bg-pink-500',    labelColor: 'text-pink-300' },
  { key: 'skills',            recordedKey: 'skills',            label: 'Skills',             fillBg: 'bg-fuchsia-500', labelColor: 'text-fuchsia-300' },
  { key: 'messages',          recordedKey: 'messages',          label: 'Messages',           fillBg: 'bg-emerald-500', labelColor: 'text-emerald-300' },
  { key: 'autocompactBuffer', recordedKey: 'autocompactBuffer', label: 'Autocompact buffer', fillBg: 'bg-orange-500',  labelColor: 'text-orange-300' },
  { key: 'freeSpace',         recordedKey: 'freeSpace',         label: 'Free space',         fillBg: 'bg-gray-500',    labelColor: 'text-gray-400' },
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

/** Format a Δ between heuristic and recorded. Used for the per-row
 *  comparison badge — small enough to read at a glance, signed so the
 *  user can see whether we're over or under. */
function formatDelta(heuristic: number, recorded: number): { text: string; tone: 'match' | 'low' | 'high' } {
  const diff = heuristic - recorded
  const denom = Math.max(recorded, 1)
  const ratio = Math.abs(diff) / denom
  // < 5 % drift counts as a match for visual purposes.
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
  const pctOfBucketDenom = (value / safeLimit) * 100

  // Comparison badge — only when both the bucket has a recorded
  // counterpart AND the snapshot itself is in scope. Buckets without
  // a captured equivalent (systemTools, mcpTools — Claude doesn't
  // print them in /context) skip the badge entirely.
  const recordedValue =
    recorded && bucket.recordedKey !== null ? recorded[bucket.recordedKey] : null
  const delta = recordedValue !== null && typeof recordedValue === 'number'
    ? formatDelta(value, recordedValue)
    : null
  const badgeTone =
    delta?.tone === 'match'
      ? 'text-emerald-400/90'
      : delta?.tone === 'high'
        ? 'text-amber-300'
        : 'text-rose-300'

  return (
    <div>
      <div className="flex items-center justify-between text-[10px] mb-1 gap-2">
        <span className={`${bucket.labelColor} font-medium`}>{bucket.label}</span>
        <span className="tabular-nums text-gray-300 flex items-baseline gap-1.5">
          <span className="font-medium">{formatTokenNumber(value)}</span>
          <span className="text-gray-500">({pctOfBucketDenom.toFixed(1)}%)</span>
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
  const recorded = breakdown.recordedSnapshot ?? null

  // Header note: are we able to compare against a captured /context?
  // The badge is informational — the displayed numbers come from the
  // heuristic regardless. When recorded is present, every row gets a
  // small Δ vs the captured value so the user can see drift.
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

  // Total comparison line — when we DO have a recorded snapshot, show
  // both totals on the header so the user can see at a glance whether
  // the bucket sums roll up to the right place.
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
                  totalDelta.tone === 'match'
                    ? 'text-emerald-400/90 text-[9px] font-mono ml-0.5'
                    : totalDelta.tone === 'high'
                      ? 'text-amber-300 text-[9px] font-mono ml-0.5'
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
