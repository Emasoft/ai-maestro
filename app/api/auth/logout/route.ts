/**
 * POST /api/auth/logout
 *
 * Invalidates the user session and clears the cookie.
 */

import { NextResponse } from 'next/server'
import {
  extractSessionFromCookie,
  invalidateSession,
  buildClearSessionCookie
} from '@/lib/session-auth'

export async function POST(request: Request) {
  try {
    const cookieHeader = request.headers.get('Cookie')
    const token = extractSessionFromCookie(cookieHeader)

    if (token) {
      await invalidateSession(token)
    }

    const response = NextResponse.json({ success: true })
    response.headers.set('Set-Cookie', buildClearSessionCookie())
    return response
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Auth Logout] Error:', msg)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
