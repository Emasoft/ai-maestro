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
import {
  isValidProgramArgs,
  resolveRestartBin,
  sanitizePersonaName,
  buildRelaunchCommand,
  runRestartSequence,
} from '@/lib/session-restart'
import { resolveLaunchArgs } from '@/services/agent-launch-args'

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

  // CC-GOV-002: reject programArgs with shell metacharacters that could escape
  // the `--name "…"` quoting the receiving shell parses. The allowlist is the
  // single definition in lib/session-restart.ts, shared with me/restart, so the
  // two surfaces cannot validate differently.
  if (!isValidProgramArgs(programArgs)) {
    return NextResponse.json({ error: 'Invalid programArgs: contains disallowed characters' }, { status: 400 })
  }

  // TRDD-GZ1KOHNR: enforce `--agent <persona>` on relaunch too — a restart must
  // not resurrect a titled Claude agent as generic claude. resolveLaunchArgs
  // derives it from the installed role-plugin; refuse (before any stop, so a
  // running agent is never disrupted) if a Claude agent has no resolvable persona.
  const enforced = await resolveLaunchArgs(agent?.id, program, programArgs)
  if (enforced.kind === 'refuse') {
    return NextResponse.json(
      { error: 'agent_persona_unresolved', message: `Refusing to restart "${sessionName}": ${enforced.reason}` },
      { status: 409 },
    )
  }

  // Build the relaunch command through the shared, security-validated construction
  // (bin resolution + persona-name allowlist + --name injection), then run the
  // mechanical stop→poll→relaunch sequence. Both live in lib/session-restart.ts.
  const bin = resolveRestartBin(program)
  const personaName = sanitizePersonaName(agent?.label || agent?.name || sessionName, sessionName)
  const command = buildRelaunchCommand(bin, enforced.args, personaName)

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
    // API-MIN-03: log the detail server-side; return a generic message (exec
    // errors leak socket paths / absolute layout).
    console.error('[Sessions restart] tmux command failed:', { detail: outcome.detail })
    return NextResponse.json({ error: 'Session restart failed' }, { status: 500 })
  }
  return NextResponse.json({ success: true, sessionName, command: outcome.command })
}
