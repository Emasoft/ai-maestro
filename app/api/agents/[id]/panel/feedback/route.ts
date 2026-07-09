import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/route-auth'
import { isValidUuid } from '@/lib/validation'
import { drainPanelFeedback } from '@/services/shared-state'

/**
 * GET /api/agents/[id]/panel/feedback — drain (read-and-clear) the queued
 * panel:feedback events the dashboard bounced back from pushed panel HTML
 * (TRDD-229CJGYH). FIFO order; each event is {payload, receivedAt}.
 *
 * Non-strict: this reads back interaction events the human user generated for
 * the polling plugin — a de-escalation-free read, gated by standard auth. The
 * drain is destructive by design (the plugin is the single consumer); a second
 * caller simply sees an empty list.
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

  const events = drainPanelFeedback(id)
  return NextResponse.json({ count: events.length, events })
}
