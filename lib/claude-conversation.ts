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
export interface ConversationProbeOpts {
  /**
   * Only count a transcript last written at or after this epoch (ms). This is the AGENT-IDENTITY
   * gate of TRDD-KO4TQCJ0 — see `resumeEntitlementEpoch`. Undefined = count any transcript.
   */
  sinceEpochMs?: number
  /** Injectable for tests; defaults to the real home. */
  homedir?: string
}

export type ConversationProbe = (workdir: string, opts?: ConversationProbeOpts) => Promise<boolean>

const CONVERSATION_PROBES: Record<string, ConversationProbe> = {
  // Verified: `claude --continue` resolves ~/.claude/projects/<slug>/*.jsonl by the same slug.
  claude: (workdir, opts) => hasPriorConversation(workdir, opts?.homedir, opts?.sinceEpochMs),
}

/**
 * The transcript probe for a client, or null when we have not verified where that client stores
 * its conversations. `program` is matched loosely because the registry stores free-form values
 * ("claude", "claude code", "claude-code").
 */
export function resolveConversationProbe(program: string): ConversationProbe | null {
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
  sinceEpochMs?: number,
): Promise<boolean> {
  const dir = path.join(homedir, '.claude', 'projects', conversationSlug(absDir))
  try {
    const entries = await fsp.readdir(dir)
    const transcripts = entries.filter((e) => e.endsWith('.jsonl'))
    if (sinceEpochMs === undefined) return transcripts.length > 0
    // The entitlement gate (TRDD-KO4TQCJ0). `stat` per transcript, early-returning on the first
    // match, because the answer is "does ANY transcript belong to this agent's lifetime?" — a
    // workdir with one fresh file must not pay for a hundred stale ones.
    for (const name of transcripts) {
      try {
        const st = await fsp.stat(path.join(dir, name))
        if (st.mtimeMs >= sinceEpochMs) return true
      } catch {
        // A transcript that vanished between readdir and stat is simply not evidence.
      }
    }
    return false
  } catch {
    return false
  }
}

/**
 * The registry fields this module reads off an agent. Structural, not `Agent`, so the pure helpers
 * below stay importable from tests and from `lib/` without dragging the registry in.
 */
export interface ConversationOwnerLike {
  program?: string | null
  workingDirectory?: string | null
  sessions?: Array<{ workingDirectory?: string | null } | null | undefined> | null
  createdAt?: string | null
}

/** The workdir whose transcripts this agent would resume — the same fallback every caller used. */
export function conversationWorkdir(agent: ConversationOwnerLike | null | undefined): string | undefined {
  return agent?.workingDirectory || agent?.sessions?.[0]?.workingDirectory || undefined
}

/**
 * The instant this agent became entitled to a transcript at its workdir: its creation time.
 *
 * WHY THIS EXISTS (TRDD-KO4TQCJ0). Claude Code keys transcripts by workdir PATH, not by agent, so a
 * NEW agent created at a REUSED workdir inherits the DELETED agent's slug — and, before this gate,
 * resumed its conversation. Agent identity never appeared in the probe at all. Comparing the
 * transcript's mtime against the agent's own creation time is the cheapest thing that distinguishes
 * "my conversation" from "my predecessor's": a restarted agent's transcript is younger than the
 * agent; an inherited one is older.
 *
 * DEGRADES OPEN, DELIBERATELY. A registry row with no parseable `createdAt` yields no epoch, and the
 * probe then answers exactly as it did before this card — any transcript counts. Blocking a resume
 * on a missing field would trade a rare wrong resume for a routine lost one, and losing the turn in
 * flight is the more expensive failure (TRDD-NIU5RQ1S is the whole reason the resume exists).
 */
export function resumeEntitlementEpoch(agent: ConversationOwnerLike | null | undefined): number | undefined {
  const raw = agent?.createdAt
  if (!raw) return undefined
  const t = new Date(raw).getTime()
  return Number.isFinite(t) ? t : undefined
}

/**
 * Does a transcript exist that THIS agent is entitled to resume?
 *
 * The `--continue`-flag shape, for the three restart surfaces. Takes the AGENT — never a bare
 * workdir — so a call site cannot silently omit the entitlement epoch: that is precisely the
 * N-1-of-N failure this card was written to avoid, and `tests/unit/agent-resume-entitlement.test.ts`
 * pins it structurally by forbidding any production import of `hasPriorConversation` outside here.
 *
 * A client with no verified probe answers FALSE — we cannot see its transcripts, so we cannot claim
 * one exists. That is the correct answer for a caller building a flag; the BOOT path, which must
 * treat an unverified client as "resume anyway" per the USER ruling of 2026-07-25, uses
 * `resolveAgentResumeProbe` instead. The two shapes differ because that ruling makes them differ.
 */
export async function agentMayResumeConversation(
  agent: ConversationOwnerLike | null | undefined,
  opts: { program?: string; workdir?: string; homedir?: string } = {},
): Promise<boolean> {
  const workdir = opts.workdir || conversationWorkdir(agent)
  if (!workdir) return false
  const probe = resolveConversationProbe(opts.program || agent?.program || '')
  if (!probe) return false
  return probe(workdir, { sinceEpochMs: resumeEntitlementEpoch(agent), homedir: opts.homedir })
}

/**
 * The `decideResume` shape: a thunk bound to this agent's workdir AND entitlement epoch, or null
 * when the client has no verified probe — preserving `decideResume`'s null-means-resume-anyway
 * contract while still gating the clients we CAN see.
 */
export function resolveAgentResumeProbe(
  agent: ConversationOwnerLike | null | undefined,
  opts: { program?: string; workdir?: string; homedir?: string } = {},
): (() => Promise<boolean>) | null {
  const probe = resolveConversationProbe(opts.program || agent?.program || '')
  if (!probe) return null
  const workdir = opts.workdir || conversationWorkdir(agent)
  if (!workdir) return null
  const sinceEpochMs = resumeEntitlementEpoch(agent)
  return () => probe(workdir, { sinceEpochMs, homedir: opts.homedir })
}
