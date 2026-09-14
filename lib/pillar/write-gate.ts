/**
 * TRDD-write-gate — the corpus-scoped write refusal for trddgrep/prrdgrep/specgrep (ai-maestro#161 phase a).
 *
 * The prior gate lived in `scripts/pillar-cli` as a bash argv scan, keyed on the process's
 * CWD. Two failures that made it unreliable rather than merely narrow: it never saw
 * `prrdgrep add` (a bash regex that only knew `edit`/`fix`), and a search PATTERN containing
 * the word "edit" (`trddgrep "edit the rotator"`) could be misread as the verb. Both are
 * symptoms of scanning argv text instead of asking the tool what it actually parsed.
 *
 * This gate is asked AFTER each tool has already parsed its own verb — so it never
 * re-implements argv parsing, and "is this a write?" is answered from the same `cmd` the
 * tool is about to dispatch on, not a second guess at it.
 *
 * PURE, deliberately (no `fs`, no `git`). `cwd` and `root` are supplied ALREADY RESOLVED by
 * the caller — each entry point (`scripts/trddgrep.mjs`, `scripts/prrdgrep.mjs`,
 * `scripts/specgrep.mjs`) computes `root` as the realpath of the parent of the `scripts/`
 * dir IT lives in, and `cwd` as the realpath of `process.cwd()`, both via
 * `fs.realpathSync.native`. Keeping this function I/O-free is what makes it testable with
 * plain strings and no filesystem fixture.
 *
 * "Inside" means `cwd === root` or `cwd` starts with `root + path.sep` — the checkout the
 * running tool ships in, keyed on WHERE THE CALLER IS RUNNING FROM, never on the corpus it
 * was asked to write to (`--design-dir` can point anywhere; a caller sitting outside the
 * checkout and aiming at a corpus INSIDE it is still refused, and the reverse is still
 * allowed — see the CWD-keying discriminator test).
 */
import path from 'path'

export type PillarWriteTool = 'trddgrep' | 'prrdgrep' | 'specgrep'

/**
 * Verbs that REWRITE the corpus, per tool. Everything else — including trddgrep's
 * `new`/`set`/`append`/`check-box`/`move`, which also mutate a card, and
 * `index-verify --repair`, which rewrites the SQLite index rather than the corpus — is
 * deliberately left ungated here; gating them is a separate, later decision.
 */
export const WRITE_VERBS: Record<PillarWriteTool, readonly string[]> = {
  trddgrep: ['fix', 'edit'],
  prrdgrep: ['edit', 'add'],
  specgrep: ['edit'],
}

export interface WriteGateOpts {
  /** The realpath of `process.cwd()` at the moment the tool started. */
  cwd: string
  /** The realpath of the checkout root the running tool ships in. */
  root: string
  env?: NodeJS.ProcessEnv
}

/**
 * `null` when the write is allowed; a refusal message otherwise.
 *
 * `AIM_PILLAR_ALLOW_WRITE=1` is the one escape hatch, matching
 * `three-pillars-tools-only.md`'s documented override.
 */
export function writeRefusal(tool: PillarWriteTool, verb: string, opts: WriteGateOpts): string | null {
  if (!WRITE_VERBS[tool].includes(verb)) return null
  const env = opts.env ?? process.env
  if (env.AIM_PILLAR_ALLOW_WRITE === '1') return null

  const { cwd, root } = opts
  const inside = cwd === root || cwd.startsWith(root + path.sep)
  if (inside) return null

  return [
    `${tool}: '${verb}' rewrites the corpus and is disabled outside the ai-maestro checkout.`,
    `  The query surface (board, next, why, show, lint, validate, env) works; new set append check-box move are not gated.`,
    `  Deliberate? AIM_PILLAR_ALLOW_WRITE=1 ${tool} ...`,
  ].join('\n')
}
