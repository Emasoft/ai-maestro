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
  // If no governance password is set, allow open access (otherwise user is locked out
  // with no way to reach Settings to set the password — chicken-and-egg problem).
  const { loadGovernance } = await import('@/lib/governance')
  const config = loadGovernance()
  if (!config.passwordHash) {
    return NextResponse.json({ authenticated: true, passwordNotSet: true })
  }

  const cookieHeader = request.headers.get('Cookie')
  const token = extractSessionFromCookie(cookieHeader)

  if (token && validateSession(token)) {
    return NextResponse.json({ authenticated: true })
  }

  return NextResponse.json({ authenticated: false }, { status: 401 })
}
