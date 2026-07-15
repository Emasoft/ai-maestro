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
 *   - passkey: (not yet implemented) a WebAuthn assertion in place of a code.
 *
 * Flow (two calls; console & email):
 *   POST { method? }                    -> 200 { codeRequired, channel, hint, expiresAt }
 *   POST { method?, code, newPassword } -> 200 { reset: true, securityPolicyReset }  (+ session: auto-login)
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

// method defaults to 'console' (backward-compatible with the original single-method route).
// Call-1 sends { method? }. Call-2 sends { method?, code, newPassword }. Password bounds match
// the passwordPolicy DEFAULTS in lib/security-config.ts (min 8, max 256).
const BodySchema = z.object({
  method: z.enum(['console', 'email', 'passkey']).optional(),
  code: z.string().regex(/^\d{6}$/, 'code must be a 6-digit string').optional(),
  newPassword: z.string().min(8, 'password must be at least 8 characters').max(256).optional(),
}).strict()

/** Tight: this route mints codes and sets the master credential. 5 tries / 15 min / peer. */
const MAX_ATTEMPTS = 5
const WINDOW_MS = 15 * 60_000

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
    // A WebAuthn assertion replaces the code here; the challenge/verify wiring is a separate
    // follow-up. Fail loudly rather than silently falling back to a weaker method.
    return NextResponse.json({ error: 'not_implemented', message: 'Passkey reset is not available yet.' }, { status: 501 })
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

  // ── 6. Set the new password with NO old-password check — the verified code IS the
  // authorization. We deliberately call the low-level setPassword rather than the
  // service-layer setGovernancePassword, because the latter demands the current password
  // when a hash exists — exactly what the forgot-password user cannot supply. ──
  const wasUnlocked = isUnlocked()
  await setPassword(body.newPassword)

  // ── 7. If the config was locked (the true forgot case), its blob is keyed to the LOST
  // password and can never be decrypted again. Re-initialize it to DEFAULTS under the new
  // password. Only security POLICY tuning resets — no secrets live there. ──
  let securityPolicyReset = false
  if (!wasUnlocked) {
    saveSecurityConfig(getSecurityDefaults(), body.newPassword)
    securityPolicyReset = true
  }

  resetRateLimit(rlKey)

  // ── 8. Auto-login — the user proved control and set a fresh password; mint a session. ──
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
