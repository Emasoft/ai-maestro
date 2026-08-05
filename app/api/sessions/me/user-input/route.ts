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
import { getAgent } from '@/lib/agent-registry'
import { computeSessionName } from '@/types/agent'
import { injectedPrompts } from '@/services/shared-state'
import { recordUserInput, nowEpochSeconds } from '@/lib/user-presence'

/**
 * How long an unspent injection mark stays able to veto (ai-maestro#117). The echo arrives
 * within milliseconds — the hook fires as the prompt is submitted — so this is not a matching
 * window but a floor for a mark whose echo NEVER comes (agent killed between send and submit).
 * Deliberately short: every second here is a second in which a genuine keystroke could be
 * swallowed, and a missed veto merely restores the old behaviour while a wrong one blinds
 * recovery to a live user.
 */
const INJECTION_ECHO_MAX_AGE_MS = 30_000

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }

  // ai-maestro#117 — VETO AN ECHO OF OUR OWN INJECTION.
  //
  // This endpoint is called by the agent's `UserPromptSubmit` hook, which fires for EVERY
  // prompt. Injection is literal keystrokes (`sendKeys(…, {literal:true})`), so the hook
  // cannot tell an injected prompt from a typed one — and `fleet-recovery-runner` reads the
  // record this writes as "a human is at the keyboard, defer". So a queued task or a nudge
  // was silently reporting human presence and standing recovery down, with no attacker.
  //
  // The hook cannot fix this where it runs: it has no way to know. The SERVER knows, because
  // it did the injecting. So the veto lives here.
  //
  // CONSUME-ONCE, NOT A TIME WINDOW: one injection produces exactly one hook call, so the
  // mark is DELETED as it is spent. A window would keep vetoing genuine keystrokes that
  // happen to follow an injection. The MAX_AGE guard only discards a mark whose echo never
  // arrived (the send landed but the agent was killed before submitting), so a stale mark
  // cannot silently eat a real keystroke minutes later.
  //
  // DIRECTION IS THE WHOLE DESIGN: veto on POSITIVE evidence only. No mark ⇒ record presence
  // exactly as before. Never infer "not human" from a missing mark — that would make recovery
  // race a live user, which is the failure this gate exists to prevent.
  const agent = auth.agentId ? getAgent(auth.agentId) : null
  // Same resolution as the sibling me/restart route — one way to compute a session name.
  const primary = agent?.sessions?.find((s) => s.status === 'online') ?? agent?.sessions?.[0]
  const sessionName = agent ? computeSessionName(agent.name, primary?.index ?? 0) : undefined
  if (sessionName) {
    const injectedAt = injectedPrompts.get(sessionName)
    if (injectedAt !== undefined) {
      injectedPrompts.delete(sessionName)
      if (Date.now() - injectedAt <= INJECTION_ECHO_MAX_AGE_MS) {
        return NextResponse.json({ recorded: false, reason: 'injected_prompt' })
      }
    }
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
