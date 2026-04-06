/**
 * GET /api/auth/session
 *
 * Check if the current session cookie is valid.
 * Used by the React app to decide whether to show login modal.
 *
 * 200 { authenticated: true }  — valid session
 * 401 { authenticated: false } — no session or expired
 */

import { NextResponse } from 'next/server'
import { extractSessionFromCookie, validateSession } from '@/lib/session-auth'

export async function GET(request: Request) {
  const cookieHeader = request.headers.get('Cookie')
  const token = extractSessionFromCookie(cookieHeader)

  if (token && validateSession(token)) {
    return NextResponse.json({ authenticated: true })
  }

  return NextResponse.json({ authenticated: false }, { status: 401 })
}
