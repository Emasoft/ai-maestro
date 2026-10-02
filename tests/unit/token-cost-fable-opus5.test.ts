/**
 * Pricing families added for Fable 5 / 5.1 and Opus 5.5 (TRDD-2PFVKO7P A3).
 * Rates: Anthropic pricing page, fetched 2026-10-02 (matches the claude-api
 * skill model table, 2026-09-25). No mocks.
 */
import { describe, it, expect } from 'vitest'
import { modelFamily, isFallbackFamily, approxCostUsd, PRICES } from '@/lib/token-cost'
import type { MessageUsage } from '@/types/sessions-browser'

const M = 1_000_000
const usage = (inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheCreationTokens = 0): MessageUsage => ({
  inputTokens,
  outputTokens,
  cacheReadTokens,
  cacheCreationTokens,
})

describe('token-cost: fable / opus 5.5 families', () => {
  it('Fable 5.1 and the bare alias resolve to fable; Fable 5 to fable5', () => {
    expect(modelFamily('claude-fable-5-1')).toBe('fable')
    expect(modelFamily('claude-fable-5-1[1m]')).toBe('fable')
    expect(modelFamily('fable')).toBe('fable')
    expect(modelFamily('claude-fable-5')).toBe('fable5')
    expect(modelFamily('CLAUDE-FABLE-5')).toBe('fable5')
  })
  it('Opus 5.5 resolves to opus5 while opus-4-8 and opus-5 stay in opus', () => {
    expect(modelFamily('claude-opus-5-5')).toBe('opus5')
    expect(modelFamily('claude-opus-5-5[1m]')).toBe('opus5')
    expect(modelFamily('claude-opus-4-8')).toBe('opus')
    expect(modelFamily('claude-opus-5')).toBe('opus')
  })
  it('fable is a known family, not a fallback', () => {
    expect(isFallbackFamily('claude-fable-5-1')).toBe(false)
    expect(isFallbackFamily('claude-fable-5')).toBe(false)
    expect(isFallbackFamily('claude-opus-5-5')).toBe(false)
  })
  it('prices Fable 5.1 at $10 in / $50 out / $0.25 cache read / $12.50 write', () => {
    expect(approxCostUsd(usage(M), 'claude-fable-5-1')).toBeCloseTo(10, 6)
    expect(approxCostUsd(usage(0, M), 'claude-fable-5-1')).toBeCloseTo(50, 6)
    expect(approxCostUsd(usage(0, 0, M), 'claude-fable-5-1')).toBeCloseTo(0.25, 6)
    expect(approxCostUsd(usage(0, 0, 0, M), 'claude-fable-5-1')).toBeCloseTo(12.5, 6)
  })
  it('prices Fable 5 like 5.1 except cache read at $1', () => {
    expect(approxCostUsd(usage(M), 'claude-fable-5')).toBeCloseTo(10, 6)
    expect(approxCostUsd(usage(0, M), 'claude-fable-5')).toBeCloseTo(50, 6)
    expect(approxCostUsd(usage(0, 0, M), 'claude-fable-5')).toBeCloseTo(1, 6)
  })
  it('prices Opus 5.5 at $4 in / $20 out / $0.20 cache read / $5 write', () => {
    expect(approxCostUsd(usage(M), 'claude-opus-5-5')).toBeCloseTo(4, 6)
    expect(approxCostUsd(usage(0, M), 'claude-opus-5-5')).toBeCloseTo(20, 6)
    expect(approxCostUsd(usage(0, 0, M), 'claude-opus-5-5')).toBeCloseTo(0.2, 6)
    expect(approxCostUsd(usage(0, 0, 0, M), 'claude-opus-5-5')).toBeCloseTo(5, 6)
  })
  it('1h write is 2x input for the new families', () => {
    for (const fam of ['fable', 'fable5', 'opus5'] as const) {
      expect(PRICES[fam].cacheWrite).toBeCloseTo(PRICES[fam].input * 1.25, 6)
      expect(PRICES[fam].cacheWrite1h).toBeCloseTo(PRICES[fam].input * 2, 6)
    }
  })
  it('modern Opus (4.5-5) is $5/$25/$0.50/$6.25, not the legacy $15/$75', () => {
    for (const id of ['claude-opus-4-5', 'claude-opus-4-8', 'claude-opus-4-10', 'claude-opus-5', 'opus']) {
      expect(modelFamily(id)).toBe('opus')
    }
    expect(approxCostUsd(usage(M), 'claude-opus-4-8')).toBeCloseTo(5, 6)
    expect(approxCostUsd(usage(0, M), 'claude-opus-5')).toBeCloseTo(25, 6)
    expect(approxCostUsd(usage(0, 0, M), 'claude-opus-4-6')).toBeCloseTo(0.5, 6)
    expect(approxCostUsd(usage(0, 0, 0, M), 'claude-opus-4-7')).toBeCloseTo(6.25, 6)
  })
  it('Opus 4.1 and earlier resolve to opus41 at $15/$75/$1.50/$18.75', () => {
    for (const id of ['claude-opus-4-1', 'claude-opus-4-1-20250805', 'claude-opus-4-0', 'claude-opus-4-20250514', 'claude-opus-4@20250514', 'claude-opus-4', 'claude-3-opus-20240229']) {
      expect(modelFamily(id)).toBe('opus41')
    }
    expect(approxCostUsd(usage(M), 'claude-opus-4-1')).toBeCloseTo(15, 6)
    expect(approxCostUsd(usage(0, M), 'claude-opus-4-1')).toBeCloseTo(75, 6)
    expect(approxCostUsd(usage(0, 0, M), 'claude-opus-4-1')).toBeCloseTo(1.5, 6)
    expect(approxCostUsd(usage(0, 0, 0, M), 'claude-opus-4-1')).toBeCloseTo(18.75, 6)
  })
  it('Haiku 4.5 is $1/$5', () => {
    expect(approxCostUsd(usage(M), 'claude-haiku-4-5')).toBeCloseTo(1, 6)
    expect(approxCostUsd(usage(0, M), 'claude-haiku-4-5')).toBeCloseTo(5, 6)
  })
})
