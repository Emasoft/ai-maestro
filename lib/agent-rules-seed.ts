/**
 * DEP governance-rule seeding (TRDD-DE9757LJ Phase 2).
 *
 * ai-maestro ships the DEP (ai-maestro-DEPENDENT) governance rules under
 * `<app>/rules/aimaestro/*.md` — the multi-agent overlay (approval tiers,
 * transition authority, PRRD governance, multi-agent kanban) that EXPANDS
 * the universal IND base the ai-maestro-janitor installs globally. The
 * server copies these files into each registered agent workdir's
 * `.claude/rules/` so they load ONLY inside agent workdirs, never in
 * unrelated projects.
 *
 * Ownership contract (mirrors the janitor's rules_installer.py):
 * every shipped DEP rule carries the DEP_RULE_MARKER provenance comment.
 * The seeder only ever overwrites files that carry the marker — a
 * same-named file WITHOUT it is user-owned and is never touched.
 * Idempotency is content-based (byte compare), so calling this on every
 * wake is cheap and rule updates ship automatically with the app.
 */
import { mkdir, readdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'

export const DEP_RULE_MARKER = 'ai-maestro:installed-dep-rule'

// Bundled DEP rule sources. process.cwd() is the app install dir under both
// full mode (`node server.mjs`) and headless (`tsx server.mjs`) — the same
// resolution version.json uses (services/config-service.ts), so a packaging
// change that breaks one breaks both loudly instead of silently.
const DEFAULT_RULES_SOURCE_DIR = join(process.cwd(), 'rules', 'aimaestro')

export interface EnsureAgentRulesResult {
  /** created — file was absent in the workdir */
  seeded: string[]
  /** overwritten — marker present but bytes differed (stale copy refreshed) */
  updated: string[]
  /** byte-identical — nothing to do */
  unchanged: string[]
  /** same-named file WITHOUT the marker — user-owned, never touched */
  preserved: string[]
}

/**
 * Idempotently copy the shipped DEP rules into `<workdir>/.claude/rules/`.
 *
 * Never throws for a missing/empty source dir (a dev tree or a broken
 * package must not block agent creation or wake); per-file I/O errors DO
 * propagate so callers can log them — call sites treat seeding as
 * best-effort and never fail the surrounding pipeline on it.
 */
export async function ensureAgentRules(
  workdir: string,
  sourceDir: string = DEFAULT_RULES_SOURCE_DIR
): Promise<EnsureAgentRulesResult> {
  const result: EnsureAgentRulesResult = { seeded: [], updated: [], unchanged: [], preserved: [] }

  let entries: string[]
  try {
    entries = (await readdir(sourceDir)).filter((f) => f.endsWith('.md')).sort()
  } catch {
    return result
  }
  if (entries.length === 0) return result

  const destDir = join(workdir, '.claude', 'rules')
  await mkdir(destDir, { recursive: true })

  for (const name of entries) {
    const src = await readFile(join(sourceDir, name))
    const destPath = join(destDir, name)

    let dest: Buffer | null = null
    try {
      dest = await readFile(destPath)
    } catch {
      dest = null // absent — seed it
    }

    if (dest === null) {
      await writeFile(destPath, src)
      result.seeded.push(name)
    } else if (dest.equals(src)) {
      result.unchanged.push(name)
    } else if (dest.toString('utf-8').includes(DEP_RULE_MARKER)) {
      await writeFile(destPath, src)
      result.updated.push(name)
    } else {
      result.preserved.push(name)
    }
  }

  return result
}
