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
    // MIN-01: do not leak error.message. Log full error server-side.
    console.error('[webauthn/authenticate GET]', err)
    return NextResponse.json({ error: 'internal_error', code: 'webauthn-auth-options' }, { status: 500 })
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

    // API2-MAJ-06: per-source rate-limit + global cap, matching the
    // /api/auth/login pattern. A WebAuthn brute-forcer from one IP must
    // not be able to lock out a legitimate user logging in from another.
    const sourceIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'unknown'
    const rateLimitKey = `auth-login:${sourceIp}`
    const rateCheck = checkAndRecordAttempt(rateLimitKey)
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Too many authentication attempts. Try again later.' },
        { status: 429 }
      )
    }
    const globalRateCheck = checkAndRecordAttempt('auth-login:global', 200)
    if (!globalRateCheck.allowed) {
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

    // Success: reset only the per-source bucket; the global bucket
    // continues to accumulate so cross-source attempts can't be laundered.
    resetRateLimit(rateLimitKey)
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

    // Only expose well-known webauthn protocol error CODES (not raw text).
    if (message.includes('webauthn_challenge_expired')) {
      return NextResponse.json({ error: 'webauthn_challenge_expired' }, { status: 401 })
    }
    if (message.includes('webauthn_verification_failed')) {
      return NextResponse.json({ error: 'webauthn_verification_failed' }, { status: 401 })
    }
    if (message.includes('webauthn_unknown_credential')) {
      return NextResponse.json({ error: 'webauthn_unknown_credential' }, { status: 401 })
    }

    // MIN-01: do not leak error.message in the generic 500 path.
    console.error('[webauthn/authenticate POST]', err)
    return NextResponse.json({ error: 'internal_error', code: 'webauthn-auth' }, { status: 500 })
  }
}
