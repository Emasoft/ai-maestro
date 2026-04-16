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
