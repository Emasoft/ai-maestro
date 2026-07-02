/**
 * Manual "Run now" trigger for the auto-update scheduler.
 *
 * POST /api/settings/auto-update/run
 *
 * Triggers a single tick out-of-band, mirroring exactly what the scheduler
 * does on its interval. Used by:
 *   - The "Run now" button on the Plugin Updates settings page so the user
 *     can confirm their checkbox configuration produces the expected
 *     updates without waiting for the next interval.
 *   - The smoke-test scenarios.
 *
 * Sudo-gated: a manual run can mutate plugin state across every agent
 * EXACTLY the same way the scheduled tick does, so it carries the same
 * trust requirement.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/route-auth'
import { requireSudoToken } from '@/lib/sudo-guard'
import { runTickNow } from '@/services/auto-update-service'
import { loadSettings } from '@/lib/auto-update-settings'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const sudoErr = requireSudoToken(req, 'POST', '/api/settings/auto-update/run')
  if (sudoErr) return sudoErr

  const auth = requireAuth(req)
  if (!auth.ok) return auth.error

  try {
    // Run a tick. runTickNow() is idempotent — if the scheduler is already
    // ticking, this returns immediately with ran=false so the UI can
    // surface "another run already in progress, try again in a moment".
    const result = await runTickNow()
    // Re-read settings after the tick so the caller gets the updated
    // lastRunAt / lastRunSummary in the same response, no second GET.
    const after = await loadSettings()
    return NextResponse.json({
      ran: result.ran,
      entries: result.entries,
      settings: after,
    })
  } catch (err) {
    console.error('[auto-update/run] failed:', err)
    return NextResponse.json({ error: 'Failed to trigger auto-update tick' }, { status: 500 })
  }
}
