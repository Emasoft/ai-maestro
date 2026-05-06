import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { unsubscribeAgent } from '@/services/groups-service'
import { enforceAuth } from '@/lib/route-auth'
import { authenticateFromRequest, buildAuthContext } from '@/lib/agent-auth'

const UnsubscribeSchema = z.object({
  agentId: z.string().uuid(),
}).strict()

// POST /api/groups/[id]/unsubscribe - Unsubscribe an agent from a group
// Body: { agentId: string }
// Authentication required (governance-free per R20).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = enforceAuth(request)
  if (authErr) return authErr

  const { id: groupId } = await params

  let raw: unknown
  try { raw = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = UnsubscribeSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) },
      { status: 400 },
    )
  }

  // SVC2-MAJ-07 (2026-05-06): forward authContext.
  const auth = authenticateFromRequest(request)
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status || 401 })
  }
  const result = await unsubscribeAgent(groupId, parsed.data.agentId, buildAuthContext(auth))
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.data)
}
