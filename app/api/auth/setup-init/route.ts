/**
 * POST /api/auth/setup-init
 *
 * First-run setup step 1 (SEC-PHASE-6). Triggers a 6-digit verification
 * code that the server sends to the user via macOS notification (or
 * notify-send on Linux, or a 0600-permissioned file as last resort).
 *
 * The response describes WHERE the user should look for the code but
 * NEVER returns the code itself — that channel separation is the whole
 * point. The user must be physically able to read the OS notification
 * (or open the local file) to prove they own the host.
 *
 * Whitelisted in middleware.ts so it works before any auth is set up.
 * REJECTED with 409 if a governance password is already configured —
 * this endpoint is exclusively for first-run bootstrap.
 */

import { NextResponse } from 'next/server'
import { loadGovernance } from '@/lib/governance'
import { startSetupFlow } from '@/lib/setup-bootstrap'

export const dynamic = 'force-dynamic'

export async function POST() {
  // Refuse if a password already exists — there's no reason to
  // re-trigger the first-run flow on an already-bootstrapped host.
  // (Password change uses POST /api/governance/password instead.)
  const config = loadGovernance()
  if (config.passwordHash) {
    return NextResponse.json(
      {
        error: 'already_bootstrapped',
        message: 'Governance password already configured. Use POST /api/governance/password to change it.',
      },
      { status: 409 }
    )
  }

  try {
    const { channel, hint, expiresAt } = await startSetupFlow()
    return NextResponse.json({
      ok: true,
      channel,
      hint,
      expiresAt,
      ttlSeconds: 300,
    })
  } catch (err) {
    console.error('[setup-init] failed:', err)
    return NextResponse.json(
      { error: 'setup_failed', message: 'Could not dispatch setup code. Check server logs.' },
      { status: 500 }
    )
  }
}
