import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/route-auth'
import { isValidUuid } from '@/lib/validation'
import { cancelEntry } from '@/lib/command-queue'

/**
 * DELETE /api/agents/[id]/queue/[entryId] — cancel one pending queued command.
 *
 * Non-strict (requireAuth only): cancelling is a DE-escalation — it REMOVES a
 * pending action rather than injecting one — so it needs no sudo token (the
 * strict gate guards the POST that CREATES the injection). Any authenticated
 * caller may cancel a queued entry.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const auth = requireAuth(request)
  if (!auth.ok) return auth.error

  const { id, entryId } = await params
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
  }
  if (!entryId || entryId.length > 200) {
    return NextResponse.json({ error: 'Invalid entry ID format' }, { status: 400 })
  }

  const removed = cancelEntry(id, entryId)
  if (!removed) {
    return NextResponse.json({ error: 'Queue entry not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, entryId })
}
