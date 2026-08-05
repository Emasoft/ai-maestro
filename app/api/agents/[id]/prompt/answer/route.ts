import { NextRequest, NextResponse } from 'next/server'
import { authenticateFromRequest, buildAuthContext } from '@/lib/agent-auth'
import { requireSudoToken } from '@/lib/sudo-guard'
import { isValidUuid } from '@/lib/validation'
import { getAgentById, sendAgentSessionCommand } from '@/services/agents-core-service'
import { readPendingPrompt } from '@/services/sessions-service'

/**
 * POST /api/agents/[id]/prompt/answer — answer a pending permission/question
 * prompt by {optionKey} OR {text}.
 *
 * Classified "strict" in security-registry.json: this injects a keystroke into a
 * live agent terminal, so a USER caller needs a fresh sudo token and an AGENT
 * caller authorizes by AID + title — both handled by requireSudoToken's R32
 * dual-path (then sendAgentSessionCommand's own authorize() gate is the final
 * check). Ordering mirrors the strict-POST sibling app/api/agents/[id]/ensure-core:
 * sudo FIRST, then authenticateFromRequest → buildAuthContext.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
  }

  // Path template MUST be the real request-path template this handler serves —
  // op-binding of the sudo token depends on it (see the SCEN-016 note in
  // app/api/agents/[id]/route.ts).
  const sudoErr = requireSudoToken(request, 'POST', '/api/agents/[id]/prompt/answer')
  if (sudoErr) return sudoErr

  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const hasOptionKey = typeof body.optionKey === 'string' && body.optionKey.length > 0
  const hasText = typeof body.text === 'string' && body.text.length > 0
  // XOR: exactly one of the two answer forms. Both-or-neither is a client error —
  // an empty text and an option key at once is ambiguous about what to send.
  if (hasOptionKey === hasText) {
    return NextResponse.json(
      { error: 'Provide exactly one of {optionKey} or {text}' },
      { status: 400 },
    )
  }

  let command: string
  if (hasOptionKey) {
    // Resolve the option key against the ACTUAL pending prompt so a stale or
    // wrong key is rejected (400) instead of blindly typing a digit into the
    // pane. Requires the agent's workingDirectory to read the chat-state file.
    const result = getAgentById(id)
    if (result.error || !result.data) {
      return NextResponse.json(
        { error: result.error || 'Agent not found' },
        { status: result.status || 404 },
      )
    }
    const workingDirectory = result.data.agent.workingDirectory
    const prompt = workingDirectory ? readPendingPrompt(workingDirectory) : null
    if (!prompt) {
      return NextResponse.json(
        { error: 'No prompt is currently pending for this agent' },
        { status: 409 },
      )
    }
    const match = prompt.options.find((o) => o.key === body.optionKey)
    if (!match) {
      const keys = prompt.options.map((o) => o.key).join(', ')
      return NextResponse.json(
        { error: `Unknown optionKey. Pending options: ${keys || '(none)'}` },
        { status: 400 },
      )
    }
    // The option key IS the keystroke the terminal menu expects (the hook models
    // options as {key:'1'|'2'|…}); sending it (+Enter) selects that choice.
    command = match.key
  } else {
    command = body.text
  }

  // requireIdle:false — a pending prompt is a WAITING state, which the activity
  // ladder may or may not count as "idle"; gating on idleness would 409 exactly
  // when the answer is needed, so we inject unconditionally. sendAgentSessionCommand
  // still enforces its own authorize() gate and confirms the tmux session exists.
  // authAction 'unblock-prompt' — R42.8, NOT 'send-command'. R42 revokes
  // cross-agent send-command and that stays revoked; this route is the one
  // narrow verb the USER ruling (2026-08-05) carved out, so it authorizes as
  // itself and gets the title scoping (MANAGER any / COS own-team / never an
  // ASSISTANT) plus the service's blocked-only precondition. Answering your OWN
  // prompt is self-drive and is unaffected.
  const send = await sendAgentSessionCommand(
    id,
    { command, requireIdle: false, addNewline: true, authAction: 'unblock-prompt' },
    buildAuthContext(auth),
  )
  if (send.error) {
    return NextResponse.json({ error: send.error }, { status: send.status || 500 })
  }
  return NextResponse.json(send.data)
}
