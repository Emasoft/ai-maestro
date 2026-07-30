/**
 * POST /api/sessions/[id]/restart
 *
 * Orchestrates a full graceful restart of a Claude Code (or other AI program)
 * session running inside tmux. The restart is a 4-step sequence:
 *
 *   Step 1: Send `/exit` to the tmux pane — Claude interprets this as a
 *           clean shutdown request and exits gracefully.
 *   Step 2: Poll the tmux pane's current command every 500ms for up to 15s.
 *           When the pane command becomes a shell (zsh, bash, etc.), the AI
 *           program has exited and the shell prompt is visible.
 *   Step 3: Wait 1s for the shell to fully initialize (prompt rendering,
 *           rc file sourcing, etc.).
 *   Step 4: Send the relaunch command (e.g. `claude --agent my-plugin-main-agent`)
 *           to restart the AI program with the same arguments.
 *
 * **Callers:** The profile panel's Restart button, and the useRestartQueue hook
 * (which defers the call until the agent reaches idle_prompt safe state).
 *
 * **Timeout:** Returns HTTP 504 if the program doesn't exit within 15 seconds.
 *
 * **Request body (optional):**
 *   - `program`: display name of the AI program (resolved to CLI binary)
 *   - `programArgs`: CLI arguments to pass on relaunch
 *
 * Falls back to the agent registry's stored program/programArgs, then to 'claude'.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAgentBySession } from '@/lib/agent-registry'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { authorize } from '@/lib/authorization'
import { requireSudoToken } from '@/lib/sudo-guard'
import { runRestartSequence } from '@/lib/session-restart'
import { prepareRelaunchCommand } from '@/lib/session-relaunch'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // #116: Restart tears down + relaunches the AI process — classified
  // "strict" in security-registry.json.
  const sudoErr = requireSudoToken(request, 'POST', '/api/sessions/[id]/restart')
  if (sudoErr) return sudoErr

  const { id: sessionName } = await params

  // CC-GOV-001: Validate session name to prevent shell injection via tmux send-keys
  if (!/^[a-zA-Z0-9_@.-]+$/.test(sessionName)) {
    return NextResponse.json({ error: 'Invalid session name' }, { status: 400 })
  }

  // Auth + RBAC
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }

  // Look up the agent's stored program and args from the registry
  const agent = getAgentBySession(sessionName)

  // TRDD-BF3JN4TL (R42): authorize UNCONDITIONALLY — see the identical note in
  // the /stop route. The old `if (agent)` guard skipped RBAC whenever the session
  // name resolved to no registry agent (a fail-OPEN). `undefined` is the correct
  // input: the system-owner is granted before the target is consulted, and an
  // AGENT is denied unless the target is provably itself.
  const authz = authorize(auth, 'restart-session', agent?.id)
  if (!authz.allowed) {
    return NextResponse.json({ error: authz.reason || 'Forbidden' }, { status: 403 })
  }

  // Manager gate: team agents cannot restart without a MANAGER on the host
  if (agent) {
    const { getManagerId } = await import('@/lib/governance')
    const { isAgentInAnyTeam } = await import('@/lib/team-registry')
    if (!getManagerId() && isAgentInAnyTeam(agent.id)) {
      return NextResponse.json(
        { error: 'Cannot restart team agent: no MANAGER exists on this host. Assign a MANAGER first.' },
        { status: 403 }
      )
    }
  }

  let body: { program?: string; programArgs?: string } = {}
  try { body = await request.json() } catch { /* optional body */ }

  // CC-GOV-002: Validate body.program and body.programArgs are strings to prevent
  // type confusion attacks (e.g. sending an object/array that coerces in shell context)
  if (body.program !== undefined && typeof body.program !== 'string') {
    return NextResponse.json({ error: 'Invalid program: must be a string' }, { status: 400 })
  }
  if (body.programArgs !== undefined && typeof body.programArgs !== 'string') {
    return NextResponse.json({ error: 'Invalid programArgs: must be a string' }, { status: 400 })
  }

  // TRDD-O8NCNRWO: same subagent gate as the stop route — CC ≥2.1.198 background
  // subagents make an idle prompt unsafe; a PROVEN positive counter refuses with
  // 409 (null/0 never blocks — stale-low per plugin#17); ?force=true overrides.
  const force = request.nextUrl.searchParams.get('force') === 'true'
  const { readSubagentCount, evaluateExitGate } = await import('@/lib/session-safe-state')
  const agentWorkingDir = agent?.workingDirectory || agent?.sessions?.[0]?.workingDirectory
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

  const program = body.program || agent?.program || 'claude'
  const programArgs = body.programArgs || agent?.programArgs || ''

  // Validate + build through the ONE shared composition (lib/session-relaunch.ts):
  // programArgs allowlist (CC-GOV-002), `--agent <persona>` enforcement
  // (TRDD-GZ1KOHNR), bin resolution, persona-name allowlist, and `--continue`
  // (TRDD-6AMXSG3S). It was inline here until TRDD-QZL828OD added a SECOND
  // restarter (the R42.7 fleet driver) — two clones of a security-validated build
  // is how the two silently drift, so the build moved out and this route now maps
  // its refusals to HTTP instead of re-deriving them. Every refusal still happens
  // BEFORE anything is stopped, so a running agent is never disrupted by one.
  const prep = await prepareRelaunchCommand(agent, sessionName, { program, programArgs })
  if (prep.kind === 'invalid-args') {
    return NextResponse.json({ error: 'Invalid programArgs: contains disallowed characters' }, { status: 400 })
  }
  if (prep.kind === 'persona-unresolved') {
    return NextResponse.json(
      { error: 'agent_persona_unresolved', message: `Refusing to restart "${sessionName}": ${prep.reason}` },
      { status: 409 },
    )
  }

  const outcome = await runRestartSequence(sessionName, prep.command)

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
    // API-MIN-03: log the detail server-side; return a generic message (exec
    // errors leak socket paths / absolute layout).
    console.error('[Sessions restart] tmux command failed:', { detail: outcome.detail })
    return NextResponse.json({ error: 'Session restart failed' }, { status: 500 })
  }
  return NextResponse.json({ success: true, sessionName, command: outcome.command })
}
