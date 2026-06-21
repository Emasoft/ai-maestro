/**
 * WebAuthn Credentials Management
 *
 * GET    /api/auth/webauthn/credentials  — List registered credentials (system-owner only)
 * DELETE /api/auth/webauthn/credentials  — Remove a credential by ID (system-owner + sudo)
 *
 * These endpoints manage the passkey inventory. Listing shows credential metadata
 * (never the public key). Deletion requires sudo mode for safety.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { loadCredentials, deleteCredential } from '@/lib/webauthn-server'
import { enforceSystemOwner } from '@/lib/route-auth'
import { validateAndConsumeSudoToken } from '@/lib/sudo-auth'
import { isUserAuthorityModelEnabled } from '@/lib/governance'
import { getActiveMaestroUserId } from '@/lib/user-registry'

/**
 * Verify a one-shot sudo token earned by the system owner and enforce
 * subject + operation binding inline (this route is not in security-registry's
 * strict list, so it cannot use lib/sudo-guard's requireSudoToken — that helper
 * no-ops for unregistered routes; calling it here would silently DROP the sudo
 * requirement). Mirrors requireSudoToken's USER/SYSTEM-OWNER branch (SUDO-01/02);
 * the caller MUST run enforceSystemOwner() FIRST (SUDO-04, authenticate-before-consume).
 */
function consumeOwnerSudoToken(
  rawToken: string | null,
  method: string,
  path: string
): { ok: true } | { ok: false; status: number; body: Record<string, unknown> } {
  const result = validateAndConsumeSudoToken(rawToken)
  if (!result.ok) {
    return { ok: false, status: 403, body: { error: 'sudo_required', reason: result.reason } }
  }
  // SUDO-02 subject binding — accept 'system-owner' always, and the active-maestro
  // id under the user-authority model. Fail-secure: never widen on a read error.
  const validSubjects = new Set<string>(['system-owner'])
  try {
    if (isUserAuthorityModelEnabled()) {
      const activeMaestroId = getActiveMaestroUserId()
      if (activeMaestroId) validSubjects.add(activeMaestroId)
    }
  } catch {
    /* fail-secure */
  }
  if (!validSubjects.has(result.subject)) {
    return { ok: false, status: 403, body: { error: 'sudo_subject_mismatch' } }
  }
  // SUDO-01 operation binding — a bound token may be used only for its operation.
  if (result.operation && (result.operation.method !== method || result.operation.path !== path)) {
    return { ok: false, status: 403, body: { error: 'sudo_operation_mismatch' } }
  }
  return { ok: true }
}

// ============================================================================
// GET — List registered credentials
// ============================================================================

export async function GET(request: NextRequest) {
  // SYSTEM-OWNER ONLY. WHY: the passkey inventory is the host owner's, and the
  // previous raw validateSession() check admitted any logged-in user under the
  // R36/R37 user-authority model. enforceSystemOwner is the active-MAESTRO under
  // the model and the (unchanged) logged-in web session when the model is off.
  const authErr = enforceSystemOwner(request)
  if (authErr) return authErr

  try {
    const credentials = loadCredentials()

    // Return metadata only — never expose the public key material
    const safeList = credentials.map(c => ({
      credentialID: c.credentialID,
      label: c.label,
      createdAt: c.createdAt,
      transports: c.transports,
      counter: c.counter,
    }))

    return NextResponse.json({ credentials: safeList })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list credentials'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ============================================================================
// DELETE — Remove a credential by ID
// ============================================================================

const DeleteSchema = z.object({
  credentialID: z.string().min(1),
}).strict()

export async function DELETE(request: NextRequest) {
  // SYSTEM-OWNER ONLY (see GET) — deleting a passkey removes a login credential.
  // Runs FIRST so a forged/expired session can never burn a one-shot sudo token (SUDO-04).
  const authErr = enforceSystemOwner(request)
  if (authErr) return authErr

  // STRICT (sudo). WHY: the previous code consumed the token with a bare
  // validateAndConsumeSudoToken() and ignored the returned subject/operation,
  // so a token minted for a different operation or subject could be replayed to
  // delete a passkey. consumeOwnerSudoToken enforces subject-binding (SUDO-02)
  // and operation-binding (SUDO-01) inline (this route is not in the strict
  // registry, so requireSudoToken would no-op — see the helper's doc-comment).
  const sudo = consumeOwnerSudoToken(request.headers.get('x-sudo-token'), 'DELETE', '/api/auth/webauthn/credentials')
  if (!sudo.ok) return NextResponse.json(sudo.body, { status: sudo.status })

  try {
    const raw = await request.json()
    const parsed = DeleteSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'credentialID is required' },
        { status: 400 }
      )
    }

    const { credentialID } = parsed.data
    const removed = deleteCredential(credentialID)

    if (!removed) {
      return NextResponse.json(
        { error: 'Credential not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, credentialID })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete credential'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
