/**
 * POST /api/oauth-rotator/reauth/complete — finish a re-login with the pasted code.
 *
 * TRDD-OX5TT5OT. Anthropic's callback page DISPLAYS `<code>#<state>`; the owner copies it here.
 * This exchanges it for a fresh token pair and files it as a SLOT under the account the token
 * actually belongs to, which lifts the dead-token retry ban on the next rotator beat.
 *
 * The pasted code NEVER passes through a model: browser → this form field → the exchange. It is
 * not logged, not echoed in a response, and single-use at the endpoint anyway.
 *
 * Writes a SLOT, never the live credential — the live `Claude Code-credentials` is owned by Claude
 * Code and writing it here would race its single-use rotating grant.
 *
 * Gated by {@link guardReauthRoute}: console + MAESTRO + sudo, all three.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { guardReauthRoute } from '@/lib/oauth-rotator/reauth-guard'
import { completeReauth, type ReauthFailure } from '@/lib/oauth-rotator/reauth-flow'

const BodySchema = z.object({
  state: z.string().min(1).max(200),
  /** The whole string off the callback page — normally `code#state`. */
  code: z.string().min(1).max(4096),
})

/** Each refusal gets the status that tells a client what to DO, not just that it failed. */
const STATUS_FOR: Record<ReauthFailure, number> = {
  unknown_state: 400,
  expired_state: 410, // Gone — the flow timed out; start a new one.
  replayed_state: 409, // Conflict — already used.
  state_mismatch: 400,
  empty_code: 400,
  exchange_failed: 502, // Upstream refused or was unreachable.
  account_unresolved: 502,
  slot_locked: 503, // A rotation tick held the lock; nothing was written — retry.
}

export async function POST(request: NextRequest) {
  const denied = guardReauthRoute(request, '/api/oauth-rotator/reauth/complete')
  if (denied) return denied

  let body: z.infer<typeof BodySchema>
  try {
    body = BodySchema.parse(await request.json())
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  const result = await completeReauth(body.state, body.code)
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason, status: result.status },
      { status: STATUS_FOR[result.reason] },
    )
  }
  return NextResponse.json({
    ok: true,
    email: result.email,
    hasRefreshToken: result.hasRefreshToken,
    expiresInH: result.expiresInH,
  })
}
