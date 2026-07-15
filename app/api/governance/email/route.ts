import { NextRequest, NextResponse } from 'next/server'
import { enforceSystemOwner } from '@/lib/route-auth'
import { getRecoveryEmail, clearRecoveryEmail } from '@/lib/governance'
import { deleteSmtpPassword } from '@/lib/smtp-credential'

/**
 * Report the recovery-email configuration (TRDD-P7XKV3N9) — non-secret fields only (the
 * app-password lives in the OS credential store, never returned). Owner-gated.
 */
export async function GET(request: NextRequest) {
  const denied = enforceSystemOwner(request)
  if (denied) return denied

  const rec = getRecoveryEmail()
  if (!rec) return NextResponse.json({ configured: false })
  return NextResponse.json({
    configured: true,
    email: rec.email,
    verified: rec.verified,
    provider: rec.smtp ? { host: rec.smtp.host, port: rec.smtp.port, secure: rec.smtp.secure } : null,
  })
}

/**
 * Remove the recovery email AND its stored app-password (TRDD-P7XKV3N9). Owner-gated. Like
 * /configure this tears down the remote-reset channel, so it SHOULD also be classified
 * `strict` (sudo) in security-registry.json.
 */
export async function DELETE(request: NextRequest) {
  const denied = enforceSystemOwner(request)
  if (denied) return denied

  const rec = getRecoveryEmail()
  if (rec) {
    deleteSmtpPassword(rec.email)
    await clearRecoveryEmail()
  }
  return NextResponse.json({ cleared: true })
}
