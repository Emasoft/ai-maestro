/**
 * POST /api/oauth-rotator/reauth/start — begin a re-login for a dead account slot.
 *
 * TRDD-OX5TT5OT. A slot whose refresh token is dead can only be repaired by a human consenting
 * again; this mints the PKCE challenge and hands back the claude.ai consent URL to open.
 *
 * Returns the URL and an opaque `state` handle. The PKCE VERIFIER stays on the server — shipping
 * it to the browser would discard the entire point of PKCE — so the client cannot complete the
 * exchange itself even though it drives the consent step.
 *
 * Gated by {@link guardReauthRoute}: console + MAESTRO + sudo, all three.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { guardReauthRoute } from '@/lib/oauth-rotator/reauth-guard'
import { startReauth } from '@/lib/oauth-rotator/reauth-flow'

const BodySchema = z.object({
  /** Which account the owner MEANT to re-login. Display-only — the account actually filed is
   *  whoever the new token turns out to belong to, resolved at completion. */
  email: z.string().min(1).max(320).optional(),
})

export async function POST(request: NextRequest) {
  const denied = guardReauthRoute(request, '/api/oauth-rotator/reauth/start')
  if (denied) return denied

  let body: z.infer<typeof BodySchema> = {}
  try {
    const raw = await request.text()
    body = raw ? BodySchema.parse(JSON.parse(raw)) : {}
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  const { authorizeUrl, state } = startReauth({ emailHint: body.email ?? null })
  return NextResponse.json({ authorizeUrl, state })
}
