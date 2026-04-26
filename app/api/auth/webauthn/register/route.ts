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
    const message = err instanceof Error ? err.message : 'Failed to generate registration options'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ============================================================================
// POST — Verify registration response and store credential
// ============================================================================

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
    }),
    authenticatorAttachment: z.string().optional(),
    clientExtensionResults: z.record(z.string(), z.unknown()),
    type: z.string(),
  }),
  label: z.string().min(1).max(100).default('Passkey'),
})

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

    // Distinguish client errors from server errors
    if (message.includes('webauthn_challenge_expired') ||
        message.includes('webauthn_verification_failed') ||
        message.includes('webauthn_duplicate')) {
      return NextResponse.json({ error: message }, { status: 400 })
    }

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
