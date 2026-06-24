import { describe, it, expect } from 'vitest'
import { isMarketplaceSupported, getMarketplaceSpec, writeMarketplaceManifest } from '@/lib/converter/marketplace-emitters'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

describe('writeMarketplaceManifest — the hazard the P5 caller-guard prevents', () => {
  // plugin-storage-service now gates both writeMarketplaceManifest calls on
  // isMarketplaceSupported(). These tests lock in WHY: the supported path writes
  // a real manifest, the stub path rejects — so an ungated call to a stub client
  // would crash a conversion. Real FS, no mocks, temp dir cleaned up.
  it('writes a manifest file for a supported client (claude)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aim-mkt-claude-'))
    try {
      const manifestPath = await writeMarketplaceManifest(dir, 'claude', 'test-mkt', [])
      const content = await readFile(manifestPath, 'utf8')
      expect(content.length).toBeGreaterThan(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('REJECTS for a stub client (gemini) — the crash the caller-guard skips', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'aim-mkt-gemini-'))
    try {
      await expect(writeMarketplaceManifest(dir, 'gemini', 'test-mkt', [])).rejects.toThrow()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
