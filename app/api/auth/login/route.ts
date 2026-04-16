/**
 * POST /api/auth/login
 *
 * User logs in with governance password → gets httpOnly session cookie.
 * This closes SF-058: browser requests without the cookie are now rejected
 * instead of receiving system-owner access.
 *
 * Body: { password: string }
 * Success: 200 + Set-Cookie: aim_session=<token>
 * Failure: 401 { error: "Invalid password" }
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createSession, buildSessionCookie } from '@/lib/session-auth'
import { checkAndRecordAttempt, resetRateLimit } from '@/lib/rate-limit'

const LoginSchema = z.object({
  password: z.string().min(1).max(256),
}).strict()

export async function POST(request: Request) {
  try {
    const raw = await request.json()
    const parsed = LoginSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Password required' }, { status: 400 })
    }
    const { password } = parsed.data

    // CC-GOV-014: Rate-limit login attempts
    const rateCheck = checkAndRecordAttempt('auth-login')
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts. Try again later.' },
        { status: 429 }
      )
    }

    // Verify against governance password
    const { verifyPassword } = await import('@/lib/governance')

    const valid = await verifyPassword(password)
    // verifyPassword returns false for both "no password set" and "wrong password".
    // This is intentional — we don't reveal whether a password exists.
    if (!valid) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
    }

    // Reset rate limit on successful login
    resetRateLimit('auth-login')

    // Unlock encrypted security config with the plaintext password
    const { unlockSecurityConfig } = await import('@/lib/security-config')
    unlockSecurityConfig(password)

    // Create session
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined
    const token = await createSession(ip || undefined)

    // Determine if HTTPS (for Secure flag on cookie)
    const isSecure = request.url.startsWith('https')

    const response = NextResponse.json({ success: true })
    response.headers.set('Set-Cookie', buildSessionCookie(token, isSecure))
    response.headers.set('Cache-Control', 'no-store')

    return response
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Auth Login] Error:', msg)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
