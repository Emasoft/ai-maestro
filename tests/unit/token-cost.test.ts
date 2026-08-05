import { describe, it, expect } from 'vitest'
import {
  modelFamily,
  isFallbackFamily,
  approxCostUsd,
  costBreakdown,
  formatUsd,
  PRICES,
  FALLBACK_FAMILY,
  APPROX_COST_CAVEAT,
} from '@/lib/token-cost'
import type { MessageUsage } from '@/types/sessions-browser'

// Minimal MessageUsage builder. `cacheCreation1hTokens` IS priced (at 2× input,
// vs the 5m tier's 1.25×) — it was display-only until #94 finding 3 measured the
// 37.5% under-report that caused. Omitting it is the pre-split record shape and
// must price exactly as it always did.
const usage = (
  inputTokens = 0,
  outputTokens = 0,
  cacheReadTokens = 0,
  cacheCreationTokens = 0,
  cacheCreation1hTokens?: number,
): MessageUsage => ({
  inputTokens,
  outputTokens,
  cacheReadTokens,
  cacheCreationTokens,
  ...(cacheCreation1hTokens === undefined ? {} : { cacheCreation1hTokens }),
})

describe('token-cost: modelFamily', () => {
  it('resolves opus ids (incl [1m] variant and future versions) to opus', () => {
    expect(modelFamily('claude-opus-4-8')).toBe('opus')
    expect(modelFamily('claude-opus-4-8[1m]')).toBe('opus')
    expect(modelFamily('claude-opus-5')).toBe('opus')
    expect(modelFamily('opus')).toBe('opus')
  })
  it('resolves sonnet and haiku', () => {
    expect(modelFamily('claude-sonnet-4-6')).toBe('sonnet')
    expect(modelFamily('claude-haiku-4-5')).toBe('haiku')
  })
  it('falls back to sonnet for unknown / empty / null / undefined', () => {
    expect(modelFamily('gpt-5')).toBe(FALLBACK_FAMILY)
    expect(modelFamily('')).toBe(FALLBACK_FAMILY)
    expect(modelFamily(null)).toBe(FALLBACK_FAMILY)
    expect(modelFamily(undefined)).toBe(FALLBACK_FAMILY)
    expect(FALLBACK_FAMILY).toBe('sonnet')
  })
})

describe('token-cost: isFallbackFamily', () => {
  it('is false for known families, true for unknown / null / empty', () => {
    expect(isFallbackFamily('claude-opus-4-8')).toBe(false)
    expect(isFallbackFamily('claude-sonnet-4-6')).toBe(false)
    expect(isFallbackFamily('claude-haiku-4-5')).toBe(false)
    expect(isFallbackFamily('gpt-5')).toBe(true)
    expect(isFallbackFamily(null)).toBe(true)
    expect(isFallbackFamily('')).toBe(true)
  })
})

describe('token-cost: approxCostUsd (per-MTok rates)', () => {
  it('prices 1M input tokens at the family input rate', () => {
    expect(approxCostUsd(usage(1_000_000), 'claude-opus-4-8')).toBeCloseTo(15, 6)
    expect(approxCostUsd(usage(1_000_000), 'claude-sonnet-4-6')).toBeCloseTo(3, 6)
    expect(approxCostUsd(usage(1_000_000), 'claude-haiku-4-5')).toBeCloseTo(0.8, 6)
  })
  it('prices output / cache-read / cache-write distinctly (opus)', () => {
    expect(approxCostUsd(usage(0, 1_000_000), 'opus')).toBeCloseTo(75, 6)
    expect(approxCostUsd(usage(0, 0, 1_000_000), 'opus')).toBeCloseTo(1.5, 6)
    expect(approxCostUsd(usage(0, 0, 0, 1_000_000), 'opus')).toBeCloseTo(18.75, 6)
  })
  it('zero usage is exactly $0', () => {
    expect(approxCostUsd(usage(), 'opus')).toBe(0)
  })
  it('an unrecognized model id is priced at the sonnet fallback tier', () => {
    expect(approxCostUsd(usage(1_000_000), 'mystery-model')).toBeCloseTo(PRICES.sonnet.input, 6)
  })
})

describe('token-cost: PRICES table integrity', () => {
  it('cache tiers follow the documented multipliers (write 1.25x / 1h 2x, read 0.10x of input)', () => {
    for (const fam of ['opus', 'sonnet', 'haiku'] as const) {
      expect(PRICES[fam].cacheWrite).toBeCloseTo(PRICES[fam].input * 1.25, 6)
      expect(PRICES[fam].cacheWrite1h).toBeCloseTo(PRICES[fam].input * 2, 6)
      expect(PRICES[fam].cacheRead).toBeCloseTo(PRICES[fam].input * 0.1, 6)
      expect(PRICES[fam].output).toBeGreaterThan(PRICES[fam].input)
      // The 1h tier MUST be the dearer one — the whole point of separating them.
      expect(PRICES[fam].cacheWrite1h).toBeGreaterThan(PRICES[fam].cacheWrite)
    }
  })
})

describe('token-cost: costBreakdown', () => {
  it('splits buckets and totals consistently with approxCostUsd', () => {
    const u = usage(1000, 2000, 3000, 4000)
    const b = costBreakdown(u, 'claude-opus-4-8')
    expect(b.family).toBe('opus')
    expect(b.isFallback).toBe(false)
    expect(b.input.tokens).toBe(1000)
    expect(b.output.tokens).toBe(2000)
    expect(b.cacheRead.tokens).toBe(3000)
    expect(b.cacheCreation.tokens).toBe(4000)
    expect(b.totalTokens).toBe(10000)
    // Sum-then-divide (approxCostUsd) vs divide-each-then-sum (breakdown) can
    // differ in the last float bit, so compare closely rather than strictly.
    expect(b.approxUsd).toBeCloseTo(approxCostUsd(u, 'claude-opus-4-8'), 9)
    // cache-read MUST be a distinct, priced bucket (the audit flagged it being dropped).
    expect(b.cacheRead.usd).toBeCloseTo((3000 * PRICES.opus.cacheRead) / 1_000_000, 9)
  })
  it('flags the fallback family for an unknown model', () => {
    const b = costBreakdown(usage(1000), 'gpt-5')
    expect(b.family).toBe('sonnet')
    expect(b.isFallback).toBe(true)
  })
})

describe('token-cost: formatUsd', () => {
  it('formats by magnitude band', () => {
    expect(formatUsd(0)).toBe('$0.00')
    expect(formatUsd(0.005)).toBe('<$0.01')
    expect(formatUsd(0.0123)).toBe('$0.0123')
    expect(formatUsd(42.5)).toBe('$42.50')
  })
  it('guards non-finite and non-positive input', () => {
    expect(formatUsd(-1)).toBe('$0.00')
    expect(formatUsd(NaN)).toBe('$0.00')
    expect(formatUsd(Infinity)).toBe('$0.00')
  })
})

describe('token-cost: APPROX_COST_CAVEAT', () => {
  it('is a non-empty single-source caveat string', () => {
    expect(typeof APPROX_COST_CAVEAT).toBe('string')
    expect(APPROX_COST_CAVEAT.length).toBeGreaterThan(10)
  })
})

/**
 * The two cache-WRITE tiers (#94 finding 3).
 *
 * WHY THESE EXIST. `cacheCreation1hTokens` was parsed, summed and DISPLAYED but
 * never priced — every 1-hour write was billed at the 5-minute rate, i.e. 1.25
 * where 2 was due, a silent 37.5% under-report on exactly the long-lived
 * sessions this cost view exists to weigh. Nothing could go red, because the
 * only assertions were on records that carry no split at all.
 *
 * So the load-bearing case is `mixed`: a record whose two tiers are BOTH
 * non-zero is the only shape that can tell the tiered arithmetic from the flat
 * one. A 1h-only record would also pass under a (wrong) implementation that
 * simply swapped the constant.
 */
describe('token-cost: 5m vs 1h cache-write tiers', () => {
  const M = 1_000_000

  it('prices a 1h-only record at 2x input, not the 5m 1.25x', () => {
    const u = usage(0, 0, 0, M, M)
    // sonnet: input 3 -> 1h write 6, 5m write 3.75. The old flat path gave 3.75.
    expect(approxCostUsd(u, 'claude-sonnet-4-6')).toBeCloseTo(6, 10)
    expect(approxCostUsd(u, 'claude-sonnet-4-6')).not.toBeCloseTo(3.75, 3)
  })

  it('splits a MIXED record across both tiers — the case that discriminates', () => {
    // 1M total, 600k of it at the 1h tier => 400k @3.75 + 600k @6.
    const u = usage(0, 0, 0, M, 600_000)
    const expected = (400_000 * 3.75 + 600_000 * 6) / M
    expect(approxCostUsd(u, 'claude-sonnet-4-6')).toBeCloseTo(expected, 10)
    // A flat-5m implementation would say 3.75; a flat-1h one would say 6.
    expect(approxCostUsd(u, 'claude-sonnet-4-6')).not.toBeCloseTo(3.75, 3)
    expect(approxCostUsd(u, 'claude-sonnet-4-6')).not.toBeCloseTo(6, 3)
  })

  it('bills a record with NO split entirely at the 5m rate (pre-split shape)', () => {
    const u = usage(0, 0, 0, M)
    expect(approxCostUsd(u, 'claude-sonnet-4-6')).toBeCloseTo(3.75, 10)
    expect(approxCostUsd(u, 'claude-opus-4-8')).toBeCloseTo(18.75, 10)
  })

  it('clamps a malformed record claiming more 1h tokens than the total', () => {
    // Without the clamp the 5m remainder goes NEGATIVE and refunds money —
    // a bad record must stay merely wrong, never sign-flipped.
    const u = usage(0, 0, 0, M, 5 * M)
    const usd = approxCostUsd(u, 'claude-sonnet-4-6')
    expect(usd).toBeCloseTo(6, 10) // whole total at the 1h rate, nothing negative
    expect(usd).toBeGreaterThan(0)
  })

  it('keeps approxCostUsd and costBreakdown in agreement on a split record', () => {
    // Their agreement is a documented guarantee, and it is exactly what a second
    // copy of the tier arithmetic would break — hence one shared helper.
    const u = usage(1000, 2000, 3000, M, 250_000)
    for (const model of ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5']) {
      expect(costBreakdown(u, model).approxUsd).toBeCloseTo(approxCostUsd(u, model), 12)
    }
  })
})
