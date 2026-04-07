import { NextRequest, NextResponse } from 'next/server'
import { notifyGroupSubscribers } from '@/services/groups-service'

// POST /api/groups/[id]/notify - Notify all group subscribers
// Body: { message: string, priority?: string }
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Validate body is a plain object (not null, array, or primitive)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 })
  }

  const { message, priority } = body as Record<string, unknown>

  if (!message || typeof message !== 'string') {
    return NextResponse.json({ error: 'message is required and must be a string' }, { status: 400 })
  }

  if (priority !== undefined && typeof priority !== 'string') {
    return NextResponse.json({ error: 'priority must be a string' }, { status: 400 })
  }

  try {
    const result = await notifyGroupSubscribers(id, message, priority)
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.data)
  } catch (err) {
    console.error(`[Groups Notify] Failed to notify group ${id}:`, err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
