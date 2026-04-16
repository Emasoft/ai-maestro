/**
 * WebAuthn Credentials Management
 *
 * GET    /api/auth/webauthn/credentials  — List registered credentials (system-owner only)
 * DELETE /api/auth/webauthn/credentials  — Remove a credential by ID (system-owner + sudo)
 *
 * These endpoints manage the passkey inventory. Listing shows credential metadata
 * (never the public key). Deletion requires sudo mode for safety.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { loadCredentials, deleteCredential } from '@/lib/webauthn-server'
import { extractSessionFromCookie, validateSession } from '@/lib/session-auth'
import { validateAndConsumeSudoToken } from '@/lib/sudo-auth'

// ============================================================================
// Helpers
// ============================================================================

function isAuthenticated(request: Request): boolean {
  const cookieHeader = request.headers.get('cookie')
  const token = extractSessionFromCookie(cookieHeader)
  if (!token) return false
  return validateSession(token)
}

// ============================================================================
// GET — List registered credentials
// ============================================================================

export async function GET(request: Request) {
  if (!isAuthenticated(request)) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  try {
    const credentials = loadCredentials()

    // Return metadata only — never expose the public key material
    const safeList = credentials.map(c => ({
      credentialID: c.credentialID,
      label: c.label,
      createdAt: c.createdAt,
      transports: c.transports,
      counter: c.counter,
    }))

    return NextResponse.json({ credentials: safeList })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list credentials'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ============================================================================
// DELETE — Remove a credential by ID
// ============================================================================

const DeleteSchema = z.object({
  credentialID: z.string().min(1),
}).strict()

export async function DELETE(request: Request) {
  if (!isAuthenticated(request)) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  // Must have sudo token
  const sudoToken = request.headers.get('x-sudo-token')
  const sudoResult = validateAndConsumeSudoToken(sudoToken)
  if (!sudoResult.ok) {
    return NextResponse.json(
      { error: 'Sudo token required for credential deletion', reason: sudoResult.reason },
      { status: 403 }
    )
  }

  try {
    const raw = await request.json()
    const parsed = DeleteSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'credentialID is required' },
        { status: 400 }
      )
    }

    const { credentialID } = parsed.data
    const removed = deleteCredential(credentialID)

    if (!removed) {
      return NextResponse.json(
        { error: 'Credential not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, credentialID })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete credential'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
