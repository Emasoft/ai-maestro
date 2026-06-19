/**
 * /api/governance/maestro-delegate — MAESTRO-DELEGATE handoff (R37.2 / R37.3).
 *
 * POST   — the MAESTRO assigns the MAESTRO-DELEGATE title to one human user.
 *          Only ONE delegate may exist at a time (R37.2); while it exists the
 *          original MAESTRO is SUSPENDED and all its privileges pass to the
 *          delegate (getActiveMaestroUserId resolves to the delegate).
 * DELETE  — the MAESTRO recalls the delegate, restoring itself (R37.3).
 *
 * AUTH: MAESTRO-only (enforceMaestro) + a fresh sudo token (strict route).
 *
 * R37.4 SAFEGUARD: a MAESTRO-DELEGATE has NO power over the MAESTRO/MAESTRO-
 * DELEGATE titles — so the active delegate may NOT assign another delegate nor
 * recall itself. Both operations require the request to come from the ORIGINAL
 * MAESTRO (userTitle === 'maestro'), not the acting delegate.
 *
 * This route is meaningful ONLY when the user-authority model is enabled. With
 * the model OFF there is no user identity, enforceMaestro behaves as the legacy
 * system-owner gate, and there is no delegate concept — the handlers return a
 * clear "model disabled" error rather than mutating anything.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { enforceMaestro } from '@/lib/route-auth'
import { requireSudoToken } from '@/lib/sudo-guard'
import { authenticateFromRequest, buildAuthContext } from '@/lib/agent-auth'
import { withLock } from '@/lib/file-lock'
import { isUserAuthorityModelEnabled, loadGovernance, saveGovernance } from '@/lib/governance'
import { loadUsers, getUser, saveUser, getMaestroDelegateUserId } from '@/lib/user-registry'
import { internalError } from '@/lib/error-response'

export const dynamic = 'force-dynamic'

const AssignSchema = z.object({
  targetUserId: z.string().min(1).max(128),
}).strict()

/** Refuse early when the user-authority model is off (no delegate concept). */
function modelGuard(): NextResponse | null {
  if (!isUserAuthorityModelEnabled()) {
    return NextResponse.json(
      {
        error: 'user_authority_model_disabled',
        message: 'The MAESTRO-DELEGATE handoff requires the user-authority model to be enabled.',
      },
      { status: 409 },
    )
  }
  return null
}

/**
 * Resolve the caller's user title from the request. enforceMaestro already
 * confirmed the caller is the ACTIVE maestro (maestro OR acting delegate); this
 * distinguishes the two so R37.4 can refuse a delegate self-mutation.
 */
function callerUserTitle(request: NextRequest): string | undefined {
  const result = authenticateFromRequest(request)
  if (result.error) return undefined
  return buildAuthContext(result).userTitle
}

// ── POST: assign the MAESTRO-DELEGATE (R37.2) ───────────────────────────────
export async function POST(request: NextRequest) {
  const authErr = enforceMaestro(request)
  if (authErr) return authErr
  const sudoErr = requireSudoToken(request, 'POST', '/api/governance/maestro-delegate')
  if (sudoErr) return sudoErr
  const offErr = modelGuard()
  if (offErr) return offErr

  // R37.4 — only the ORIGINAL maestro may appoint a delegate. The acting
  // delegate (userTitle === 'maestro-delegate') has no power over the titles.
  if (callerUserTitle(request) === 'maestro-delegate') {
    return NextResponse.json(
      { error: 'forbidden_delegate_cannot_assign', message: 'A MAESTRO-DELEGATE cannot appoint another delegate (R37.4).' },
      { status: 403 },
    )
  }

  try {
    let raw: unknown
    try { raw = await request.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const parsed = AssignSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json({ error: 'targetUserId required' }, { status: 400 })
    }
    const { targetUserId } = parsed.data

    // Serialize on the governance lock so the one-at-a-time invariant and the
    // governance-pointer write are atomic against a concurrent assign/recall.
    const outcome = await withLock('governance', async (): Promise<
      { ok: true } | { ok: false; status: number; error: string }
    > => {
      // One delegate at a time (R37.2).
      const existing = getMaestroDelegateUserId()
      if (existing) {
        return { ok: false, status: 409, error: 'A MAESTRO-DELEGATE already exists. Recall it before assigning a new one (R37.2).' }
      }
      const target = getUser(targetUserId)
      if (!target) {
        return { ok: false, status: 404, error: 'Target user not found' }
      }
      if (target.title === 'maestro') {
        return { ok: false, status: 400, error: 'The MAESTRO cannot also be the MAESTRO-DELEGATE' }
      }
      // Promote the target user to delegate (suspends the maestro while active).
      await saveUser({ ...target, title: 'maestro-delegate' })
      // Record the O(1) governance pointer.
      const config = loadGovernance()
      config.maestroDelegateUserId = targetUserId
      saveGovernance(config)
      return { ok: true }
    })

    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status })
    }
    return NextResponse.json({ ok: true, maestroDelegateUserId: targetUserId })
  } catch (error) {
    return internalError(error, 'governance-maestro-delegate-assign')
  }
}

// ── DELETE: recall the MAESTRO-DELEGATE (R37.3) ─────────────────────────────
export async function DELETE(request: NextRequest) {
  const authErr = enforceMaestro(request)
  if (authErr) return authErr
  const sudoErr = requireSudoToken(request, 'DELETE', '/api/governance/maestro-delegate')
  if (sudoErr) return sudoErr
  const offErr = modelGuard()
  if (offErr) return offErr

  // R37.3/R37.4 — only the ORIGINAL maestro may recall the delegate. The acting
  // delegate cannot recall itself (it has no power over the titles).
  if (callerUserTitle(request) === 'maestro-delegate') {
    return NextResponse.json(
      { error: 'forbidden_delegate_cannot_recall', message: 'A MAESTRO-DELEGATE cannot recall itself; only the MAESTRO may recall it (R37.3/R37.4).' },
      { status: 403 },
    )
  }

  try {
    const outcome = await withLock('governance', async (): Promise<
      { ok: true; recalled: string | null }
    > => {
      const delegateId = getMaestroDelegateUserId()
      if (delegateId) {
        // Demote the delegate back to a normal user (restores the maestro).
        const delegate = loadUsers().find(u => u.id === delegateId && !u.deletedAt)
        if (delegate) {
          await saveUser({ ...delegate, title: 'user' })
        }
      }
      const config = loadGovernance()
      config.maestroDelegateUserId = null
      saveGovernance(config)
      return { ok: true, recalled: delegateId }
    })

    return NextResponse.json({ ok: true, recalled: outcome.recalled })
  } catch (error) {
    return internalError(error, 'governance-maestro-delegate-recall')
  }
}
