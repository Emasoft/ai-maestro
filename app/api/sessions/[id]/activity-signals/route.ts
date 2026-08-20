/**
 * GET /api/sessions/[id]/activity-signals   (TRDD-ZLBBD4E3)
 *
 * Read-only derived activity signals for a NON-self pane — the fleet guardian /
 * injection-gate consumer. Returns booleans and epochs ONLY (in_turn, hook_status,
 * hook_updated_at_epoch, last_user_input_epoch, transcript_last_write_epoch) — never
 * pane content and never transcript text, which is what makes a non-self read safe
 * where R42 keeps `state --pane` self-only. That no-content property is normative;
 * see lib/session-activity-signals.ts.
 *
 * Auth required (cookie or Bearer); NOT strict — a read of derived signals mutates
 * nothing. The session-name regex prevents argv/path injection.
 */
import { NextResponse } from 'next/server'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { sessionActivitySignals } from '@/lib/session-activity-signals'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }
  const { id: sessionName } = await params
  if (!/^[a-zA-Z0-9_@.-]+$/.test(sessionName)) {
    return NextResponse.json({ error: 'Invalid session name' }, { status: 400 })
  }
  try {
    const signals = await sessionActivitySignals(sessionName)
    if (!signals) {
      return NextResponse.json({ error: 'No registered agent for that session' }, { status: 404 })
    }
    return NextResponse.json(signals)
  } catch (error) {
    console.error('GET /api/sessions/[id]/activity-signals failed:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
