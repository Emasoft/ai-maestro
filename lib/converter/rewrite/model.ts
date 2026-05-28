/**
 * Model identifier mapping — convert agent model field between providers.
 * Ported from acplugin utils/model.ts.
 *
 * Maps provider-specific model IDs to cross-provider equivalents.
 * Body text model name replacement is in body.ts (different concern).
 */

import type { Provider, AgentIR } from '../types'
import { WarningCollector } from '../utils/warnings'

/**
 * Cross-provider model mapping.
 *
 * Claude ships frontier models faster than a static table can track — Opus
 * went 4.6 → 4.7 → 4.8 inside a single month (Claude Code 2.1.142 → 2.1.154).
 * A version-exact table goes stale the instant a new Opus/Sonnet/Haiku ships
 * and then silently passes an invalid Claude id straight through to the
 * target client. So:
 *
 * - Claude→X is keyed by *family alias* (`opus`/`sonnet`/`haiku`). Any
 *   concrete id — `claude-opus-4-8`, the 1M variant `claude-opus-4-8[1m]`,
 *   a future `claude-opus-5` — is normalized to its family before lookup
 *   (see `claudeFamily`). New Claude releases need no edit here.
 * - X→Claude emits the family *alias*, not a pinned version, so a converted
 *   agent always resolves to the current Claude model instead of a frozen
 *   one. Round-trips (alias → target → alias) are stable.
 *
 * Codex models: gpt-5.4, gpt-5.4-mini, gpt-5.3-codex, gpt-5.2
 * Source: https://developers.openai.com/codex/models
 */

/** Claude family alias → Codex model (flagship / coding / efficient tiers). */
const CLAUDE_TO_CODEX: Record<string, string> = {
  opus: 'gpt-5.4',
  sonnet: 'gpt-5.3-codex',
  haiku: 'gpt-5.4-mini',
}

/** Claude family alias → Gemini model. */
const CLAUDE_TO_GEMINI: Record<string, string> = {
  opus: 'gemini-2-pro',
  sonnet: 'gemini-2-flash',
  haiku: 'gemini-3-flash',
}

/** Codex → Claude family alias (alias, never a pinned version — see header). */
const CODEX_TO_CLAUDE: Record<string, string> = {
  'gpt-5.4': 'opus',
  'gpt-5.4-mini': 'haiku',
  'gpt-5.3-codex': 'sonnet',
  'gpt-5.3-codex-spark': 'sonnet',
  'gpt-5.2': 'sonnet',
  'o3': 'opus',
  'o3-mini': 'sonnet',
}

/** Gemini → Claude family alias. */
const GEMINI_TO_CLAUDE: Record<string, string> = {
  'gemini-2-flash': 'sonnet',
  'gemini-2-pro': 'opus',
  'gemini-3-flash': 'haiku',
  'gemini-3-pro': 'opus',
}

/**
 * Normalize any Claude model id to its family alias.
 * Strips a trailing context-window suffix like `[1m]` first, so
 * `claude-opus-4-8[1m]` and `claude-opus-4-8` both resolve to `opus`.
 * Returns null for non-Claude / unrecognized ids (caller passes through).
 */
function claudeFamily(model: string): 'opus' | 'sonnet' | 'haiku' | null {
  const base = model.replace(/\[.*$/, '').trim()
  if (base === 'opus' || base.startsWith('claude-opus-')) return 'opus'
  if (base === 'sonnet' || base.startsWith('claude-sonnet-')) return 'sonnet'
  if (base === 'haiku' || base.startsWith('claude-haiku-')) return 'haiku'
  return null
}

/** Get the mapping table for a source→target pair */
function getMappingTable(source: string, target: string): Record<string, string> | null {
  if (source === 'claude-code' && target === 'codex') return CLAUDE_TO_CODEX
  if (source === 'claude-code' && target === 'gemini') return CLAUDE_TO_GEMINI
  if (source === 'codex' && target === 'claude-code') return CODEX_TO_CLAUDE
  if (source === 'gemini' && target === 'claude-code') return GEMINI_TO_CLAUDE
  // For other pairs, pass through (OpenCode and Kiro accept most model strings)
  return null
}

/** Map a model identifier from source to target provider */
export function mapModel(model: string, source: Provider, target: Provider): string {
  if (source.id === target.id) return model
  const table = getMappingTable(source.id, target.id)
  if (!table) return model // Pass through for unmapped pairs
  // Claude→X: collapse any concrete / versioned / 1M Claude id to its family
  // alias so new model releases map without a table edit (see header).
  if (source.id === 'claude-code') {
    const family = claudeFamily(model)
    return family ? (table[family] ?? model) : model
  }
  // X→Claude (and any other pair): exact match, pass through if unmapped.
  return table[model] ?? model
}

/** Apply model mapping to all agents. Returns new array (no mutation). */
export function rewriteAgentModels(
  agents: AgentIR[], source: Provider, target: Provider, warnings: WarningCollector
): AgentIR[] {
  return agents.map(agent => {
    if (!agent.model) return agent
    const mapped = mapModel(agent.model, source, target)
    if (mapped !== agent.model) {
      warnings.add(`Agent "${agent.name}": model "${agent.model}" → "${mapped}"`)
    }
    return { ...agent, model: mapped }
  })
}
