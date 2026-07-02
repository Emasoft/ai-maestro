/**
 * /api/agents/foreign-approvals/[id]/reject — reject a pending foreign-AID
 * approval (R35.2). Discards everything: the foreign AID is NOT accepted and the
 * staged import payload is deleted.
 *
 * AUTH: the MAESTRO via UI (enforceMaestro — the R37 MAESTRO/system-owner gate)
 * + a fresh sudo token (classified strict in security-registry.json). Same R32
 * reasoning as approve — an agent can never reach this gate (the sudo-guard agent
 * dual-path fails CLOSED for any strict route without a STRICT_AGENT_RULES entry),
 * so a foreign agent cannot decide its own request.
 */

import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import { enforceMaestro } from '@/lib/route-auth'
import { requireSudoToken } from '@/lib/sudo-guard'
import { getForeignApproval, updateForeignApproval } from '@/lib/foreign-approval-registry'
import { internalError } from '@/lib/error-response'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authErr = enforceMaestro(request)
  if (authErr) return authErr
  const sudoErr = requireSudoToken(request, 'POST', '/api/agents/foreign-approvals/[id]/reject')
  if (sudoErr) return sudoErr

  try {
    const { id } = await params
    const entry = getForeignApproval(id)
    if (!entry) {
      return NextResponse.json({ error: 'Foreign approval not found' }, { status: 404 })
    }
    if (entry.status !== 'pending') {
      return NextResponse.json(
        { error: `Foreign approval already ${entry.status}` },
        { status: 409 },
      )
    }

    // Discard the staged import payload — nothing about the foreign agent is kept.
    if (entry.importPayloadPath) {
      try { fs.unlinkSync(entry.importPayloadPath) } catch { /* best-effort */ }
    }

    updateForeignApproval(id, {
      status: 'rejected',
      decidedAt: new Date().toISOString(),
      decidedBy: 'system-owner',
      importPayloadPath: undefined,
    })

    return NextResponse.json({ ok: true, approvalId: id, status: 'rejected' })
  } catch (error) {
    return internalError(error, 'foreign-approvals-reject')
  }
}
