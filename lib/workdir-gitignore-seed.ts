/**
 * Managed git-exclude block for git-repo agent workdirs (TRDD-57EBNB72, WS1
 * of the fleet-readiness plan — campaign TRDD-903b7a20 blocker B2).
 *
 * When an existing git repository is adopted as an agent working directory
 * (the wizard's "Browse existing project folder" flow), ai-maestro and the
 * runtime tooling write files INTO that repo: the seeded DEP rules
 * (`.claude/rules/aimaestro-*.md`, re-seeded on every wake), the local-scope
 * plugin enablement (`.claude/settings.local.json`), per-op element installs,
 * and runtime artifacts (`.janitor/`, `reports/`, `.codegraph/`, …). Without
 * ignore protection those files dirty the repo and can be accidentally
 * committed or published with the plugin.
 *
 * The managed block lives in `.git/info/exclude`, NOT in `.gitignore`:
 * real repos TRACK their .gitignore, so appending there dirties the very
 * tree this module exists to keep clean (the WS1b dummy adoption proved it —
 * `git status` showed ` M .gitignore`). info/exclude has identical ignore
 * semantics, is never tracked, never ships with a publish, and is re-seeded
 * per clone by the wake self-heal.
 *
 * Behavior:
 *   - runs ONLY when `<workdir>/.git` exists; when `.git` is a FILE (linked
 *     worktree / submodule) the real git dir is resolved via its `gitdir:`
 *     pointer, and a `commondir` file (worktrees) is followed so the block
 *     lands in the COMMON `info/exclude` git actually reads;
 *   - never touches user content outside the markers;
 *   - dedupes: entries already present verbatim outside the block are not
 *     repeated inside it (trim-match);
 *   - content-idempotent: writes only when the resulting file differs
 *     byte-wise, so calling it on every wake is cheap.
 *
 * Deliberately NOT listed: `.claude/settings.json` and `CLAUDE.md`.
 * ignore rules have no effect on files a repo already tracks, and for repos
 * that do NOT track them, hiding config-deploy edits would silently mask
 * user-initiated configuration pushes that SHOULD show up as diffs.
 */
import { existsSync, statSync, readFileSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { isAbsolute, join, resolve, dirname } from 'path'

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
  // LOCAL-scoped TRDDs (TRDD-S7R1BNTG) — the machine-private half of the task corpus.
  // A local TRDD is about THIS instance (its paths, caches, credentials-adjacent
  // state), so it is the task equivalent of a LOCAL memory note and must never be
  // pushed. PROJECT-scoped TRDDs stay in design/ and ARE tracked — that asymmetry is
  // the whole point of the scope field.
  '.claude/local-tasks/',
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
  /** exclude file did not exist — created with the managed block */
  created: boolean
  /** existing exclude file rewritten (block added or regenerated) */
  updated: boolean
  /** file already byte-identical to the desired state */
  unchanged: boolean
  /** `<workdir>/.git` absent or unresolvable — not a repo, nothing done */
  skipped: boolean
}

const NO_OP: EnsureWorkdirGitignoreResult = {
  created: false,
  updated: false,
  unchanged: false,
  skipped: true,
}

/**
 * Resolve the `info/exclude` path for a workdir, or null when the workdir is
 * not a git repo. Handles the three shapes:
 *   - `.git` directory (normal clone)          → .git/info/exclude
 *   - `.git` file with `gitdir:` (worktree)    → <gitdir>/<commondir>/info/exclude
 *   - `.git` file with `gitdir:` (submodule)   → <gitdir>/info/exclude
 */
function resolveExcludePath(workdir: string): string | null {
  const dotGit = join(workdir, '.git')
  if (!existsSync(dotGit)) return null

  let gitDir: string
  try {
    if (statSync(dotGit).isDirectory()) {
      gitDir = dotGit
    } else {
      const m = readFileSync(dotGit, 'utf-8').match(/^gitdir:\s*(.+)\s*$/m)
      if (!m) return null
      const pointer = m[1].trim()
      gitDir = isAbsolute(pointer) ? pointer : resolve(workdir, pointer)
      // A linked worktree's git dir carries a `commondir` file pointing at the
      // shared git dir — git reads info/exclude from THERE, not the worktree dir.
      const commondirFile = join(gitDir, 'commondir')
      if (existsSync(commondirFile)) {
        const common = readFileSync(commondirFile, 'utf-8').trim()
        gitDir = isAbsolute(common) ? common : resolve(gitDir, common)
      }
    }
  } catch {
    return null
  }
  return join(gitDir, 'info', 'exclude')
}

/**
 * Idempotently maintain the managed exclude block for a git-repo workdir.
 *
 * Never throws for a non-repo workdir (returns skipped). I/O errors DO
 * propagate so callers can log them — call sites treat this as best-effort
 * and never fail the surrounding pipeline on it (same contract as
 * ensureAgentRules in lib/agent-rules-seed.ts).
 */
export async function ensureWorkdirGitignore(
  workdir: string
): Promise<EnsureWorkdirGitignoreResult> {
  const excludePath = resolveExcludePath(workdir)
  if (excludePath === null) return NO_OP

  let existing: string | null = null
  try {
    existing = await readFile(excludePath, 'utf-8')
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
    await mkdir(dirname(excludePath), { recursive: true })
    await writeFile(excludePath, block)
    return { created: true, updated: false, unchanged: false, skipped: false }
  }
  if (next === existing) {
    return { created: false, updated: false, unchanged: true, skipped: false }
  }
  await writeFile(excludePath, next)
  return { created: false, updated: true, unchanged: false, skipped: false }
}
