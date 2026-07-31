// Building the relaunch command for a session — the ONE composition, shared by
// every caller that restarts an agent (TRDD-QZL828OD).
//
// This was inline in `POST /api/sessions/[id]/restart` and nowhere else, which was
// fine while the route was the only restarter. R42.7 adds a second one (the
// server-as-daemon fleet restart), and cloning a security-validated composition is
// how two paths silently drift apart — the same footgun as two same-named maps with
// different key casing. So the build is extracted once and BOTH callers use it.
//
// It deliberately stops short of ACTING: it returns a discriminated result and lets
// the caller decide what a refusal means (the route maps it to HTTP; the fleet
// driver skips that agent and reports why). Every security check the route relied
// on happens here, in the same order:
//   1. `isValidProgramArgs` — reject shell metacharacters that could escape the
//      `--name "…"` quoting the receiving shell parses (CC-GOV-002).
//   2. `resolveLaunchArgs` — enforce `--agent <persona>` so a restart cannot
//      resurrect a titled Claude agent as a generic `claude` (TRDD-GZ1KOHNR).
//      Checked BEFORE anything is stopped, so a running agent is never disrupted
//      by a refusal.
//   3. `sanitizePersonaName` + `resolveRestartBin` + `buildRelaunchCommand` — the
//      shared bin resolution and persona-name allowlist.

import {
  isValidProgramArgs,
  resolveRestartBin,
  sanitizePersonaName,
  buildRelaunchCommand,
} from '@/lib/session-restart'

/** The subset of an Agent this module needs. Kept structural so a test can pass a
 *  literal and the two callers can pass their own registry object unchanged. */
export interface RelaunchAgentLike {
  id?: string
  name?: string
  label?: string
  program?: string
  programArgs?: string
  workingDirectory?: string | null
  sessions?: Array<{ workingDirectory?: string | null }>
  /** Creation time — the resume-entitlement epoch of TRDD-KO4TQCJ0. */
  createdAt?: string | null
}

export type RelaunchPrep =
  /** programArgs carried disallowed characters — the caller refuses (route: 400). */
  | { kind: 'invalid-args' }
  /** A Claude agent whose persona could not be resolved (route: 409). */
  | { kind: 'persona-unresolved'; reason: string }
  /** Ready to hand to `runRestartSequence`. */
  | { kind: 'ready'; command: string; bin: string; continueConversation: boolean }

/** Injectable seams. Defaults lazy-import the real modules so this file stays
 *  importable (and unit-testable) without pulling the service layer in. */
export interface RelaunchPrepDeps {
  resolveLaunchArgs?: (
    agentId: string | undefined,
    program: string,
    programArgs: string,
  ) => Promise<{ kind: 'refuse'; reason: string } | { kind: 'ok'; args: string }>
  /** Takes the AGENT, not a workdir: the entitlement epoch travels with it (TRDD-KO4TQCJ0). */
  mayResumeConversation?: (agent: RelaunchAgentLike | null | undefined) => Promise<boolean>
}

/**
 * Validate + build the relaunch command for `sessionName`.
 *
 * `program` / `programArgs` default to the agent's stored values — which is what
 * makes a fleet restart non-expressive under R42.7(b): the daemon supplies no
 * arguments of its own, it replays what the agent was already launched with.
 */
export async function prepareRelaunchCommand(
  agent: RelaunchAgentLike | null | undefined,
  sessionName: string,
  overrides: { program?: string; programArgs?: string } = {},
  deps: RelaunchPrepDeps = {},
): Promise<RelaunchPrep> {
  const program = overrides.program || agent?.program || 'claude'
  const programArgs = overrides.programArgs || agent?.programArgs || ''

  if (!isValidProgramArgs(programArgs)) return { kind: 'invalid-args' }

  const resolveArgs =
    deps.resolveLaunchArgs ??
    (async (id, prog, args) =>
      (await import('@/services/agent-launch-args')).resolveLaunchArgs(id, prog, args))
  const enforced = await resolveArgs(agent?.id, program, programArgs)
  if (enforced.kind === 'refuse') return { kind: 'persona-unresolved', reason: enforced.reason }

  const bin = resolveRestartBin(program)
  const personaName = sanitizePersonaName(agent?.label || agent?.name || sessionName, sessionName)

  // TRDD-6AMXSG3S: resume the agent's own transcript rather than cold-starting it.
  // A restart exists to pick up new config, NOT to discard the task in flight.
  // `--continue` is Claude-only and fails with no prior transcript, hence both guards.
  // TRDD-KO4TQCJ0: "its own" is load-bearing — transcripts are keyed by workdir PATH, so an agent
  // created at a REUSED workdir would otherwise resume its DELETED predecessor's conversation.
  // `agentMayResumeConversation` takes the agent so the entitlement epoch cannot be left behind.
  const mayResume =
    deps.mayResumeConversation ??
    (async (a: RelaunchAgentLike | null | undefined) =>
      (await import('@/lib/claude-conversation')).agentMayResumeConversation(a, { program }))
  const continueConversation = bin === 'claude' && (await mayResume(agent))

  return {
    kind: 'ready',
    command: buildRelaunchCommand(bin, enforced.args, personaName, { continueConversation }),
    bin,
    continueConversation,
  }
}
