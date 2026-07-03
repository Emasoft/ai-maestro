/**
 * Single TS source of truth for Claude model context-window limits.
 *
 * MUST stay in sync with
 * rust-tools/aim-jsonl-reader/src/context.rs `context_limit_for_model`
 * — TRDD-1657a5f4 Phase 1. Any change here (a new family, a new 1M
 * trigger) MUST be mirrored there, and vice versa, or the Rust reader
 * and the TS heuristic will disagree on free-space for the same session.
 *
 * Canonical rule (TRDD-1657a5f4 Phase 1; extended by TRDD-CS51MFIX):
 *   - A model id whose (lowercased) string CONTAINS the substring `[1m]`
 *     is the extended-context variant → 1,000,000 tokens.
 *   - A model whose id belongs to a NATIVELY-1M family (currently only
 *     Sonnet 5 — `claude-sonnet-5`) → 1,000,000 tokens even WITHOUT a tag.
 *   - Everything else — claude-opus-4*, claude-sonnet-4*, claude-haiku-4*,
 *     bare `opus`/`sonnet`/`haiku` aliases, and unknown ids — resolves to
 *     the 200,000-token default.
 *
 * IMPORTANT: standard Opus 4.6 / 4.7 / 4.8 are 200K, NOT 1M. The earlier
 * `claude-opus-4*` → 1,000,000 heuristic over-reported free space by
 * ~800K on every standard-context Opus session. Only the `[1m]` tag (e.g.
 * `claude-opus-4-8[1m]`) signals the 1M window for the Opus/Haiku lines.
 *
 * Sonnet 5 (CC 2.1.197, 2026-06-30 — the current DEFAULT model) is the
 * exception: its 1M window is NATIVE, and CC writes the bare id
 * `claude-sonnet-5` with no `[1m]` tag (ground-truthed against real
 * `~/.claude/projects/*.jsonl`). So the family is matched directly. The
 * rule stays sonnet-5-narrow — bare `sonnet` and `claude-sonnet-4-6` are
 * still 200K (Sonnet 4.6 is not natively 1M), so this does NOT revive the
 * old over-reporting bug the `[1m]`-only rule was created to kill.
 */

/** Default Claude context window when nothing else matches. */
export const DEFAULT_CONTEXT_LIMIT = 200_000

/** Extended-context window for the `[1m]` model variants. */
export const EXTENDED_CONTEXT_LIMIT = 1_000_000

/**
 * Named limits, smallest unit of truth. The `[1m]` decision is a substring
 * test rather than a table key because the tag can ride on any family
 * (`claude-opus-4-8[1m]`, a future `claude-sonnet-4-7[1m]`, …), so it
 * cannot be enumerated as a fixed set of ids.
 */
export const CONTEXT_LIMITS = {
  default: DEFAULT_CONTEXT_LIMIT,
  extended: EXTENDED_CONTEXT_LIMIT,
} as const

/** Substring that tags the extended-context (1M) variant of any model. */
const EXTENDED_CONTEXT_TAG = '[1m]'

/**
 * Substrings identifying model families whose NATIVE (untagged) context
 * window is 1M. Sonnet 5 ships its id as bare `claude-sonnet-5` (no `[1m]`),
 * so the tag test alone would misclassify it as 200K. Kept family-narrow
 * (`sonnet-5`, not `sonnet`) so Sonnet 4.6 stays at its 200K default.
 */
const NATIVE_1M_FAMILY_MARKERS = ['sonnet-5'] as const

/**
 * Resolve the context-window size for a Claude model id.
 *
 * @param model The model id from the JSONL (`claude-opus-4-8`,
 *   `claude-opus-4-8[1m]`, `claude-sonnet-5`, the bare alias `opus`, etc.).
 *   An empty string or unknown id resolves to {@link DEFAULT_CONTEXT_LIMIT}.
 */
export function contextLimitForModel(model: string): number {
  const m = model.toLowerCase()
  if (m.includes(EXTENDED_CONTEXT_TAG)) return CONTEXT_LIMITS.extended
  // Natively-1M families (Sonnet 5) advertise no `[1m]` tag — match directly.
  if (NATIVE_1M_FAMILY_MARKERS.some((marker) => m.includes(marker))) {
    return CONTEXT_LIMITS.extended
  }
  return CONTEXT_LIMITS.default
}
