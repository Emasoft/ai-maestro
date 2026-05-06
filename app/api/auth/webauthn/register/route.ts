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

import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  generateWebAuthnRegistrationOptions,
  verifyWebAuthnRegistration,
  saveCredential,
  loadCredentials,
  type StoredCredential,
} from '@/lib/webauthn-server'
import { extractSessionFromCookie, validateSession } from '@/lib/session-auth'
import { validateAndConsumeSudoToken } from '@/lib/sudo-auth'
import type { RegistrationResponseJSON } from '@simplewebauthn/types'

// ============================================================================
// Helpers
// ============================================================================

function isAuthenticated(request: Request): boolean {
  const cookieHeader = request.headers.get('cookie')
  const token = extractSessionFromCookie(cookieHeader)
  if (!token) return false
  return validateSession(token)
}

// ============================================================================
// GET — Generate registration options
// ============================================================================

export async function GET(request: Request) {
  // Must be authenticated (system-owner session)
  if (!isAuthenticated(request)) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    )
  }

  try {
    const options = await generateWebAuthnRegistrationOptions()
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

export async function POST(request: Request) {
  // Must be authenticated (system-owner session)
  if (!isAuthenticated(request)) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    )
  }

  // Must have sudo token (registering a new passkey is a privileged operation)
  const sudoToken = request.headers.get('x-sudo-token')
  const sudoResult = validateAndConsumeSudoToken(sudoToken)
  if (!sudoResult.ok) {
    return NextResponse.json(
      { error: 'Sudo token required for credential registration', reason: sudoResult.reason },
      { status: 403 }
    )
  }

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

    // Verify the registration response with the stored challenge
    const registrationInfo = await verifyWebAuthnRegistration(
      response as unknown as RegistrationResponseJSON,
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
