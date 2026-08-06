/**
 * POST /api/daemon/enroll — enroll the janitor daemon's Ed25519 public key (TRDD-APN5WB2L, #60).
 *
 * OWNER-GATED, and classified `strict` in security-registry.json: enrolling a key grants a
 * non-agent principal the ability to inject prompts and interrupts into any managed session, so
 * it is exactly the class of operation sudo-mode exists for. The daemon can never reach this route
 * with its own signature — that asymmetry is what stops a compromised daemon from re-enrolling a
 * new key for itself.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { requireSudoToken } from '@/lib/sudo-guard'
import { enrollDaemonPrincipal } from '@/services/daemon-inject-service'
import { internalError } from '@/lib/error-response'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const sudoErr = requireSudoToken(request, 'POST', '/api/daemon/enroll')
    if (sudoErr) return sudoErr

    const auth = authenticateFromRequest(request)
    if (auth.error) {
      return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
    }
    // The service refuses a non-owner context as well — two independent gates, because a route
    // that is the ONLY thing standing between a caller and a principal grant is one refactor away
    // from being the thing nobody re-checks.
    const isSystemOwner = !auth.agentId
    const body = await request.json().catch(() => null)
    const result = await enrollDaemonPrincipal(body, { isSystemOwner, agentId: auth.agentId })
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data, { status: result.status })
  } catch (error) {
    return internalError(error, 'Daemon enroll')
  }
}
