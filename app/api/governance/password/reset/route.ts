/**
 * POST /api/governance/password/reset — FORGOT-PASSWORD recovery (TRDD-P7XKV3N9 sibling).
 *
 * Unlike /invalidate, this route requires NO old password. It is the "I forgot my
 * password" path: you cannot prove knowledge of a secret you have lost, so the ONLY
 * factor is PRESENCE — a one-shot code delivered to the host (local file + best-effort
 * desktop notification, lib/setup-bootstrap.ts). A remote device on the VPN cannot read
 * that code, so it cannot reset. Console presence REPLACES the knowledge factor; that
 * substitution is the entire security property, which is why the console check is first
 * and unconditional. Dropping it would turn "forgot password" into a remote takeover.
 *
 * This is safe because anyone who can read a 0600 file in the owner's home (or see the
 * owner's desktop) already controls the machine — resetting the governance password
 * grants them nothing they could not already take.
 *
 * Flow (two calls):
 *   POST {}                    -> 200 { codeRequired: true, channel, hint, expiresAt }  (+ code on the host)
 *   POST { code, newPassword } -> 200 { reset: true, securityPolicyReset }  (+ session cookie: auto-login)
 *
 * Consequence surfaced to the caller: the governance password also keys
 * security-config.enc. When the config is not unlocked (the true forgot case) its blob
 * is keyed to the LOST password and can never be decrypted again, so we re-initialize
 * it to DEFAULTS under the new password and report securityPolicyReset:true. Only
 * security POLICY tuning is affected — no secrets or API keys live there.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { setPassword } from '@/lib/governance'
import { isConsolePeer, peerAddress } from '@/lib/peer-address.mjs'
import { startSetupFlow, verifySetupCode } from '@/lib/setup-bootstrap'
import { checkAndRecordAttempt, resetRateLimit } from '@/lib/rate-limit'
import { isUnlocked, saveSecurityConfig, getSecurityDefaults } from '@/lib/security-config'
import { createSession, buildSessionCookie } from '@/lib/session-auth'

// Call-1 sends {} (no fields). Call-2 sends { code, newPassword }. Password bounds
// match the passwordPolicy DEFAULTS in lib/security-config.ts (min 8, max 256).
const BodySchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'code must be a 6-digit string').optional(),
  newPassword: z.string().min(8, 'password must be at least 8 characters').max(256).optional(),
}).strict()

/** Tight: this route mints codes and sets the master credential. 5 tries / 15 min / peer. */
const MAX_ATTEMPTS = 5
const WINDOW_MS = 15 * 60_000

export async function POST(request: NextRequest) {
  const peer = peerAddress(request) ?? ''
  const rlKey = `pw-reset:${peer}`

  // ── 1. Console presence — FIRST and unconditional. It is the ONLY factor here (no
  // old password), so a remote caller must never get past this line, and must never
  // receive a code. Same reasoning as /invalidate, but here the stakes are higher
  // because there is no second factor behind it. ──
  if (!isConsolePeer(peer)) {
    return NextResponse.json(
      {
        error: 'console_required',
        message:
          'The password can only be reset from the machine running AI Maestro. ' +
          'Remote devices on the VPN can use every other function — not this one.',
      },
      { status: 403 },
    )
  }

  // ── 2. Throttle — call-1 mints codes (and desktop notifications); call-2 is a
  // code-guessing surface. Cap both per peer. ──
  const rl = checkAndRecordAttempt(rlKey, MAX_ATTEMPTS, WINDOW_MS)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'too_many_attempts', retryAfterMs: rl.retryAfterMs },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
    )
  }

  let body: z.infer<typeof BodySchema>
  try {
    body = BodySchema.parse(await request.json())
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  // ── 3. No code yet ⇒ put one on the host. ──
  if (!body.code) {
    let flow: Awaited<ReturnType<typeof startSetupFlow>>
    try {
      flow = await startSetupFlow()
    } catch {
      // FAIL CLOSED — no channel to the host ⇒ presence cannot be proven ⇒ refuse.
      // Waving it through "because notifications are broken" reduces this to nothing,
      // which for a no-old-password reset is a wide-open door.
      return NextResponse.json(
        {
          error: 'presence_channel_unavailable',
          message: 'Could not deliver a confirmation code to this machine, so presence cannot be proven.',
        },
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

  // ── 5. Verify the presence code (one-shot; setup-bootstrap consumes it + unlinks the file). ──
  const v = verifySetupCode(body.code)
  if (!v.ok) {
    return NextResponse.json({ error: `code_${v.reason}` }, { status: 401 })
  }

  // ── 6. Set the new password with NO old-password check — the console + code IS the
  // authorization. We deliberately call the low-level setPassword rather than the
  // service-layer setGovernancePassword, because the latter demands the current
  // password when a hash exists — which is exactly what the forgot-password user
  // cannot supply. setPassword re-hashes, clears passwordInvalidatedAt, and re-encrypts
  // security-config only if it is currently unlocked. ──
  const wasUnlocked = isUnlocked()
  await setPassword(body.newPassword)

  // ── 7. If the config was locked (the true forgot case), its blob is keyed to the
  // LOST password and can never be decrypted again — setPassword's re-encrypt was
  // skipped. Re-initialize it to DEFAULTS under the new password so the host is not
  // left with an unreadable config. Only security POLICY tuning resets — no secrets
  // live there — so this is a safe, surfaced consequence, not data loss. ──
  let securityPolicyReset = false
  if (!wasUnlocked) {
    saveSecurityConfig(getSecurityDefaults(), body.newPassword)
    securityPolicyReset = true
  }

  resetRateLimit(rlKey)

  // ── 8. Auto-login — the user proved presence and set a fresh password; mint a session
  // so they land in the app without a separate login round (mirrors setup-verify). ──
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
