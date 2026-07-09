import { NextRequest, NextResponse } from 'next/server'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { authorize } from '@/lib/authorization'
import { isValidUuid } from '@/lib/validation'
import { cancelEntry, getEntry } from '@/lib/command-queue'

/**
 * DELETE /api/agents/[id]/queue/[entryId] — cancel one pending queued command.
 *
 * Stays NON-STRICT (no sudo token): cancelling injects nothing, so a human does
 * not re-enter a password to undo their own queue. But non-strict is a statement
 * about SUDO, never about AUTHORIZATION, and this route previously conflated the
 * two — it called `requireAuth` alone, which proves WHO the caller is and
 * nothing about what they may do.
 *
 * The consequence was a fleet-wide denial of governance. Enqueue is gated
 * (MANAGER anywhere, COS in-team, an agent on itself); cancel was gated by
 * nothing, and the sibling GET hands any caller the entry ids. So one valid
 * agent token could silently delete every command the MANAGER had queued across
 * every agent. A gate on the door is worthless when the wall has no authorization
 * at all — you cannot inject, but you can nullify, which is the same outcome.
 *
 * "Cancelling is a de-escalation" was the original reasoning, and it is true of
 * the ACTION and false of the AUTHORITY: it removes a pending command, and it
 * hands the canceller a veto over commands they could never have issued. Two
 * checks, because there are two different attacks:
 *
 *   1. CROSS-AGENT — the caller targets someone else's queue. Decided by the
 *      ordinary `send-command` matrix: MANAGER anywhere, COS within its team,
 *      system-owner always, every other agent 403.
 *   2. SELF-TARGET — the caller is the agent whose queue this is. `send-command`
 *      alone would allow it (self-drive is exempt per TRDD-D3RP7KQZ), so it is
 *      NOT sufficient here: driving your own terminal is permitted, refusing an
 *      order is not. An agent may retract only what it queued for itself.
 *      An entry with no `enqueuedBy` is treated as not-yours — fail closed.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }

  const { id, entryId } = await params
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
  }
  if (!entryId || entryId.length > 200) {
    return NextResponse.json({ error: 'Invalid entry ID format' }, { status: 400 })
  }

  const entry = getEntry(id, entryId)
  if (!entry) {
    return NextResponse.json({ error: 'Queue entry not found' }, { status: 404 })
  }

  if (auth.agentId && auth.agentId === id) {
    if (entry.enqueuedBy !== auth.agentId) {
      return NextResponse.json(
        { error: 'An agent may not cancel a command queued for it by another principal' },
        { status: 403 },
      )
    }
  } else {
    const authz = authorize(auth, 'send-command', id)
    if (!authz.allowed) {
      return NextResponse.json({ error: authz.reason || 'Forbidden' }, { status: 403 })
    }
  }

  const removed = cancelEntry(id, entryId)
  if (!removed) {
    return NextResponse.json({ error: 'Queue entry not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, entryId })
}
