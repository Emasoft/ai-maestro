/**
 * WebAuthn Registration Endpoints
 *
 * GET  /api/auth/webauthn/register  — Generate registration options (system-owner only)
 * POST /api/auth/webauthn/register  — Verify registration response and store credential
 *                                      (system-owner + sudo required)
 *
 * These endpoints allow the system owner to register new passkeys (WebAuthn
 * credentials) for passwordless login.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  generateWebAuthnRegistrationOptions,
  verifyWebAuthnRegistration,
  saveCredential,
  type StoredCredential,
} from '@/lib/webauthn-server'
import { enforceSystemOwner } from '@/lib/route-auth'
import { verifyAndConsumeSudoToken } from '@/lib/sudo-auth'
import { isUserAuthorityModelEnabled } from '@/lib/governance'
import { getActiveMaestroUserId } from '@/lib/user-registry'
import type { RegistrationResponseJSON } from '@simplewebauthn/types'

/**
 * Verify a one-shot sudo token earned by the system owner and enforce
 * subject + operation binding inline (this route is not in security-registry's
 * strict list, so it cannot use lib/sudo-guard's requireSudoToken — that helper
 * no-ops for unregistered routes; calling it here would silently DROP the sudo
 * requirement). This mirrors requireSudoToken's USER/SYSTEM-OWNER branch:
 *  - subject must be 'system-owner' (model-off) or the active-maestro id (model-on),
 *    so a token minted for a different subject cannot be replayed here (SUDO-02);
 *  - if the token was minted bound to a specific operation, it may be consumed
 *    ONLY for THIS (method, path); an unbound (legacy) token is tolerated (SUDO-01).
 * The caller MUST run enforceSystemOwner() FIRST so a forged session can never
 * burn a one-shot token (SUDO-04).
 */
function consumeOwnerSudoToken(
  rawToken: string | null,
  method: string,
  path: string
): { ok: true } | { ok: false; status: number; body: Record<string, unknown> } {
  // SUDO-02 subject binding — accept the legacy 'system-owner' sentinel always,
  // and the active-maestro id when the user-authority model is on (mirrors the
  // mint, which binds subject to ctx.userId ?? 'system-owner'). Fail-safe: on any
  // registry/flag read error, keep the legacy {'system-owner'}-only set (deny-only).
  const validSubjects = new Set<string>(['system-owner'])
  try {
    if (isUserAuthorityModelEnabled()) {
      const activeMaestroId = getActiveMaestroUserId()
      if (activeMaestroId) validSubjects.add(activeMaestroId)
    }
  } catch {
    /* fail-secure: never widen the subject set on error */
  }
  // AUTHENTICATE-BEFORE-CONSUME: the store verifies subject (SUDO-02) AND
  // operation (SUDO-01) BEFORE it burns the token, so a wrong-subject or
  // wrong-op replay is rejected WITHOUT consuming a still-valid token.
  const result = verifyAndConsumeSudoToken(rawToken, {
    operation: { method, path },
    acceptSubject: (subject) => validSubjects.has(subject),
  })
  if (result.ok) return { ok: true }
  if (result.reason === 'subject_mismatch') {
    return { ok: false, status: 403, body: { error: 'sudo_subject_mismatch' } }
  }
  if (result.reason === 'operation_mismatch') {
    return { ok: false, status: 403, body: { error: 'sudo_operation_mismatch' } }
  }
  return { ok: false, status: 403, body: { error: 'sudo_required', reason: result.reason } }
}

// ============================================================================
// GET — Generate registration options
// ============================================================================

export async function GET(request: NextRequest) {
  // SYSTEM-OWNER ONLY. WHY: registering a passkey for the host owner is a
  // privilege-grant. The previous check used raw validateSession(), which under
  // the R36/R37 user-authority model admits ANY logged-in user (incl. a
  // non-MAESTRO normal user) — a privilege-escalation gap. enforceSystemOwner
  // resolves isSystemOwner via buildAuthContext, which is the active-MAESTRO
  // under the model and the (unchanged) logged-in web session when the model is
  // off, so the single-operator default is byte-identical.
  const authErr = enforceSystemOwner(request)
  if (authErr) return authErr

  try {
    // TRDD-OC9ELGSO P2: derive rpId/origin from the request Host (allow-listed).
    const options = await generateWebAuthnRegistrationOptions(request.headers.get('host'))
    return NextResponse.json(options, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    // MIN-01: log full error server-side, return generic 500.
    console.error('[webauthn/register GET]', err)
    return NextResponse.json({ error: 'internal_error', code: 'webauthn-register-options' }, { status: 500 })
  }
}

// ============================================================================
// POST — Verify registration response and store credential
// ============================================================================

// API2-MAJ-20: .strict() at every level — defense in depth against extra
// fields that simplewebauthn's verifier might silently accept.
const RegistrationBodySchema = z.object({
  response: z.object({
    id: z.string(),
    rawId: z.string(),
    response: z.object({
      clientDataJSON: z.string(),
      attestationObject: z.string(),
      authenticatorData: z.string().optional(),
      transports: z.array(z.string()).optional(),
      publicKeyAlgorithm: z.number().optional(),
      publicKey: z.string().optional(),
    }).strict(),
    authenticatorAttachment: z.string().optional(),
    // API2-MIN-06: clientExtensionResults is a free-form record of
    // WebAuthn extensions. A fully-typed schema would enumerate every
    // standard extension (credProps, largeBlob, prf, etc.) but since
    // the simplewebauthn verifier already validates extension semantics
    // at the protocol level, the schema here only enforces "object with
    // string keys and any values". Tightening to specific extensions
    // would risk rejecting valid future extensions; the trade-off is
    // intentional — leave as-is unless you're consciously adding
    // extension-aware validation.
    clientExtensionResults: z.record(z.string(), z.unknown()),
    type: z.string(),
  }).strict(),
  label: z.string().min(1).max(100).default('Passkey'),
}).strict()

export async function POST(request: NextRequest) {
  // SYSTEM-OWNER ONLY (see GET) — registering a new passkey is a privilege grant.
  // Runs FIRST so a forged/expired session can never burn a one-shot sudo token (SUDO-04).
  const authErr = enforceSystemOwner(request)
  if (authErr) return authErr

  // STRICT (sudo). WHY: a bare consume that ignored the token's subject/operation
  // would let a token minted for a different operation or subject be replayed to
  // register a passkey. consumeOwnerSudoToken uses verifyAndConsumeSudoToken to
  // enforce subject-binding (SUDO-02) and operation-binding (SUDO-01) BEFORE it
  // burns the token (a mismatch does not consume a still-valid token). This route
  // is not in the strict registry, so requireSudoToken would no-op — see the
  // helper's doc-comment.
  const sudo = consumeOwnerSudoToken(request.headers.get('x-sudo-token'), 'POST', '/api/auth/webauthn/register')
  if (!sudo.ok) return NextResponse.json(sudo.body, { status: sudo.status })

  try {
    const raw = await request.json()
    const parsed = RegistrationBodySchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid registration response', details: parsed.error.format() },
        { status: 400 }
      )
    }

    const { response, label } = parsed.data

    // Verify the registration response with the stored challenge. The Host must
    // match the one used at generate time (TRDD-OC9ELGSO P2 — same allow-list).
    const registrationInfo = await verifyWebAuthnRegistration(
      response as unknown as RegistrationResponseJSON,
      undefined,
      request.headers.get('host'),
    )

    // Build the credential record for storage
    const credential: StoredCredential = {
      credentialID: registrationInfo.credential.id,
      credentialPublicKey: Buffer.from(registrationInfo.credential.publicKey).toString('base64url'),
      counter: registrationInfo.credential.counter,
      transports: (registrationInfo.credential.transports ?? []) as string[],
      createdAt: new Date().toISOString(),
      label,
    }

    // Persist the credential
    saveCredential(credential)

    return NextResponse.json({
      success: true,
      credentialID: credential.credentialID,
      label: credential.label,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Registration failed'

    // Only expose well-known webauthn protocol error codes (not raw text).
    if (message.includes('webauthn_challenge_expired')) {
      return NextResponse.json({ error: 'webauthn_challenge_expired' }, { status: 400 })
    }
    if (message.includes('webauthn_verification_failed')) {
      return NextResponse.json({ error: 'webauthn_verification_failed' }, { status: 400 })
    }
    if (message.includes('webauthn_duplicate')) {
      return NextResponse.json({ error: 'webauthn_duplicate' }, { status: 400 })
    }

    // MIN-01: log full error server-side, return generic 500.
    console.error('[webauthn/register POST]', err)
    return NextResponse.json({ error: 'internal_error', code: 'webauthn-register' }, { status: 500 })
  }
}
