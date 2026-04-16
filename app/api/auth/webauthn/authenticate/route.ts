/**
 * WebAuthn Authentication Endpoints
 *
 * GET  /api/auth/webauthn/authenticate  — Generate authentication options (unauthenticated — login flow)
 * POST /api/auth/webauthn/authenticate  — Verify authentication response, create session
 *
 * These endpoints handle the passkey login flow. The GET is unauthenticated
 * because this IS the login mechanism. The POST verifies the passkey assertion
 * and creates a session cookie (same as the password login route).
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  generateWebAuthnAuthenticationOptions,
  verifyWebAuthnAuthentication,
  hasRegisteredCredentials,
} from '@/lib/webauthn-server'
import { createSession, buildSessionCookie } from '@/lib/session-auth'
import { checkAndRecordAttempt, resetRateLimit } from '@/lib/rate-limit'
import { recordAuthFailure, recordAuthSuccess, isLockedDown } from '@/lib/kill-switch'
import type { AuthenticationResponseJSON } from '@simplewebauthn/types'

// ============================================================================
// GET — Generate authentication options (unauthenticated)
// ============================================================================

export async function GET() {
  try {
    // If no passkeys registered, return a helpful error
    if (!hasRegisteredCredentials()) {
      return NextResponse.json(
        { error: 'no_passkeys_registered', message: 'No passkeys have been registered yet' },
        { status: 404 }
      )
    }

    const options = await generateWebAuthnAuthenticationOptions()
    return NextResponse.json(options, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate authentication options'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ============================================================================
// POST — Verify authentication response and create session
// ============================================================================

const AuthenticationBodySchema = z.object({
  response: z.object({
    id: z.string(),
    rawId: z.string(),
    response: z.object({
      clientDataJSON: z.string(),
      authenticatorData: z.string(),
      signature: z.string(),
      userHandle: z.string().optional(),
    }),
    authenticatorAttachment: z.string().optional(),
    clientExtensionResults: z.record(z.string(), z.unknown()),
    type: z.string(),
  }),
})

export async function POST(request: Request) {
  try {
    // Kill switch: reject during lockdown
    if (isLockedDown()) {
      return NextResponse.json(
        { error: 'System is in emergency lockdown. Try again later.' },
        { status: 503 }
      )
    }

    // Rate-limit authentication attempts (same bucket as password login)
    const rateCheck = checkAndRecordAttempt('auth-login')
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Too many authentication attempts. Try again later.' },
        { status: 429 }
      )
    }

    const raw = await request.json()
    const parsed = AuthenticationBodySchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid authentication response', details: parsed.error.format() },
        { status: 400 }
      )
    }

    const { response } = parsed.data

    // Verify the authentication response
    const authInfo = await verifyWebAuthnAuthentication(
      response as unknown as AuthenticationResponseJSON,
    )

    // Success: reset rate limits and kill switch counter
    resetRateLimit('auth-login')
    recordAuthSuccess()

    // Unlock encrypted security config (passkey auth does not provide the
    // plaintext governance password, so we skip unlockSecurityConfig here —
    // the config uses its default-key fallback)

    // Create session (same as password login)
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined
    const token = await createSession(ip || undefined)

    // Determine if HTTPS (for Secure flag on cookie)
    const isSecure = request.url.startsWith('https')

    const resp = NextResponse.json({ success: true })
    resp.headers.set('Set-Cookie', buildSessionCookie(token, isSecure))
    resp.headers.set('Cache-Control', 'no-store')

    return resp
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Authentication failed'

    // Record auth failure for kill switch
    recordAuthFailure()

    if (message.includes('webauthn_challenge_expired') ||
        message.includes('webauthn_verification_failed') ||
        message.includes('webauthn_unknown_credential')) {
      return NextResponse.json({ error: message }, { status: 401 })
    }

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
