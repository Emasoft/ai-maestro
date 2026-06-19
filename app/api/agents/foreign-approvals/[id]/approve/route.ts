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
 * On approval:
 *   1. Materialize the staged foreign export via the NATIVE import path
 *      (importAgent(..., {newId:true}, {bypassForeignApproval:true})).
 *   2. Re-issue a FRESH native AID — generate a new Ed25519 keypair, overwrite
 *      the imported (foreign) keys, discard the foreign one (R34.2 impersonation
 *      defense). The foreign fingerprint never gets an aid_associate on this host.
 *   3. Bind the NEW fingerprint via markAgentAsAMPRegistered (sets
 *      metadata.amp.fingerprint — the field token/route.ts reads — and auto-emits
 *      aid_associate for the new fp).
 *   4. Emit aid_reissue {old→new} and aid_approve_foreign (R35.2) — recorded in
 *      the signed ledger, which thereafter validates the new AID.
 *   5. Mark the approval entry approved; delete the staged ZIP.
 */

import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import { enforceMaestro } from '@/lib/route-auth'
import { requireSudoToken } from '@/lib/sudo-guard'
import { getForeignApproval, updateForeignApproval } from '@/lib/foreign-approval-registry'
import { importAgent } from '@/services/agents-transfer-service'
import { generateKeyPair, saveKeyPair } from '@/lib/amp-keys'
import { markAgentAsAMPRegistered } from '@/lib/agent-registry'
import { recordAidReissue, recordForeignApproval } from '@/lib/aid-ledger-authority'
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
    if (entry.kind !== 'agent') {
      // User approvals are handled by the user-registry approval flow (R36/R40),
      // not this agent-materialization route.
      return NextResponse.json(
        { error: 'This route approves foreign AGENTS only; foreign users are approved via the user flow.' },
        { status: 400 },
      )
    }
    if (!entry.importPayloadPath || !fs.existsSync(entry.importPayloadPath)) {
      return NextResponse.json(
        { error: 'Staged import payload missing or already consumed' },
        { status: 410 },
      )
    }

    // 1. Materialize on the native code path (bypass the foreign gate — we ARE
    //    the approval). newId:true so the local agent gets a fresh id.
    const zipBuffer = fs.readFileSync(entry.importPayloadPath)
    const importResult = await importAgent(zipBuffer, { newId: true }, { bypassForeignApproval: true })
    if (importResult.error || !importResult.data?.success || !importResult.data.agent) {
      return NextResponse.json(
        { error: importResult.error || 'Foreign agent import failed', details: importResult.data?.errors },
        { status: importResult.status || 500 },
      )
    }
    const newAgent = importResult.data.agent
    const newAgentId = newAgent.id

    // 2. Re-issue a FRESH native AID — overwrite the imported foreign keys.
    const freshKeyPair = await generateKeyPair()
    saveKeyPair(newAgentId, freshKeyPair)
    const newFingerprint = freshKeyPair.fingerprint

    // 3. Bind the NEW fingerprint into the registry (metadata.amp.fingerprint —
    //    the field the token route reads). markAgentAsAMPRegistered auto-emits an
    //    aid_associate for newFingerprint (R34.2 "recorded counts as verification").
    await markAgentAsAMPRegistered(newAgentId, {
      address: `${newAgent.name}@default.aimaestro.local`,
      tenant: 'default',
      fingerprint: newFingerprint,
      registeredAt: new Date().toISOString(),
    })

    // 4. Emit the reissue + foreign-approval ledger ops. recordAidReissue also
    //    re-associates the new fp (deduped) and invalidates the old fp's cache,
    //    so the foreign fingerprint can never be served as backed.
    recordAidReissue(newAgentId, entry.fingerprint, newFingerprint, entry.sourceHostId, 'user')
    recordForeignApproval(newFingerprint, 'agent', entry.sourceHostId, 'system-owner', 'user')

    // 5. Mark approved + delete the staged ZIP.
    try { fs.unlinkSync(entry.importPayloadPath) } catch { /* best-effort */ }
    updateForeignApproval(id, {
      status: 'approved',
      decidedAt: new Date().toISOString(),
      decidedBy: 'system-owner',
      newAgentId,
      newFingerprint,
      importPayloadPath: undefined,
    })

    return NextResponse.json({
      ok: true,
      approvalId: id,
      newAgentId,
      newFingerprint,
      warnings: importResult.data.warnings,
    })
  } catch (error) {
    return internalError(error, 'foreign-approvals-approve')
  }
}
