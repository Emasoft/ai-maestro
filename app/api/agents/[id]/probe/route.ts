import { NextRequest, NextResponse } from 'next/server'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { requireSudoToken } from '@/lib/sudo-guard'
import { isValidUuid } from '@/lib/validation'
import { getAgentProbe } from '@/services/block-state-service'

// GET /api/agents/[id]/probe — aggregate everything the server already knows about one
// agent (registry status, pane block-state, hook chat-state) into a single read, per
// TRDD-LT5N2JA4. Built on the `block-state` route's exact pattern (same sudo-guard-first
// ordering, same auth), and the SAME authorization action — `unblock-prompt` — because this
// route can surface the same pane text (`block.excerpt`) that block-state does, so a caller
// who may not read a peer's screen there must not be able to read it here either.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
  }

  // Ordering mirrors block-state: the sudo guard runs FIRST and authenticates itself,
  // so a forged cookie can never burn a token (SUDO-04).
  const sudoErr = requireSudoToken(request, 'GET', '/api/agents/[id]/probe')
  if (sudoErr) return sudoErr
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }

  const result = await getAgentProbe(id)
  if (result.error || !result.data) {
    return NextResponse.json({ error: result.error || 'Unknown error' }, { status: result.status || 500 })
  }
  return NextResponse.json(result.data)
}
