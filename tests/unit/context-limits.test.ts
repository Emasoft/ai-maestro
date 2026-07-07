/**
 * Unit tests for the single TS source of truth for Claude model
 * context-window limits — `lib/context-limits.ts` (TRDD-1657a5f4 Phase 1).
 *
 * Canonical rule the fix agent (build agent T) and the Rust mirror
 * (`rust-tools/aim-jsonl-reader/src/context.rs`) both implement:
 *   - a model id whose lowercased string CONTAINS `[1m]` → 1,000,000
 *   - everything else (opus/sonnet/haiku 4.x without the marker, bare
 *     aliases, empty, unknown) → 200,000 default.
 *
 * The HIGH bug this guards against (IN-1 §C1): the old heuristic returned
 * 1,000,000 for ANY `claude-opus-4*`, over-reporting standard Opus
 * 4.6/4.7/4.8 free space by ~800K. The `[1m]` tag OR a native-1M family
 * (Sonnet 5, bare `claude-sonnet-5`) grants 1M; nothing else does.
 *
 * No mocks — exercises the real exported function.
 */

import { describe, it, expect } from 'vitest'

import {
  contextLimitForModel,
  CONTEXT_LIMITS,
  DEFAULT_CONTEXT_LIMIT,
  EXTENDED_CONTEXT_LIMIT,
} from '@/lib/context-limits'

describe('contextLimitForModel — standard-context families default to 200K', () => {
  it('claude-opus-4-8 → 200000 (NOT 1M — the regression this fix repairs)', () => {
    expect(contextLimitForModel('claude-opus-4-8')).toBe(200_000)
  })

  it('claude-sonnet-4-6 → 200000', () => {
    expect(contextLimitForModel('claude-sonnet-4-6')).toBe(200_000)
  })

  it('claude-haiku-4-5 → 200000', () => {
    expect(contextLimitForModel('claude-haiku-4-5')).toBe(200_000)
  })

  it('claude-fable-5 / bare fable → 200000 (Claude 5 family gets no native-1M grant unless tagged)', () => {
    expect(contextLimitForModel('claude-fable-5')).toBe(200_000)
    expect(contextLimitForModel('fable')).toBe(200_000)
  })

  it('older claude-opus-4-6 / 4-7 → 200000 (none of the 4.x line is auto-1M)', () => {
    expect(contextLimitForModel('claude-opus-4-6')).toBe(200_000)
    expect(contextLimitForModel('claude-opus-4-7')).toBe(200_000)
  })

  it('bare opus/sonnet/haiku aliases → 200000 (family default, never auto-1M)', () => {
    expect(contextLimitForModel('opus')).toBe(200_000)
    expect(contextLimitForModel('sonnet')).toBe(200_000)
    expect(contextLimitForModel('haiku')).toBe(200_000)
  })
})

describe('contextLimitForModel — the [1m] tag or a native-1M family grants the extended window', () => {
  it('claude-opus-4-8[1m] → 1000000', () => {
    expect(contextLimitForModel('claude-opus-4-8[1m]')).toBe(1_000_000)
  })

  it('the [1m] tag rides on any family (a hypothetical sonnet 1M variant)', () => {
    expect(contextLimitForModel('claude-sonnet-4-7[1m]')).toBe(1_000_000)
  })

  it('claude-fable-5[1m] → 1000000 (generic [1m] tag covers new families without a code change)', () => {
    expect(contextLimitForModel('claude-fable-5[1m]')).toBe(1_000_000)
  })

  it('claude-sonnet-5 → 1000000 (native 1M, no [1m] tag — CC 2.1.197, TRDD-CS51MFIX)', () => {
    // CC writes the bare id `claude-sonnet-5` (verified: 2554 real JSONL records).
    // Its 1M window is native, so the family must grant 1M without a tag.
    expect(contextLimitForModel('claude-sonnet-5')).toBe(1_000_000)
    expect(contextLimitForModel('CLAUDE-SONNET-5')).toBe(1_000_000)
  })

  it('claude-sonnet-4-6 stays 200000 (sonnet-5 rule must NOT promote Sonnet 4.6)', () => {
    expect(contextLimitForModel('claude-sonnet-4-6')).toBe(200_000)
  })

  it('adversarial near-misses stay 200000 — a `-5` from another family and a longer version number', () => {
    // claude-sonnet-4-5 ends in `-5` but is NOT the sonnet-5 family;
    // claude-sonnet-50 / -55 are different major versions whose prefix
    // `sonnet-5` must NOT over-match (this pins the `(?![0-9])` boundary).
    expect(contextLimitForModel('claude-sonnet-4-5')).toBe(200_000)
    expect(contextLimitForModel('claude-sonnet-50')).toBe(200_000)
    expect(contextLimitForModel('claude-sonnet-55')).toBe(200_000)
  })

  it('a dated snapshot of the sonnet-5 family is still native 1M', () => {
    expect(contextLimitForModel('claude-sonnet-5-20260630')).toBe(1_000_000)
  })

  it('matches the tag case-insensitively (an upper-cased [1M] still resolves to 1M)', () => {
    // contextLimitForModel lowercases the input before the substring test,
    // so a model id printed with an upper-case tag must not slip through.
    expect(contextLimitForModel('CLAUDE-OPUS-4-8[1M]')).toBe(1_000_000)
  })
})

describe('contextLimitForModel — empty / unknown ids fall back to the default', () => {
  it('empty string → 200000', () => {
    expect(contextLimitForModel('')).toBe(200_000)
  })

  it('a never-seen model id → 200000', () => {
    expect(contextLimitForModel('some-future-model-x')).toBe(200_000)
  })

  it('a non-Claude provider id without the tag → 200000', () => {
    expect(contextLimitForModel('gpt-5.5')).toBe(200_000)
  })
})

describe('exported constants match the canonical numbers', () => {
  it('DEFAULT_CONTEXT_LIMIT is 200000 and EXTENDED_CONTEXT_LIMIT is 1000000', () => {
    expect(DEFAULT_CONTEXT_LIMIT).toBe(200_000)
    expect(EXTENDED_CONTEXT_LIMIT).toBe(1_000_000)
  })

  it('CONTEXT_LIMITS map mirrors the two named limits', () => {
    expect(CONTEXT_LIMITS.default).toBe(DEFAULT_CONTEXT_LIMIT)
    expect(CONTEXT_LIMITS.extended).toBe(EXTENDED_CONTEXT_LIMIT)
  })

  it('the function only ever returns one of the two known limits', () => {
    const ids = ['', 'opus', 'claude-opus-4-8', 'claude-opus-4-8[1m]', 'garbage', 'gpt-5.5']
    for (const id of ids) {
      const limit = contextLimitForModel(id)
      expect([DEFAULT_CONTEXT_LIMIT, EXTENDED_CONTEXT_LIMIT]).toContain(limit)
    }
  })
})
