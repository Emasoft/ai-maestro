/**
 * PATCH /api/governance/user
 *
 * Updates the local user's display name and/or avatar WITHOUT requiring a
 * password change. Both fields are optional; only the ones present in the
 * body are written. The endpoint is strict-auth via middleware — only the
 * authenticated system owner can update their own profile.
 */

import { NextRequest, NextResponse } from 'next/server'
import { setUserName, setUserAvatar, loadGovernance } from '@/lib/governance'
import { authenticateFromRequest, buildAuthContext } from '@/lib/agent-auth'

export const dynamic = 'force-dynamic'

export async function PATCH(request: NextRequest) {
  // Middleware has gated this request at the cookie level. Verify in full here.
  const authResult = authenticateFromRequest(request)
  if (authResult.error) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status ?? 401 })
  }
  const ctx = buildAuthContext(authResult)
  if (!ctx.isSystemOwner) {
    return NextResponse.json({ error: 'Forbidden — only the system owner can edit the local user profile' }, { status: 403 })
  }

  let body: { userName?: string; userAvatar?: string | null }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const updates: string[] = []

  if (typeof body.userName === 'string') {
    const trimmed = body.userName.trim()
    if (trimmed.length === 0 || trimmed.length > 64) {
      return NextResponse.json(
        { error: 'userName must be 1-64 characters' },
        { status: 400 }
      )
    }
    await setUserName(trimmed)
    updates.push('userName')
  }

  if ('userAvatar' in body) {
    const val = body.userAvatar
    if (val !== null && typeof val !== 'string') {
      return NextResponse.json(
        { error: 'userAvatar must be a string or null' },
        { status: 400 }
      )
    }
    if (typeof val === 'string' && val.length > 1024) {
      return NextResponse.json(
        { error: 'userAvatar too long (max 1024 chars)' },
        { status: 400 }
      )
    }
    await setUserAvatar(val ?? null)
    updates.push('userAvatar')
  }

  if (updates.length === 0) {
    return NextResponse.json(
      { error: 'No fields to update' },
      { status: 400 }
    )
  }

  const config = loadGovernance()
  return NextResponse.json({
    updated: updates,
    userName: config.userName ?? null,
    userAvatar: config.userAvatar ?? null,
  })
}
