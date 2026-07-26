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
 * Where each client keeps its transcripts — the "is there anything to resume?" probe, per client.
 *
 * This module started Claude-only and now hosts the cross-client registry, because the probe is
 * fs-bound and `client-capabilities.ts` is imported by browser bundles that must not pull in `fs`.
 *
 * A client is listed ONLY when its transcript location has been VERIFIED on a real install.
 * Everything else answers `null` = UNKNOWN. Add a client here after checking it, not before.
 *
 * UNKNOWN DOES NOT MEAN COLD START — read `decideResume` before changing anything here. This
 * header used to say the opposite ("unknown means cold start — never a speculative resume"), which
 * has contradicted the code since the USER ruling of 2026-07-25: the CALLER knows whether this is a
 * first launch (the wizard passes `continueConversation: false`; every other path leaves it true),
 * and a filesystem guess is not a better authority than the caller. A probe present and negative
 * still refuses.
 *
 * The stale wording is called out rather than deleted because it nearly cost a reversal: a review
 * pass read the header, found the body disagreeing, and proposed "fixing" the body — which would
 * have undone a USER decision to satisfy a comment. When code and comment disagree about a recorded
 * ruling, the comment is the defect.
 *
 * The residual risk this leaves is real but narrow, and belongs to the CALLER, not here: a client
 * with no probe whose caller wrongly passes `continueConversation: true` on a virgin workdir emits
 * its resume verb with nothing to resume. Closing it means adding that client's probe above.
 */
const CONVERSATION_PROBES: Record<string, (workdir: string) => Promise<boolean>> = {
  // Verified: `claude --continue` resolves ~/.claude/projects/<slug>/*.jsonl by the same slug.
  claude: hasPriorConversation,
}

/**
 * The transcript probe for a client, or null when we have not verified where that client stores
 * its conversations. `program` is matched loosely because the registry stores free-form values
 * ("claude", "claude code", "claude-code").
 */
export function resolveConversationProbe(program: string): ((workdir: string) => Promise<boolean>) | null {
  const p = (program || '').toLowerCase()
  for (const [key, probe] of Object.entries(CONVERSATION_PROBES)) {
    if (p.includes(key)) return probe
  }
  return null
}

/** Why a wake/boot-restore launch did NOT resume a prior conversation, or the verb to use. */
export type ResumeDecision =
  | { resume: true; verb: string }
  | { resume: false; reason: 'no-verb' | 'no-transcript' }

/**
 * Decide whether a relaunch should carry its client's resume verb (TRDD-NIU5RQ1S).
 *
 * Extracted from the wake path so the load-bearing half of the USER's mandate — "all agents must
 * resume their work exactly from where they left it" — is a testable decision rather than a branch
 * buried in a 400-line launcher that no test can reach.
 *
 * `hasPrior` is a THUNK, not a boolean, deliberately: it walks the filesystem, and a client with no
 * resume verb is rejected before it is ever called, so evaluating it eagerly would pay that walk for
 * launches that were never going to resume. It also keeps the whole decision injectable in tests.
 *
 * This answers WHETHER to resume. WHERE the verb goes in the command line is a per-client syntax
 * question answered by `composeLaunchWithResume` — deliberately separate, because the two vary
 * independently: every client answers "do I have a transcript?" the same way and "where does my
 * resume verb go?" differently.
 */
export async function decideResume(
  resumeVerb: string | undefined | null,
  hasPrior: (() => Promise<boolean>) | null,
): Promise<ResumeDecision> {
  const verb = (resumeVerb || '').trim()
  if (!verb) return { resume: false, reason: 'no-verb' }
  // A null probe means we have not verified where THIS client stores transcripts. We resume anyway
  // (USER 2026-07-25: "the launch string should always include the command to resume the last
  // conversation, except ... the first launch"), because the caller — not a filesystem guess — is
  // what knows whether this is a brand-new agent: the wizard passes continueConversation:false for
  // a first launch, and every other path leaves it true. The probe stays for Claude as
  // belt-and-braces, so a caller that forgets still cannot make `claude --continue` exit on a
  // virgin workdir.
  if (hasPrior && !(await hasPrior())) return { resume: false, reason: 'no-transcript' }
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
