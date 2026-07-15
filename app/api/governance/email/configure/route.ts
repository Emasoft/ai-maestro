import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { enforceSystemOwner } from '@/lib/route-auth'
import { autodetectSMTP, verifyCredentials } from '@/lib/smtp-autodetect'
import { storeSmtpPassword } from '@/lib/smtp-credential'
import { setRecoveryEmail } from '@/lib/governance'
import { startSetupFlow } from '@/lib/setup-bootstrap'

/**
 * Configure the recovery email ONCE (TRDD-P7XKV3N9) — the "enter the password once" surface.
 * Autodetects SMTP, verifies the app-password by an authenticated handshake, and on SUCCESS
 * persists the password (OS credential store) + the settings (governance), then emails a
 * confirmation code the owner enters at /verify. AUTH_REQUIRED (host/port right but the
 * password was rejected / SMTP is disabled in webmail) and FAILED (unreachable) return their
 * status + guidance WITHOUT storing anything.
 *
 * SECURITY: setting the recovery email establishes a REMOTE password-reset channel, so it is
 * as sensitive as changing the password — an attacker who set their own address here could
 * reset the governance password. It is owner-gated (never an agent) and SHOULD additionally
 * be classified `strict` (sudo) in security-registry.json so it demands a fresh password.
 */
const BodySchema = z.object({
  email: z.email().max(254),
  appPassword: z.string().min(1).max(256),
}).strict()

export async function POST(request: NextRequest) {
  const denied = enforceSystemOwner(request)
  if (denied) return denied

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', detail: parsed.error.issues }, { status: 400 })
  const { email, appPassword } = parsed.data

  const detected = await autodetectSMTP(email)
  if (!detected) return NextResponse.json({ status: 'FAILED', error: 'no_smtp_detected' }, { status: 200 })

  const { status, config, instructions } = await verifyCredentials(
    { host: detected.host, port: detected.port, secure: detected.secure, usernameFormat: detected.usernameFormat },
    email,
    appPassword,
  )

  if (status !== 'SUCCESS') {
    // Store nothing: AUTH_REQUIRED means enable SMTP / use an app-password; FAILED means
    // unreachable. The UI shows `instructions` and the detected settings for a manual retry.
    return NextResponse.json({ status, instructions, detected: { host: config.host, port: config.port, secure: config.secure } }, { status: 200 })
  }

  // Verified — persist ONCE. Password → OS credential store (survives a governance reset);
  // settings → governance (UNVERIFIED until the owner confirms receipt of the code below).
  storeSmtpPassword(email, appPassword)
  await setRecoveryEmail(email, { host: config.host, port: config.port, secure: config.secure, usernameFormat: config.usernameFormat })
  const flow = await startSetupFlow({ email, purpose: 'email verification' })
  // The password is verified + stored; only the confirmation-code DELIVERY can still degrade.
  // If the mailer fell back to the host file (channel !== 'email'), a REMOTE owner cannot read
  // it, so the email will never verify — surface codeSent so the UI can warn "settings saved,
  // but the confirmation email could not be sent; check your SMTP configuration."
  return NextResponse.json({ status: 'SUCCESS', codeSent: flow.channel === 'email', channel: flow.channel, hint: flow.hint, expiresAt: flow.expiresAt })
}
