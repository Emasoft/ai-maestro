import { NextRequest, NextResponse } from 'next/server'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { internalError } from '@/lib/error-response'
import { generateNow } from '@/lib/janitor-status-archive'

export const dynamic = 'force-dynamic'

/**
 * POST /api/janitor/reports/generate — the Refresh button.
 *
 * Runs the janitor's own generator with its browser-open call suppressed, archives the document it
 * produces, and returns the new entry. No window ever opens: the USER's directive is that this
 * appears in an iframe, never a popup.
 *
 * ── WHY THIS IS NOT CLASSIFIED `strict` ────────────────────────────────────────────────────────
 *
 * It is a POST that spawns a subprocess, so `strict` (a fresh sudo token per call) is the reflex.
 * Two reasons it would be the wrong call, and they are worth stating because the next reader will
 * reach for it too:
 *
 *   1. Sudo tokens are ONE-SHOT. A Refresh button behind sudo means a governance-password prompt
 *      on every single refresh — which does not make the operation safer, it makes people stop
 *      refreshing and read a stale document instead. That is a net loss of exactly the freshness
 *      this feature exists to provide.
 *   2. It is not a mutation of governed state. It READS host state and writes one archive file.
 *      The strict settings entries (`PATCH /api/settings/auto-update`, `POST .../run`) all change
 *      what the machine DOES; this changes only what we have recorded about it.
 *
 * The real risk is resource consumption — a host-wide process scan taking tens of seconds — and
 * that is bounded where it belongs, by the in-flight guard inside `generateNow` itself. A held-down
 * Refresh button gets one scan and a string, not N concurrent scans.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = authenticateFromRequest(request)
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
    }

    const result = await generateNow()
    if (!result.ok) {
      // 409 rather than 500 for the in-flight case: nothing failed, the caller is simply early.
      const busy = result.reason === 'a generation is already running'
      return NextResponse.json({ error: result.reason }, { status: busy ? 409 : 502 })
    }
    return NextResponse.json({ entry: result.entry }, { status: 200 })
  } catch (error) {
    return internalError(error, 'Janitor report generate')
  }
}
