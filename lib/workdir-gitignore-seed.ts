/**
 * Managed .gitignore block for git-repo agent workdirs (TRDD-57EBNB72, WS1
 * of the fleet-readiness plan — campaign TRDD-903b7a20 blocker B2).
 *
 * When an existing git repository is adopted as an agent working directory
 * (the wizard's "Browse existing project folder" flow), ai-maestro and the
 * runtime tooling write files INTO that repo: the seeded DEP rules
 * (`.claude/rules/aimaestro-*.md`, re-seeded on every wake), the local-scope
 * plugin enablement (`.claude/settings.local.json`), per-op element installs,
 * and runtime artifacts (`.janitor/`, `reports/`, `.codegraph/`, …). Without
 * gitignore protection those files dirty the repo and can be accidentally
 * committed or published with the plugin.
 *
 * This module idempotently maintains ONE marker-delimited managed block in
 * `<workdir>/.gitignore`:
 *   - runs ONLY when `<workdir>/.git` exists (dir or file — linked worktrees
 *     and submodules use a `.git` FILE, so an existsSync dir-check would skip
 *     exactly the repos that need protection);
 *   - never touches user content outside the markers;
 *   - dedupes: entries already present verbatim outside the block are not
 *     repeated inside it (trim-match);
 *   - content-idempotent: writes only when the resulting file differs
 *     byte-wise, so calling it on every wake is cheap.
 *
 * Deliberately NOT listed: `.claude/settings.json` and `CLAUDE.md`.
 * gitignore has no effect on files a repo already tracks, and for repos that
 * do NOT track them, hiding config-deploy edits would silently mask
 * user-initiated configuration pushes that SHOULD show up as diffs.
 */
import { existsSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'

export const GITIGNORE_BLOCK_BEGIN =
  '# >>> ai-maestro:managed-gitignore — do not edit inside this block >>>'
export const GITIGNORE_BLOCK_END = '# <<< ai-maestro:managed-gitignore <<<'

/**
 * Everything ai-maestro or the bundled runtime tooling may create inside an
 * agent workdir. Sources: the CreateAgent/wake write inventory + the runtime
 * artifact catalog assembled for TRDD-57EBNB72 (see the TRDD body).
 */
export const MANAGED_GITIGNORE_ENTRIES: readonly string[] = [
  // ai-maestro server writes
  '.claude/settings.local.json',
  '.claude/rules/aimaestro-*.md',
  '.mcp.json',
  // janitor / memory runtime state
  '.janitor/',
  '.claude/janitor/',
  '.claude/agent-memory/',
  // agent report convention (may hold private data — never committed)
  'reports/',
  'reports_dev/',
  // _dev scratch convention
  'docs_dev/',
  'scripts_dev/',
  'samples_dev/',
  'examples_dev/',
  'tests_dev/',
  'downloads_dev/',
  'libs_dev/',
  'builds_dev/',
  // code-analysis / tooling caches
  '.codegraph/',
  '.tldr/',
  '.tldrignore',
  '.serena/',
  '.trashcan/',
  '.rechecker/',
  '.infographic/',
  // planning-skill stubs
  'task_plan.md',
  'findings.md',
  'progress.md',
]

export interface EnsureWorkdirGitignoreResult {
  /** .gitignore did not exist — created with the managed block */
  created: boolean
  /** existing .gitignore rewritten (block added or regenerated) */
  updated: boolean
  /** file already byte-identical to the desired state */
  unchanged: boolean
  /** `<workdir>/.git` absent — not a repo, nothing done */
  skipped: boolean
}

const NO_OP: EnsureWorkdirGitignoreResult = {
  created: false,
  updated: false,
  unchanged: false,
  skipped: true,
}

/**
 * Idempotently maintain the managed gitignore block in a git-repo workdir.
 *
 * Never throws for a non-repo workdir (returns skipped). I/O errors DO
 * propagate so callers can log them — call sites treat this as best-effort
 * and never fail the surrounding pipeline on it (same contract as
 * ensureAgentRules in lib/agent-rules-seed.ts).
 */
export async function ensureWorkdirGitignore(
  workdir: string
): Promise<EnsureWorkdirGitignoreResult> {
  // .git may be a directory (normal clone) OR a file (worktree/submodule).
  if (!existsSync(join(workdir, '.git'))) return NO_OP

  const gitignorePath = join(workdir, '.gitignore')
  let existing: string | null = null
  try {
    existing = await readFile(gitignorePath, 'utf-8')
  } catch {
    existing = null
  }

  // Split any prior managed block out of the user content so the block is
  // regenerated in place (stale entry sets from older app versions heal).
  let before = existing ?? ''
  let after = ''
  if (existing !== null) {
    const beginIdx = existing.indexOf(GITIGNORE_BLOCK_BEGIN)
    const endIdx = existing.indexOf(GITIGNORE_BLOCK_END)
    if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
      before = existing.slice(0, beginIdx)
      after = existing.slice(endIdx + GITIGNORE_BLOCK_END.length)
      // Swallow exactly one trailing newline of the removed block region.
      if (after.startsWith('\n')) after = after.slice(1)
    }
  }

  // Dedupe: an entry already present verbatim (trim-match) in the USER
  // portion is not repeated inside the managed block.
  const userLines = new Set(
    (before + '\n' + after).split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
  )
  const entries = MANAGED_GITIGNORE_ENTRIES.filter((e) => !userLines.has(e))

  const block =
    entries.length > 0
      ? `${GITIGNORE_BLOCK_BEGIN}\n${entries.join('\n')}\n${GITIGNORE_BLOCK_END}\n`
      : ''

  let next: string
  if (block === '') {
    // Everything is already covered by the user's own entries — keep the
    // file free of an empty managed block.
    next = before + after
  } else {
    if (before.length > 0 && !before.endsWith('\n')) before += '\n'
    next = before + block + after
  }

  if (existing === null) {
    if (block === '') return NO_OP // nothing to add and no file to create
    await writeFile(gitignorePath, block)
    return { created: true, updated: false, unchanged: false, skipped: false }
  }
  if (next === existing) {
    return { created: false, updated: false, unchanged: true, skipped: false }
  }
  await writeFile(gitignorePath, next)
  return { created: false, updated: true, unchanged: false, skipped: false }
}
