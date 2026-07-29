/**
 * GET /api/oauth-rotator/status — which Claude accounts this host holds, and which need a human.
 *
 * TRDD-OX5TT5OT. The read half of the re-login flow: a "Re-login" button is useless without saying
 * WHICH account needs one, and until now nothing in the dashboard showed the rotator at all.
 *
 * NO SECRETS. It reads only `state.json`, the rotator's no-secret INDEX (emails, timestamps,
 * failure counters) — never a slot blob, so no keychain is touched and no token can be returned.
 * The `fp` fingerprint the index also carries is deliberately omitted: it identifies a token and
 * the UI has no use for it.
 *
 * MAESTRO-only, but deliberately NOT console-gated, unlike the two mutating routes. Seeing that an
 * account is dead is exactly what the owner needs from their phone — it is what tells them a trip
 * to the machine is required. Only the LOGIN itself is bound to physical presence.
 */
import { NextRequest, NextResponse } from 'next/server'

import { enforceMaestro } from '@/lib/route-auth'
import { expiresInH, loadState } from '@/lib/oauth-rotator/slots'
import { MAX_REFRESH_FAILURES } from '@/lib/oauth-rotator/tick'

/** Read one optional numeric extra off an index entry without asserting the open shape. */
function num(entry: Record<string, unknown>, key: string): number | null {
  const v = entry[key]
  return typeof v === 'number' ? v : null
}

export async function GET(request: NextRequest) {
  const denied = enforceMaestro(request)
  if (denied) return denied

  const state = loadState()
  const slots = (state.slots ?? {}) as unknown as Record<string, Record<string, unknown>>

  const accounts = Object.keys(slots)
    .sort()
    .map((email) => {
      const entry = slots[email] ?? {}
      const expiresAt = num(entry, 'expires_at')
      const refreshFailures = num(entry, 'refresh_failures') ?? 0
      return {
        email,
        isLive: state.live_email === email,
        expiresAt,
        // Reuse the blob helper rather than re-implementing its ms-vs-seconds heuristic: two
        // readings of `expiresAt` would eventually disagree, and the one on screen would be wrong.
        expiresInH: expiresAt === null ? null : expiresInH({ claudeAiOauth: { expiresAt } }),
        refreshFailures,
        /** True when only a human can repair it — the SAME threshold the tick applies. */
        refreshDead: refreshFailures >= MAX_REFRESH_FAILURES,
        capturedAt: typeof entry.captured_at === 'string' ? entry.captured_at : null,
        via: typeof entry.via === 'string' ? entry.via : null,
      }
    })

  return NextResponse.json({ liveEmail: state.live_email ?? null, accounts })
}
