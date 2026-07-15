import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { enforceSystemOwner } from '@/lib/route-auth'
import { verifySetupCode } from '@/lib/setup-bootstrap'
import { getRecoveryEmail, setRecoveryEmailVerified } from '@/lib/governance'

/**
 * Confirm the owner received the code at the configured recovery email (TRDD-P7XKV3N9) —
 * this proves the address is actually reachable, marking it verified so it may be used to
 * deliver a REMOTE password-reset code later. Owner-gated. The code is one-shot (consumed by
 * verifySetupCode), so a captured code cannot be replayed.
 */
const BodySchema = z.object({ code: z.string().regex(/^\d{6}$/, 'code must be 6 digits') }).strict()

export async function POST(request: NextRequest) {
  const denied = enforceSystemOwner(request)
  if (denied) return denied

  // Nothing to verify unless an email was configured first (/configure stored it, unverified).
  if (!getRecoveryEmail()) return NextResponse.json({ error: 'no_recovery_email' }, { status: 400 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', detail: parsed.error.issues }, { status: 400 })

  const res = verifySetupCode(parsed.data.code)
  if (!res.ok) return NextResponse.json({ error: `code_${res.reason}` }, { status: 401 })

  await setRecoveryEmailVerified()
  return NextResponse.json({ verified: true })
}
