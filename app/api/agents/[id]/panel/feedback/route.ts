import { NextRequest, NextResponse } from 'next/server'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { authorize } from '@/lib/authorization'
import { isValidUuid } from '@/lib/validation'
import { drainPanelFeedback } from '@/services/shared-state'

/**
 * GET /api/agents/[id]/panel/feedback — drain (read-and-clear) the queued
 * panel:feedback events the dashboard bounced back from pushed panel HTML
 * (TRDD-229CJGYH). FIFO order; each event is {payload, receivedAt}.
 *
 * Non-strict: this reads back interaction events the human user generated for
 * the polling plugin. The drain is destructive by design (the plugin is the
 * single consumer); a second caller simply sees an empty list — which is why
 * only the agent itself (or the owner) may drain: `send-command`, as `/panel`.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }

  const { id } = await params
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
  }

  // TRDD-91TLL7DW: the drain DELETES what it returns, and it took the agent from the path with
  // only authentication behind it — so any agent could empty (steal) another agent's feedback
  // queue. The POST that fills that queue (`/panel`) is the `send-command` action with the path
  // id as target, which R42 makes self-only for agents; draining the same panel's replies is the
  // same capability, so it carries the same action: the agent itself or the owner, nobody else.
  const authz = authorize(auth, 'send-command', id)
  if (!authz.allowed) {
    return NextResponse.json({ error: authz.reason || 'Forbidden' }, { status: 403 })
  }

  const events = drainPanelFeedback(id)
  return NextResponse.json({ count: events.length, events })
}
