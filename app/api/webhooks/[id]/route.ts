import { NextRequest, NextResponse } from 'next/server'
import { getWebhookById, deleteWebhookById } from '@/services/webhooks-service'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { isValidUuid } from '@/lib/validation'

/**
 * GET /api/webhooks/[id]
 * Get a specific webhook subscription
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  // Validate webhook ID format to prevent invalid lookups (MF-004)
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'Invalid webhook ID format' }, { status: 400 })
  }
  const result = getWebhookById(id)

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.data)
}

/**
 * DELETE /api/webhooks/[id]
 * Unsubscribe / delete a webhook
 * Requires authentication to prevent unauthorized deletion (MF-003)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  // Validate webhook ID format (MF-004)
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'Invalid webhook ID format' }, { status: 400 })
  }
  // Authenticate -- webhook deletion is a mutating operation
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status ?? 401 })
  }

  // Ownership check: pass the authenticated agent ID so the service layer
  // can verify the caller created this webhook (system-owner may delete any).
  const result = deleteWebhookById(id, auth.agentId)

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.data)
}
