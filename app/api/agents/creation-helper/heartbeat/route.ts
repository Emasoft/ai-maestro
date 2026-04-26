/**
 * Heartbeat endpoint for Haephestos session watchdog.
 *
 * The agent-creation page sends a POST every 30s to keep the session alive.
 * If no heartbeat is received for 2 minutes, the watchdog kills the session
 * to prevent zombie sessions from consuming tokens indefinitely.
 */

import { NextRequest, NextResponse } from 'next/server'
import { enforceAuth } from '@/lib/route-auth'
import { heartbeatCreationHelper } from '@/services/creation-helper-service'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  // #114: Authenticate before any side effect.
  const authErr = enforceAuth(request)
  if (authErr) return authErr

  try {
    await heartbeatCreationHelper()
  } catch (error) {
    console.error('[heartbeat] heartbeatCreationHelper failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Heartbeat failed' },
      { status: 500 },
    )
  }
  return NextResponse.json({ ok: true })
}
