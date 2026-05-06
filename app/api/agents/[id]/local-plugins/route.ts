/**
 * Local Plugin Toggle API
 *
 * POST /api/agents/[id]/local-plugins — Toggle a local plugin's enabled state
 *
 * Uses ChangePlugin() for desired-state reconciliation.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/route-auth'
import { ChangePlugin } from '@/services/element-management-service'
import { isValidUuid } from '@/lib/validation'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // #114: Authenticate before any side effect.
  const auth = requireAuth(req)
  if (!auth.ok) return auth.error

  try {
    const { id: agentId } = await params
    // SF-009: Validate UUID format for agent ID (defense-in-depth)
    if (!isValidUuid(agentId)) {
      return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
    }
    const body = await req.json()
    const { key, enabled } = body as { key?: string; enabled?: boolean }

    if (!key || typeof key !== 'string') {
      return NextResponse.json({ error: 'key is required (plugin key in name@marketplace format)' }, { status: 400 })
    }
    if (typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 })
    }

    // Parse plugin key into name and marketplace
    const atIdx = key.lastIndexOf('@')
    if (atIdx <= 0) {
      return NextResponse.json({ error: 'Invalid plugin key format — expected name@marketplace' }, { status: 400 })
    }
    const pluginName = key.substring(0, atIdx)
    const marketplace = key.substring(atIdx + 1)

    const result = await ChangePlugin(agentId, {
      name: pluginName,
      marketplace,
      action: enabled ? 'enable' : 'disable',
      scope: 'local',
    }, auth.context)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    // Forward restartNeeded so the UI can re-queue the agent's session
    // for restart. ChangePlugin always sets it true for state mutations,
    // but we propagate the actual value rather than hard-coding it —
    // future pipeline gates (e.g. no-op idempotent paths) may flip it
    // false and we want the UI to honour that.
    return NextResponse.json({ success: true, key, enabled, restartNeeded: result.restartNeeded })
  } catch (error) {
    console.error('[local-plugins] POST failed:', error)
    return NextResponse.json({ error: 'Failed to toggle plugin' }, { status: 500 })
  }
}
