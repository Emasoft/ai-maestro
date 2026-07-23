/**
 * POST /api/sessions/me/restart  (TRDD-4P1M8I18 Phase 2)
 *
 * The SELF-ONLY-BY-CONSTRUCTION agent self-restart. An agent (the janitor `#J`
 * continuity path, or any agent recovering a stuck self) restarts ITS OWN
 * session — and ONLY its own.
 *
 * WHY a separate route from POST /api/sessions/[id]/restart:
 *   - That route maps to the `restart-session` AuthAction, which is a DRIVE
 *     action NOT in SELF_DRIVE_ACTIONS (lib/authorization.ts) — so an agent
 *     naming its own session there is DENIED ("No agent can modify itself via
 *     the AI Maestro API"). Agents have no server path to self-restart.
 *   - The fix is not to add self to `restart-session` (that would loosen the
 *     shared drive action and touch every cross-agent restart). It is a route
 *     whose target is DERIVED from the authenticated caller: there is NO `[id]`
 *     / session parameter, so no request shape — body, query, header — can name
 *     another agent. "Restart agent B while authenticated as A" is
 *     unrepresentable here. That is stronger than self-only-by-authorization
 *     (which relies on a check rejecting a supplied non-self target).
 *
 * WHY NOT sudo-strict: R32 — agents NEVER face a sudo gate (sudo protects the
 * human's cross-target destructive ops). A self-only-by-construction route has
 * no cross-target for sudo to protect, so it is a normal authenticated route
 * (the structural middleware still blocks anonymous callers). It is deliberately
 * ABSENT from security-registry.json / STRICT_AGENT_RULES.
 *
 * The mechanical relaunch (stop→poll→relaunch, the CC-GOV allowlists, the
 * `--name` injection) is the SHARED lib/session-restart.ts — identical to
 * [id]/restart, so the two surfaces cannot construct different commands.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAgent } from '@/lib/agent-registry'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { computeSessionName } from '@/types/agent'
import { sessionExistsSync } from '@/lib/agent-runtime'
import {
  isValidProgramArgs,
  resolveRestartBin,
  sanitizePersonaName,
  buildRelaunchCommand,
  runRestartSequence,
} from '@/lib/session-restart'
import { resolveLaunchArgs } from '@/services/agent-launch-args'
import { hasPriorConversation } from '@/lib/claude-conversation'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  // Authenticate. The structural middleware already blocks anonymous callers;
  // this rejects a forged/expired credential explicitly.
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }

  // AGENT-only. The system-owner (session cookie → no agentId) has no "me" agent
  // session; the human restarts a named session via POST /api/sessions/[id]/restart.
  // This is the ONLY caller identity the route reads — the target is derived from
  // it, never supplied.
  if (!auth.agentId) {
    return NextResponse.json(
      {
        error: 'no_self_agent',
        message: 'me/restart is for agents restarting themselves. Use /api/sessions/[id]/restart to restart a named session.',
      },
      { status: 400 }
    )
  }

  const agent = getAgent(auth.agentId)
  if (!agent) {
    return NextResponse.json({ error: 'agent_not_found' }, { status: 404 })
  }

  // Resolve THIS agent's own live session — self BY CONSTRUCTION. The session name
  // is computed from the caller's own agent record (primary/online session index),
  // never from the request. computeSessionName(name, 0) === name.
  const primary = agent.sessions?.find((s) => s.status === 'online') ?? agent.sessions?.[0]
  const sessionName = computeSessionName(agent.name, primary?.index ?? 0)
  if (!sessionExistsSync(sessionName)) {
    return NextResponse.json(
      {
        error: 'no_live_session',
        message: 'This agent has no live tmux session to restart.',
      },
      { status: 409 }
    )
  }

  // Manager-gate parity with [id]/restart: a team agent cannot restart without a
  // MANAGER on the host. Self-restart must not be a laxer path than the named
  // route — a team agent should not be able to self-restart out of a
  // MANAGER-removed hibernation (CLAUDE.md §10 blocking cascade).
  const { getManagerId } = await import('@/lib/governance')
  const { isAgentInAnyTeam } = await import('@/lib/team-registry')
  if (!getManagerId() && isAgentInAnyTeam(agent.id)) {
    return NextResponse.json(
      { error: 'Cannot restart team agent: no MANAGER exists on this host. Assign a MANAGER first.' },
      { status: 403 }
    )
  }

  // Subagent gate parity (TRDD-O8NCNRWO): a PROVEN positive counter refuses with
  // 409 (null/0 never blocks — stale-low per plugin#17); ?force=true overrides.
  const force = request.nextUrl.searchParams.get('force') === 'true'
  const { readSubagentCount, evaluateExitGate } = await import('@/lib/session-safe-state')
  const agentWorkingDir = agent.workingDirectory || agent.sessions?.[0]?.workingDirectory
  const gate = evaluateExitGate(readSubagentCount(agentWorkingDir), force)
  if (gate.blocked) {
    return NextResponse.json(
      {
        error: 'subagents_running',
        message: `Refusing to restart: ${gate.subagentCount} background subagent(s) still running. Retry with ?force=true to restart anyway.`,
        subagentCount: gate.subagentCount,
      },
      { status: 409 }
    )
  }

  // Optional body { program, programArgs }; default to the agent's registry values.
  let body: { program?: string; programArgs?: string } = {}
  try { body = await request.json() } catch { /* optional body */ }
  if (body.program !== undefined && typeof body.program !== 'string') {
    return NextResponse.json({ error: 'Invalid program: must be a string' }, { status: 400 })
  }
  if (body.programArgs !== undefined && typeof body.programArgs !== 'string') {
    return NextResponse.json({ error: 'Invalid programArgs: must be a string' }, { status: 400 })
  }
  const program = body.program || agent.program || 'claude'
  const programArgs = body.programArgs || agent.programArgs || ''
  if (!isValidProgramArgs(programArgs)) {
    return NextResponse.json({ error: 'Invalid programArgs: contains disallowed characters' }, { status: 400 })
  }

  // TRDD-GZ1KOHNR: enforce `--agent <persona>` on self-relaunch too — refuse
  // (before any stop) if this Claude agent has no resolvable role persona.
  const enforced = await resolveLaunchArgs(agent.id, program, programArgs)
  if (enforced.kind === 'refuse') {
    return NextResponse.json(
      { error: 'agent_persona_unresolved', message: `Refusing to restart "${sessionName}": ${enforced.reason}` },
      { status: 409 },
    )
  }

  // Build via the shared, security-validated construction and run the mechanical
  // sequence — the same lib [id]/restart uses, so the two cannot diverge.
  const bin = resolveRestartBin(program)
  const personaName = sanitizePersonaName(agent.label || agent.name || sessionName, sessionName)

  // TRDD-6AMXSG3S: same continuity guarantee as [id]/restart — an agent that
  // restarts ITSELF to pick up new config must come back on its own transcript,
  // not on a blank session that has forgotten why it restarted.
  const restartWorkdir = agent.workingDirectory || agent.sessions?.[0]?.workingDirectory
  const continueConversation =
    bin === 'claude' && !!restartWorkdir && (await hasPriorConversation(restartWorkdir))

  const command = buildRelaunchCommand(bin, enforced.args, personaName, { continueConversation })

  const outcome = await runRestartSequence(sessionName, command)

  if (outcome.status === 'timeout') {
    return NextResponse.json(
      {
        error: 'Timeout: program did not exit within 15s',
        hint: 'The session may be sitting on a confirmation dialog (e.g. background subagents still running). Check the terminal, or retry.',
      },
      { status: 504 }
    )
  }
  if (outcome.status === 'error') {
    console.error('[Sessions me/restart] tmux command failed:', { detail: outcome.detail })
    return NextResponse.json({ error: 'Session restart failed' }, { status: 500 })
  }
  return NextResponse.json({ success: true, sessionName, command: outcome.command })
}
