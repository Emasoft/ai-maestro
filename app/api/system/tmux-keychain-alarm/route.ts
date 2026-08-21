/**
 * GET /api/system/tmux-keychain-alarm — the fleet-wide tmux-server keychain alarm
 * (TRDD-GIA2LC83, UI half of TRDD-78J4I4QS).
 *
 * Read-only mirror of lib/tmux-server-keychain-watchdog.ts's in-memory alarm state.
 * No secrets — `active`/`since`/`message` only.
 */
import { NextRequest, NextResponse } from 'next/server'

import { enforceMaestro } from '@/lib/route-auth'
import { getTmuxServerKeychainAlarm } from '@/lib/tmux-server-keychain-watchdog'

export async function GET(request: NextRequest) {
  const denied = enforceMaestro(request)
  if (denied) return denied

  return NextResponse.json(getTmuxServerKeychainAlarm())
}
