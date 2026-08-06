/**
 * Why is an agent blocked — the service behind `GET /api/agents/[id]/block-state`.
 *
 * This is the capability the whole unattended premise rests on: a fleet only runs without a
 * human if a supervisor can SEE that an agent is stuck and answer it. Today it cannot, and
 * a live agent on this host has been stuck on an AskUserQuestion since the previous evening
 * while its MANAGER watched and correctly refused to act (TRDD-89LVZSQ0 / TRDD-8RVDY7ND).
 *
 * The verdict logic is pure and lives in `lib/agent-block-state.ts`, with the measurements
 * that justify trusting the pane over the hook. This file is only the I/O around it.
 */
import { getAgentById } from '@/services/agents-core-service'
import { getRuntime } from '@/lib/agent-runtime'
import { readPendingPrompt } from '@/services/sessions-service'
import { resolveBlockState, matchPane, type BlockVerdict } from '@/lib/agent-block-state'

/** How much scrollback to read. Enough to hold a long AskUserQuestion, bounded so a huge
 *  buffer cannot be pulled through this surface in one call. */
const CAPTURE_LINES = 120

export interface BlockStateResult {
  data?: BlockVerdict & { matches?: string[]; sessionName: string }
  error?: string
  status?: number
}

/**
 * Resolve an agent's blocked state, optionally searching the pane.
 *
 * SECURITY — why `match` is gated on being blocked, ON TOP of the route's authorization.
 * The route is strict/`unblock-prompt` (R42.8: MANAGER any, COS own-team, never an
 * ASSISTANT, self always), so an arbitrary caller never reaches here. This is the second
 * layer, and it constrains the callers who ARE authorized.
 *
 * The verdict exposes the prompt, its choices, and the lines that explain the stall. An
 * arbitrary regex over the whole pane is a different thing: it is an ORACLE, and a pane can
 * hold anything the agent was shown, secrets included. Binary-searching a key out of it is a
 * real primitive, and a MANAGER is not thereby entitled to it.
 *
 * So `match` is served ONLY while the agent is genuinely blocked. That is not a compromise —
 * it is the capability's own justification made mechanical: the reason to search a pane is
 * to understand why work stopped. If work has not stopped, there is no reason, and the
 * oracle is closed. One predicate, and the same one that gates injection.
 */
export async function getBlockState(
  agentId: string,
  opts: { match?: string } = {},
): Promise<BlockStateResult> {
  const result = getAgentById(agentId)
  if (result.error || !result.data) {
    return { error: result.error || 'Agent not found', status: result.status || 404 }
  }
  const agent = result.data.agent

  // Resolution order taken from the shipped `aimaestro-session.sh::_resolve_session_name`
  // (`.agent.session.tmuxSessionName // .agent.name`) rather than invented.
  //
  // NOTE for whoever touches this next: that script's jq path is
  // `.agent.sessions[0].tmuxSessionName`, and the `AgentSession` TYPE declares no such
  // field — only `LiveAgentSessionStatus` does. So the shipped script reads a property the
  // type system does not guarantee on that path. It evidently works at runtime, so this is
  // a type/shape divergence worth its own look, not something to "fix" blind from here.
  // We read the DECLARED field and fall back to the agent name, which is the same answer in
  // every case the script handles.
  const sessionName = agent.session?.tmuxSessionName || agent.name
  if (!sessionName) {
    return { error: 'Agent has no session to inspect', status: 409 }
  }

  let paneText: string
  try {
    paneText = await getRuntime().capturePane(sessionName, CAPTURE_LINES)
  } catch (err) {
    // A capture failure is NOT "not blocked" — reporting a healthy verdict here would tell a
    // supervisor everything is fine about an agent we could not read at all.
    return {
      error: `Could not read the agent's pane: ${err instanceof Error ? err.message : String(err)}`,
      status: 502,
    }
  }
  if (!paneText) {
    return { error: 'Agent pane is empty or unreadable', status: 502 }
  }

  // The hook's label is a HINT only — measured to mislabel AskUserQuestion as
  // `permission_prompt`, and to go ~17h stale on a blocked agent (which generates no events).
  // `readPendingPrompt` is keyed by WORKING DIRECTORY (the chat-state file is
  // sha256(cwd)[:16]), not by session name — a detail worth stating, because passing the
  // session name here silently returns null forever and the verdict degrades to pane-only
  // without anything reporting that the hint was never consulted.
  let hookType: string | null = null
  try {
    const pending = agent.workingDirectory ? readPendingPrompt(agent.workingDirectory) : null
    hookType = (pending as { notificationType?: string } | null)?.notificationType ?? null
  } catch {
    hookType = null
  }

  const verdict = resolveBlockState(paneText, hookType)

  if (opts.match !== undefined) {
    if (!verdict.blocked) {
      return {
        error:
          'pane search is available only while the agent is BLOCKED (it is not); ' +
          `current state: ${verdict.reason}`,
        status: 409,
      }
    }
    let matches: string[]
    try {
      matches = matchPane(paneText, opts.match)
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'invalid regex', status: 400 }
    }
    return { data: { ...verdict, matches, sessionName } }
  }

  return { data: { ...verdict, sessionName } }
}
