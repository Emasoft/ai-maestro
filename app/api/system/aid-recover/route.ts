/**
 * /api/system/aid-recover — explicit R33 recovery (operations endpoint).
 *
 * POST — for a given `fingerprint` (or `agentId`, resolved to its
 * metadata.amp.fingerprint), rebuild the agent's auth state from the signed
 * ledger and repopulate the recovery cache. Reports the recovered
 * {agentId, title, team, fingerprint}.
 *
 * The AUTOMATIC R33 path already runs inside the token route's recovery fallback
 * (app/api/v1/auth/token) — this endpoint is the manual ops lever (surface it in
 * Settings → Diagnostics beside the ledger-health panel) for when an operator
 * wants to pre-warm / inspect a reconstruction.
 *
 * AUTH: the MAESTRO via UI (enforceMaestro — the R37 MAESTRO/system-owner gate)
 * + a fresh sudo token (classified strict). Recovery READS the ledger, so it works
 * even in read-only mode — but the sudo gate keeps it a deliberate operator action,
 * never an agent-reachable one (R32; the sudo-guard agent dual-path also fails
 * CLOSED for any strict route without a STRICT_AGENT_RULES entry).
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { enforceMaestro } from '@/lib/route-auth'
import { requireSudoToken } from '@/lib/sudo-guard'
import { reconstructAgentAuthState } from '@/lib/aid-ledger-authority'
import { getAgent } from '@/lib/agent-registry'
import { internalError } from '@/lib/error-response'

export const dynamic = 'force-dynamic'

const RecoverSchema = z.object({
  fingerprint: z.string().min(1).max(256).optional(),
  agentId: z.string().min(1).max(128).optional(),
}).strict().refine(d => !!d.fingerprint || !!d.agentId, {
  message: 'Provide fingerprint or agentId',
})

export async function POST(request: NextRequest) {
  const authErr = enforceMaestro(request)
  if (authErr) return authErr
  const sudoErr = requireSudoToken(request, 'POST', '/api/system/aid-recover')
  if (sudoErr) return sudoErr

  try {
    let raw: unknown
    try { raw = await request.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const parsed = RecoverSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json({ error: 'fingerprint or agentId required' }, { status: 400 })
    }

    // Resolve the fingerprint — directly, or via the agent's registry record.
    let fingerprint = parsed.data.fingerprint
    if (!fingerprint && parsed.data.agentId) {
      const agent = getAgent(parsed.data.agentId)
      fingerprint = (agent?.metadata?.amp as Record<string, unknown> | undefined)?.fingerprint as string | undefined
      if (!fingerprint) {
        return NextResponse.json(
          { error: 'agent_has_no_fingerprint', message: 'That agent has no metadata.amp.fingerprint to recover.' },
          { status: 404 },
        )
      }
    }

    const recovered = fingerprint ? reconstructAgentAuthState(fingerprint) : null
    if (!recovered) {
      return NextResponse.json(
        { error: 'aid_no_ledger_history', message: 'No signed-ledger association found for that AID; nothing to recover (R33/R34.1).' },
        { status: 404 },
      )
    }

    return NextResponse.json({
      ok: true,
      recovered: {
        agentId: recovered.agentId,
        governanceTitle: recovered.governanceTitle,
        teamId: recovered.teamId,
        fingerprint: recovered.fingerprint,
      },
    })
  } catch (error) {
    return internalError(error, 'aid-recover')
  }
}
