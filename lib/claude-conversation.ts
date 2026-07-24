/**
 * Where Claude Code keeps a project's conversation, and whether one exists yet
 * (TRDD-6AMXSG3S).
 *
 * Claude Code stores transcripts at `~/.claude/projects/<slug>/*.jsonl`, where
 * `<slug>` is the project's ABSOLUTE path with every '/' replaced by '-'.
 * `claude --continue` resolves "the most recent conversation" through exactly
 * this slug — which is why an agent relaunched IN ITS OWN WORKDIR continues its
 * own transcript and never another agent's.
 *
 * Two ad-hoc copies of this derivation already exist (the DeleteAgent
 * history-purge in services/element-management-service.ts and the chat reader in
 * services/agents-chat-service.ts). They agree today; this module is the place
 * they should converge on, so a third variant is never written.
 */

import { promises as fsp } from 'fs'
import os from 'os'
import path from 'path'

/** Why a wake/boot-restore launch did NOT resume a prior conversation, or the verb to append. */
export type ResumeDecision =
  | { resume: true; verb: string }
  | { resume: false; reason: 'no-verb' | 'subcommand' | 'no-transcript' }

/**
 * Decide whether a relaunch should carry its client's resume verb (TRDD-NIU5RQ1S).
 *
 * Extracted from the wake path so the load-bearing half of the USER's mandate — "all agents must
 * resume their work exactly from where they left it" — is a testable decision rather than a branch
 * buried in a 400-line launcher that no test can reach.
 *
 * `hasPrior` is a THUNK, not a boolean, deliberately: it walks the filesystem, and the verb checks
 * below reject most clients outright, so evaluating it eagerly would pay that walk for launches
 * that were never going to resume. It also keeps the whole decision injectable in tests.
 *
 * FLAG-FORM ONLY. Per-client resume verbs are not interchangeable: claude `--continue` and gemini
 * `-r latest` are flags that append safely, but codex `resume --last` and kiro `chat --resume` are
 * SUBCOMMANDS that must precede other args — appending those builds a command that is WRONG rather
 * than merely absent, which is the worse failure (a cold start still starts). Those clients are
 * refused here, loudly, until they go through buildLaunchCommand, which owns subcommand ordering.
 */
export async function decideResume(
  resumeVerb: string | undefined | null,
  hasPrior: () => Promise<boolean>,
): Promise<ResumeDecision> {
  const verb = (resumeVerb || '').trim()
  if (!verb) return { resume: false, reason: 'no-verb' }
  if (!verb.startsWith('-')) return { resume: false, reason: 'subcommand' }
  if (!(await hasPrior())) return { resume: false, reason: 'no-transcript' }
  return { resume: true, verb }
}

/**
 * The `~/.claude/projects/` directory name for an absolute working directory.
 * `path.resolve` first, so `/a//b` and `/a/b` — which Claude resolves to the
 * same project — cannot derive two different slugs.
 */
export function conversationSlug(absDir: string): string {
  return path.resolve(absDir).replace(/\//g, '-')
}

/**
 * True when Claude Code already holds at least one transcript for this workdir,
 * i.e. `--continue` has something to continue.
 *
 * FAIL-SAFE BY DESIGN: every failure path returns false. If the directory is
 * unreadable, or Claude ever encodes a path character differently than the
 * slug rule above, the caller simply omits `--continue` and relaunches exactly
 * as it does today. A wrong answer therefore costs the old cold start — never a
 * relaunch that dies on a `--continue` with no conversation behind it.
 */
export async function hasPriorConversation(
  absDir: string,
  homedir: string = os.homedir(),
): Promise<boolean> {
  const dir = path.join(homedir, '.claude', 'projects', conversationSlug(absDir))
  try {
    const entries = await fsp.readdir(dir)
    return entries.some((e) => e.endsWith('.jsonl'))
  } catch {
    return false
  }
}
