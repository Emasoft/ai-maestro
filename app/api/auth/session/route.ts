/**
 * GET /api/auth/session
 *
 * Check if the current session cookie is valid.
 * Used by the React app to decide whether to show login modal.
 *
 * 200 { authenticated: true }  — valid session
 * 200 { authenticated: true, passwordNotSet: true } — no governance password configured (open access)
 * 401 { authenticated: false } — no session or expired
 */

import { NextResponse } from 'next/server'
import { extractSessionFromCookie, validateSession } from '@/lib/session-auth'

export async function GET(request: Request) {
  try {
    // If no governance password is set, allow open access (otherwise user is locked out
    // with no way to reach Settings to set the password — chicken-and-egg problem).
    const { loadGovernance, isRecoverySetupComplete } = await import('@/lib/governance')
    const config = loadGovernance()
    if (!config.passwordHash) {
      // `passwordInvalidatedAt` distinguishes a FORCED ROTATION from a fresh
      // install (TRDD-P7XKV3N9). Both land here with no hash, but they mean
      // opposite things to the person reading the screen: "welcome, pick a
      // password" is reassuring, and it is the WRONG thing to say when someone
      // just revoked the credential — if that was not you, you need to know now.
      const res = NextResponse.json({
        authenticated: true,
        passwordNotSet: true,
        passwordInvalidatedAt: config.passwordInvalidatedAt ?? null,
      })
      res.headers.set('Cache-Control', 'no-store')
      return res
    }

    const cookieHeader = request.headers.get('Cookie')
    const token = extractSessionFromCookie(cookieHeader)

    if (token && validateSession(token)) {
      // recoverySetupComplete gates the first-run required-recovery step (TRDD-7U927FCM):
      // LoginGate keeps the owner on the recovery step until they configure a verified
      // recovery email OR opt out to console/passkey recovery.
      const res = NextResponse.json({ authenticated: true, recoverySetupComplete: isRecoverySetupComplete() })
      res.headers.set('Cache-Control', 'no-store')
      return res
    }

    const res = NextResponse.json({ authenticated: false }, { status: 401 })
    res.headers.set('Cache-Control', 'no-store')
    return res
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Auth Session] Error:', msg)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
