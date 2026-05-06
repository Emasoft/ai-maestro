/**
 * POST /api/sessions/me/user-input
 *
 * Records the human user's last-input timestamp on the user record.
 * Called from `UserPromptSubmit` hooks installed in AI Maestro-managed
 * Claude Code sessions so the AMAMA plugin can compute idle time on
 * approval-request decisions.
 *
 * Spec: design/handoffs/aimaestro-server-presence-api.md (handoff
 * from the AMAMA design team, 2026-05-06).
 *
 * AI Maestro is single-tenant per host (one human user owns the
 * dashboard), so the spec's `users[<owner-of-session>]` collection
 * collapses to a single global record. The route persists the
 * timestamp atomically (tmp + rename + cross-process lock — same
 * hardening pattern as `services/element-management-service.ts`).
 *
 * Auth: any session-cookie holder OR Bearer AID_AUTH carrier — i.e.
 * the same callers the rest of the API serves. The structural
 * middleware credential gate already blocks anonymous calls.
 */

import { NextResponse } from 'next/server'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { recordUserInput, nowEpochSeconds } from '@/lib/user-presence'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }

  const recordedAtEpoch = nowEpochSeconds()
  try {
    const persisted = await recordUserInput(recordedAtEpoch)
    // The persisted value may be HIGHER than `recordedAtEpoch` if a
    // concurrent writer landed a later timestamp first (the helper
    // keeps the maximum). Return the persisted value so the caller
    // sees the actual stored state.
    return NextResponse.json({ recorded_at_epoch: persisted })
  } catch (err) {
    console.error('[user-presence] recordUserInput failed:', err)
    return NextResponse.json(
      { error: 'persistence_failed', message: 'Could not record user-input timestamp.' },
      { status: 500 },
    )
  }
}
