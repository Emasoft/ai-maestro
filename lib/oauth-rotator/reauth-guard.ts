// The gate on the dashboard re-login routes (TRDD-OX5TT5OT).
//
// ONE helper for BOTH routes, deliberately: a security gate copied into two handlers is a gate that
// will eventually differ between them, and the difference is always discovered from the weaker side.
//
// THREE conditions, ALL required — not any:
//
//   1. CONSOLE  — the caller is physically at the machine running AI Maestro.
//   2. MAESTRO  — the caller is the owner's own session, never an agent.
//   3. SUDO     — a fresh one-shot token minted by re-entering the governance password.
//
// WHY console, when every other AI Maestro function is deliberately usable from a phone on the VPN:
// this route captures a CREDENTIAL. Tailscale authenticates the DEVICE; physical presence
// authenticates the PERSON, and a credential capture demands the second (USER ruling, 2026-07-29:
// "only the MAESTRO USER can login to claude, and ONLY WHEN IT IS BEFORE THE HOST COMPUTER, not
// when he connects from a remote device"). A borrowed or stolen session cookie on a remote device
// must not be able to start one. Reachable is not permitted.
//
// This is the THIRD console-gated operation on this host — after the governance-password revoke and
// MAESTRO login, whose own scope note says "do not copy the loopback check anywhere else". That
// note was correct when it was written and is now superseded for this one operation by the ruling
// above; extending the list is a deliberate act, recorded here and in that route, not an oversight.
//
// ORDER IS LOAD-BEARING. Console is checked FIRST, before any credential is read, so a remote
// caller gets ONE uniform answer and can never use the endpoint as an oracle — distinct
// "unauthenticated" vs "not at the console" replies would leak which half a probe got right.

import { NextRequest, NextResponse } from 'next/server'

import { isConsolePeer, peerAddress } from '@/lib/peer-address.mjs'
import { enforceMaestro } from '@/lib/route-auth'
import { requireSudoToken } from '@/lib/sudo-guard'

/**
 * Returns a refusal to return immediately, or null when all three conditions hold.
 *
 * `pathTemplate` must match the route's key in `security-registry.json`, which is what makes the
 * sudo requirement real — `requireSudoToken` is a NO-OP for a path the registry does not classify
 * `strict`, so a typo here silently removes the third factor while the code still reads as if it
 * were enforced.
 */
export function guardReauthRoute(request: NextRequest, pathTemplate: string): NextResponse | null {
  const peer = peerAddress(request) ?? ''
  if (!isConsolePeer(peer)) {
    return NextResponse.json(
      {
        error: 'console_required',
        message:
          'Logging in to Claude can only be done from the machine running AI Maestro. ' +
          'Remote devices on the VPN can use every other function — not this one.',
      },
      { status: 403 },
    )
  }
  const maestro = enforceMaestro(request)
  if (maestro) return maestro
  return requireSudoToken(request, 'POST', pathTemplate)
}
