import { describe, it, expect } from 'vitest'
import { mapModel, rewriteAgentModels } from '@/lib/converter/rewrite/model'
import { getProvider } from '@/lib/converter/registry'
import { WarningCollector } from '@/lib/converter/utils/warnings'
import type { AgentIR, Provider } from '@/lib/converter/types'

// Real registry providers — no mocks. This suite proves the cross-client
// model mapping tracks new releases on BOTH sides without going stale:
//   - Claude→X: Opus 4.8 and the 1M variant normalize by family alias.
//   - X→Claude: gpt-5.5 (current Codex frontier, verified 2026-05-28) maps,
//     and a future/unlisted gpt-5.x falls back by tier (codexTier).
// See the header comment in lib/converter/rewrite/model.ts.

const claude = getProvider('claude-code') as Provider
const codex = getProvider('codex') as Provider
const gemini = getProvider('gemini') as Provider

function makeAgent(model: string | null): AgentIR {
  return {
    name: 'a', description: '', body: '', model,
    temperature: null, reasoningEffort: null, tools: null, disallowedTools: null,
    permissionMode: null, maxTurns: null, timeoutMins: null, background: false,
    isolation: null, mcpServers: null, skills: null, hooks: null, memory: null,
    extras: {}, fileName: 'a.md', sourcePath: 'a.md',
  }
}

describe('mapModel — Claude → Codex (family-normalized, gpt-5.5 flagship)', () => {
  it('maps the Opus 4.8 1M variant claude-opus-4-8[1m] → gpt-5.5', () => {
    expect(mapModel('claude-opus-4-8[1m]', claude, codex)).toBe('gpt-5.5')
  })

  it('maps the Opus 4.8 base id claude-opus-4-8 → gpt-5.5', () => {
    expect(mapModel('claude-opus-4-8', claude, codex)).toBe('gpt-5.5')
  })

  it('maps the bare opus alias → gpt-5.5 (current Codex frontier)', () => {
    expect(mapModel('opus', claude, codex)).toBe('gpt-5.5')
  })

  it('maps a future claude-opus-5 → gpt-5.5 with no table edit (family match)', () => {
    expect(mapModel('claude-opus-5', claude, codex)).toBe('gpt-5.5')
  })

  it('maps sonnet (claude-sonnet-4-6) → gpt-5.3-codex', () => {
    expect(mapModel('claude-sonnet-4-6', claude, codex)).toBe('gpt-5.3-codex')
  })

  it('maps haiku (claude-haiku-4-5) → gpt-5.4-mini', () => {
    expect(mapModel('claude-haiku-4-5', claude, codex)).toBe('gpt-5.4-mini')
  })
})

describe('mapModel — Claude → Gemini', () => {
  it('maps claude-opus-4-8[1m] → gemini-2-pro', () => {
    expect(mapModel('claude-opus-4-8[1m]', claude, gemini)).toBe('gemini-2-pro')
  })
})

describe('mapModel — Codex → Claude (alias, not a pinned version)', () => {
  it('maps the gpt-5.5 frontier model → opus alias', () => {
    expect(mapModel('gpt-5.5', codex, claude)).toBe('opus')
  })

  it('still maps gpt-5.4 → opus (flagship tier)', () => {
    expect(mapModel('gpt-5.4', codex, claude)).toBe('opus')
  })

  it('maps gpt-5.3-codex → sonnet alias', () => {
    expect(mapModel('gpt-5.3-codex', codex, claude)).toBe('sonnet')
  })

  it('keeps the curated legacy gpt-5.2 → sonnet (table beats the bare-frontier fallback)', () => {
    // gpt-5.2 is bare-frontier-shaped, so codexTier would say "opus"; the
    // curated table must win to preserve the deliberate legacy downgrade.
    expect(mapModel('gpt-5.2', codex, claude)).toBe('sonnet')
  })
})

describe('mapModel — codexTier fallback for unlisted future gpt-5.x ids', () => {
  it('maps a future bare frontier gpt-5.6 → opus', () => {
    expect(mapModel('gpt-5.6', codex, claude)).toBe('opus')
  })

  it('maps a future gpt-5.6-mini → haiku', () => {
    expect(mapModel('gpt-5.6-mini', codex, claude)).toBe('haiku')
  })

  it('maps a future gpt-5.6-codex → sonnet', () => {
    expect(mapModel('gpt-5.6-codex', codex, claude)).toBe('sonnet')
  })
})

describe('mapModel — invariants', () => {
  it('round-trips opus → codex (gpt-5.5) → opus alias', () => {
    const toCodex = mapModel('claude-opus-4-8[1m]', claude, codex)
    expect(toCodex).toBe('gpt-5.5')
    expect(mapModel(toCodex, codex, claude)).toBe('opus')
  })

  it('is a no-op when source and target providers are the same', () => {
    expect(mapModel('claude-opus-4-8[1m]', claude, claude)).toBe('claude-opus-4-8[1m]')
  })

  it('passes an unrecognized Claude-side model through unchanged', () => {
    expect(mapModel('mystery-model-x', claude, codex)).toBe('mystery-model-x')
  })

  it('passes a non-gpt-5 unknown Codex id through unchanged (fallback only fires for gpt-5.x)', () => {
    expect(mapModel('mystery-codex-x', codex, claude)).toBe('mystery-codex-x')
  })
})

describe('rewriteAgentModels', () => {
  it('rewrites an Opus 4.8 agent for Codex and records one warning', () => {
    const warnings = new WarningCollector()
    const out = rewriteAgentModels([makeAgent('claude-opus-4-8[1m]')], claude, codex, warnings)
    expect(out[0].model).toBe('gpt-5.5')
    expect(warnings.getWarnings()).toHaveLength(1)
    expect(warnings.getWarnings()[0]).toContain('gpt-5.5')
  })

  it('leaves a null model untouched and records no warning', () => {
    const warnings = new WarningCollector()
    const out = rewriteAgentModels([makeAgent(null)], claude, codex, warnings)
    expect(out[0].model).toBeNull()
    expect(warnings.getWarnings()).toHaveLength(0)
  })
})
