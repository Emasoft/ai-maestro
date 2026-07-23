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
