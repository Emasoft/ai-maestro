/**
 * /api/auth/dev-token (TRDD-A9335BZ6)
 *
 * The owner's only way to mint, inspect, pause, or revoke the dev-mode login
 * token (see `lib/dev-mode-token.ts` for the full WHY). System-owner only —
 * an agent must never be able to mint its own bypass for the login password.
 *
 * GET              -> status: { enabled, issued, createdAt, lastUsedAt }. Never the token/hash.
 * GET ?challenge=1 -> WebAuthn authentication options (mirrors webauthn/authenticate's GET),
 *                     so the dashboard can drive one endpoint instead of two.
 * POST { password, assertion } -> verify governance password AND the WebAuthn assertion
 *                     (BOTH required — no password-only fallback), then mint. Returns
 *                     { token } exactly once; the plaintext is never stored or re-shown.
 * PATCH { enabled } -> pause/resume without destroying the token.
 * DELETE            -> revoke (destroys the token; a fresh POST mints a new one).
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  getDevTokenStatus,
  setDevModeEnabled,
  mintDevToken,
  revokeDevToken,
} from '@/lib/dev-mode-token'
import { enforceSystemOwner } from '@/lib/route-auth'
import { verifyPassword } from '@/lib/governance'
import {
  generateWebAuthnAuthenticationOptions,
  verifyWebAuthnAuthentication,
  hasRegisteredCredentials,
} from '@/lib/webauthn-server'
import { checkAndRecordAttempt, resetRateLimit } from '@/lib/rate-limit'
import { recordAuthFailure, recordAuthSuccess, isLockedDown } from '@/lib/kill-switch'
import type { AuthenticationResponseJSON } from '@simplewebauthn/types'

// Mirrors sudo-password's split: a generous machine-wide floor plus a tight
// per-caller bucket, reset only on success so a correct mint never launders
// another caller's accumulated failures out of the window (TRDD-X8R2HP9D).
const GLOBAL_MAX_ATTEMPTS = 200
const SUBJECT_MAX_ATTEMPTS = 5
const RATE_KEY = 'dev-token:owner'

export const dynamic = 'force-dynamic'

// ============================================================================
// GET — status, or (?challenge=1) WebAuthn authentication options
// ============================================================================

export async function GET(request: NextRequest) {
  const authErr = enforceSystemOwner(request)
  if (authErr) return authErr

  const url = new URL(request.url)
  if (url.searchParams.get('challenge') === '1') {
    if (!hasRegisteredCredentials()) {
      return NextResponse.json(
        { error: 'no_passkeys_registered', message: 'No passkeys have been registered yet' },
        { status: 404 }
      )
    }
    try {
      const options = await generateWebAuthnAuthenticationOptions(request.headers.get('host'))
      return NextResponse.json(options, { headers: { 'Cache-Control': 'no-store' } })
    } catch (err) {
      console.error('[auth/dev-token GET challenge]', err)
      return NextResponse.json({ error: 'internal_error', code: 'dev-token-challenge' }, { status: 500 })
    }
  }

  return NextResponse.json(getDevTokenStatus(), { headers: { 'Cache-Control': 'no-store' } })
}

// ============================================================================
// POST — mint (password + WebAuthn assertion, both required)
// ============================================================================

const AssertionSchema = z.object({
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
})

const MintSchema = z.object({
  password: z.string().min(1).max(256),
  assertion: AssertionSchema,
}).strict()

export async function POST(request: NextRequest) {
  if (isLockedDown()) {
    return NextResponse.json(
      { error: 'System is in emergency lockdown. Try again later.' },
      { status: 503 }
    )
  }

  const globalCheck = checkAndRecordAttempt('dev-token:global', GLOBAL_MAX_ATTEMPTS)
  if (!globalCheck.allowed) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 })
  }

  const authErr = enforceSystemOwner(request)
  if (authErr) return authErr

  const subjectCheck = checkAndRecordAttempt(RATE_KEY, SUBJECT_MAX_ATTEMPTS)
  if (!subjectCheck.allowed) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 })
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = MintSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'password and assertion required', details: parsed.error.format() },
      { status: 400 }
    )
  }
  const { password, assertion } = parsed.data

  const passwordOk = await verifyPassword(password)
  if (!passwordOk) {
    recordAuthFailure()
    return NextResponse.json({ error: 'invalid_password' }, { status: 403 })
  }

  // Password alone is NEVER sufficient — a stolen governance password must
  // not be able to mint a standing bypass credential without also holding
  // the hardware passkey. No password-only fallback, by design.
  if (!hasRegisteredCredentials()) {
    return NextResponse.json(
      { error: 'no_passkeys_registered', message: 'Register a passkey before minting a dev-mode token' },
      { status: 400 }
    )
  }

  try {
    await verifyWebAuthnAuthentication(
      assertion as unknown as AuthenticationResponseJSON,
      undefined,
      request.headers.get('host'),
    )
  } catch (err) {
    recordAuthFailure()
    const message = err instanceof Error ? err.message : 'Authentication failed'
    if (message.includes('webauthn_challenge_expired')) {
      return NextResponse.json({ error: 'webauthn_challenge_expired' }, { status: 401 })
    }
    if (message.includes('webauthn_verification_failed')) {
      return NextResponse.json({ error: 'webauthn_verification_failed' }, { status: 401 })
    }
    if (message.includes('webauthn_unknown_credential')) {
      return NextResponse.json({ error: 'webauthn_unknown_credential' }, { status: 401 })
    }
    console.error('[auth/dev-token POST]', err)
    return NextResponse.json({ error: 'internal_error', code: 'dev-token-webauthn' }, { status: 500 })
  }

  resetRateLimit(RATE_KEY)
  recordAuthSuccess()
  const token = await mintDevToken()
  return NextResponse.json({ token }, { headers: { 'Cache-Control': 'no-store' } })
}

// ============================================================================
// PATCH — pause/resume without destroying the token
// ============================================================================

const PatchSchema = z.object({ enabled: z.boolean() }).strict()

export async function PATCH(request: NextRequest) {
  if (isLockedDown()) {
    return NextResponse.json(
      { error: 'System is in emergency lockdown. Try again later.' },
      { status: 503 }
    )
  }
  const authErr = enforceSystemOwner(request)
  if (authErr) return authErr

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = PatchSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'enabled (boolean) required' }, { status: 400 })
  }

  await setDevModeEnabled(parsed.data.enabled)
  return NextResponse.json(getDevTokenStatus())
}

// ============================================================================
// DELETE — revoke
// ============================================================================

export async function DELETE(request: NextRequest) {
  if (isLockedDown()) {
    return NextResponse.json(
      { error: 'System is in emergency lockdown. Try again later.' },
      { status: 503 }
    )
  }
  const authErr = enforceSystemOwner(request)
  if (authErr) return authErr

  await revokeDevToken()
  return NextResponse.json({ success: true })
}
