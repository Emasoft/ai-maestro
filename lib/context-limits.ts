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
 *   - A model whose id belongs to a NATIVELY-1M family (Sonnet 5 —
 *     `claude-sonnet-5`; Opus 5 — `claude-opus-5`) → 1,000,000 tokens even
 *     WITHOUT a tag.
 *   - Everything else — claude-opus-4*, claude-sonnet-4*, claude-haiku-4*,
 *     bare `opus`/`sonnet`/`haiku` aliases, and unknown ids — resolves to
 *     the 200,000-token default.
 *
 * IMPORTANT: standard Opus 4.6 / 4.7 / 4.8 are 200K, NOT 1M. The earlier
 * `claude-opus-4*` → 1,000,000 heuristic over-reported free space by
 * ~800K on every standard-context Opus session. Only the `[1m]` tag (e.g.
 * `claude-opus-4-8[1m]`) signals the 1M window for the Opus/Haiku lines.
 *
 * Sonnet 5 (CC 2.1.197, 2026-06-30) and Opus 5 (CC 2.1.219, the current
 * DEFAULT Opus) are the exceptions: their 1M window is NATIVE, and CC writes
 * the bare ids `claude-sonnet-5` / `claude-opus-5` with no `[1m]` tag
 * (ground-truthed against real `~/.claude/projects/*.jsonl`). So those
 * families are matched directly. The rule stays VERSION-narrow — bare
 * `sonnet`/`opus` and the whole 4.x line are still 200K — so this does NOT
 * revive the old over-reporting bug the `[1m]`-only rule was created to kill.
 *
 * WHY Opus 5 had to be added (2026-08-04, TRDD-9X2STNL2): the family match
 * was written when Sonnet 5 was the only native-1M model, so `opus-5` fell
 * through to the 200K default. `claude-opus-5[1m]` still resolved to 1M via
 * the tag, which is exactly what made the gap invisible — the tagged form is
 * the one that appears most often, so the bare id UNDER-reported a 1M session
 * as 200K (a 5x understatement of free space) with nothing failing. Measured
 * before the fix: `contextLimitForModel('claude-opus-5')` → 200000.
 *
 * ── KNOWN HAZARD: the model id no longer FULLY determines the window ─────
 * CC 2.1.223 changed `CLAUDE_CODE_DISABLE_1M_CONTEXT` to hold EVERY natively-1M
 * model to 200K via auto-compaction (previously a fixed list). So a session on
 * `claude-opus-5` with that var set really runs at 200K while this resolver —
 * which reads the id and nothing else — answers 1,000,000. That is a 5x
 * OVER-report of free space: the exact failure the `claude-opus-4*` heuristic
 * was deleted for, reached through a new door.
 *
 * NOT CURRENTLY LIVE, and measured rather than assumed (2026-08-07): the var is
 * set in no shell env, neither `~/.claude/settings*.json`, no `~/agents/*`
 * workdir settings, nowhere in this repo, and not in the pm2 env. Left
 * unimplemented DELIBERATELY, because the obvious fix is wrong twice over:
 *   1. `process.env` here reads the SERVER's environment, not the AGENT's — a
 *      per-session variable cannot be resolved from the process doing the
 *      parsing; and
 *   2. `services/sessions-browser/local-context-breakdown.ts` calls this from
 *      the BROWSER, where there is no `process.env` to read at all.
 * The only sound signal is the agent's OWN spawn environment, which the server
 * knows per-agent at launch and would have to thread through. Anyone doing that
 * must also mirror it into `context.rs` (see the sync obligation at the top).
 *
 * ── AND ONE THING THE SAME RELEASE TURNED FROM A GUESS INTO AN AGREEMENT ──
 * The 200K fallback for an UNRECOGNIZED id used to be our own conservative
 * choice. CC 2.1.223 also made auto-compact keep sessions on unknown model ids
 * within its assumed window instead of letting them grow past it (escape hatch:
 * `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1`). So the default is
 * now the behaviour CC actually ENFORCES, not merely a safe guess — which is
 * why an unknown id must keep resolving to the default and must never be made
 * to "optimistically" inherit 1M. (The changelog does not state the assumed
 * window numerically; that it equals 200K is inferred from the default, so
 * treat the NUMBER as unconfirmed even though the DIRECTION is not.)
 */

/** Default Claude context window when nothing else matches. */
export const DEFAULT_CONTEXT_LIMIT = 200_000

/** Extended-context window for 1M models (`[1m]`-tagged or natively-1M families). */
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
 * Matches model families whose NATIVE (untagged) context window is 1M.
 * Sonnet 5 and Opus 5 ship their ids bare (`claude-sonnet-5`,
 * `claude-opus-5` — no `[1m]`), so the tag test alone would misclassify them
 * as 200K. Kept VERSION-narrow (`sonnet-5`/`opus-5`, never bare
 * `sonnet`/`opus`) so the entire 4.x line stays at its 200K default.
 *
 * The `(?![0-9])` guard anchors the version on a boundary so it does NOT
 * substring-over-match a DIFFERENT version number that merely starts with
 * those digits — `claude-sonnet-50` (major v50) / `claude-opus-55` stay
 * 200K, while `claude-sonnet-5` / `claude-opus-5` and their dated snapshots
 * (`claude-sonnet-5-20260630`) still resolve to 1M. This preserves the
 * anti-substring-over-report guarantee that motivated the `[1m]`-only rule
 * (TRDD-1657a5f4); the Rust resolver mirrors the same non-digit boundary.
 *
 * Adding a family here is the ONLY correct way to onboard a new native-1M
 * model — do not relax the boundary guard to catch one, or the next major
 * version silently inherits a window it does not have.
 */
const NATIVE_1M_FAMILY_RE = /(?:sonnet|opus)-5(?![0-9])/

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
  // Natively-1M families (Sonnet 5, Opus 5) advertise no `[1m]` tag — match directly.
  if (NATIVE_1M_FAMILY_RE.test(m)) return CONTEXT_LIMITS.extended
  return CONTEXT_LIMITS.default
}
