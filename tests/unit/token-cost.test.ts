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

// Minimal MessageUsage builder — the optional nested cache fields
// (cacheCreation5mTokens/1hTokens) are display-only and not priced, so the
// cost math never reads them.
const usage = (
  inputTokens = 0,
  outputTokens = 0,
  cacheReadTokens = 0,
  cacheCreationTokens = 0,
): MessageUsage => ({ inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens })

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
  it('cache tiers follow the documented multipliers (write 1.25x, read 0.10x of input)', () => {
    for (const fam of ['opus', 'sonnet', 'haiku'] as const) {
      expect(PRICES[fam].cacheWrite).toBeCloseTo(PRICES[fam].input * 1.25, 6)
      expect(PRICES[fam].cacheRead).toBeCloseTo(PRICES[fam].input * 0.1, 6)
      expect(PRICES[fam].output).toBeGreaterThan(PRICES[fam].input)
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
