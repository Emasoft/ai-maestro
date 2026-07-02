/**
 * POST /api/auth/setup-verify
 *
 * First-run setup step 2 (SEC-PHASE-6). Validates the 6-digit code from
 * /api/auth/setup-init, then persists the chosen governance password,
 * username, and avatar to ~/.aimaestro/governance.json. On success the
 * caller is logged in immediately — a session cookie is set in the
 * response so the browser can proceed without a separate login round.
 *
 * Body: {
 *   code: string         (6 digits)
 *   password: string     (min 8 chars)
 *   userName: string     (1-64 chars)
 *   userAvatar?: string  (optional avatar identifier)
 * }
 *
 * Whitelisted in middleware.ts so it works before any auth is set up.
 * REJECTED with 409 if a governance password is already configured.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { loadGovernance } from '@/lib/governance'
import { setGovernancePassword } from '@/services/governance-service'
import { setUserAvatar } from '@/lib/governance'
import { verifySetupCode } from '@/lib/setup-bootstrap'
import { createSession, buildSessionCookie } from '@/lib/session-auth'

export const dynamic = 'force-dynamic'

// API-MIN-02 fix: replaced manual field validation with a Zod schema for
// consistency with other routes (see app/api/auth/sudo-password/route.ts).
// `.strict()` rejects unknown fields; the per-field constraints match the
// audit recommendation (`z.object({ code: z.string().min(1).max(256) }).strict()`)
// extended to cover the full body.
const SetupVerifySchema = z.object({
  code: z.string().min(1).max(256).regex(/^\d{6}$/, 'code must be a 6-digit string'),
  password: z.string().min(8, 'password must be at least 8 characters'),
  userName: z.string().min(1).max(64),
  userAvatar: z.string().max(1024).optional(),
}).strict()

export async function POST(request: NextRequest) {
  // Refuse if already bootstrapped
  const existing = loadGovernance()
  if (existing.passwordHash) {
    return NextResponse.json(
      { error: 'already_bootstrapped', message: 'Governance password already configured.' },
      { status: 409 }
    )
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = SetupVerifySchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return NextResponse.json(
      { error: 'invalid_request', message: issue?.message || 'Invalid request body', issues: parsed.error.issues },
      { status: 400 }
    )
  }
  const body = parsed.data
  const trimmedUserName = body.userName.trim()
  if (trimmedUserName.length === 0) {
    return NextResponse.json(
      { error: 'invalid_user_name', message: 'userName must not be only whitespace' },
      { status: 400 }
    )
  }

  // Verify the OS-notification code (one-shot, consumes record on success)
  const verify = verifySetupCode(body.code)
  if (!verify.ok) {
    const msgMap: Record<string, string> = {
      no_code: 'No setup code is pending — call POST /api/auth/setup-init first.',
      expired: 'Setup code expired (5-minute TTL). Request a new one.',
      mismatch: 'Setup code does not match.',
      rate_limited: 'Too many failed attempts. Request a new setup code.',
    }
    return NextResponse.json(
      { error: 'verify_failed', reason: verify.reason, message: msgMap[verify.reason] },
      { status: 403 }
    )
  }

  // Persist password + username via the canonical service. setGovernancePassword
  // takes both fields atomically so a failure halfway leaves no half-state.
  const result = await setGovernancePassword({
    password: body.password,
    userName: trimmedUserName,
  })
  if (result.error) {
    console.error('[setup-verify] setGovernancePassword failed:', result.error)
    return NextResponse.json(
      { error: 'persist_failed', message: result.error },
      { status: result.status ?? 500 }
    )
  }

  // Avatar (optional) — persisted separately because the password service
  // doesn't know about it. A failure here is non-fatal — the user is
  // already bootstrapped and can fix the avatar from Settings later.
  if (body.userAvatar) {
    try {
      await setUserAvatar(body.userAvatar)
    } catch (err) {
      console.warn('[setup-verify] setUserAvatar failed (non-fatal):', err)
    }
  }

  // Log the user in immediately by minting a session token
  const token = await createSession()
  const response = NextResponse.json({
    ok: true,
    userName: trimmedUserName,
    message: 'Bootstrap complete. You are now logged in.',
  })
  response.headers.set('Set-Cookie', buildSessionCookie(token))
  return response
}
