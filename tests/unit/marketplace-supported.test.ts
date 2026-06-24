import { describe, it, expect } from 'vitest'
import { isMarketplaceSupported, getMarketplaceSpec } from '@/lib/converter/marketplace-emitters'

// TRDD-TBGGUA2V P5 — graceful degradation for non-Claude clients. gemini/kiro/
// opencode/cursor use a stub marketplace spec whose serialize/cliRegister/
// cliUpdate THROW (no surrogate built yet). isMarketplaceSupported() is the
// detection primitive that lets callers skip-with-warning instead of crashing.

describe('isMarketplaceSupported — capability detection (P5)', () => {
  it('reports clients with a real marketplace spec as supported', () => {
    expect(isMarketplaceSupported('claude')).toBe(true)
    expect(isMarketplaceSupported('codex')).toBe(true)
  })

  it('reports stub clients (no CLI/serializer yet) as unsupported', () => {
    expect(isMarketplaceSupported('gemini')).toBe(false)
    expect(isMarketplaceSupported('kiro')).toBe(false)
    expect(isMarketplaceSupported('opencode')).toBe(false)
    expect(isMarketplaceSupported('cursor')).toBe(false)
  })

  it('returns false (never throws) for an unknown / empty client — safe query', () => {
    expect(isMarketplaceSupported('nonexistent')).toBe(false)
    expect(isMarketplaceSupported('')).toBe(false)
  })

  it('does NOT change existing behavior: real spec serializes, stub still throws', () => {
    // A supported client serializes normally...
    expect(typeof getMarketplaceSpec('claude').serialize('m', [])).toBe('string')
    // ...and a stub STILL throws — isMarketplaceSupported is the guard callers
    // use to avoid this, not a silent behavior change to the stub itself.
    expect(() => getMarketplaceSpec('gemini').serialize('m', [])).toThrow()
  })
})
