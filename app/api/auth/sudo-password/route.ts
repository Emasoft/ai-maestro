/**
 * POST /api/auth/sudo-password
 *
 * Issues a short-lived sudo-mode token after verifying the governance
 * password. Required before invoking any API route classified "strict" in
 * security-registry.json (e.g. DELETE agent, DELETE team, change title).
 *
 * Body: { password: string }
 * Response: { token: string, expiresAt: number (unix ms) }
 *
 * Failure modes:
 *   - 400 missing/invalid body
 *   - 401 caller not authenticated at all (middleware rejects first)
 *   - 403 password mismatch
 *   - 503 governance password not configured yet (bootstrap state)
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateFromRequest, buildAuthContext } from '@/lib/agent-auth'
import { issueSudoToken } from '@/lib/sudo-auth'

const SudoSchema = z.object({
  password: z.string().min(1).max(256),
}).strict()

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const authResult = authenticateFromRequest(request)
  if (authResult.error) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status ?? 401 })
  }
  const ctx = buildAuthContext(authResult)
  const subject = ctx.isSystemOwner ? 'system-owner' : (ctx.agentId ?? 'unknown')

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = SudoSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'password required' }, { status: 400 })
  }
  const { password } = parsed.data

  try {
    const { token, expiresAt } = await issueSudoToken(password, subject)
    return NextResponse.json({ token, expiresAt })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.startsWith('sudo_mode_unavailable')) {
      return NextResponse.json(
        { error: 'governance password not configured' },
        { status: 503 }
      )
    }
    if (msg === 'sudo_mode_bad_password') {
      return NextResponse.json(
        { error: 'invalid password' },
        { status: 403 }
      )
    }
    console.error('[sudo-password] unexpected error:', msg)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
