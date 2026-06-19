/**
 * POST /api/governance/password - Set or change governance password
 *
 * SF-031 (P8): Delegates all business logic to governance-service.setGovernancePassword
 * to eliminate duplicate password logic between route and service layers.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { setGovernancePassword } from '@/services/governance-service'
import { enforceSystemOwner } from '@/lib/route-auth'
import { authenticateFromRequest, buildAuthContext } from '@/lib/agent-auth'
import { requireSudoToken } from '@/lib/sudo-guard'
import { loadSecurityConfig } from '@/lib/security-config'

const PasswordSchema = z.object({
  password: z.string().min(1).max(256),
  currentPassword: z.string().optional(),
  userName: z.string().max(128).optional(),
}).strict()

// NT-023 (P8): Ensure Next.js does not cache this route
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  // Strict: changing the governance password is the most sensitive
  // operation on the host. System-owner only + sudo token required.
  const authErr = enforceSystemOwner(request)
  if (authErr) return authErr

  // R37.4 — a MAESTRO-DELEGATE has NO power over the MAESTRO's attributes and
  // CANNOT change the MAESTRO's sudo password. Under the user-authority model
  // this global governance password is the MAESTRO's password, so refuse a
  // delegate caller. enforceSystemOwner admits the active maestro (which a
  // delegate is while acting), so this extra check is what stops the delegate.
  // FLAG-OFF: userTitle is undefined → the guard is inert (no behavior change).
  {
    const result = authenticateFromRequest(request)
    if (!result.error) {
      const ctx = buildAuthContext(result)
      if (ctx.userTitle === 'maestro-delegate') {
        return NextResponse.json(
          { error: 'forbidden_delegate_cannot_change_maestro_password', message: 'A MAESTRO-DELEGATE cannot change the MAESTRO\'s sudo password (R37.4).' },
          { status: 403 },
        )
      }
    }
  }

  const sudoErr = requireSudoToken(request, 'POST', '/api/governance/password')
  if (sudoErr) return sudoErr

  try {
    let raw: unknown
    try { raw = await request.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = PasswordSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) },
        { status: 400 },
      )
    }

    const cfg = loadSecurityConfig().passwordPolicy
    if (parsed.data.password.length < cfg.minLength) {
      return NextResponse.json({ error: `Password must be at least ${cfg.minLength} characters` }, { status: 400 })
    }

    const result = await setGovernancePassword(parsed.data)

    // Defense-in-depth: guard against service returning undefined at runtime
    if (!result) {
      return NextResponse.json({ error: 'Service returned no result' }, { status: 500 })
    }

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data, { status: result.status })
  } catch (error) {
    console.error('[governance] password POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
