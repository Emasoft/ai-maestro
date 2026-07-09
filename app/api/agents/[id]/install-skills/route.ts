/**
 * POST /api/agents/{id}/install-skills
 *
 * Install all ai-maestro skills from Claude into a non-Claude agent's skill directory.
 * Uses the cross-client skill conversion service to copy skills from Claude's
 * plugin cache to the target client's skill path.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAgent } from '@/lib/agent-registry'
import { authenticateFromRequest } from '@/lib/agent-auth'
import { authorize } from '@/lib/authorization'
import { detectClientType } from '@/lib/client-capabilities'
import { convertSkill, listClientSkills } from '@/services/cross-client-skill-service'
import { isValidUuid } from '@/lib/validation'
import { enforceAuth } from '@/lib/route-auth'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = enforceAuth(request)
  if (authErr) return authErr

  const { id } = await params

  if (!isValidUuid(id)) {
    return NextResponse.json({ error: 'Invalid agent ID format' }, { status: 400 })
  }

  // TRDD-D3RP7KQZ: installing skills is CONFIGURATION, so no agent may do it to
  // itself, and only a MANAGER (or the target's own COS) may do it to another.
  // `enforceAuth` above only AUTHENTICATES — it proves who the caller is and
  // nothing about what they may do. Without this check any authenticated agent
  // could reinstall the skill set on itself or on any other non-Claude agent,
  // which is precisely the self-reconfiguration the invariant forbids.
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }
  const authz = authorize(auth, 'manage-skills', id)
  if (!authz.allowed) {
    return NextResponse.json({ error: authz.reason || 'Forbidden' }, { status: 403 })
  }

  const agent = getAgent(id)
  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  const clientType = detectClientType(agent.program || 'claude')

  if (clientType === 'claude') {
    return NextResponse.json(
      { error: 'Claude agents use the plugin system — use claude plugin install ai-maestro' },
      { status: 400 }
    )
  }

  // Get all Claude skills and convert each to the target client
  const claudeSkills = await listClientSkills('claude')
  const results = { installed: [] as string[], skipped: [] as string[], errors: [] as Array<{ skill: string; error: string }> }

  for (const skillName of claudeSkills) {
    const result = await convertSkill(skillName, 'claude', clientType)
    if (result.success) {
      results.installed.push(skillName)
    } else if (String(result.error ?? '').includes('not found')) {
      results.skipped.push(skillName)
    } else {
      results.errors.push({ skill: skillName, error: result.error || 'Unknown error' })
    }
  }

  return NextResponse.json(results)
}
