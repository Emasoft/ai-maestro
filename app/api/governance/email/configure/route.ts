import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { enforceSystemOwner } from '@/lib/route-auth'
import { autodetectSMTP, verifyCredentials, type SmtpConfig } from '@/lib/smtp-autodetect'
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
  // The mail-provider SMTP login id (TRDD-P7XKV3N9). Optional: blank/absent ⇒ the server
  // derives the login from usernameFormat (the prior behavior). Present ⇒ used verbatim,
  // for providers whose login is neither the full email nor its local-part.
  userid: z.string().trim().max(256).optional(),
  // Manual SMTP server override (TRDD-P7XKV3N9). When `host` is supplied, it is used
  // VERBATIM and autodetection is SKIPPED — the escape hatch for a provider whose server
  // autodetection gets wrong or cannot reach (custom-domain relays, self-hosted, corporate),
  // and the answer to "it said the address was wrong but never asked me for it". Same risk
  // class as autodetect (the route already opens SMTP to a discovered host) and owner-gated.
  host: z.string().trim().min(1).max(255).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  secure: z.boolean().optional(),
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
  const { email, appPassword, userid, host, port, secure } = parsed.data

  // A manual host override wins over autodetection — it is the owner's explicit server, used
  // when detection is wrong or unreachable. `secure` defaults from the port (465 ⇒ implicit
  // TLS) when unspecified; usernameFormat is 'full' (the userid field overrides the login when
  // the provider needs something else). Otherwise autodetect from the email domain as before.
  let cfg: SmtpConfig
  if (host) {
    const p = port ?? 587
    cfg = { host, port: p, secure: secure ?? p === 465, usernameFormat: 'full' }
  } else {
    const detected = await autodetectSMTP(email)
    if (!detected) return NextResponse.json({ status: 'FAILED', error: 'no_smtp_detected' }, { status: 200 })
    cfg = { host: detected.host, port: detected.port, secure: detected.secure, usernameFormat: detected.usernameFormat }
  }

  const { status, config, instructions } = await verifyCredentials(cfg, email, appPassword, userid)

  if (status !== 'SUCCESS') {
    // Store nothing: AUTH_REQUIRED means enable SMTP / use an app-password; FAILED means
    // unreachable. The UI shows `instructions` and the detected settings for a manual retry.
    return NextResponse.json({ status, instructions, detected: { host: config.host, port: config.port, secure: config.secure } }, { status: 200 })
  }

  // Verified — persist ONCE. Password → OS credential store (survives a governance reset);
  // settings → governance (UNVERIFIED until the owner confirms receipt of the code below).
  storeSmtpPassword(email, appPassword)
  // Persist the verified server settings, plus the explicit login id ONLY when the MAESTRO
  // supplied one (userid is zod-trimmed). Omitting the key keeps the stored object clean and
  // means the send path derives the login from usernameFormat (the prior behavior).
  await setRecoveryEmail(email, {
    host: config.host,
    port: config.port,
    secure: config.secure,
    usernameFormat: config.usernameFormat,
    ...(userid ? { username: userid } : {}),
  })
  const flow = await startSetupFlow({ email, purpose: 'email verification' })
  // The password is verified + stored; only the confirmation-code DELIVERY can still degrade.
  // If the mailer fell back to the host file (channel !== 'email'), a REMOTE owner cannot read
  // it, so the email will never verify — surface codeSent so the UI can warn "settings saved,
  // but the confirmation email could not be sent; check your SMTP configuration."
  return NextResponse.json({ status: 'SUCCESS', codeSent: flow.channel === 'email', channel: flow.channel, hint: flow.hint, expiresAt: flow.expiresAt })
}
