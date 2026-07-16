import { NextRequest, NextResponse } from 'next/server'
import { enforceSystemOwner } from '@/lib/route-auth'
import { setRecoveryOptOut, isRecoverySetupComplete } from '@/lib/governance'

/**
 * POST /api/governance/recovery-optout (TRDD-7U927FCM)
 *
 * The escape hatch for the first-run REQUIRED-recovery gate: the owner explicitly chooses to
 * rely on console/passkey recovery INSTEAD of configuring a recovery email. Sets recoveryOptOut
 * so isRecoverySetupComplete() becomes true and the gate stops blocking app entry.
 *
 * DELIBERATELY owner-gated ONLY — NOT console-gated. Console-gating would re-introduce the exact
 * lockout the escape hatch exists to prevent: a REMOTE owner (iPad over Tailscale) on a host
 * whose SMTP is unreachable could then neither configure email NOR opt out, and would be stranded
 * mid-first-run. Waiving one's own recovery method is squarely within owner authority (the caller
 * already holds an authenticated owner session), so a session check is the correct and sufficient
 * gate. NOT classified strict either — it runs immediately after bootstrap, and a sudo re-prompt
 * one screen after setting the password is friction with no security gain.
 */
export async function POST(request: NextRequest) {
  const denied = enforceSystemOwner(request)
  if (denied) return denied

  await setRecoveryOptOut(true)
  return NextResponse.json({ optOut: true, recoverySetupComplete: isRecoverySetupComplete() })
}
