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
import fs from 'fs'
import { getAgentById } from '@/services/agents-core-service'
import { getRuntime } from '@/lib/agent-runtime'
import { readPendingPrompt } from '@/services/sessions-service'
import { resolveBlockState, matchPane, type BlockVerdict } from '@/lib/agent-block-state'
import { computeSessionName, type Agent } from '@/types/agent'
import { chatStateFileFor } from '@/lib/chat-state-path'
import { resolveAgentStatus } from '@/lib/agent-status'

/** How much scrollback to read. Enough to hold a long AskUserQuestion, bounded so a huge
 *  buffer cannot be pulled through this surface in one call. */
const CAPTURE_LINES = 120

export interface BlockStateResult {
  data?: BlockVerdict & { matches?: string[]; sessionName: string }
  error?: string
  status?: number
}

export type PaneVerdict =
  | { ok: true; verdict: BlockVerdict; paneText: string; sessionName: string }
  | { ok: false; error: string; status: number }

/**
 * Capture and classify ONE agent's pane.
 *
 * Exported because two callers must reach the SAME verdict about the same pane: this
 * service (the read route) and `sendAgentSessionCommand`'s R42.8 blocked-only precondition
 * (the write gate). If they judged "blocked" differently, a supervisor could be shown a
 * question it is then refused permission to answer — or, worse, be allowed to answer one it
 * was never shown.
 *
 * THE SESSION NAME IS COMPUTED THE WAY THE WRITE PATH COMPUTES IT, and that is not a style
 * preference. `sendAgentSessionCommand` addresses `computeSessionName(agent.name, index)`.
 * An earlier draft here read `agent.session?.tmuxSessionName`, which is a different field
 * and can hold a different string — so the read and the write could land on DIFFERENT panes,
 * and a supervisor would answer a question it had not read. Read and write must name the
 * same pane by construction, not by coincidence.
 */
export async function readPaneVerdict(
  agentName: string | undefined,
  sessionIndex: number,
  workingDirectory?: string,
): Promise<PaneVerdict> {
  if (!agentName) {
    return { ok: false, error: 'Agent has no name configured', status: 400 }
  }
  const sessionName = computeSessionName(agentName, sessionIndex)

  let paneText: string
  try {
    paneText = await getRuntime().capturePane(sessionName, CAPTURE_LINES)
  } catch (err) {
    // A capture failure is NOT "not blocked" — reporting a healthy verdict here would tell a
    // supervisor everything is fine about an agent we could not read at all.
    return {
      ok: false,
      error: `Could not read the agent's pane: ${err instanceof Error ? err.message : String(err)}`,
      status: 502,
    }
  }
  if (!paneText) {
    return { ok: false, error: 'Agent pane is empty or unreadable', status: 502 }
  }

  // The hook's label is a HINT only — measured to mislabel AskUserQuestion as
  // `permission_prompt`, and to go ~17h stale on a blocked agent (which generates no events).
  // `readPendingPrompt` is keyed by WORKING DIRECTORY (the chat-state file is
  // sha256(cwd)[:16]), not by session name — a detail worth stating, because passing the
  // session name here silently returns null forever and the verdict degrades to pane-only
  // without anything reporting that the hint was never consulted.
  let hookType: string | null = null
  try {
    const pending = workingDirectory ? readPendingPrompt(workingDirectory) : null
    hookType = (pending as { notificationType?: string } | null)?.notificationType ?? null
  } catch {
    hookType = null
  }

  return { ok: true, verdict: resolveBlockState(paneText, hookType), paneText, sessionName }
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

  // Index 0 is the primary session — the same one `sendAgentSessionCommand` writes to.
  const primary = agent.sessions?.find(s => s.index === 0)
  const pane = await readPaneVerdict(agent.name, primary?.index ?? 0, agent.workingDirectory)
  if (!pane.ok) {
    return { error: pane.error, status: pane.status }
  }
  const { verdict, paneText, sessionName } = pane

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

/** The hook's chat-state fields the probe surfaces (TRDD-LT5N2JA4). */
interface HookSnapshot {
  notificationType: string | null
  message: string | null
  options: unknown[] | null
  updatedAt: string | null
  ageSeconds: number | null
}

const HOOK_STALE_AFTER_SECONDS = 60 * 60 // 1h — the card's own staleness bound

/** Read the hook's raw chat-state file for a workdir. Same resolver as every other
 *  chat-state reader (lib/chat-state-path) — never a second cwd-hash mirror. */
function readHookSnapshot(workingDirectory: string | undefined): HookSnapshot | null {
  if (!workingDirectory) return null
  try {
    const stateFile = chatStateFileFor(workingDirectory)
    if (!fs.existsSync(stateFile)) return null
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as Record<string, unknown>
    const updatedAt = typeof state.updatedAt === 'string' ? state.updatedAt : null
    const ageMs = updatedAt ? Date.now() - Date.parse(updatedAt) : NaN
    return {
      notificationType: typeof state.notificationType === 'string' ? state.notificationType : null,
      message: typeof state.message === 'string' ? state.message : null,
      options: Array.isArray(state.options) ? state.options : null,
      updatedAt,
      ageSeconds: Number.isFinite(ageMs) ? Math.round(ageMs / 1000) : null,
    }
  } catch {
    return null
  }
}

export interface ProbeResult {
  agent: Agent
  status: ReturnType<typeof resolveAgentStatus>
  block: (BlockVerdict & { sessionName: string }) | null
  hook: HookSnapshot | null
  usage: null
  lastError: { text: string; at: string | null; source: 'hook' } | null
  sources: Record<'registry' | 'pane' | 'hook' | 'usage', string>
}

/**
 * `GET /api/agents/[id]/probe` — one aggregating read of everything this server already
 * knows about an agent (registry status + pane block-state + hook chat-state), per
 * TRDD-LT5N2JA4. `usage` (agentlenspro) is deliberately OMITTED: the card measured that its
 * `sessions` view keys on the Claude Code session id, which has no proven mapping to an
 * ai-maestro agent id — a guessed join would attribute one agent's cost/context-fill to
 * another, a wrong number that looks authoritative. `sources` names every feed's outcome so a
 * degraded read is visible rather than silently defaulted (the whole point of this card).
 */
export async function getAgentProbe(agentId: string): Promise<{
  data?: ProbeResult
  error?: string
  status?: number
}> {
  const result = getAgentById(agentId)
  if (result.error || !result.data) {
    return { error: result.error || 'Agent not found', status: result.status || 404 }
  }
  const agent = result.data.agent

  const isOnline = agent.session?.status === 'online'
  const programRunning = agent.session?.programRunning

  const sources: ProbeResult['sources'] = {
    registry: 'ok',
    pane: 'unavailable: not queried',
    hook: 'unavailable: not queried',
    usage: 'unavailable: no proven join key (see TRDD-LT5N2JA4)',
  }

  const blockResult = await getBlockState(agentId)
  const block = blockResult.data ?? null
  sources.pane = block ? 'ok' : `unavailable: ${blockResult.error || 'unknown error'}`

  const hook = readHookSnapshot(agent.workingDirectory)
  if (!hook) {
    sources.hook = 'unavailable: no chat-state file'
  } else if (hook.ageSeconds !== null && hook.ageSeconds > HOOK_STALE_AFTER_SECONDS) {
    sources.hook = `stale:${hook.ageSeconds}s`
  } else {
    sources.hook = 'ok'
  }

  const status = resolveAgentStatus(
    isOnline,
    false, // isHibernated — no persisted hibernation flag on Agent today; see TRDD-LT5N2JA4 report
    undefined,
    hook?.notificationType ?? undefined,
    programRunning,
    undefined,
  )

  const lastError: ProbeResult['lastError'] =
    hook && (hook.notificationType === 'api_error' || hook.notificationType === 'rate_limited')
      ? { text: hook.message || hook.notificationType, at: hook.updatedAt, source: 'hook' }
      : null

  return {
    data: { agent, status, block, hook, usage: null, lastError, sources },
    status: 200,
  }
}
