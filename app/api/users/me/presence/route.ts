/**
 * GET /api/users/me/presence
 *
 * Returns the human user's last-input timestamp + the server's
 * current clock so the AMAMA plugin can compute idle age without
 * client-server clock skew bias.
 *
 * Spec: design/handoffs/aimaestro-server-presence-api.md (handoff
 * from the AMAMA design team, 2026-05-06).
 *
 * Response:
 *   {
 *     "last_user_input_epoch": number | null,
 *     "server_now_epoch":      number
 *   }
 *
 * `last_user_input_epoch` is null until the first
 * `POST /api/sessions/me/user-input` lands; AMAMA treats that as
 * "no recorded input yet, fall back to UI activity heuristics".
 *
 * Auth mirrors the POST half — session cookie or Bearer AID_AUTH.
 */

import { NextResponse } from 'next/server'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { getPresence, nowEpochSeconds } from '@/lib/user-presence'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }

  const presence = getPresence()
  return NextResponse.json({
    last_user_input_epoch: presence.last_user_input_epoch,
    server_now_epoch: nowEpochSeconds(),
  })
}
