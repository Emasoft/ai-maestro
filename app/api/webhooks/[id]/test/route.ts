import { NextRequest, NextResponse } from 'next/server'
import { testWebhookById } from '@/services/webhooks-service'
import { enforceSystemOwner } from '@/lib/route-auth'

/**
 * POST /api/webhooks/[id]/test
 * Send a test webhook to verify connectivity
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  // Webhook mutations are system-owner only — agents can't trigger
  // outbound HTTP to arbitrary URLs on behalf of the host.
  const authErr = enforceSystemOwner(request)
  if (authErr) return authErr

  const { id } = params
  const result = await testWebhookById(id)

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.data)
}
