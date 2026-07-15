import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { enforceSystemOwner } from '@/lib/route-auth'
import { autodetectSMTP } from '@/lib/smtp-autodetect'

/**
 * Preview the SMTP settings AI Maestro would use for an email address (TRDD-P7XKV3N9), so
 * the configure UI can show host/port/security + any app-password guidance BEFORE the owner
 * enters their password. Owner-gated (logged-in web user only — never an agent). No password
 * is supplied here, so verify=false: the authenticated reachability/credential check happens
 * at /configure, and this stays a fast, read-only preview.
 */
const BodySchema = z.object({ email: z.email().max(254) }).strict()

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

  const detected = await autodetectSMTP(parsed.data.email, { verify: false })
  if (!detected) return NextResponse.json({ error: 'no_smtp_detected' }, { status: 404 })

  // Non-secret settings only — safe to return to the owner so the UI can preview + link out.
  return NextResponse.json({
    host: detected.host,
    port: detected.port,
    secure: detected.secure,
    usernameFormat: detected.usernameFormat,
    source: detected.source,
    label: detected.label,
    known: detected.known,
    appPasswordUrl: detected.appPasswordUrl,
    note: detected.note,
  })
}
