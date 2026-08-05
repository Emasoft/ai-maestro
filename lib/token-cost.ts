/**
 * Single source of truth for token-cost APPROXIMATION (TRDD-1657a5f4 Phase 4).
 *
 * ════════════════════════════════════════════════════════════════════════
 * MONEY HERE IS ALWAYS AN APPROXIMATION. NEVER PRESENT IT AS EXACT SPEND.
 * ════════════════════════════════════════════════════════════════════════
 *
 * The user pays a FLAT-RATE Pro/Max subscription. Claude Code does not bill
 * per token. Every dollar figure this module produces is an INDICATIVE
 * "what would this have cost at published per-token API prices" equivalent —
 * a yardstick for the relative weight of a session, NOT the user's actual
 * outlay. The UI MUST render every figure with a `~` / "approx" prefix and
 * surface {@link APPROX_COST_CAVEAT} near it (tooltip or footnote).
 *
 * Why approximate by construction:
 *   - The flat-rate plan decouples usage from spend entirely.
 *   - Published API rates drift; the table below is a 2026 snapshot.
 *   - Token counts come from the JSONL `usage` object, which itself is
 *     best-effort (some turns omit cache buckets).
 *   - Family resolution is a substring match, so an unrecognized model id
 *     falls back to the sonnet tier rather than failing.
 *
 * This module is intentionally DECOUPLED from `lib/context-limits.ts`. It
 * reuses the *idea* of resolving a Claude model id to a family alias, but it
 * owns its OWN price map — context limits and prices change on different
 * cadences and must not be a single edit-point.
 */

import type { MessageUsage } from '@/types/sessions-browser'

/** The three Claude pricing families. Unknown ids resolve to `sonnet`. */
export type ModelFamily = 'opus' | 'sonnet' | 'haiku'

/** Per-million-token USD rates for one model family. */
export interface FamilyPrices {
  /** USD per 1M input (uncached prompt) tokens. */
  input: number
  /** USD per 1M output (generated) tokens. */
  output: number
  /** USD per 1M cache-WRITE tokens (the 5-minute ephemeral write tier). */
  cacheWrite: number
  /**
   * USD per 1M cache-WRITE tokens at the **1-hour** ephemeral tier (2× input,
   * vs the 5m tier's 1.25×). Applied only to the portion a record reports as
   * `cacheCreation1hTokens`; when a record carries no split, everything is
   * billed at {@link FamilyPrices.cacheWrite} exactly as before.
   */
  cacheWrite1h: number
  /** USD per 1M cache-READ (cache-hit) tokens. */
  cacheRead: number
}

/**
 * Indicative published Anthropic API per-MTok USD rates, family-keyed.
 *
 * ⚠️  INDICATIVE published rates as of 2026 — these DRIFT. Treat them as a
 *     yardstick, not a quote. Anthropic adjusts list prices over time and
 *     across regions; do not hardcode business logic on the exact numbers.
 *
 * Derivation of the cache tiers (Anthropic's documented multipliers):
 *   - cache WRITE (5m ephemeral) ≈ 1.25 × input rate
 *   - cache WRITE (1h ephemeral) ≈ 2.00 × input rate
 *   - cache READ  (cache hit)     ≈ 0.10 × input rate
 *
 * ⚠️ THE TWO WRITE TIERS ARE NOT INTERCHANGEABLE, AND THE 1h ONE IS THE
 *    EXPENSIVE ONE. Billing a 1h write at the 5m rate reports 1.25/2 =
 *    62.5% of it — a systematic 37.5% UNDER-report, silently, on exactly
 *    the traffic that costs most. Long-lived agent sessions run on the 1h
 *    TTL, so the sessions this dashboard exists to weigh were the ones most
 *    under-priced. Measured and reported upstream as `Emasoft/ai-maestro#94`
 *    finding 3 by AgentlensPro, which replaced an inferred window model with
 *    telemetry.
 *
 *    It also breaks the RELATIVE comparison this module is for: a marathon
 *    1h-TTL session and a short 5m one were being weighed on different
 *    scales, so "which session is expensive" was answerable only up to that
 *    distortion. Approximate is fine; differently-approximate-per-row is not.
 *
 * Base list rates used (per 1M tokens):
 *   opus    ≈ $15 in  / $75 out
 *   sonnet  ≈ $3  in  / $15 out
 *   haiku   ≈ $0.80 in / $4 out
 */
export const PRICES: Readonly<Record<ModelFamily, FamilyPrices>> = {
  opus: {
    input: 15,
    output: 75,
    cacheWrite: 18.75, // 15 × 1.25
    cacheWrite1h: 30, // 15 × 2.00
    cacheRead: 1.5, // 15 × 0.10
  },
  sonnet: {
    input: 3,
    output: 15,
    cacheWrite: 3.75, // 3 × 1.25
    cacheWrite1h: 6, // 3 × 2.00
    cacheRead: 0.3, // 3 × 0.10
  },
  haiku: {
    input: 0.8,
    output: 4,
    cacheWrite: 1.0, // 0.80 × 1.25
    cacheWrite1h: 1.6, // 0.80 × 2.00
    cacheRead: 0.08, // 0.80 × 0.10
  },
} as const

/**
 * Family used when a model id matches none of opus/sonnet/haiku. Surfaced as
 * a named constant so callers can label the fallback in the UI ("assuming
 * sonnet-tier rates") rather than silently presenting numbers as if the
 * model were known.
 */
export const FALLBACK_FAMILY: ModelFamily = 'sonnet'

/**
 * Resolve a Claude model id to its pricing family by substring.
 *
 * Version-proof: `claude-opus-4-8`, the 1M variant `claude-opus-4-8[1m]`,
 * a hypothetical `claude-opus-5`, and the bare alias `opus` all collapse to
 * `opus`. A null / empty / unrecognized id returns {@link FALLBACK_FAMILY}
 * (sonnet tier) — the most representative mid-tier so an unknown model never
 * over- or under-states cost wildly.
 *
 * @param model The model id from the JSONL line/session, or `null`.
 */
export function modelFamily(model: string | null | undefined): ModelFamily {
  if (!model) return FALLBACK_FAMILY
  const m = model.toLowerCase()
  // Order: most-specific check first. Each family alias is a distinct
  // substring so order only matters if Anthropic ever ships a compound
  // name; today these are mutually exclusive.
  if (m.includes('opus')) return 'opus'
  if (m.includes('haiku')) return 'haiku'
  if (m.includes('sonnet')) return 'sonnet'
  return FALLBACK_FAMILY
}

/** True when the model id did not match a known family (UI may flag it). */
export function isFallbackFamily(model: string | null | undefined): boolean {
  if (!model) return true
  const m = model.toLowerCase()
  return !(m.includes('opus') || m.includes('haiku') || m.includes('sonnet'))
}

/**
 * APPROXIMATE indicative cost of a usage record at published per-token API
 * rates. Sum over the four token buckets, each priced at its family rate,
 * divided by 1e6 (rates are per-MTok).
 *
 * Returns dollars (a float). ALWAYS approximate — see the module header.
 *
 * @param usage Token buckets for one message (or a summed total).
 * @param model The model id; resolved to a family via {@link modelFamily}.
 */
/**
 * Price the cache-WRITE bucket across its two tiers, in raw (pre-÷1M) units.
 *
 * `cacheCreationTokens` is the AUTHORITATIVE total (see `MessageUsage`), so the
 * 5-minute portion is derived as `total − 1h` rather than read from
 * `cacheCreation5mTokens`. Trusting two independently-parsed optional fields to
 * sum to a third is a second source of truth, and the day a record reports only
 * one of them the total would silently stop matching the sum of its parts. One
 * authoritative number, one subtraction.
 *
 * `Math.max(0, …)` is not defensive noise: the split fields are documented as
 * best-effort, so a malformed record claiming more 1h tokens than the total
 * would otherwise make the 5m remainder NEGATIVE and quietly refund money.
 * Clamping keeps a bad record merely wrong, never sign-flipped.
 *
 * Shared by both entry points ON PURPOSE — `approxCostUsd` and `costBreakdown`
 * are documented to agree for the same inputs, and two copies of this
 * arithmetic is exactly how that guarantee would rot.
 */
function cacheWriteRawUsd(usage: MessageUsage, p: FamilyPrices): number {
  const oneHour = Math.min(usage.cacheCreation1hTokens ?? 0, usage.cacheCreationTokens)
  const fiveMin = Math.max(0, usage.cacheCreationTokens - oneHour)
  return fiveMin * p.cacheWrite + oneHour * p.cacheWrite1h
}

export function approxCostUsd(
  usage: MessageUsage,
  model: string | null | undefined,
): number {
  const p = PRICES[modelFamily(model)]
  const usd =
    usage.inputTokens * p.input +
    usage.outputTokens * p.output +
    usage.cacheReadTokens * p.cacheRead +
    cacheWriteRawUsd(usage, p)
  return usd / 1_000_000
}

/** One priced bucket: how many tokens and their approximate USD value. */
export interface CostBucket {
  tokens: number
  usd: number
}

/**
 * Structured per-bucket breakdown for the UI to render. Every `usd` value is
 * an APPROXIMATION (see module header). `approxUsd` is the rounded sum of the
 * four buckets and equals {@link approxCostUsd} for the same inputs.
 */
export interface CostBreakdown {
  /** Family the prices were drawn from (so the UI can label the assumption). */
  family: ModelFamily
  /** True when `family` is the fallback (model id unrecognized). */
  isFallback: boolean
  input: CostBucket
  output: CostBucket
  cacheRead: CostBucket
  cacheCreation: CostBucket
  /** Sum of all four buckets' token counts. */
  totalTokens: number
  /** Approximate total USD across all buckets. */
  approxUsd: number
}

/**
 * Build a structured cost breakdown from a usage record. The UI renders each
 * bucket's tokens + approx USD and the total. Money is ALWAYS approximate.
 *
 * @param usage Token buckets for one message (or a summed total).
 * @param model The model id; resolved to a family via {@link modelFamily}.
 */
export function costBreakdown(
  usage: MessageUsage,
  model: string | null | undefined,
): CostBreakdown {
  const family = modelFamily(model)
  const p = PRICES[family]
  const input: CostBucket = {
    tokens: usage.inputTokens,
    usd: (usage.inputTokens * p.input) / 1_000_000,
  }
  const output: CostBucket = {
    tokens: usage.outputTokens,
    usd: (usage.outputTokens * p.output) / 1_000_000,
  }
  const cacheRead: CostBucket = {
    tokens: usage.cacheReadTokens,
    usd: (usage.cacheReadTokens * p.cacheRead) / 1_000_000,
  }
  const cacheCreation: CostBucket = {
    tokens: usage.cacheCreationTokens,
    usd: cacheWriteRawUsd(usage, p) / 1_000_000,
  }
  const totalTokens =
    input.tokens + output.tokens + cacheRead.tokens + cacheCreation.tokens
  const approxUsd =
    input.usd + output.usd + cacheRead.usd + cacheCreation.usd
  return {
    family,
    isFallback: isFallbackFamily(model),
    input,
    output,
    cacheRead,
    cacheCreation,
    totalTokens,
    approxUsd,
  }
}

/**
 * Format a USD amount for display. Designed for the small per-message and
 * per-session figures the browser shows.
 *
 *   - Exactly 0           → "$0.00"
 *   - 0 < n < $0.01       → "<$0.01"  (too small to show 2 decimals honestly)
 *   - $0.01 ≤ n < $10     → 4 decimals, e.g. "$0.0123" (fine-grained)
 *   - n ≥ $10             → 2 decimals, e.g. "$42.50"  (coarser for big sums)
 *
 * The caller is responsible for the `~` / "approx" prefix + caveat; this
 * function returns the bare number so it composes with either presentation.
 *
 * @param n A dollar amount (may be a float from {@link approxCostUsd}).
 */
export function formatUsd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '$0.00'
  if (n < 0.01) return '<$0.01'
  const decimals = n < 10 ? 4 : 2
  return `$${n.toFixed(decimals)}`
}

/**
 * Short caveat the UI MUST show near EVERY money figure (tooltip / footnote).
 * Keeps the "this is not your real bill" message a single source of truth so
 * every surface phrases it identically.
 */
export const APPROX_COST_CAVEAT =
  'Indicative API-equivalent at published per-token rates — not your actual flat-rate Pro/Max spend.'
