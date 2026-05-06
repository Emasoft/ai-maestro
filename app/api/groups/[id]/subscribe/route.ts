import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { subscribeAgent } from '@/services/groups-service'
import { enforceAuth } from '@/lib/route-auth'
import { authenticateFromRequest, buildAuthContext } from '@/lib/agent-auth'

const SubscribeSchema = z.object({
  agentId: z.string().uuid(),
}).strict()

// POST /api/groups/[id]/subscribe - Subscribe an agent to a group
// Body: { agentId: string }
// Authentication required (governance-free per R20).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authErr = enforceAuth(request)
  if (authErr) return authErr

  try {
    const { id: groupId } = await params

    let raw: unknown
    try { raw = await request.json() } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const parsed = SubscribeSchema.safeParse(raw)
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
    const result = await subscribeAgent(groupId, parsed.data.agentId, buildAuthContext(auth))
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (error) {
    console.error('Failed to subscribe agent to group:', error)
    return NextResponse.json(
      { error: `Failed to subscribe agent: ${(error as Error).message}` },
      { status: 500 }
    )
  }
}
