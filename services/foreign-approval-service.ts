/**
 * Foreign-approval service (R34.2 / R35.2) — the APPROVE side, as an R51
 * transaction (TRDD-LMAZO2ET).
 *
 * The approve flow mutates FIVE independent stores: the agent registry
 * (importAgent), the on-disk AMP keypair, the registry AMP binding
 * (markAgentAsAMPRegistered), the foreign-approval registry, and the signed
 * AID ledger. The route used to run them as a hand-rolled sequence with one
 * outer catch, so a throw at any middle step left a registered+keyed agent
 * behind while the approval stayed `pending` — and the retry click ran
 * importAgent({newId:true}) AGAIN, minting a duplicate agent with the first
 * orphan left permanently. This module wraps the whole sequence in
 * runGateSequence so any failure unwinds every store to the pre-call state.
 *
 * Gate order is chosen for the CRASH window too (a crash runs no rollback):
 * the approval entry flips to `approved` BEFORE the final ledger appends, so
 * a crash after the flip leaves a live agent + an `approved` entry — the
 * retry is then refused by the pending-check instead of minting a duplicate.
 * The only thing a crash there can lose is the two audit appends.
 *
 * Ledger gates and the append-only contract: a signed append-only ledger
 * cannot have rows removed, but the LIVE effect of an aid_associate/aid_reissue
 * is honestly reversible by appending an aid_revoke — reconstruction and the
 * R34.1 gate honor "a later aid_revoke beats an earlier aid_associate"
 * (lib/aid-ledger-authority.ts). The aid_approve_foreign row of an aborted
 * attempt remains as audit HISTORY of that attempt, which is exactly what an
 * audit ledger is for; it gates nothing live.
 *
 * COMPENSATIONS GO THROUGH THE MODULE PRIMITIVES (the `*Ns` namespaces), never
 * through the injected `deps`: a deps override exists to model ONE failing
 * forward collaborator, and a rollback held hostage by the same injected
 * failure would test nothing. In production deps === the namespaces anyway.
 */

import fs from 'fs'
import path from 'path'
import * as transferNs from '@/services/agents-transfer-service'
import * as ampKeysNs from '@/lib/amp-keys'
import * as registryNs from '@/lib/agent-registry'
import * as aidLedgerNs from '@/lib/aid-ledger-authority'
import * as foreignRegNs from '@/lib/foreign-approval-registry'
import { runGateSequence, type Gate } from '@/lib/gate-transaction'
import { withLock } from '@/lib/file-lock'
import { getStateDir } from '@/lib/ecosystem-constants'
import type { KeyPair } from '@/lib/amp-keys'
import type { Agent } from '@/types/agent'
import type { ForeignApprovalEntry } from '@/types/foreign-approval'
import type { ServiceResult } from '@/types/service'

/**
 * The injectable forward collaborators — one per mutating gate, so a test can
 * drive a seeded failure at each gate and assert the stores rolled back.
 * Everything not listed here always resolves to the real module.
 */
export interface ApproveForeignAgentDeps {
  importAgent: typeof transferNs.importAgent
  saveKeyPair: typeof ampKeysNs.saveKeyPair
  markAgentAsAMPRegistered: typeof registryNs.markAgentAsAMPRegistered
  updateForeignApproval: typeof foreignRegNs.updateForeignApproval
  recordAidReissue: typeof aidLedgerNs.recordAidReissue
  recordForeignApproval: typeof aidLedgerNs.recordForeignApproval
}

export interface ApproveForeignAgentSuccess {
  ok: true
  approvalId: string
  newAgentId: string
  newFingerprint: string
  warnings?: string[]
}

interface ApproveCtx {
  approvalId: string
  entry: ForeignApprovalEntry
  deps: ApproveForeignAgentDeps
  // G01 — materialize
  registryIdsBefore?: Set<string>
  messageDirsExistedBefore?: Record<'inbox' | 'sent' | 'archived', boolean>
  newAgent?: Agent
  newAgentId?: string
  importWarnings?: string[]
  // G02 — keypair reissue
  priorKeyPair?: KeyPair | null
  freshKeyPair?: KeyPair
  newFingerprint?: string
  // G03 — registry bind
  rowBeforeBind?: Agent | null
  // G04 — approval flip
  approvalBefore?: ForeignApprovalEntry
  // shared by the ledger compensations — the revoke is emitted at most once
  revokeEmitted?: boolean
}

const agentsDataDir = () => path.join(getStateDir(), 'agents')
const messagesDir = () => path.join(getStateDir(), 'messages')
const MESSAGE_FOLDERS = ['inbox', 'sent', 'archived'] as const

/** Append the compensating aid_revoke for the fresh fingerprint, at most once
 * per pipeline run — G03's bind and G05's reissue both associate the same
 * fingerprint, so their undos share one revocation. */
function revokeFreshFingerprintOnce(ctx: ApproveCtx): void {
  if (ctx.revokeEmitted || !ctx.newAgentId || !ctx.newFingerprint) return
  aidLedgerNs.recordAidRevocation(
    ctx.newAgentId,
    ctx.newFingerprint,
    'foreign-approval approve aborted — rollback',
    'system',
  )
  ctx.revokeEmitted = true
}

function buildGates(): Gate<ApproveCtx>[] {
  return [
    {
      id: 'G01',
      what: 'materialize the staged export via the native import path',
      run: async (ctx) => {
        // Snapshot FIRST, so the undo can diff even when run dies mid-way.
        ctx.registryIdsBefore = new Set(registryNs.loadAgents().map((a) => a.id))
        const existed = {} as Record<'inbox' | 'sent' | 'archived', boolean>
        for (const folder of MESSAGE_FOLDERS) {
          existed[folder] = fs.existsSync(path.join(messagesDir(), folder, ctx.entry.displayName))
        }
        ctx.messageDirsExistedBefore = existed

        const zipBuffer = fs.readFileSync(ctx.entry.importPayloadPath!)
        const importResult = await ctx.deps.importAgent(
          zipBuffer,
          { newId: true },
          { bypassForeignApproval: true },
        )
        if (importResult.error || !importResult.data?.success || !importResult.data.agent) {
          throw new Error(
            importResult.error ||
              importResult.data?.errors?.join('; ') ||
              'Foreign agent import failed',
          )
        }
        ctx.newAgent = importResult.data.agent
        ctx.newAgentId = importResult.data.agent.id
        ctx.importWarnings = importResult.data.warnings
      },
      // Un-import. importAgent's own catch cleans only its temp dir, so a
      // partial import can leave a registry row + data dirs behind — the undo
      // therefore sweeps by DIFF (rows that appeared since the snapshot AND
      // carry the staged export's name), not by a remembered id, so it removes
      // exactly the imported agent whether run completed, half-completed, or
      // never reached the registry write. The name match is what makes a
      // concurrently-created unrelated agent invisible to the sweep.
      undo: async (ctx) => {
        if (!ctx.registryIdsBefore) return
        let removedIds: string[] = []
        await withLock('agents', () => {
          const agents = registryNs.loadAgents()
          const suspects = agents.filter(
            (a) => !ctx.registryIdsBefore!.has(a.id) && a.name === ctx.entry.displayName,
          )
          removedIds = suspects.map((s) => s.id)
          if (removedIds.length) {
            registryNs.saveAgents(agents.filter((a) => !removedIds.includes(a.id)))
          }
        })
        for (const rid of removedIds) {
          const dataDir = path.join(agentsDataDir(), rid)
          if (fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true })
        }
        for (const folder of MESSAGE_FOLDERS) {
          if (ctx.messageDirsExistedBefore?.[folder]) continue
          const dest = path.join(messagesDir(), folder, ctx.entry.displayName)
          if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true })
        }
      },
    },
    {
      id: 'G02',
      what: 'overwrite the imported foreign keys with a fresh native keypair',
      run: async (ctx) => {
        ctx.priorKeyPair = ampKeysNs.loadKeyPair(ctx.newAgentId!)
        ctx.freshKeyPair = await ampKeysNs.generateKeyPair()
        ctx.deps.saveKeyPair(ctx.newAgentId!, ctx.freshKeyPair)
        ctx.newFingerprint = ctx.freshKeyPair.fingerprint
      },
      // Restoring the prior (foreign) pair repairs every partial state
      // saveKeyPair can leave (private renamed, public failed); with no prior
      // pair the honest reverse is removing the key dir outright.
      undo: async (ctx) => {
        if (!ctx.newAgentId) return
        if (ctx.priorKeyPair) ampKeysNs.saveKeyPair(ctx.newAgentId, ctx.priorKeyPair)
        else ampKeysNs.deleteKeyPair(ctx.newAgentId)
      },
    },
    {
      id: 'G03',
      what: 'bind the fresh fingerprint into the registry (markAgentAsAMPRegistered)',
      run: async (ctx) => {
        const row = registryNs.loadAgents().find((a) => a.id === ctx.newAgentId)
        ctx.rowBeforeBind = row ? structuredClone(row) : null
        const updated = await ctx.deps.markAgentAsAMPRegistered(ctx.newAgentId!, {
          address: `${ctx.newAgent!.name}@default.aimaestro.local`,
          tenant: 'default',
          fingerprint: ctx.newFingerprint!,
          registeredAt: new Date().toISOString(),
        })
        if (!updated) {
          throw new Error('markAgentAsAMPRegistered wrote no registry row (agent not found)')
        }
      },
      // markAgentAsAMPRegistered also fire-and-forgets an aid_associate for the
      // fresh fingerprint, so the undo both restores the registry row snapshot
      // AND appends the compensating aid_revoke (see the module header).
      undo: async (ctx) => {
        if (ctx.newAgentId && ctx.rowBeforeBind) {
          await withLock('agents', () => {
            const agents = registryNs.loadAgents()
            const idx = agents.findIndex((a) => a.id === ctx.newAgentId)
            if (idx >= 0) {
              agents[idx] = ctx.rowBeforeBind!
              registryNs.saveAgents(agents)
            }
          })
        }
        revokeFreshFingerprintOnce(ctx)
      },
    },
    {
      id: 'G04',
      what: 'flip the foreign-approval entry to approved',
      // Deliberately BEFORE the final ledger appends: once this lands, a retry
      // is refused by the pending-check, so even the no-rollback crash window
      // after it cannot mint a duplicate agent.
      run: async (ctx) => {
        ctx.approvalBefore = structuredClone(ctx.entry)
        const updated = ctx.deps.updateForeignApproval(ctx.approvalId, {
          status: 'approved',
          decidedAt: new Date().toISOString(),
          decidedBy: 'system-owner',
          newAgentId: ctx.newAgentId,
          newFingerprint: ctx.newFingerprint,
          importPayloadPath: undefined,
        })
        if (!updated) {
          throw new Error('updateForeignApproval wrote nothing — approval entry vanished mid-flight')
        }
      },
      undo: async (ctx) => {
        const b = ctx.approvalBefore
        if (!b) return
        foreignRegNs.updateForeignApproval(ctx.approvalId, {
          status: b.status,
          decidedAt: b.decidedAt,
          decidedBy: b.decidedBy,
          newAgentId: b.newAgentId,
          newFingerprint: b.newFingerprint,
          importPayloadPath: b.importPayloadPath,
        })
      },
    },
    {
      id: 'G05',
      what: 'record aid_reissue + aid_approve_foreign in the signed ledger',
      run: async (ctx) => {
        ctx.deps.recordAidReissue(
          ctx.newAgentId!,
          ctx.entry.fingerprint,
          ctx.newFingerprint!,
          ctx.entry.sourceHostId,
          'user',
        )
        ctx.deps.recordForeignApproval(
          ctx.newFingerprint!,
          'agent',
          ctx.entry.sourceHostId,
          'system-owner',
          'user',
        )
      },
      // The appends cannot be removed; the live effect (the fresh fingerprint
      // being ledger-backed) is reversed by the compensating aid_revoke. The
      // aid_approve_foreign row of the aborted attempt stays as audit history.
      undo: async (ctx) => {
        revokeFreshFingerprintOnce(ctx)
      },
    },
  ]
}

/** R51.7 success-path invariants — every store agrees before we claim success. */
async function approveInvariants(ctx: ApproveCtx): Promise<string[]> {
  const violations: string[] = []
  const row = registryNs.loadAgents().find((a) => a.id === ctx.newAgentId)
  if (!row) {
    violations.push(`registry has no row for the imported agent ${ctx.newAgentId}`)
  } else {
    const boundFp = (row.metadata?.amp as { fingerprint?: string } | undefined)?.fingerprint
    if (boundFp !== ctx.newFingerprint) {
      violations.push(
        `registry metadata.amp.fingerprint is "${boundFp}" — not the fresh fingerprint`,
      )
    }
    if (row.ampRegistered !== true) violations.push('registry row is not marked ampRegistered')
  }
  const kp = ampKeysNs.loadKeyPair(ctx.newAgentId!)
  if (!kp || kp.fingerprint !== ctx.newFingerprint) {
    violations.push('on-disk keypair does not carry the fresh fingerprint')
  }
  const after = foreignRegNs.getForeignApproval(ctx.approvalId)
  if (after?.status !== 'approved') {
    violations.push(`foreign-approval entry status is "${after?.status}" — expected approved`)
  }
  return violations
}

/**
 * Approve a pending foreign-agent AID (R34.2 / R35.2) — the whole five-store
 * sequence under runGateSequence. Validation refusals return their HTTP-ish
 * status; a gate failure returns 500 with the runner's exact R51 message
 * (which names the failed gate, and any unrevertable residue).
 *
 * The staged ZIP is unlinked only AFTER the pipeline (and its invariants)
 * succeeded — a file deletion has no honest undo, so it may not sit where a
 * later failure could need it back. Best-effort, exactly like the old route.
 */
export async function approveForeignAgent(
  id: string,
  depOverrides: Partial<ApproveForeignAgentDeps> = {},
): Promise<ServiceResult<ApproveForeignAgentSuccess>> {
  const entry = foreignRegNs.getForeignApproval(id)
  if (!entry) return { error: 'Foreign approval not found', status: 404 }
  if (entry.status !== 'pending') {
    return { error: `Foreign approval already ${entry.status}`, status: 409 }
  }
  if (entry.kind !== 'agent') {
    return {
      error:
        'This route approves foreign AGENTS only; foreign users are approved via the user flow.',
      status: 400,
    }
  }
  if (!entry.importPayloadPath || !fs.existsSync(entry.importPayloadPath)) {
    return { error: 'Staged import payload missing or already consumed', status: 410 }
  }

  const deps: ApproveForeignAgentDeps = {
    importAgent: transferNs.importAgent,
    saveKeyPair: ampKeysNs.saveKeyPair,
    markAgentAsAMPRegistered: registryNs.markAgentAsAMPRegistered,
    updateForeignApproval: foreignRegNs.updateForeignApproval,
    recordAidReissue: aidLedgerNs.recordAidReissue,
    recordForeignApproval: aidLedgerNs.recordForeignApproval,
    ...depOverrides,
  }

  const ctx: ApproveCtx = { approvalId: id, entry, deps }
  const result = await runGateSequence(buildGates(), ctx, { invariants: approveInvariants })

  if (!result.ok) {
    console.error('[foreign-approval] approve failed:', result.message, result.ops)
    return { error: result.message, status: 500 }
  }

  // Consume the staged ZIP (its path was already cleared from the entry by G04;
  // the pre-flip snapshot still carries it).
  const stagedPath = ctx.approvalBefore?.importPayloadPath ?? entry.importPayloadPath
  try {
    if (stagedPath) fs.unlinkSync(stagedPath)
  } catch {
    /* best-effort — a lingering tmp ZIP is harmless; the entry no longer points at it */
  }

  return {
    data: {
      ok: true,
      approvalId: id,
      newAgentId: ctx.newAgentId!,
      newFingerprint: ctx.newFingerprint!,
      warnings: ctx.importWarnings,
    },
    status: 200,
  }
}
