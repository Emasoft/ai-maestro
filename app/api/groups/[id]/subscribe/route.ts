import { NextRequest, NextResponse } from 'next/server'
import { subscribeAgent } from '@/services/groups-service'
import { enforceAuth } from '@/lib/route-auth'

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

    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { agentId } = body
    if (!agentId || typeof agentId !== 'string') {
      return NextResponse.json({ error: 'agentId is required and must be a string' }, { status: 400 })
    }

    const result = await subscribeAgent(groupId, agentId)
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
