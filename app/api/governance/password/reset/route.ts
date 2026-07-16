/**
 * POST /api/governance/password/reset — FORGOT-PASSWORD recovery (TRDD-P7XKV3N9 sibling).
 *
 * Requires NO old password: you cannot prove knowledge of a secret you have lost, so the
 * factor is a one-shot code delivered over a channel you demonstrably control. THREE methods:
 *
 *   - console (default): the code goes to the HOST (0600 file + best-effort notification),
 *     gated on console presence. A remote VPN device cannot read it, so cannot reset.
 *     Console presence REPLACES the knowledge factor — the entire security property.
 *   - email: the code is emailed to the owner's VERIFIED recovery address, so a REMOTE
 *     device (iPad/iPhone) can recover. The trust root shifts from "at the host" to
 *     "controls the registered email"; the console gate is intentionally NOT applied.
 *   - passkey: a WebAuthn assertion (possession of a registered authenticator) in place of a
 *     code. Like email it is deliberately remote-capable — the trust root is the private key
 *     the owner holds, so the console gate is intentionally NOT applied.
 *
 * Flow (two calls; console & email):
 *   POST { method? }                    -> 200 { codeRequired, channel, hint, expiresAt }
 *   POST { method?, code, newPassword } -> 200 { reset: true, securityPolicyReset }  (+ session: auto-login)
 *
 * Flow (two calls; passkey):
 *   POST { method: 'passkey' }                         -> 200 { assertionRequired: true, options }
 *   POST { method: 'passkey', assertion, newPassword } -> 200 { reset: true, securityPolicyReset }  (+ session)
 *
 * Consequence surfaced to the caller: the governance password also keys security-config.enc.
 * When the config is not unlocked (the true forgot case) its blob is keyed to the LOST
 * password and can never be decrypted again, so we re-initialize it to DEFAULTS under the new
 * password and report securityPolicyReset:true. Only security POLICY tuning is affected — no
 * secrets or API keys live there.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { setPassword, getRecoveryEmail } from '@/lib/governance'
import { isConsolePeer, peerAddress } from '@/lib/peer-address.mjs'
import { startSetupFlow, verifySetupCode } from '@/lib/setup-bootstrap'
import { checkAndRecordAttempt, resetRateLimit } from '@/lib/rate-limit'
import { isUnlocked, saveSecurityConfig, getSecurityDefaults } from '@/lib/security-config'
import { createSession, buildSessionCookie } from '@/lib/session-auth'
import {
  generateWebAuthnAuthenticationOptions,
  verifyWebAuthnAuthentication,
  hasRegisteredCredentials,
} from '@/lib/webauthn-server'
import type { AuthenticationResponseJSON } from '@simplewebauthn/types'

// The passkey method carries a WebAuthn assertion (navigator.credentials.get() output) in
// place of a code. Shape mirrors the working /api/auth/webauthn/authenticate route's schema;
// intentionally NOT .strict() at the assertion level so valid WebAuthn extension fields are
// tolerated — the simplewebauthn verifier validates the protocol semantics itself.
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

// method defaults to 'console' (backward-compatible with the original single-method route).
// Call-1 sends { method? }. Call-2 sends { method?, code, newPassword } (console/email) or
// { method:'passkey', assertion, newPassword }. Password bounds match the passwordPolicy
// DEFAULTS in lib/security-config.ts (min 8, max 256).
const BodySchema = z.object({
  method: z.enum(['console', 'email', 'passkey']).optional(),
  code: z.string().regex(/^\d{6}$/, 'code must be a 6-digit string').optional(),
  assertion: AssertionSchema.optional(),
  newPassword: z.string().min(8, 'password must be at least 8 characters').max(256).optional(),
}).strict()

/** Tight: this route mints codes and sets the master credential. 5 tries / 15 min / peer. */
const MAX_ATTEMPTS = 5
const WINDOW_MS = 15 * 60_000

/**
 * The SHARED tail of every reset method — console, email, AND passkey run it byte-identically.
 * The caller has ALREADY proven authorization by this point (a one-shot code for console/email,
 * a verified WebAuthn assertion for passkey), so there is deliberately NO old-password check
 * here: we call the low-level setPassword rather than the service-layer setter that would demand
 * the current password — exactly what a forgot-password user cannot supply. If the security-config
 * blob was still locked (the true forgot case) it is keyed to the LOST password and can never be
 * decrypted again, so it is re-initialized to DEFAULTS under the new password and reported
 * honestly (only POLICY tuning resets — no secrets live there). Finally the rate-limit bucket is
 * cleared and an auto-login session is minted.
 */
async function finalizeReset(newPassword: string, rlKey: string): Promise<NextResponse> {
  const wasUnlocked = isUnlocked()
  await setPassword(newPassword)

  let securityPolicyReset = false
  if (!wasUnlocked) {
    saveSecurityConfig(getSecurityDefaults(), newPassword)
    securityPolicyReset = true
  }

  resetRateLimit(rlKey)

  const token = await createSession()
  const response = NextResponse.json({
    reset: true,
    securityPolicyReset,
    message: securityPolicyReset
      ? 'Password reset. Custom security-policy settings reverted to their defaults.'
      : 'Password reset. You are now logged in.',
  })
  response.headers.set('Set-Cookie', buildSessionCookie(token))
  return response
}

export async function POST(request: NextRequest) {
  const peer = peerAddress(request) ?? ''
  const rlKey = `pw-reset:${peer}`

  let body: z.infer<typeof BodySchema>
  try {
    body = BodySchema.parse(await request.json())
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }
  const method = body.method ?? 'console'

  if (method === 'passkey') {
    // Possession of a registered passkey's private key REPLACES the knowledge factor: signing
    // the server challenge proves the owner holds the authenticator, exactly as a one-shot code
    // proves control of the console/email channel. Like email, this is deliberately remote-capable
    // — the trust root is the key, not console presence, so NO console gate is applied.
    //
    // GATE FIRST (mirrors the console/email method gate): refuse when nothing is registered —
    // there is no credential to verify possession against — so a caller we will reject never
    // consumes a rate-limit slot and never starts a challenge.
    if (!hasRegisteredCredentials()) {
      return NextResponse.json(
        {
          error: 'no_passkeys_registered',
          message: 'No passkeys are registered on this host, so a passkey reset cannot be performed.',
        },
        { status: 403 },
      )
    }

    // Throttle both calls (challenge issue + assertion verify) per peer, same cap/window as the
    // code methods — the verify call is the credential-forgery surface, so cap it exactly as
    // call-2 of the code methods is capped.
    const rl = checkAndRecordAttempt(rlKey, MAX_ATTEMPTS, WINDOW_MS)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'too_many_attempts', retryAfterMs: rl.retryAfterMs },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
      )
    }

    // Call-1: no assertion yet ⇒ issue+store a one-shot WebAuthn challenge (60s TTL, in the same
    // lib/webauthn-server store the login flow uses) and hand the client the request options for
    // navigator.credentials.get(). The challenge is public by design — security rests on the
    // private key that must sign it, which only the owner's authenticator holds.
    if (!body.assertion) {
      try {
        // TRDD-OC9ELGSO P2: derive rpId/origin from the request Host (allow-listed).
        const options = await generateWebAuthnAuthenticationOptions(request.headers.get('host'))
        return NextResponse.json({ assertionRequired: true, options })
      } catch {
        // FAIL CLOSED — if a challenge cannot be started, the caller cannot prove possession.
        return NextResponse.json(
          { error: 'challenge_unavailable', message: 'Could not start the passkey challenge.' },
          { status: 503 },
        )
      }
    }

    // Call-2: assertion supplied ⇒ a new password is mandatory (the assertion alone resets nothing).
    if (!body.newPassword) {
      return NextResponse.json({ error: 'new_password_required' }, { status: 400 })
    }

    // Verify the assertion against the owner's REGISTERED credential — this consumes the one-shot
    // challenge and checks the signature. A forged, replayed, expired, or unknown-credential
    // assertion is rejected here and resets NOTHING.
    try {
      // Host must match the one used at generate time (TRDD-OC9ELGSO P2).
      await verifyWebAuthnAuthentication(
        body.assertion as unknown as AuthenticationResponseJSON,
        undefined,
        request.headers.get('host'),
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      // Surface only well-known webauthn protocol CODES (mirrors the authenticate route). Any
      // other verify error is a 401 too — FAIL CLOSED, never wave a reset through on an
      // unexpected failure.
      if (message.includes('webauthn_challenge_expired')) {
        return NextResponse.json({ error: 'webauthn_challenge_expired' }, { status: 401 })
      }
      if (message.includes('webauthn_unknown_credential')) {
        return NextResponse.json({ error: 'webauthn_unknown_credential' }, { status: 401 })
      }
      if (message.includes('webauthn_verification_failed')) {
        return NextResponse.json({ error: 'webauthn_verification_failed' }, { status: 401 })
      }
      console.error('[password/reset passkey verify]', err)
      return NextResponse.json({ error: 'webauthn_verification_failed' }, { status: 401 })
    }

    // Proven possession ⇒ run the EXACT same tail as console/email.
    return finalizeReset(body.newPassword, rlKey)
  }

  // ── 1. Method gate — FIRST, so a caller we will reject never consumes a rate-limit slot
  // and never triggers code delivery. Also resolves the delivery target for call-1. ──
  let recoveryEmail: string | null = null
  if (method === 'console') {
    // Console presence is the ONLY factor for this method (no old password), so a remote
    // caller must never get past this line. Dropping it would be a remote takeover.
    if (!isConsolePeer(peer)) {
      return NextResponse.json(
        {
          error: 'console_required',
          message:
            'The password can only be reset from the machine running AI Maestro, or via a ' +
            'configured recovery email. Remote devices on the VPN can use every other function.',
        },
        { status: 403 },
      )
    }
  } else {
    // email: the factor is control of the VERIFIED recovery address. No console gate — remote
    // recovery is the entire point. Refuse when no verified email is configured.
    const rec = getRecoveryEmail()
    if (!rec || !rec.verified) {
      return NextResponse.json(
        { error: 'email_not_configured', message: 'No verified recovery email is configured on this host.' },
        { status: 403 },
      )
    }
    recoveryEmail = rec.email
  }

  // ── 2. Throttle — call-1 mints codes (and emails/notifications); call-2 is a code-guessing
  // surface. Cap both per peer. The email method is remotely reachable, so this is its main
  // anti-abuse control (that + one-shot codes the attacker cannot read). ──
  const rl = checkAndRecordAttempt(rlKey, MAX_ATTEMPTS, WINDOW_MS)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'too_many_attempts', retryAfterMs: rl.retryAfterMs },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
    )
  }

  // ── 3. No code yet ⇒ mint one and deliver it over the method's channel. ──
  if (!body.code) {
    let flow: Awaited<ReturnType<typeof startSetupFlow>>
    try {
      flow = recoveryEmail
        ? await startSetupFlow({ email: recoveryEmail, purpose: 'password reset' })
        : await startSetupFlow()
    } catch {
      // FAIL CLOSED — no channel to prove control ⇒ refuse. For a no-old-password reset,
      // waving it through "because delivery is broken" is a wide-open door.
      return NextResponse.json(
        {
          error: 'delivery_channel_unavailable',
          message: 'Could not deliver a confirmation code, so control of the recovery channel cannot be proven.',
        },
        { status: 503 },
      )
    }
    // For the EMAIL method the code MUST actually reach the email — a fallback to the host
    // file is useless to a remote user, so treat that as a delivery failure, not success.
    if (method === 'email' && flow.channel !== 'email') {
      return NextResponse.json(
        { error: 'email_delivery_failed', message: 'The recovery email could not be sent. Check the SMTP configuration.' },
        { status: 503 },
      )
    }
    // Note what is NOT in this response: the code.
    return NextResponse.json({ codeRequired: true, channel: flow.channel, hint: flow.hint, expiresAt: flow.expiresAt })
  }

  // ── 4. Code supplied ⇒ a new password is mandatory (the code alone resets nothing). ──
  if (!body.newPassword) {
    return NextResponse.json({ error: 'new_password_required' }, { status: 400 })
  }

  // ── 5. Verify the one-shot code (setup-bootstrap consumes it + unlinks the host file). ──
  const v = verifySetupCode(body.code)
  if (!v.ok) {
    return NextResponse.json({ error: `code_${v.reason}` }, { status: 401 })
  }

  // ── 6. Verified code IS the authorization — run the shared tail (setPassword with NO
  // old-password check + securityPolicyReset dance + rate-limit clear + auto-login). This is
  // byte-identical to the passkey path, which reaches finalizeReset after verifying its assertion. ──
  return finalizeReset(body.newPassword, rlKey)
}
