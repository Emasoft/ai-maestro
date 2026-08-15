/**
 * /api/agents/foreign-approvals/[id]/approve — approve a foreign agent's AID
 * (R34.2 / R35.2). THE one place a sudo password is required for this flow
 * (R32-compliant: USER/UI only — agents never face a sudo gate).
 *
 * Guards, in order:
 *   1. enforceMaestro — the R37 MAESTRO/system-owner gate (web session). An
 *      agent's Bearer/AID can never satisfy this (R32 / R35.2), so a foreign
 *      agent cannot self-approve. The agent dual-path in sudo-guard ALSO fails
 *      CLOSED (403) for any strict route that has no STRICT_AGENT_RULES entry,
 *      so an agent is denied here either way.
 *   2. requireSudoToken   — a fresh sudo token (R34.2 "requires a sudo password
 *      from the USER (via UI)"). Classified strict in security-registry.json.
 *
 * The approval itself — materialize the staged export, re-issue a fresh native
 * AID, bind it, flip the approval entry, record the ledger ops — is the R51
 * transaction in services/foreign-approval-service.ts (TRDD-LMAZO2ET): five
 * independent stores, so it runs under runGateSequence with per-gate undos
 * instead of the hand-rolled sequence this route used to carry. Any mid-flight
 * failure unwinds every store, so a retry can never mint a duplicate agent.
 */

import { NextRequest, NextResponse } from 'next/server'
import { enforceMaestro } from '@/lib/route-auth'
import { requireSudoToken } from '@/lib/sudo-guard'
import { approveForeignAgent } from '@/services/foreign-approval-service'
import { internalError } from '@/lib/error-response'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authErr = enforceMaestro(request)
  if (authErr) return authErr
  const sudoErr = requireSudoToken(request, 'POST', '/api/agents/foreign-approvals/[id]/approve')
  if (sudoErr) return sudoErr

  try {
    const { id } = await params
    const result = await approveForeignAgent(id)
    if (result.error || !result.data) {
      return NextResponse.json({ error: result.error ?? 'approval failed' }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    return internalError(error, 'foreign-approvals-approve')
  }
}
