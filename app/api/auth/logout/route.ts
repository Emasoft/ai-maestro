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
  const cookieHeader = request.headers.get('Cookie')
  const token = extractSessionFromCookie(cookieHeader)

  if (token) {
    invalidateSession(token)
  }

  const response = NextResponse.json({ success: true })
  response.headers.set('Set-Cookie', buildClearSessionCookie())
  return response
}
