/**
 * /api/agents/foreign-approvals — list pending foreign-AID approvals (R35.2).
 *
 * GET — the MAESTRO's approval queue: agents/users from OTHER hosts whose AID is
 * waiting to be accepted on this host. Read-only, so it works even in ledger
 * read-only mode (checkWriteBlock passes GET).
 *
 * AUTH: the MAESTRO only (enforceMaestro — the R37 MAESTRO/system-owner gate).
 * Under the R36/R37 user-authority model this means the ACTIVE MAESTRO; with the
 * model OFF it is the legacy single-operator web session. An agent's Bearer/AID
 * can NEVER satisfy this gate (R32 / R35 — only the MAESTRO via the UI may
 * see/decide these), so a foreign agent can never list or self-approve its own
 * pending request.
 */

import { NextRequest, NextResponse } from 'next/server'
import { enforceMaestro } from '@/lib/route-auth'
import { listPendingForeignApprovals } from '@/lib/foreign-approval-registry'
import { internalError } from '@/lib/error-response'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const authErr = enforceMaestro(request)
  if (authErr) return authErr

  try {
    const pending = listPendingForeignApprovals()
    // Never leak the staged ZIP path to the client — it is an internal
    // server-side artifact. Project only the fields the UI needs.
    const safe = pending.map(e => ({
      id: e.id,
      fingerprint: e.fingerprint,
      kind: e.kind,
      sourceHostId: e.sourceHostId,
      displayName: e.displayName,
      status: e.status,
      requestedAt: e.requestedAt,
    }))
    return NextResponse.json({ pending: safe })
  } catch (error) {
    return internalError(error, 'foreign-approvals-list')
  }
}
