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

export const dynamic = 'force-dynamic'

/**
 * Execute a command with args array (no shell) to prevent injection.
 * CC-GOV-001: Never pass user-derived values through shell interpolation.
 */
function execCommandArgs(bin: string, args: string[]): string {
  const { execFileSync } = require('child_process')
  return (execFileSync(bin, args, { timeout: 5000, encoding: 'utf8' }) as string).trim()
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Query tmux for the process currently running in the session's pane. */
function getPaneCommand(sessionName: string): string | null {
  try {
    return execCommandArgs('tmux', ['display-message', '-p', '-t', sessionName, '#{pane_current_command}']) || null
  } catch {
    return null
  }
}

/** Shell process names that indicate the AI program has exited and the pane
 *  is back at a shell prompt (ready to accept a new launch command). */
const SHELL_COMMANDS = new Set(['zsh', 'bash', 'sh', 'fish', '-zsh', '-bash'])

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

  if (agent) {
    const authz = authorize(auth, 'restart-session', agent.id)
    if (!authz.allowed) {
      return NextResponse.json({ error: authz.reason || 'Forbidden' }, { status: 403 })
    }
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

  const program = body.program || agent?.program || 'claude'
  const programArgs = body.programArgs || agent?.programArgs || ''

  // CC-GOV-002: Reject programArgs containing shell metacharacters that could escape
  // the single-quoted tmux send-keys argument. Only allow safe CLI flags/values.
  // Allowed: alphanumeric, spaces, hyphens, underscores, dots, slashes, equals,
  //          colons, commas, at-signs, double-quotes, tildes
  if (programArgs && !/^[a-zA-Z0-9 \-_./=:,@"~]+$/.test(programArgs)) {
    return NextResponse.json({ error: 'Invalid programArgs: contains disallowed characters' }, { status: 400 })
  }

  // Resolve display program name (e.g. "Claude Code") to the actual CLI binary name
  const resolveBin = (p: string): string => {
    const lower = p.toLowerCase()
    if (lower.includes('claude')) return 'claude'
    if (lower.includes('codex')) return 'codex'
    if (lower.includes('aider')) return 'aider'
    if (lower.includes('gemini')) return 'gemini'
    // CC-GOV-002: Warn when falling back to default — may indicate unexpected input
    console.warn(`[Sessions Restart] resolveBin: unrecognized program "${p}", falling back to "claude"`)
    return 'claude'
  }

  try {
    // Step 1: Ctrl+C clears partial input, /exit as literal text exits Claude Code
    // Note: Ctrl+D does NOT exit Claude Code. Only /exit works.
    // CC-GOV-001: Use execCommandArgs (no shell) for all tmux interactions
    execCommandArgs('tmux', ['send-keys', '-t', sessionName, 'C-c'])
    execCommandArgs('tmux', ['send-keys', '-t', sessionName, '-l', '/exit'])
    execCommandArgs('tmux', ['send-keys', '-t', sessionName, 'Enter'])

    // Step 2: Poll tmux pane command every 500ms until it becomes a shell
    // (meaning the AI program exited and the shell prompt is back)
    const maxWait = 15000  // 15 second timeout
    const pollInterval = 500
    let elapsed = 0
    let exited = false

    while (elapsed < maxWait) {
      await sleep(pollInterval)
      elapsed += pollInterval
      const paneCmd = getPaneCommand(sessionName)
      // If pane command is null (session gone) or a shell, the program exited
      if (!paneCmd || SHELL_COMMANDS.has(paneCmd)) {
        exited = true
        break
      }
    }

    if (!exited) {
      return NextResponse.json({ error: 'Timeout: program did not exit within 15s' }, { status: 504 })
    }

    // Step 3: Brief pause for shell readiness (rc files, prompt rendering)
    await sleep(1000)

    // Step 4: Build and send the relaunch command into the tmux pane
    const bin = resolveBin(program)
    // Ensure --name <persona> is always present in the args
    const personaName = agent?.label || agent?.name || sessionName
    let finalArgs = programArgs
    if (!finalArgs.includes('--name ')) {
      // Insert --name before any -- divider (raw prompt passthrough), or at the end
      const dividerIdx = finalArgs.indexOf(' -- ')
      if (dividerIdx !== -1) {
        finalArgs = finalArgs.slice(0, dividerIdx) + ` --name "${personaName}"` + finalArgs.slice(dividerIdx)
      } else {
        finalArgs = `${finalArgs} --name "${personaName}"`.trim()
      }
    }
    const cmd = `${bin} ${finalArgs}`.trim()
    // CC-GOV-001: Use execCommandArgs (no shell) — tmux send-keys with -l sends
    // the command as literal text, then a separate Enter key press launches it.
    execCommandArgs('tmux', ['send-keys', '-t', sessionName, '-l', cmd])
    execCommandArgs('tmux', ['send-keys', '-t', sessionName, 'Enter'])

    return NextResponse.json({ success: true, sessionName, command: cmd })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
