/**
 * DEP rule seeding (TRDD-DE9757LJ Phase 2; tamper-resistance TRDD-JGCEA6CQ).
 *
 * ai-maestro ships its DEP (ai-maestro-DEPENDENT) rules under
 * `<app>/rules/aimaestro/*.md` — the governance overlay (approval tiers,
 * transition authority, PRRD, multi-agent kanban) that EXPANDS the universal
 * IND base the ai-maestro-janitor installs globally, plus the operating rules
 * that tell an agent how to behave inside the harness. The server copies these
 * into each registered agent workdir's `.claude/rules/` so they load ONLY
 * inside agent workdirs, never in unrelated projects.
 *
 * OWNERSHIP CONTRACT — ai-maestro owns the `aimaestro-*.md` NAME.
 * A shipped rule is restored to the shipped bytes whenever it differs, whether
 * or not it still carries the DEP_RULE_MARKER, and re-created when deleted.
 * The marker is provenance, NOT a permission gate.
 *
 * This is the security fix that supersedes the original contract (which
 * PRESERVED a same-named file lacking the marker, treating it as user-owned).
 * That was a bypass with a two-step recipe: strip the marker, rewrite the rule,
 * and the seeder politely leaves your edit in place forever — letting the
 * GOVERNED party silently rewrite the rules that govern it. A user who wants
 * their own rule uses any other filename; the `aimaestro-*` namespace is the
 * server's.
 *
 * Files are written READ-ONLY (0444) so an accidental or casual write fails
 * rather than succeeding quietly, and the mode is re-asserted on every pass.
 *
 * HONEST LIMIT: agents share the server's UID today, so a determined agent can
 * chmod the file back and rewrite it. This makes tampering *transient and
 * self-healing*, not impossible — the file is restored on create, wake, import,
 * server boot, and the periodic watchdog. Real prevention needs per-agent UID
 * isolation (TRDD-a1019073); do not read this module as a sandbox.
 */
import { chmod, mkdir, readdir, readFile, stat, writeFile } from 'fs/promises'
import { join } from 'path'

export const DEP_RULE_MARKER = 'ai-maestro:installed-dep-rule'

/**
 * Seeded rules are read-only. Enforced on write AND repaired on every pass, so
 * a `chmod +w` alone (without a content change) is still corrected.
 */
export const RULE_FILE_MODE = 0o444

// Bundled DEP rule sources. process.cwd() is the app install dir under both
// full mode (`node server.mjs`) and headless (`tsx server.mjs`) — the same
// resolution version.json uses (services/config-service.ts), so a packaging
// change that breaks one breaks both loudly instead of silently.
const DEFAULT_RULES_SOURCE_DIR = join(process.cwd(), 'rules', 'aimaestro')

export interface EnsureAgentRulesResult {
  /** created — file was absent (never seeded, or deleted by someone) */
  seeded: string[]
  /** bytes differed — restored to the shipped content (a rule update OR tampering) */
  updated: string[]
  /** byte-identical — nothing to do */
  unchanged: string[]
  /** content was already correct but the read-only mode had been removed — mode repaired */
  remoded: string[]
}

export interface AgentRulesSweepResult {
  /** workdirs actually visited */
  scanned: number
  /** workdirs that gained at least one rule file (new, or re-created after deletion) */
  seeded: number
  /** workdirs where a rule's bytes differed and were restored (rule update OR tampering) */
  updated: number
  /** workdirs where a rule's read-only mode had been removed and was re-applied */
  remoded: number
  /** `<workdir>: <error>` for each workdir the sweep could not seed */
  failed: string[]
}

/**
 * Write a rule file and leave it read-only.
 *
 * The existing file is chmod'd writable FIRST: it is normally 0444 (we put it
 * there), and writeFile's `mode` option only applies when a file is CREATED —
 * so without this an update would EACCES against our own protection.
 */
async function writeProtected(destPath: string, src: Buffer): Promise<void> {
  try {
    await chmod(destPath, 0o644)
  } catch {
    // Absent (the common create path) or not ours — let writeFile decide.
  }
  await writeFile(destPath, src, { mode: RULE_FILE_MODE })
  await chmod(destPath, RULE_FILE_MODE)
}

/**
 * Restore the shipped DEP rules in `<workdir>/.claude/rules/`.
 *
 * Enforcing, not merely seeding: a rule that is missing is re-created, a rule
 * whose bytes differ is overwritten (this covers BOTH a legitimate rule update
 * and tampering — they are indistinguishable on disk and the response to each
 * is the same), and a rule whose mode drifted off read-only is re-protected.
 * The DEP_RULE_MARKER records provenance; it does not grant anyone the right to
 * keep an edit (see the ownership contract at the top of this file).
 *
 * Never throws for a missing/empty source dir (a dev tree or a broken package
 * must not block agent creation or wake); per-file I/O errors DO propagate so
 * callers can log them — call sites treat seeding as best-effort and never fail
 * the surrounding pipeline on it.
 */
export async function ensureAgentRules(
  workdir: string,
  sourceDir: string = DEFAULT_RULES_SOURCE_DIR
): Promise<EnsureAgentRulesResult> {
  const result: EnsureAgentRulesResult = { seeded: [], updated: [], unchanged: [], remoded: [] }

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
      dest = null // absent — deleted, or never seeded
    }

    if (dest === null) {
      await writeProtected(destPath, src)
      result.seeded.push(name)
    } else if (!dest.equals(src)) {
      await writeProtected(destPath, src)
      result.updated.push(name)
    } else {
      // Content is right; the mode may not be. A `chmod +w` with no edit yet is
      // a tamper in progress — repair it now rather than wait for the write.
      const mode = (await stat(destPath)).mode & 0o777
      if (mode !== RULE_FILE_MODE) {
        await chmod(destPath, RULE_FILE_MODE)
        result.remoded.push(name)
      } else {
        result.unchanged.push(name)
      }
    }
  }

  return result
}

/**
 * Restore the DEP rules across MANY workdirs — the fleet-wide leg.
 *
 * Two gaps this closes, and they are different:
 *
 * 1. COVERAGE. The per-agent call sites (CreateAgent G05b, importAgent, the wake
 *    gate in ensureCorePluginInstalled) only fire when that agent is TOUCHED, so
 *    an agent that is never woken never learns a rule shipped after it was
 *    created. Run at boot, this reaches every registered agent — hibernated ones
 *    included.
 * 2. TAMPERING. A rule deleted or rewritten by an agent stays broken until that
 *    agent is next woken — i.e. exactly the agent that broke it decides when the
 *    fix lands. Run on a timer (startAgentRulesWatchdog), this restores it while
 *    the server is up, without waiting for a wake.
 *
 * Isolating failures per workdir is the point: one deleted or unwritable agent
 * directory must not stop the other agents from getting their rules. Failures are
 * COLLECTED, never thrown — the sweep is best-effort and must never block startup.
 */
export async function ensureAgentRulesForWorkdirs(
  workdirs: readonly string[],
  sourceDir: string = DEFAULT_RULES_SOURCE_DIR
): Promise<AgentRulesSweepResult> {
  const sweep: AgentRulesSweepResult = { scanned: 0, seeded: 0, updated: 0, remoded: 0, failed: [] }

  // De-dupe: two agents may legitimately share one workdir (a project adopted by
  // both a MAINTAINER and an AUTONOMOUS agent), and seeding it twice is pure waste.
  for (const workdir of new Set(workdirs)) {
    sweep.scanned++
    try {
      const r = await ensureAgentRules(workdir, sourceDir)
      if (r.seeded.length > 0) sweep.seeded++
      if (r.updated.length > 0) sweep.updated++
      if (r.remoded.length > 0) sweep.remoded++
    } catch (err) {
      sweep.failed.push(`${workdir}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return sweep
}

// The periodic loop that restores these rules is NOT here. It is the single
// agent-invariants watchdog (lib/agent-invariants.ts), which runs the `dep-rules`
// invariant alongside every other workdir guarantee. A rules-only timer used to
// live here; it was folded in (TRDD-VYQ8N4KR) because one loop per invariant is
// how you end up with N loops, N schedules, and N places to look when something
// did not get repaired.
