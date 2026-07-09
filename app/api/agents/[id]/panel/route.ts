import { NextRequest, NextResponse } from 'next/server'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { requireSudoToken } from '@/lib/sudo-guard'
import { requireAuth } from '@/lib/route-auth'
import { isValidUuid } from '@/lib/validation'
import { getAgentById } from '@/services/agents-core-service'
import { broadcastPanelMessage, panelClients, panelFeedback } from '@/services/shared-state'
import { isPanelAction, buildPanelMessage, PANEL_ACTIONS } from '@/lib/panel-messages'

/**
 * POST /api/agents/[id]/panel — drive the agent's dashboard HTML side panel
 * (TRDD-229CJGYH). Body: {action: 'open'|'close'|'refresh'|'set', html?, url?}.
 *
 * Classified "strict" in security-registry.json: this injects plugin-supplied
 * HTML into the human's dashboard (rendered in a sandboxed iframe) and remotely
 * flips what the dashboard shows — the same trust level as injecting into a
 * terminal. USER callers need a fresh sudo token; AGENT callers authorize by
 * AID + title (requireSudoToken R32 dual-path). Ordering mirrors ensure-core.
 *
 * Response carries `delivered` — how many connected panel channels received the
 * message. 0 means no dashboard currently has this agent active (the message is
 * NOT queued; the panel is a live surface, unlike the command queue).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
  }

  const sudoErr = requireSudoToken(request, 'POST', '/api/agents/[id]/panel')
  if (sudoErr) return sudoErr
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }

  const agentRes = getAgentById(id)
  if (agentRes.error || !agentRes.data) {
    return NextResponse.json(
      { error: agentRes.error || 'Agent not found' },
      { status: agentRes.status || 404 },
    )
  }

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!isPanelAction(body.action)) {
    return NextResponse.json(
      { error: `Invalid action. Allowed: ${PANEL_ACTIONS.join(', ')}` },
      { status: 400 },
    )
  }

  const built = buildPanelMessage(body.action, body.html, body.url)
  if (!built.ok) {
    return NextResponse.json({ error: built.error }, { status: 400 })
  }

  const delivered = broadcastPanelMessage(id, built.message)
  return NextResponse.json({ ok: true, action: body.action, delivered })
}

/**
 * GET /api/agents/[id]/panel — panel channel status for scripts: how many
 * dashboard clients are connected and how many feedback events await drain.
 * Read-only ⇒ non-strict.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireAuth(request)
  if (!auth.ok) return auth.error

  const { id } = await params
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
  }

  return NextResponse.json({
    connectedClients: panelClients.get(id)?.size ?? 0,
    pendingFeedback: panelFeedback.get(id)?.length ?? 0,
  })
}
