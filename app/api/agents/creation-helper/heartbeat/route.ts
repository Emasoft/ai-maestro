/**
 * Heartbeat endpoint for Haephestos session watchdog.
 *
 * The agent-creation page sends a POST every 30s to keep the session alive.
 * If no heartbeat is received for 2 minutes, the watchdog kills the session
 * to prevent zombie sessions from consuming tokens indefinitely.
 */

import { NextRequest, NextResponse } from 'next/server'
import { enforceSystemOwner } from '@/lib/route-auth'
import { heartbeatCreationHelper } from '@/services/creation-helper-service'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  // #114: Authenticate before any side effect.
  // TRDD-DQVPODKW: SYSTEM-OWNER only. This is a wizard-only surface — the Haephestos creation
  // wizard is a human dashboard flow, and a per-route caller census (2026-09-04) found this route
  // called from `components/` and NOT by the persona, whose shipped instructions
  // (agents/haephestos-creation-helper.md) curl only element-descriptions and publish-plugin.
  // Authenticating and stopping there let any agent of any title drive the owner's wizard — wipe
  // its working directory, kill its session, reset its banner, browse its filesystem.
  // A browser cookie session resolves to the system owner, so the UI is unaffected.
  const authErr = enforceSystemOwner(request)
  if (authErr) return authErr

  try {
    await heartbeatCreationHelper()
  } catch (error) {
    // API2-MIN-01: log full error server-side, return generic message to client
    console.error('[heartbeat] heartbeatCreationHelper failed:', error)
    return NextResponse.json(
      { error: 'internal_error', code: 'creation-helper-heartbeat' },
      { status: 500 },
    )
  }
  return NextResponse.json({ ok: true })
}
