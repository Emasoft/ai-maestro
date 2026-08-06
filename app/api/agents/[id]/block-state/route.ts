import { NextRequest, NextResponse } from 'next/server'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { requireSudoToken } from '@/lib/sudo-guard'
import { isValidUuid } from '@/lib/validation'
import { getBlockState } from '@/services/block-state-service'

// GET /api/agents/[id]/block-state — is this agent BLOCKED, and why.
//
// The read half of the unattended-fleet premise: a supervisor can only keep a team running
// without a human if it can see that an agent is stuck and understand what it is asking.
// Until this route existed there was NO path to that at all — `capturePane` lived in
// `lib/agent-runtime.ts` with zero API callers, so a plugin could write into a pane and
// never read one (TRDD-89LVZSQ0).
//
// Returns { blocked, reason, field{visible,empty,text}, choices[], excerpt[], hookDisagreed,
// sessionName } and, with `?match=<regex>`, a `matches[]` of pane lines.
//
// AUTH — strict, mapped to `unblock-prompt`, i.e. the SAME action that gates
// `POST …/prompt/answer` next door. That is the whole reasoning: this route and that one are
// the two halves of ONE capability (see why it is blocked → answer it), so they get ONE
// authorization story. R42.8's matrix already says exactly what the USER's directive says —
// MANAGER any, COS own-team, never an ASSISTANT, self always — and giving the read half a
// weaker policy would leave an agent that may NOT answer a stalled peer still able to read
// its screen. A pane can hold anything the agent was shown, so that is not a small residue.
//
// Deliberately NOT the `GET …/prompt` precedent (non-strict). That route serves the
// STRUCTURED pending prompt the hook captured; this one serves terminal TEXT, which is
// unbounded content rather than one modelled field.
//
// `?match=` is gated a second time, inside the service, on the agent actually being blocked.
// That is defence in depth, not the primary gate: an arbitrary regex over a pane is an
// ORACLE, and the reason to run one is to learn why work stopped. If work has not stopped,
// there is nothing to search — the capability's own justification, made mechanical.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
  }

  // Ordering mirrors `panel`/`ensure-core`: the sudo guard runs FIRST and itself
  // authenticates before touching a token, so a forged cookie cannot burn one (SUDO-04).
  const sudoErr = requireSudoToken(request, 'GET', '/api/agents/[id]/block-state')
  if (sudoErr) return sudoErr
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }

  const match = request.nextUrl.searchParams.get('match')
  const result = await getBlockState(id, match !== null ? { match } : {})

  if (result.error || !result.data) {
    return NextResponse.json({ error: result.error || 'Unknown error' }, { status: result.status || 500 })
  }
  return NextResponse.json(result.data)
}
