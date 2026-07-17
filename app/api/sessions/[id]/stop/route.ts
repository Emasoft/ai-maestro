/**
 * POST /api/sessions/[id]/stop
 *
 * Gracefully stop the AI program running inside a tmux session.
 *
 * Client-aware exit sequence (SCEN-013 fix, 2026-04-30):
 *
 * - **Claude Code**: Ctrl+C (clear partial input) then `/exit` as literal text.
 *   Chrome testing confirmed: Ctrl+D does NOT exit Claude Code — only /exit works.
 * - **Codex**: Ctrl+C twice — Codex CLI exits on a double Ctrl+C. `/exit` would
 *   be interpreted as a regular message inside Codex's interactive prompt.
 * - **Other clients (gemini, opencode, kiro)**: fall back to the Claude sequence
 *   for backward compatibility, since most CLIs accept Ctrl+C + something to
 *   confirm. Per-client refinement can land as those clients are exercised.
 *
 * The `-l` flag on tmux send-keys sends literal characters, avoiding key-name
 * interpretation that could corrupt the command.
 *
 * Fires the `SessionEnd` hook on exit.
 *
 * After this call, the tmux session remains alive (showing a shell prompt)
 * but the AI program is no longer running.
 *
 * **Response:** `{ success: true, sessionName }` on success, or HTTP 500 if
 * the tmux send-keys command fails (e.g. session not found).
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { authorize } from '@/lib/authorization'
import { requireSudoToken } from '@/lib/sudo-guard'
import { runStopSequence } from '@/lib/session-stop'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // #116: Stopping a live AI session is destructive (kills the running
  // assistant) — classified "strict" in security-registry.json.
  const sudoErr = requireSudoToken(request, 'POST', '/api/sessions/[id]/stop')
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
  const { getAgentBySession } = await import('@/lib/agent-registry')
  const targetAgent = getAgentBySession(sessionName)
  // TRDD-BF3JN4TL (R42): authorize UNCONDITIONALLY, even when the session name
  // resolves to no registry agent. The old `if (targetAgent)` guard SKIPPED the
  // check entirely on an unresolved name — so a session that had drifted out of
  // registry sync could be /exit-ed by any authenticated agent. That is a
  // fail-OPEN, and it is exactly the hole that would make R42 look enforced while
  // it was not: rename a session, bypass the rule.
  //
  // Passing `undefined` is the correct, safe input: authorize() grants the
  // system-owner before it ever looks at the target (so the dashboard is
  // unaffected), and its R42 check denies an AGENT whose target is not provably
  // itself — `undefined !== auth.agentId`. "We could not prove this is you" must
  // never read as "it is you".
  const authz = authorize(auth, 'send-command', targetAgent?.id)
  if (!authz.allowed) {
    return NextResponse.json({ error: authz.reason || 'Forbidden' }, { status: 403 })
  }

  // SCEN-013 fix: choose exit sequence based on the AI client. Claude Code uses
  // /exit; Codex uses double Ctrl+C; others fall back to Claude semantics.
  const program = (targetAgent?.program || 'claude').toLowerCase()

  // TRDD-O8NCNRWO: CC ≥2.1.198 runs subagents in the background by default, so
  // an idle-looking session may still have live subagents — /exit would then
  // land on Claude's abandon-confirmation dialog instead of exiting. Refuse
  // with a machine-readable 409 when the hook's counter PROVES live subagents
  // (a null/0 counter never blocks — it can be stale-low per plugin#17).
  // ?force=true preserves the old unconditional behavior.
  const force = request.nextUrl.searchParams.get('force') === 'true'
  const { readSubagentCount, evaluateExitGate } = await import('@/lib/session-safe-state')
  const workingDir = targetAgent?.workingDirectory || targetAgent?.sessions?.[0]?.workingDirectory
  const gate = evaluateExitGate(readSubagentCount(workingDir), force)
  if (gate.blocked) {
    return NextResponse.json(
      {
        error: 'subagents_running',
        message: `Refusing to stop: ${gate.subagentCount} background subagent(s) still running. Retry with ?force=true to stop anyway.`,
        subagentCount: gate.subagentCount,
      },
      { status: 409 }
    )
  }

  // Delegate the client-aware exit (codex double-C-c vs claude /exit) to the
  // shared lib so the FULL and HEADLESS serving modes cannot drift again
  // (TRDD-OPNDCKVA). runStopSequence uses execFileSync (no shell) and never throws.
  const outcome = await runStopSequence(sessionName, program)
  if (outcome.status === 'error') {
    // API-MIN-03: raw exec text leaks socket paths / absolute layout. Log the
    // detail server-side and return a generic message to the client.
    console.error('[Sessions stop] tmux command failed:', { detail: outcome.detail })
    return NextResponse.json({ error: 'Session stop failed' }, { status: 500 })
  }
  return NextResponse.json({ success: true, sessionName, program })
}
